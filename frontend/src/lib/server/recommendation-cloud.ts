import type { Event, ValueBet } from "@/lib/api";
import { getUpcomingMatches } from "@/lib/server/football-cloud";

type RiskLevel = "prudent" | "balanced" | "aggressive";

interface RecommendationInput {
  hours?: number;
  bankroll?: number;
  stake?: number;
  target_odds?: number;
  risk_level?: RiskLevel;
  max_legs?: number;
  min_odds?: number;
  max_odds?: number;
}

interface CandidateBet extends ValueBet {
  event: Event;
  score: number;
  recommended_stake: number;
  potential_return: number;
  reasons: string[];
  warnings: string[];
  decision: "consider" | "avoid";
}

interface ParlayCore {
  legs: CandidateBet[];
  total_odds: number;
  theoretical_probability: number;
  expected_value: number;
}

interface ParlayResult extends ParlayCore {
  stake: number;
  potential_return: number;
  risk_level: RiskLevel;
  warnings: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidenceWeight(confidence?: string) {
  if (confidence === "high") return 1.15;
  if (confidence === "medium") return 1;
  return 0.72;
}

function qualityWeight(quality?: string) {
  if (quality === "good") return 1.1;
  if (quality === "fair") return 0.95;
  return 0.65;
}

function riskConfig(risk: RiskLevel) {
  if (risk === "prudent") {
    return {
      maxOdds: 2.4,
      minProb: 0.46,
      minEdge: 0.03,
      maxStakePct: 0.01,
      parlayStakePct: 0.003,
      maxLegs: 3,
      allowLowConfidence: false,
    };
  }
  if (risk === "aggressive") {
    return {
      maxOdds: 8,
      minProb: 0.22,
      minEdge: 0.045,
      maxStakePct: 0.018,
      parlayStakePct: 0.0015,
      maxLegs: 6,
      allowLowConfidence: true,
    };
  }
  return {
    maxOdds: 4,
    minProb: 0.34,
    minEdge: 0.03,
    maxStakePct: 0.014,
    parlayStakePct: 0.0025,
    maxLegs: 4,
    allowLowConfidence: false,
  };
}

function normalizeRisk(input?: string): RiskLevel {
  if (input === "prudent" || input === "aggressive") return input;
  return "balanced";
}

function marketLabel(market: string) {
  const normalized = market.toLowerCase();
  if (normalized === "h2h") return "1N2";
  if (normalized === "totals") return "Total buts";
  if (normalized === "spreads") return "Handicap";
  return market;
}

function varianceRisk(bet: ValueBet): RiskLevel {
  if (bet.odds <= 2.2 && bet.model_prob >= 0.5) return "prudent";
  if (bet.odds <= 4 && bet.model_prob >= 0.34) return "balanced";
  return "aggressive";
}

function scoreBet(event: Event, bet: ValueBet) {
  const confidence = bet.confidence || event.prediction?.confidence;
  const quality = event.prediction?.data_quality;
  const kickoffHours =
    (new Date(event.scheduled_at).getTime() - Date.now()) / 3_600_000;
  const freshness = kickoffHours >= 0 && kickoffHours <= 72 ? 1.05 : 0.96;
  const score =
    (bet.edge * 320 + bet.ev * 110 + bet.model_prob * 35) *
    confidenceWeight(confidence) *
    qualityWeight(quality) *
    freshness;
  return clamp(score, 0, 100);
}

function buildCandidate(
  event: Event,
  bet: ValueBet,
  input: Required<Pick<RecommendationInput, "bankroll" | "stake">>,
  risk: RiskLevel,
): CandidateBet {
  const config = riskConfig(risk);
  const score = scoreBet(event, bet);
  const maxStake = input.bankroll * config.maxStakePct;
  const modelStake = input.bankroll * clamp(bet.recommended_stake_pct || 0, 0, config.maxStakePct);
  const recommendedStake = clamp(Math.min(input.stake, maxStake, modelStake || maxStake), 0, maxStake);
  const reasons = [
    `Edge modele +${(bet.edge * 100).toFixed(1)} pts vs marche corrige.`,
    `EV par unite ${bet.ev >= 0 ? "+" : ""}${bet.ev.toFixed(3)}.`,
    `Probabilite modele ${(bet.model_prob * 100).toFixed(1)}%.`,
  ];
  const warnings: string[] = [];
  if (event.prediction?.confidence === "low" || bet.confidence === "low") {
    warnings.push("Confiance modele faible: attendre plus de donnees si possible.");
  }
  if (event.prediction?.warning_flags?.length) {
    warnings.push("Compositions/blessures non confirmees dans le modele.");
  }
  if (bet.odds >= 4) {
    warnings.push("Cote elevee: variance importante meme avec edge positif.");
  }
  if (recommendedStake < input.stake * 0.5) {
    warnings.push("Mise demandee reduite par la gestion de bankroll.");
  }

  return {
    ...bet,
    risk_level: varianceRisk(bet),
    event,
    score: Number(score.toFixed(1)),
    recommended_stake: Number(recommendedStake.toFixed(2)),
    potential_return: Number((recommendedStake * bet.odds).toFixed(2)),
    reasons,
    warnings,
    decision: "consider",
  };
}

function passesRisk(candidate: CandidateBet, risk: RiskLevel, minOdds: number, maxOdds: number) {
  const config = riskConfig(risk);
  const oddsLimit = Math.min(config.maxOdds, maxOdds);
  if (candidate.odds < minOdds || candidate.odds > oddsLimit) return false;
  if (candidate.edge < config.minEdge || candidate.ev <= 0) return false;
  if (candidate.model_prob < config.minProb) return false;
  if (risk === "prudent" && candidate.risk_level !== "prudent") return false;
  if (risk === "balanced" && candidate.risk_level === "aggressive") return false;
  if (!config.allowLowConfidence && candidate.confidence === "low") return false;
  if (!config.allowLowConfidence && candidate.event.prediction?.confidence === "low") return false;
  if (candidate.score < (risk === "prudent" ? 55 : 42)) return false;
  return true;
}

function hasParlayConflict(legs: CandidateBet[], next: CandidateBet) {
  return legs.some((leg) => leg.event_id === next.event_id);
}

function buildParlay(
  candidates: CandidateBet[],
  input: Required<Pick<RecommendationInput, "bankroll" | "stake" | "target_odds" | "max_legs">>,
  risk: RiskLevel,
): ParlayResult | null {
  const config = riskConfig(risk);
  const maxLegs = Math.min(input.max_legs, config.maxLegs);
  const pool = candidates
    .filter((candidate) => candidate.model_prob >= config.minProb)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  let best: ParlayCore | null = null;

  function visit(index: number, legs: CandidateBet[]) {
    if (legs.length >= 2) {
      const totalOdds = legs.reduce((product, leg) => product * leg.odds, 1);
      const probability =
        legs.reduce((product, leg) => product * leg.model_prob, 1) *
        0.96 ** Math.max(0, legs.length - 1);
      const expectedValue = probability * totalOdds - 1;
      if (totalOdds >= input.target_odds && expectedValue > 0) {
        const candidate = {
          legs,
          total_odds: Number(totalOdds.toFixed(2)),
          theoretical_probability: Number(probability.toFixed(4)),
          expected_value: Number(expectedValue.toFixed(4)),
        };
        const bestDistance = best
          ? Math.abs(best.total_odds - input.target_odds)
          : Infinity;
        const distance = Math.abs(candidate.total_odds - input.target_odds);
        if (
          !best ||
          distance < bestDistance ||
          (distance === bestDistance &&
            candidate.theoretical_probability > best.theoretical_probability)
        ) {
          best = candidate;
        }
        return;
      }
    }

    if (legs.length >= maxLegs) return;
    for (let i = index; i < pool.length; i += 1) {
      const next = pool[i];
      if (hasParlayConflict(legs, next)) continue;
      visit(i + 1, [...legs, next]);
    }
  }

  visit(0, []);
  const selected = best as ParlayCore | null;
  if (!selected) return null;

  const recommendedStake = Number(
    clamp(input.bankroll * config.parlayStakePct, 0, input.stake).toFixed(2),
  );
  return {
    ...selected,
    stake: recommendedStake,
    potential_return: Number((recommendedStake * selected.total_odds).toFixed(2)),
    risk_level: risk,
    warnings: [
      "Combiné probabiliste: une seule selection perdante fait perdre le ticket.",
      "Mise volontairement faible via bankroll prudente.",
      "Ne pas augmenter la mise apres une perte.",
    ],
  };
}

function avoidReason(event: Event) {
  if (!event.prediction) return "Prediction indisponible.";
  if (event.prediction.confidence === "low") return "Confiance modele faible.";
  if (event.prediction.data_quality === "poor") return "Qualite de donnees insuffisante.";
  if (!event.prediction.value_bets?.length) return "Aucun edge positif bookmaker detecte.";
  return "Aucune selection ne respecte les garde-fous de risque.";
}

export async function getDailyRecommendations(input: RecommendationInput = {}) {
  const risk = normalizeRisk(input.risk_level);
  const bankroll = clamp(Number(input.bankroll || 1000), 10, 1_000_000);
  const stake = clamp(Number(input.stake || 10), 1, bankroll * 0.05);
  const targetOdds = clamp(Number(input.target_odds || 3), 1.3, 50);
  const maxLegs = clamp(Number(input.max_legs || riskConfig(risk).maxLegs), 2, 8);
  const minOdds = clamp(Number(input.min_odds || 1.2), 1.01, 20);
  const maxOdds = clamp(Number(input.max_odds || riskConfig(risk).maxOdds), 1.1, 50);
  const hours = clamp(Number(input.hours || 168), 1, 24 * 30);

  const events = await getUpcomingMatches(hours);
  const allCandidates = events.flatMap((event) =>
    (event.prediction?.value_bets || []).map((bet) =>
      buildCandidate(event, bet, { bankroll, stake }, risk),
    ),
  );

  const singles = allCandidates
    .filter((candidate) => passesRisk(candidate, risk, minOdds, maxOdds))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);

  const parlay = buildParlay(singles, { bankroll, stake, target_odds: targetOdds, max_legs: maxLegs }, risk);
  const avoid = events
    .filter((event) => !singles.some((candidate) => candidate.event_id === event.id))
    .slice(0, 12)
    .map((event) => ({
      event_id: event.id,
      match: `${event.home_team} vs ${event.away_team}`,
      scheduled_at: event.scheduled_at,
      reason: avoidReason(event),
      confidence: event.prediction?.confidence || "unknown",
    }));

  return {
    generated_at: new Date().toISOString(),
    filters: {
      hours,
      risk_level: risk,
      bankroll,
      stake,
      target_odds: targetOdds,
      max_legs: maxLegs,
      min_odds: minOdds,
      max_odds: maxOdds,
    },
    summary: {
      upcoming_events: events.length,
      value_bets_considered: allCandidates.length,
      recommended_singles: singles.length,
      avoided_events: avoid.length,
      parlay_available: Boolean(parlay),
    },
    singles: singles.map((candidate) => ({
      event_id: candidate.event_id,
      match: candidate.match || `${candidate.event.home_team} vs ${candidate.event.away_team}`,
      competition: candidate.competition || candidate.event.competition,
      scheduled_at: candidate.scheduled_at || candidate.event.scheduled_at,
      market: marketLabel(candidate.market),
      selection: candidate.selection,
      label: candidate.label,
      odds: candidate.odds,
      bookmaker: candidate.bookmaker,
      model_prob: candidate.model_prob,
      fair_prob: candidate.fair_prob,
      edge: candidate.edge,
      ev: candidate.ev,
      score: candidate.score,
      confidence: candidate.confidence || candidate.event.prediction?.confidence || "unknown",
      risk_level: candidate.risk_level,
      recommended_stake: candidate.recommended_stake,
      potential_return: candidate.potential_return,
      reasons: candidate.reasons,
      warnings: candidate.warnings,
    })),
    parlays: parlay
      ? [
          {
            ...parlay,
            legs: parlay.legs.map((leg) => ({
              event_id: leg.event_id,
              match: leg.match || `${leg.event.home_team} vs ${leg.event.away_team}`,
              market: marketLabel(leg.market),
              selection: leg.selection,
              label: leg.label,
              odds: leg.odds,
              bookmaker: leg.bookmaker,
              model_prob: leg.model_prob,
              edge: leg.edge,
              score: leg.score,
            })),
          },
        ]
      : [],
    avoid,
    guardrails: [
      "Aucun gain garanti: les sorties sont probabilistes.",
      "Ne jamais augmenter la mise pour se refaire apres une perte.",
      "Les mises recommandees sont plafonnees par une fraction prudente de bankroll.",
      "Si aucune combinaison saine n'existe, l'outil doit refuser de forcer un combine.",
    ],
  };
}
