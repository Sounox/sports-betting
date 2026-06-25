import type {
  BetSuggestion,
  CalibrationSignal,
  Event,
  MarketSignal,
  StakeAdjustmentSignal,
  ValueBet,
} from "@/lib/api";
import { getMatchBetBuilder } from "@/lib/server/bet-builder-cloud";
import { getUpcomingMatches } from "@/lib/server/football-cloud";
import {
  getEventOddsHistory,
  getRecommendationCalibrationProfile,
  type RecommendationClvSignal,
  type RecommendationCalibrationSignal,
} from "@/lib/server/history-cloud";

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

interface MarketRadarInput {
  hours?: number;
  limit?: number;
  include_proxy?: boolean;
}

interface CandidateBet extends ValueBet {
  event: Event;
  score: number;
  recommended_stake: number;
  potential_return: number;
  reasons: string[];
  warnings: string[];
  decision: "consider" | "avoid";
  market_signal?: MarketSignal;
  calibration_signal?: CalibrationSignal;
  stake_adjustment?: StakeAdjustmentSignal;
}

interface OddsMovementSignal {
  market: string;
  selection: string;
  bookmaker: string;
  point?: number | null;
  opening_price: number;
  latest_price: number;
  implied_prob_delta?: number | null;
  direction: "shortening" | "drifting" | "stable";
  signal_strength: "low" | "medium" | "high";
  observations: number;
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

interface CalibrationProfile {
  global: Map<number, RecommendationCalibrationSignal>;
  market: Map<string, RecommendationCalibrationSignal>;
  clvGlobal?: RecommendationClvSignal;
  clvMarket: Map<string, RecommendationClvSignal>;
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

function sourceWeight(suggestion: BetSuggestion) {
  if (suggestion.data_level === "bookmaker") return 1.18;
  if (suggestion.data_level === "model") return 0.96;
  return 0.74;
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

function normalize(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sameEntity(a?: string | null, b?: string | null) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function samePoint(left?: number | null, right?: number | null) {
  if (left == null || right == null) return true;
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function signalFromMovement(movement: OddsMovementSignal): MarketSignal {
  if (movement.observations < 2) {
    return {
      verdict: "insufficient",
      direction: "stable",
      signal_strength: "low",
      reason: "Historique marche encore court: signal neutre.",
      score_adjustment: 0,
      opening_price: movement.opening_price,
      latest_price: movement.latest_price,
      implied_prob_delta: movement.implied_prob_delta,
      observations: movement.observations,
    };
  }

  if (movement.direction === "shortening") {
    const adjustment =
      movement.signal_strength === "high"
        ? 8
        : movement.signal_strength === "medium"
          ? 5
          : 2;
    return {
      verdict: "favorable",
      direction: movement.direction,
      signal_strength: movement.signal_strength,
      reason: `Signal marche favorable: cote ${movement.opening_price.toFixed(2)} -> ${movement.latest_price.toFixed(2)}.`,
      score_adjustment: adjustment,
      opening_price: movement.opening_price,
      latest_price: movement.latest_price,
      implied_prob_delta: movement.implied_prob_delta,
      observations: movement.observations,
    };
  }

  if (movement.direction === "drifting") {
    const adjustment =
      movement.signal_strength === "high"
        ? -10
        : movement.signal_strength === "medium"
          ? -6
          : -2;
    return {
      verdict: "unfavorable",
      direction: movement.direction,
      signal_strength: movement.signal_strength,
      reason: `Signal marche defavorable: cote ${movement.opening_price.toFixed(2)} -> ${movement.latest_price.toFixed(2)}.`,
      score_adjustment: adjustment,
      opening_price: movement.opening_price,
      latest_price: movement.latest_price,
      implied_prob_delta: movement.implied_prob_delta,
      observations: movement.observations,
    };
  }

  return {
    verdict: "neutral",
    direction: "stable",
    signal_strength: "low",
    reason: "Cote stable dans l'historique disponible.",
    score_adjustment: 0,
    opening_price: movement.opening_price,
    latest_price: movement.latest_price,
    implied_prob_delta: movement.implied_prob_delta,
    observations: movement.observations,
  };
}

function movementMatchesBet(movement: OddsMovementSignal, bet: ValueBet) {
  if (movement.market !== bet.market) return false;
  if (!sameEntity(movement.bookmaker, bet.bookmaker)) return false;
  if (!samePoint(movement.point, bet.point)) return false;
  if (bet.market === "totals") {
    return normalize(movement.selection) === normalize(bet.selection);
  }
  return sameEntity(movement.selection, bet.selection);
}

function applyMarketSignal(
  candidate: CandidateBet,
  movements: OddsMovementSignal[],
) {
  const movement = movements.find((item) => movementMatchesBet(item, candidate));
  if (!movement) return candidate;
  const marketSignal = signalFromMovement(movement);
  const score = clamp(candidate.score + marketSignal.score_adjustment, 0, 100);
  const reasons =
    marketSignal.verdict === "favorable"
      ? [...candidate.reasons, marketSignal.reason]
      : candidate.reasons;
  const warnings =
    marketSignal.verdict === "unfavorable"
      ? [...candidate.warnings, marketSignal.reason]
      : candidate.warnings;

  return {
    ...candidate,
    score: Number(score.toFixed(1)),
    reasons,
    warnings,
    market_signal: marketSignal,
  };
}

async function loadMarketMovements(events: Event[]) {
  const settled = await Promise.allSettled(
    events.map((event) =>
      getEventOddsHistory(event.id, {
        includeBase: true,
        limit: 3000,
      }),
    ),
  );
  const byEvent = new Map<number, OddsMovementSignal[]>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const movements = (result.value as { movements?: OddsMovementSignal[] }).movements;
    if (Array.isArray(movements)) {
      byEvent.set(events[index].id, movements);
    }
  });
  return byEvent;
}

function probabilityBucket(probability: number) {
  return Math.min(9, Math.max(0, Math.floor(Math.max(0, Math.min(0.9999, probability)) * 10)));
}

function calibrationKey(market: string, bucket: number) {
  return `${normalize(market)}:${bucket}`;
}

async function loadCalibrationProfile(): Promise<CalibrationProfile> {
  try {
    const profile = await getRecommendationCalibrationProfile();
    const global = new Map<number, RecommendationCalibrationSignal>();
    const market = new Map<string, RecommendationCalibrationSignal>();
    const clvMarket = new Map<string, RecommendationClvSignal>();
    let clvGlobal: RecommendationClvSignal | undefined;
    for (const bucket of profile.buckets || []) {
      if (bucket.scope === "global") {
        global.set(bucket.bucket, bucket);
      } else if (bucket.market) {
        market.set(calibrationKey(bucket.market, bucket.bucket), bucket);
      }
    }
    for (const signal of profile.clv || []) {
      if (signal.scope === "global") {
        clvGlobal = signal;
      } else if (signal.market) {
        clvMarket.set(normalize(signal.market), signal);
      }
    }
    return { global, market, clvGlobal, clvMarket };
  } catch {
    return { global: new Map(), market: new Map(), clvMarket: new Map() };
  }
}

function chooseCalibrationSignal(
  candidate: CandidateBet,
  profile: CalibrationProfile,
) {
  const bucket = probabilityBucket(candidate.model_prob);
  const marketSignal = profile.market.get(calibrationKey(candidate.market, bucket));
  if (marketSignal && marketSignal.sample_size >= 8) return marketSignal;
  return profile.global.get(bucket) || null;
}

function applyCalibrationSignal(
  candidate: CandidateBet,
  profile: CalibrationProfile,
) {
  const signal = chooseCalibrationSignal(candidate, profile);
  if (!signal || signal.verdict === "insufficient") return candidate;

  const score = clamp(candidate.score + signal.score_adjustment, 0, 100);
  const reasons =
    signal.verdict === "underconfident" || signal.verdict === "reliable"
      ? [...candidate.reasons, signal.reason]
      : candidate.reasons;
  const warnings =
    signal.verdict === "overconfident"
      ? [...candidate.warnings, signal.reason]
      : candidate.warnings;

  return {
    ...candidate,
    score: Number(score.toFixed(1)),
    reasons,
    warnings,
    calibration_signal: signal,
  };
}

function hasAdverseCalibration(candidate: CandidateBet) {
  return (
    candidate.calibration_signal?.verdict === "overconfident" &&
    candidate.calibration_signal.signal_strength !== "low"
  );
}

function chooseClvSignal(candidate: CandidateBet, profile: CalibrationProfile) {
  const marketSignal = profile.clvMarket.get(normalize(candidate.market));
  if (marketSignal && marketSignal.sample_size >= 8) return marketSignal;
  return profile.clvGlobal || null;
}

function marketStakeFactor(signal?: MarketSignal) {
  if (!signal || signal.verdict === "neutral" || signal.verdict === "insufficient") {
    return 1;
  }
  if (signal.verdict === "favorable") {
    return signal.signal_strength === "high" ? 1.03 : 1.01;
  }
  if (signal.signal_strength === "high") return 0.55;
  if (signal.signal_strength === "medium") return 0.72;
  return 0.9;
}

function calibrationStakeFactor(signal?: CalibrationSignal) {
  if (!signal || signal.verdict === "insufficient") return 1;
  if (signal.verdict === "overconfident") {
    if (signal.signal_strength === "high") return 0.55;
    if (signal.signal_strength === "medium") return 0.72;
    return 0.9;
  }
  if (signal.verdict === "underconfident") return 1.03;
  return 1;
}

function applyStakeDiscipline(
  candidate: CandidateBet,
  profile: CalibrationProfile,
) {
  const clvSignal = chooseClvSignal(candidate, profile);
  const factors = [
    calibrationStakeFactor(candidate.calibration_signal),
    clvSignal?.stake_factor ?? 1,
    marketStakeFactor(candidate.market_signal),
  ];
  const rawFactor = factors.reduce((product, factor) => product * factor, 1);
  const stakeFactor = clamp(rawFactor, 0.35, 1.05);
  const originalStake = candidate.recommended_stake;
  const adjustedStake = Number((originalStake * stakeFactor).toFixed(2));
  if (Math.abs(stakeFactor - 1) < 0.01) {
    return {
      ...candidate,
      stake_adjustment: {
        stake_factor: 1,
        original_stake: originalStake,
        adjusted_stake: originalStake,
        verdict: "normal",
        reasons: ["Mise conservee: pas de signal historique assez fort."],
        calibration_signal: candidate.calibration_signal,
        clv_signal: clvSignal || undefined,
        market_signal: candidate.market_signal,
      } satisfies StakeAdjustmentSignal,
    };
  }

  const reasons: string[] = [];
  if (candidate.calibration_signal?.verdict === "overconfident") {
    reasons.push(candidate.calibration_signal.reason);
  }
  if (clvSignal?.verdict === "negative") {
    reasons.push(clvSignal.reason);
  }
  if (candidate.market_signal?.verdict === "unfavorable") {
    reasons.push(candidate.market_signal.reason);
  }
  if (stakeFactor > 1) {
    reasons.push("Bonus de mise plafonne: les signaux historiques sont favorables, mais la prudence reste prioritaire.");
  }
  const verdict = stakeFactor < 1 ? "reduced" : "capped_bonus";
  const warning =
    stakeFactor < 1
      ? `Mise reduite automatiquement (${Math.round(stakeFactor * 100)}% de la mise initiale) par discipline bankroll.`
      : null;
  const reason =
    stakeFactor > 1
      ? `Mise legerement relevee (${Math.round(stakeFactor * 100)}%) car les signaux historiques sont favorables.`
      : null;

  return {
    ...candidate,
    recommended_stake: adjustedStake,
    potential_return: Number((adjustedStake * candidate.odds).toFixed(2)),
    warnings: warning ? [...candidate.warnings, warning] : candidate.warnings,
    reasons: reason ? [...candidate.reasons, reason] : candidate.reasons,
    stake_adjustment: {
      stake_factor: Number(stakeFactor.toFixed(3)),
      original_stake: originalStake,
      adjusted_stake: adjustedStake,
      verdict,
      reasons: reasons.length
        ? reasons
        : ["Ajustement prudent de mise applique par le moteur bankroll."],
      calibration_signal: candidate.calibration_signal,
      clv_signal: clvSignal || undefined,
      market_signal: candidate.market_signal,
    } satisfies StakeAdjustmentSignal,
  };
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
  if (
    risk === "prudent" &&
    candidate.market_signal?.verdict === "unfavorable" &&
    candidate.market_signal.signal_strength !== "low"
  ) {
    return false;
  }
  if (risk === "prudent" && hasAdverseCalibration(candidate)) return false;
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
    .filter(
      (candidate) =>
        candidate.model_prob >= config.minProb &&
        !(
          candidate.market_signal?.verdict === "unfavorable" &&
          candidate.market_signal.signal_strength !== "low"
        ) &&
        !hasAdverseCalibration(candidate),
    )
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

  const parlayStakeFactor = Math.min(
    ...selected.legs.map((leg) => leg.stake_adjustment?.stake_factor || 1),
  );
  const recommendedStake = Number(
    clamp(
      input.bankroll * config.parlayStakePct * parlayStakeFactor,
      0,
      input.stake,
    ).toFixed(2),
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
      ...(parlayStakeFactor < 0.99
        ? [
            `Mise combine reduite (${Math.round(parlayStakeFactor * 100)}%) selon le signal historique le plus fragile.`,
          ]
        : []),
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

function radarScore(suggestion: BetSuggestion) {
  const edgeBoost = suggestion.edge ? Math.max(-8, suggestion.edge * 260) : 0;
  const marketSignalBoost = suggestion.market_signal?.score_adjustment || 0;
  const reliabilityBoost =
    suggestion.reliability_score == null
      ? 0
      : (suggestion.reliability_score - 50) * 0.45;
  const confidenceBoost =
    suggestion.confidence === "high" ? 10 : suggestion.confidence === "medium" ? 4 : -8;
  const riskPenalty =
    suggestion.risk_level === "aggressive" ? 9 : suggestion.risk_level === "balanced" ? 2 : 0;
  const playabilityPenalty =
    suggestion.playability === "eviter" ? 18 : suggestion.playability === "surveillance" ? 4 : 0;
  const score =
    (suggestion.probability * 92 +
      edgeBoost +
      confidenceBoost +
      reliabilityBoost +
      marketSignalBoost -
      riskPenalty -
      playabilityPenalty) *
    sourceWeight(suggestion);
  return Number(clamp(score, 0, 100).toFixed(1));
}

function isRadarCandidate(suggestion: BetSuggestion, includeProxy: boolean) {
  if (suggestion.category === "Resultat") return false;
  if (suggestion.category === "Score exact") return false;
  if (suggestion.playability === "eviter" && suggestion.data_level !== "bookmaker") {
    return false;
  }
  if ((suggestion.reliability_score ?? 100) < 28) return false;
  if (suggestion.tags.includes("exact_score")) return false;
  if (suggestion.tags.includes("high_variance") && suggestion.probability < 0.12) {
    return false;
  }
  if (!includeProxy && suggestion.data_level === "proxy") return false;
  if (suggestion.probability < 0.08) return false;
  return true;
}

function radarReason(suggestion: BetSuggestion) {
  if (suggestion.data_level === "bookmaker") {
    return "Cote bookmaker disponible: peut etre comparee au modele.";
  }
  if (suggestion.data_level === "proxy") {
    return "Signal proxy experimental: utile pour surveiller le marche, pas pour forcer un pari.";
  }
  return "Signal modele sans cote bookmaker confirmee: a verifier avant de jouer.";
}

export async function getMarketRadar(input: MarketRadarInput = {}) {
  const hours = clamp(Number(input.hours || 168), 1, 24 * 30);
  const limit = clamp(Number(input.limit || 4), 1, 8);
  const includeProxy = input.include_proxy !== false;
  const events = (await getUpcomingMatches(hours)).slice(0, limit);
  const settledBuilders = await Promise.allSettled(
    events.map((event, index) =>
      getMatchBetBuilder(event.id, { includeEventOdds: index < 2 }),
    ),
  );

  const suggestions = settledBuilders.flatMap((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return [];
    const event = events[index];
    return result.value.suggestions
      .filter((suggestion) => isRadarCandidate(suggestion, includeProxy))
      .map((suggestion) => ({
        event_id: event.id,
        match: `${event.home_team} vs ${event.away_team}`,
        competition: event.competition,
        scheduled_at: event.scheduled_at,
        category: suggestion.category,
        market: suggestion.market,
        label: suggestion.label,
        probability: suggestion.probability,
        fair_odds: suggestion.fair_odds,
        offered_odds: suggestion.offered_odds,
        bookmaker: suggestion.bookmaker,
        edge: suggestion.edge,
        risk_level: suggestion.risk_level,
        confidence: suggestion.confidence,
        data_level: suggestion.data_level || (suggestion.offered_odds ? "bookmaker" : "model"),
        source: suggestion.source,
        score: radarScore(suggestion),
        rationale: suggestion.rationale,
        data_note: suggestion.data_note || radarReason(suggestion),
        reliability_score: suggestion.reliability_score,
        reliability_label: suggestion.reliability_label,
        playability: suggestion.playability,
        market_signal: suggestion.market_signal,
      }));
  });

  const categoryPriority = new Map([
    ["Joueurs", 1],
    ["Joueurs - tirs", 2],
    ["Joueurs - discipline", 3],
    ["Buts equipe", 4],
    ["Scenario", 5],
    ["Defense", 6],
    ["Buts", 7],
    ["Corners", 8],
    ["Cartons", 9],
    ["Mi-temps", 10],
    ["Handicap", 11],
  ]);

  suggestions.sort((a, b) => {
    const categoryDelta =
      (categoryPriority.get(a.category) || 50) -
      (categoryPriority.get(b.category) || 50);
    if (categoryDelta !== 0) return categoryDelta;
    return b.score - a.score;
  });

  return {
    generated_at: new Date().toISOString(),
    events_scanned: events.length,
    suggestions: suggestions.slice(0, 36),
    warnings: [
      "Le radar inclut des marches modele/proxy: ils ne sont pas tous jouables chez un bookmaker.",
      "Les cotes joueurs reelles sont chargees seulement sur les deux premiers matchs du radar pour proteger le quota gratuit.",
      "Les props joueurs dependent fortement des compositions et minutes probables.",
      "Les corners, cartons et tirs cadres sont experimentaux tant que les donnees observees ne sont pas branchees.",
    ],
  };
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
  const [movementsByEvent, calibrationProfile] = await Promise.all([
    loadMarketMovements(events),
    loadCalibrationProfile(),
  ]);
  const allCandidates = events.flatMap((event) =>
    (event.prediction?.value_bets || []).map((bet) =>
      applyStakeDiscipline(
        applyCalibrationSignal(
          applyMarketSignal(
            buildCandidate(event, bet, { bankroll, stake }, risk),
            movementsByEvent.get(event.id) || [],
          ),
          calibrationProfile,
        ),
        calibrationProfile,
      ),
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
      calibration_adjusted: allCandidates.filter(
        (candidate) =>
          candidate.calibration_signal &&
          candidate.calibration_signal.verdict !== "insufficient",
      ).length,
      stake_adjusted: allCandidates.filter(
        (candidate) => candidate.stake_adjustment?.verdict === "reduced",
      ).length,
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
      market_signal: candidate.market_signal,
      calibration_signal: candidate.calibration_signal,
      stake_adjustment: candidate.stake_adjustment,
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
              market_signal: leg.market_signal,
              calibration_signal: leg.calibration_signal,
              stake_adjustment: leg.stake_adjustment,
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
