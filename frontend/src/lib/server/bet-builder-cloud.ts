import type {
  Event,
  MatchBetBuilder,
  MatchParlayRequest,
  MatchParlayRiskProfile,
  MatchParlayResponse,
  BetSuggestion,
  MatchMarketCatalogEntry,
  MarketSignal,
  OddsSnapshot,
  PlayerInsights,
} from "@/lib/api";
import { getMatch } from "@/lib/server/football-cloud";
import { getEventOddsHistory } from "@/lib/server/history-cloud";
import { getPlayerInsights } from "@/lib/server/player-cloud";
import {
  EVENT_CORE_SOCCER_MARKETS,
  EVENT_PLAYER_SOCCER_MARKETS,
  FRENCH_BOOKMAKER_PRIORITY,
  getWorldCupEventOdds,
  getWorldCupOdds,
  bookmakerPreferenceRank,
  bookmakerSourceMeta,
  isFrenchBookmaker,
  matchOddsEvent,
  serializeOdds,
  summarizeFrenchOddsCoverage,
} from "@/lib/server/odds-cloud";

type Impact = BetSuggestion["risk_level"];

type SameMatchParlayProfileConfig = {
  minProbability: number;
  minReliability: number;
  maxLegs: number;
  maxCandidates: number;
  correlationPenalty: number;
  allowLowConfidence: boolean;
  allowHighVariance: boolean;
  preferBookmakerOdds: boolean;
  label: string;
  warning: string;
};

const SAME_MATCH_PARLAY_PROFILES: Record<MatchParlayRiskProfile, SameMatchParlayProfileConfig> = {
  prudent: {
    minProbability: 0.44,
    minReliability: 68,
    maxLegs: 3,
    maxCandidates: 28,
    correlationPenalty: 0.84,
    allowLowConfidence: false,
    allowHighVariance: false,
    preferBookmakerOdds: true,
    label: "prudent",
    warning: "Profil prudent: seuils de probabilite et fiabilite renforces, nombre de selections limite.",
  },
  balanced: {
    minProbability: 0.32,
    minReliability: 58,
    maxLegs: 4,
    maxCandidates: 38,
    correlationPenalty: 0.9,
    allowLowConfidence: false,
    allowHighVariance: false,
    preferBookmakerOdds: false,
    label: "equilibre",
    warning: "Profil equilibre: compromis entre cote cible, probabilite estimee et fiabilite des donnees.",
  },
  aggressive: {
    minProbability: 0.2,
    minReliability: 42,
    maxLegs: 5,
    maxCandidates: 46,
    correlationPenalty: 0.92,
    allowLowConfidence: true,
    allowHighVariance: true,
    preferBookmakerOdds: false,
    label: "agressif",
    warning: "Profil agressif: variance plus elevee acceptee, mise prudente indispensable.",
  },
};

function normalizeParlayProfile(profile?: string): MatchParlayRiskProfile {
  if (profile === "prudent" || profile === "balanced" || profile === "aggressive") {
    return profile;
  }
  return "balanced";
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

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function poissonProbability(goals: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function poissonOver(lambda: number, line: number) {
  let probability = 0;
  for (let goals = 0; goals <= 18; goals += 1) {
    if (goals > line) probability += poissonProbability(goals, lambda);
  }
  return probability;
}

function poissonAtLeastOne(lambda: number) {
  return 1 - Math.exp(-Math.max(0, lambda));
}

function poissonAtLeastTwo(lambda: number) {
  return 1 - Math.exp(-Math.max(0, lambda)) * (1 + Math.max(0, lambda));
}

function scoreMatrix(lambdaHome: number, lambdaAway: number) {
  const scores: Array<{ home: number; away: number; probability: number }> = [];
  for (let home = 0; home <= 8; home += 1) {
    for (let away = 0; away <= 8; away += 1) {
      scores.push({
        home,
        away,
        probability:
          poissonProbability(home, lambdaHome) *
          poissonProbability(away, lambdaAway),
      });
    }
  }
  return scores;
}

function scoreProbability(
  scores: Array<{ home: number; away: number; probability: number }>,
  predicate: (score: { home: number; away: number }) => boolean,
) {
  return scores
    .filter(predicate)
    .reduce((sum, score) => sum + score.probability, 0);
}

function riskLevel(probability: number): Impact {
  if (probability >= 0.62) return "prudent";
  if (probability >= 0.45) return "balanced";
  return "aggressive";
}

function fairOdds(probability: number) {
  if (probability <= 0) return 999;
  return round(1 / probability, 2);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sameEntity(a?: string, b?: string) {
  if (!a || !b) return false;
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  return (
    left === right ||
    (left.length >= 7 && right.includes(left)) ||
    (right.length >= 7 && left.includes(right))
  );
}

function bestOutcome(
  snapshots: OddsSnapshot[],
  market: string,
  predicate: (selection: OddsSnapshot["selections"][number]) => boolean,
) {
  let best:
    | (OddsSnapshot["selections"][number] & { bookmaker: string; market: string })
    | null = null;

  for (const snapshot of snapshots) {
    if (snapshot.market !== market) continue;
    for (const selection of snapshot.selections) {
      if (!predicate(selection)) continue;
      if (
        !best ||
        bookmakerPreferenceRank(snapshot.bookmaker) < bookmakerPreferenceRank(best.bookmaker) ||
        (bookmakerPreferenceRank(snapshot.bookmaker) === bookmakerPreferenceRank(best.bookmaker) &&
          selection.price > best.price)
      ) {
        best = { ...selection, bookmaker: snapshot.bookmaker, market };
      }
    }
  }

  return best;
}

function bestPlayerOutcome(
  snapshots: OddsSnapshot[],
  market: string,
  playerName: string,
  predicate: (selection: OddsSnapshot["selections"][number]) => boolean = (selection) =>
    selection.name === "Yes",
) {
  return bestOutcome(
    snapshots,
    market,
    (selection) =>
      predicate(selection) &&
      sameEntity(selection.description || selection.name, playerName),
  );
}

function cardProbability(position: string, reliability: BetSuggestion["confidence"]) {
  const normalized = position.toLowerCase();
  const base = normalized.includes("defence")
    ? 0.22
    : normalized.includes("midfield")
      ? 0.17
      : normalized.includes("forward") || normalized.includes("offence")
        ? 0.1
        : 0.08;
  return reliability === "high" ? base * 1.05 : reliability === "medium" ? base : base * 0.85;
}

function bookmakerOnlyProbability(selection: OddsSnapshot["selections"][number]) {
  if (selection.description && selection.price > 1) {
    return Math.min(0.95, (1 / selection.price) * 0.92);
  }
  if (selection.fair_prob > 0) return selection.fair_prob;
  return selection.price > 1 ? Math.min(0.95, (1 / selection.price) * 0.92) : 0.05;
}

function appendBookmakerOnlyPlayerProps(
  suggestions: BetSuggestion[],
  snapshots: OddsSnapshot[],
) {
  const seen = new Set(suggestions.flatMap((suggestion) => suggestion.tags));
  const best = new Map<
    string,
    {
      snapshot: OddsSnapshot;
      selection: OddsSnapshot["selections"][number];
      category: string;
      market: string;
      label: string;
      tag: string;
    }
  >();

  for (const snapshot of snapshots) {
    if (
      ![
        "player_goal_scorer_anytime",
        "player_assists",
        "player_shots_on_target",
        "player_to_receive_card",
      ].includes(snapshot.market)
    ) {
      continue;
    }

    for (const selection of snapshot.selections) {
      const player = selection.description;
      if (!player || selection.price <= 1) continue;
      if (
        ["player_goal_scorer_anytime", "player_assists", "player_to_receive_card"].includes(snapshot.market) &&
        selection.name !== "Yes"
      ) {
        continue;
      }
      if (
        snapshot.market === "player_shots_on_target" &&
        selection.name !== "Over"
      ) {
        continue;
      }

      const normalizedPlayer = normalize(player);
      const line = selection.point == null ? "" : `_${String(selection.point).replace(".", "_")}`;
      const key = `${snapshot.market}:${normalizedPlayer}:${selection.name}:${line}`;
      if (seen.has(`book_player_${key}`)) continue;

      let category = "Joueurs";
      let market = "Buteur";
      let label = `${player} buteur`;
      if (snapshot.market === "player_assists") {
        market = "Passe decisive";
        label = `${player} passe decisive`;
      }
      if (snapshot.market === "player_shots_on_target") {
        category = "Joueurs - tirs";
        market = "Tir cadre";
        label =
          selection.point && selection.point > 0.5
            ? `${player} ${selection.point + 0.5}+ tirs cadres`
            : `${player} 1+ tir cadre`;
      }
      if (snapshot.market === "player_to_receive_card") {
        category = "Joueurs - discipline";
        market = "Carton joueur";
        label = `${player} recoit un carton`;
      }
      if (
        suggestions.some(
          (suggestion) =>
            normalize(suggestion.label) === normalize(label) ||
            (sameEntity(suggestion.selection, player) &&
              suggestion.market === market &&
              pointMatches(selection.point, extractLine(suggestion.label))),
        )
      ) {
        continue;
      }

      const current = best.get(key);
      if (
        !current ||
        bookmakerPreferenceRank(snapshot.bookmaker) <
          bookmakerPreferenceRank(current.snapshot.bookmaker) ||
        (bookmakerPreferenceRank(snapshot.bookmaker) ===
          bookmakerPreferenceRank(current.snapshot.bookmaker) &&
          selection.price > current.selection.price)
      ) {
        best.set(key, {
          snapshot,
          selection,
          category,
          market,
          label,
          tag: `book_player_${key}`,
        });
      }
    }
  }

  for (const item of best.values()) {
    suggestions.push(
      makeSuggestion({
        id: item.tag,
        category: item.category,
        market: item.market,
        selection: item.selection.description || item.selection.name,
        label: item.label,
        probability: bookmakerOnlyProbability(item.selection),
        source: "bookmaker",
        odds: { price: item.selection.price, bookmaker: item.snapshot.bookmaker },
        confidence: "low",
        rationale:
          "Cote bookmaker reelle detectee; estimation independante limitee faute de donnees joueur fiables.",
        data_level: "bookmaker",
        data_note:
          "A traiter comme marche a surveiller: l'edge n'est pas validee par un modele joueur robuste.",
        conflict_key: item.tag,
        tags: [item.tag, "bookmaker_player_prop", "high_variance"],
      }),
    );
  }
}

function makeSuggestion(input: {
  id: string;
  category: string;
  market: string;
  selection: string;
  label: string;
  probability: number;
  source: BetSuggestion["source"];
  odds?: { price: number; bookmaker: string };
  confidence?: BetSuggestion["confidence"];
  rationale: string;
  data_level?: BetSuggestion["data_level"];
  data_note?: string;
  conflict_key: string;
  tags?: string[];
}): BetSuggestion {
  const probability = Math.max(0.001, Math.min(0.999, input.probability));
  const offeredOdds = input.odds?.price;
  const modelFairOdds = fairOdds(probability);
  const impliedProb = offeredOdds ? 1 / offeredOdds : undefined;
  const edge = impliedProb == null ? undefined : probability - impliedProb;
  const ev = offeredOdds == null ? undefined : probability * offeredOdds - 1;
  const sourceMeta = input.odds
    ? bookmakerSourceMeta(input.odds.bookmaker)
    : input.data_level === "proxy"
      ? {
          odds_source: "proxy" as const,
          is_french_bookmaker: false,
          bookmaker_priority: 999,
          bookmaker_country: undefined,
          bookmaker_display: undefined,
          bookmaker_source_label: "Projection proxy sans cote bookmaker",
        }
      : {
          odds_source: "model" as const,
          is_french_bookmaker: false,
          bookmaker_priority: 999,
          bookmaker_country: undefined,
          bookmaker_display: undefined,
          bookmaker_source_label: "Cote fair estimee par le modele",
        };

  return {
    id: input.id,
    category: input.category,
    market: input.market,
    selection: input.selection,
    label: input.label,
    probability: round(probability),
    fair_odds: modelFairOdds,
    offered_odds: offeredOdds,
    bookmaker: input.odds?.bookmaker,
    ...sourceMeta,
    edge: edge == null ? undefined : round(edge),
    ev: ev == null ? undefined : round(ev),
    risk_level: input.confidence === "low" ? "aggressive" : riskLevel(probability),
    confidence: input.confidence || (probability >= 0.55 ? "medium" : "low"),
    source: input.source,
    data_level: input.data_level || (input.odds ? "bookmaker" : "model"),
    rationale: input.rationale,
    data_note: input.data_note,
    conflict_key: input.conflict_key,
    tags: input.tags || [],
  };
}

function oddsForSuggestion(suggestion: BetSuggestion) {
  return suggestion.offered_odds || suggestion.fair_odds;
}

function marketKeyForSuggestion(suggestion: BetSuggestion) {
  const market = suggestion.market.toLowerCase();
  if (market === "1n2") return "h2h";
  if (market.includes("total buts")) return "totals";
  if (market.includes("handicap")) return "spreads";
  if (market.includes("deux equipes")) return "btts";
  if (market.includes("rembourse")) return "draw_no_bet";
  if (market.includes("buteur")) return "player_goal_scorer_anytime";
  if (market.includes("passe decisive")) return "player_assists";
  if (market.includes("tir cadre") || market.includes("tirs cadres")) {
    return "player_shots_on_target";
  }
  if (market.includes("carton joueur")) return "player_to_receive_card";
  return null;
}

function extractLine(value: string) {
  const match = value.match(/(-?\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function pointMatches(left?: number | null, right?: number | null) {
  if (left == null || right == null) return true;
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function stripOutcomeWords(value: string) {
  return value
    .replace(/\b(over|under|yes|no|oui|non)\b/gi, "")
    .replace(/\bplus de\b|\bmoins de\b/gi, "")
    .trim();
}

function selectionMatchesSuggestion(
  movement: OddsMovementSignal,
  suggestion: BetSuggestion,
) {
  const market = movement.market;
  if (market.startsWith("player_")) {
    return sameEntity(stripOutcomeWords(movement.selection), suggestion.selection);
  }
  if (market === "totals") {
    const wantsOver =
      suggestion.selection.toLowerCase().includes("plus") ||
      suggestion.selection.toLowerCase().includes("over");
    const wantsUnder =
      suggestion.selection.toLowerCase().includes("moins") ||
      suggestion.selection.toLowerCase().includes("under");
    return (
      ((wantsOver && movement.selection === "Over") ||
        (wantsUnder && movement.selection === "Under")) &&
      pointMatches(movement.point, extractLine(suggestion.selection))
    );
  }
  if (market === "btts") {
    const wantsYes =
      suggestion.selection.toLowerCase().includes("oui") ||
      suggestion.label.toLowerCase().includes("marquent");
    const wantsNo =
      suggestion.selection.toLowerCase().includes("non") ||
      suggestion.label.toLowerCase().includes("ne marque pas");
    return (
      (wantsYes && movement.selection === "Yes") ||
      (wantsNo && movement.selection === "No")
    );
  }
  if (market === "spreads") {
    return (
      sameEntity(movement.selection, suggestion.selection) &&
      pointMatches(movement.point, extractLine(suggestion.selection))
    );
  }
  return sameEntity(movement.selection, suggestion.selection);
}

function signalFromMovement(movement: OddsMovementSignal): MarketSignal {
  const enoughHistory = movement.observations >= 2;
  if (!enoughHistory) {
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
        ? 7
        : movement.signal_strength === "medium"
          ? 4
          : 1.5;
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
        ? -9
        : movement.signal_strength === "medium"
          ? -5
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

function findMovementForSuggestion(
  suggestion: BetSuggestion,
  movements: OddsMovementSignal[],
) {
  if (!suggestion.bookmaker) return null;
  const marketKey = marketKeyForSuggestion(suggestion);
  if (!marketKey) return null;
  return (
    movements.find(
      (movement) =>
        movement.market === marketKey &&
        sameEntity(movement.bookmaker, suggestion.bookmaker) &&
        selectionMatchesSuggestion(movement, suggestion),
    ) || null
  );
}

function applyMarketSignalsToSuggestions(
  suggestions: BetSuggestion[],
  movements: OddsMovementSignal[],
) {
  return suggestions
    .map((suggestion) => {
      const movement = findMovementForSuggestion(suggestion, movements);
      if (!movement) return suggestion;
      const marketSignal = signalFromMovement(movement);
      const dataNote = [suggestion.data_note, marketSignal.reason]
        .filter(Boolean)
        .join(" ");
      return {
        ...suggestion,
        market_signal: marketSignal,
        data_note: dataNote || suggestion.data_note,
        tags:
          marketSignal.verdict === "unfavorable" &&
          marketSignal.signal_strength !== "low"
            ? [...suggestion.tags, "market_adverse"]
            : marketSignal.verdict === "favorable"
              ? [...suggestion.tags, "market_supported"]
              : suggestion.tags,
      };
    })
    .sort((a, b) => {
      const aEdge = a.edge ?? -0.2;
      const bEdge = b.edge ?? -0.2;
      return (
        bEdge +
        b.probability * 0.4 +
        (b.market_signal?.score_adjustment || 0) / 100 -
        (aEdge +
          a.probability * 0.4 +
          (a.market_signal?.score_adjustment || 0) / 100)
      );
    });
}

function hasAdverseMarketSignal(suggestion: BetSuggestion) {
  return (
    suggestion.market_signal?.verdict === "unfavorable" &&
    suggestion.market_signal.signal_strength !== "low"
  );
}

function marketReliabilityBase(suggestion: BetSuggestion) {
  const market = normalize(suggestion.market);
  if (["1n2", "totalbuts", "butsequipe"].includes(market)) return 72;
  if (["doublechance", "remboursesisinul", "lesdeuxequipesmarquent"].includes(market)) return 68;
  if (market.includes("handicap")) return 66;
  if (market.includes("clean") || market.includes("victoire")) return 58;
  if (market.includes("resultatmi") || market.includes("premiereequipe")) return 54;
  if (market.includes("buteur") || market.includes("passedecisive") || market.includes("butoupasse")) return 48;
  if (market.includes("tircadre") || market.includes("tirscadres")) return 44;
  if (market.includes("cartonjoueur")) return 38;
  if (market.includes("corners") || market.includes("cartons")) return 34;
  if (market.includes("scoreexact") || market.includes("double") || market.includes("horssurface")) return 24;
  return 46;
}

function marketReliabilityCap(suggestion: BetSuggestion) {
  const market = normalize(suggestion.market);
  if (suggestion.data_level === "proxy") return 52;
  if (market.includes("scoreexact") || market.includes("horssurface")) return 36;
  if (market.includes("premierbuteur") || market.includes("double")) return 46;
  if (market.includes("cartonjoueur")) return 64;
  if (market.includes("tircadre") || market.includes("tirscadres")) return 74;
  if (market.includes("buteur") || market.includes("passedecisive") || market.includes("butoupasse")) return 78;
  if (market.includes("corners") || market.includes("cartons")) return 58;
  return 92;
}

function reliabilityAssessment(suggestion: BetSuggestion) {
  const reasons: string[] = [];
  let score = marketReliabilityBase(suggestion);

  if (suggestion.data_level === "bookmaker") {
    score += 12;
    reasons.push("cote bookmaker disponible");
    if (suggestion.odds_source === "french_bookmaker") {
      score += 4;
      reasons.push("book francais prioritaire");
    } else {
      score -= 2;
      reasons.push("fallback bookmaker non FR");
    }
  } else if (suggestion.data_level === "proxy") {
    score -= 18;
    reasons.push("projection proxy experimentale");
  } else {
    score += 2;
    reasons.push("projection modele");
  }

  if (suggestion.offered_odds) score += 6;
  else score -= 5;

  if ((suggestion.edge ?? 0) >= 0.06) {
    score += 8;
    reasons.push("edge positif net");
  } else if ((suggestion.edge ?? 0) >= 0.025) {
    score += 4;
    reasons.push("edge positif modere");
  } else if (suggestion.edge != null && suggestion.edge < 0) {
    score -= 14;
    reasons.push("edge negatif");
  }

  if (suggestion.confidence === "high") score += 8;
  if (suggestion.confidence === "medium") score += 2;
  if (suggestion.confidence === "low") score -= 9;

  if (suggestion.probability >= 0.62) score += 4;
  if (suggestion.probability < 0.16) score -= 7;

  if (suggestion.market_signal?.verdict === "favorable") {
    score += suggestion.market_signal.signal_strength === "high" ? 7 : 4;
    reasons.push("marche favorable");
  }
  if (hasAdverseMarketSignal(suggestion)) {
    score -= suggestion.market_signal?.signal_strength === "high" ? 13 : 8;
    reasons.push("marche defavorable");
  }

  if (suggestion.tags.includes("high_variance")) {
    score -= 12;
    reasons.push("forte variance");
  }
  if (suggestion.tags.includes("exact_score")) score -= 16;
  if (suggestion.tags.includes("proxy_model")) score -= 6;

  const reliabilityScore = round(
    Math.max(0, Math.min(marketReliabilityCap(suggestion), score)),
    1,
  );
  const reliabilityLabel: BetSuggestion["reliability_label"] =
    reliabilityScore >= 70 ? "forte" : reliabilityScore >= 45 ? "moyenne" : "faible";
  const negativeEdge = suggestion.edge != null && suggestion.edge < 0;
  const playability: BetSuggestion["playability"] =
    negativeEdge
      ? reliabilityScore >= 42
        ? "surveillance"
        : "eviter"
      : reliabilityScore >= 68 &&
          suggestion.data_level !== "proxy" &&
          !suggestion.tags.includes("high_variance") &&
          !hasAdverseMarketSignal(suggestion)
        ? "jouable"
        : reliabilityScore >= 42
          ? "surveillance"
          : "eviter";
  const riskLevel =
    playability === "eviter"
      ? "aggressive"
      : reliabilityScore >= 76 && suggestion.risk_level === "balanced"
        ? "prudent"
        : suggestion.risk_level;

  return {
    ...suggestion,
    risk_level: riskLevel,
    reliability_score: reliabilityScore,
    reliability_label: reliabilityLabel,
    reliability_reasons: reasons.slice(0, 4),
    playability,
  };
}

function dedupeKey(suggestion: BetSuggestion) {
  return [
    suggestion.category,
    suggestion.market,
    normalize(suggestion.label),
    suggestion.conflict_key.startsWith("spread_") ? extractLine(suggestion.selection) ?? "" : "",
  ].join("|");
}

function suggestionQualityRank(suggestion: BetSuggestion) {
  const reliability = suggestion.reliability_score ?? 0;
  const edge = suggestion.edge == null ? -4 : suggestion.edge * 120;
  const odds = suggestion.offered_odds ? Math.min(20, suggestion.offered_odds) : 0;
  const source = suggestion.data_level === "bookmaker" ? 12 : suggestion.data_level === "model" ? 3 : -8;
  const bookmakerPreference =
    suggestion.bookmaker && isFrenchBookmaker(suggestion.bookmaker)
      ? 18 - bookmakerPreferenceRank(suggestion.bookmaker) * 2
      : suggestion.bookmaker
        ? -4
        : 0;
  const market = suggestion.market_signal?.score_adjustment || 0;
  const avoid = suggestion.playability === "eviter" ? -18 : suggestion.playability === "jouable" ? 8 : 0;
  return reliability + edge + odds + source + bookmakerPreference + market + avoid;
}

function dedupeSuggestions(suggestions: BetSuggestion[]) {
  const best = new Map<string, BetSuggestion>();
  for (const suggestion of suggestions) {
    const key = dedupeKey(suggestion);
    const current = best.get(key);
    if (!current || suggestionQualityRank(suggestion) > suggestionQualityRank(current)) {
      best.set(key, suggestion);
    }
  }
  return [...best.values()];
}

function finalSuggestionSort(a: BetSuggestion, b: BetSuggestion) {
  const playabilityOrder = { jouable: 0, surveillance: 1, eviter: 2 } as const;
  const playDelta =
    (playabilityOrder[a.playability || "surveillance"] ?? 1) -
    (playabilityOrder[b.playability || "surveillance"] ?? 1);
  if (playDelta !== 0) return playDelta;
  return suggestionQualityRank(b) - suggestionQualityRank(a);
}

function buildMarketCatalog(suggestions: BetSuggestion[]): MatchMarketCatalogEntry[] {
  const grouped = new Map<string, BetSuggestion[]>();
  for (const suggestion of suggestions) {
    const key = `${suggestion.category}|${suggestion.market}`;
    const entries = grouped.get(key) || [];
    entries.push(suggestion);
    grouped.set(key, entries);
  }

  return [...grouped.entries()]
    .map(([key, entries]) => {
      const [category, market] = key.split("|");
      const french = entries.filter(
        (suggestion) =>
          suggestion.source === "bookmaker" &&
          suggestion.odds_source === "french_bookmaker",
      );
      const global = entries.filter(
        (suggestion) =>
          suggestion.source === "bookmaker" &&
          suggestion.odds_source !== "french_bookmaker",
      );
      const proxy = entries.filter((suggestion) => suggestion.data_level === "proxy");
      const model = entries.filter(
        (suggestion) =>
          suggestion.source !== "bookmaker" && suggestion.data_level !== "proxy",
      );
      const scored = entries
        .slice()
        .sort((a, b) => suggestionQualityRank(b) - suggestionQualityRank(a));
      const best = scored[0];
      const reliabilityValues = entries
        .map((suggestion) => suggestion.reliability_score)
        .filter((value): value is number => typeof value === "number");
      const status: MatchMarketCatalogEntry["status"] =
        french.length > 0
          ? "fr_available"
          : global.length > 0
            ? "global_available"
            : proxy.length > 0 && model.length === 0
              ? "proxy_only"
              : "model_only";

      return {
        category,
        market,
        status,
        total_selections: entries.length,
        french_bookmaker_selections: french.length,
        global_bookmaker_selections: global.length,
        model_selections: model.length,
        proxy_selections: proxy.length,
        playable_count: entries.filter((suggestion) => suggestion.playability === "jouable").length,
        watch_count: entries.filter((suggestion) => suggestion.playability === "surveillance").length,
        avoid_count: entries.filter((suggestion) => suggestion.playability === "eviter").length,
        average_reliability: reliabilityValues.length
          ? round(
              reliabilityValues.reduce((sum, value) => sum + value, 0) /
                reliabilityValues.length,
              1,
            )
          : undefined,
        available_bookmakers: Array.from(
          new Set(
            entries
              .filter((suggestion) => suggestion.source === "bookmaker")
              .map(
                (suggestion) =>
                  suggestion.bookmaker_display ||
                  suggestion.bookmaker ||
                  "Bookmaker",
              ),
          ),
        ).slice(0, 6),
        example_labels: scored.slice(0, 3).map((suggestion) => suggestion.label),
        best_selection: best
          ? {
              label: best.label,
              probability: best.probability,
              fair_odds: best.fair_odds,
              offered_odds: best.offered_odds,
              bookmaker: best.bookmaker_display || best.bookmaker,
              odds_source: best.odds_source,
              edge: best.edge,
              playability: best.playability,
              reliability_score: best.reliability_score,
            }
          : undefined,
      };
    })
    .sort((a, b) => {
      const statusWeight = {
        fr_available: 0,
        global_available: 1,
        model_only: 2,
        proxy_only: 3,
      } as const;
      const statusDelta = statusWeight[a.status] - statusWeight[b.status];
      if (statusDelta !== 0) return statusDelta;
      if (b.playable_count !== a.playable_count) return b.playable_count - a.playable_count;
      return (b.average_reliability || 0) - (a.average_reliability || 0);
    });
}

function finalizeSuggestions(
  suggestions: BetSuggestion[],
  movements: OddsMovementSignal[],
) {
  return dedupeSuggestions(
    applyMarketSignalsToSuggestions(suggestions, movements).map(reliabilityAssessment),
  ).sort(finalSuggestionSort);
}

function buildSuggestions(
  event: Event,
  playerInsights: PlayerInsights | null,
  snapshots: OddsSnapshot[],
) {
  const pred = event.prediction;
  if (!pred) return [];

  const lambdaHome = pred.markets?.lambda?.home ?? 1.25;
  const lambdaAway = pred.markets?.lambda?.away ?? 1.25;
  const totalLambda = lambdaHome + lambdaAway;
  const scores = scoreMatrix(lambdaHome, lambdaAway);
  const suggestions: BetSuggestion[] = [];
  const h2hHome = bestOutcome(
    snapshots,
    "h2h",
    (selection) => normalize(selection.name) === normalize(event.home_team),
  );
  const h2hDraw = bestOutcome(
    snapshots,
    "h2h",
    (selection) => normalize(selection.name) === "draw",
  );
  const h2hAway = bestOutcome(
    snapshots,
    "h2h",
    (selection) => normalize(selection.name) === normalize(event.away_team),
  );

  suggestions.push(
    makeSuggestion({
      id: "result_home",
      category: "Resultat",
      market: "1N2",
      selection: event.home_team,
      label: `Victoire ${event.home_team}`,
      probability: pred.prob_home,
      source: h2hHome ? "bookmaker" : "model",
      odds: h2hHome ? { price: h2hHome.price, bookmaker: h2hHome.bookmaker } : undefined,
      confidence: pred.confidence,
      rationale: `Probabilite modele ${pct(pred.prob_home)}.`,
      conflict_key: "result",
      tags: ["result_home"],
    }),
    makeSuggestion({
      id: "result_draw",
      category: "Resultat",
      market: "1N2",
      selection: "Nul",
      label: "Match nul",
      probability: pred.prob_draw,
      source: h2hDraw ? "bookmaker" : "model",
      odds: h2hDraw ? { price: h2hDraw.price, bookmaker: h2hDraw.bookmaker } : undefined,
      confidence: pred.confidence,
      rationale: `Probabilite modele ${pct(pred.prob_draw)}.`,
      conflict_key: "result",
      tags: ["draw"],
    }),
    makeSuggestion({
      id: "result_away",
      category: "Resultat",
      market: "1N2",
      selection: event.away_team,
      label: `Victoire ${event.away_team}`,
      probability: pred.prob_away,
      source: h2hAway ? "bookmaker" : "model",
      odds: h2hAway ? { price: h2hAway.price, bookmaker: h2hAway.bookmaker } : undefined,
      confidence: pred.confidence,
      rationale: `Probabilite modele ${pct(pred.prob_away)}.`,
      conflict_key: "result",
      tags: ["result_away"],
    }),
  );

  suggestions.push(
    makeSuggestion({
      id: "dc_home_draw",
      category: "Resultat",
      market: "Double chance",
      selection: `${event.home_team} ou nul`,
      label: `${event.home_team} ou nul`,
      probability: pred.prob_home + pred.prob_draw,
      source: "model",
      confidence: pred.confidence,
      rationale: "Marche derive du 1N2 modele.",
      conflict_key: "double_chance",
      tags: ["no_away_win"],
    }),
    makeSuggestion({
      id: "dc_home_away",
      category: "Resultat",
      market: "Double chance",
      selection: "Pas de nul",
      label: "Pas de nul",
      probability: pred.prob_home + pred.prob_away,
      source: "model",
      confidence: "medium",
      rationale: "Marche derive du 1N2 modele.",
      conflict_key: "double_chance",
      tags: ["no_draw"],
    }),
    makeSuggestion({
      id: "dc_draw_away",
      category: "Resultat",
      market: "Double chance",
      selection: `Nul ou ${event.away_team}`,
      label: `Nul ou ${event.away_team}`,
      probability: pred.prob_draw + pred.prob_away,
      source: "model",
      confidence: pred.confidence,
      rationale: "Marche derive du 1N2 modele.",
      conflict_key: "double_chance",
      tags: ["no_home_win"],
    }),
  );

  const noDraw = pred.prob_home + pred.prob_away;
  const dnbHome = bestOutcome(
    snapshots,
    "draw_no_bet",
    (selection) => sameEntity(selection.name, event.home_team),
  );
  const dnbAway = bestOutcome(
    snapshots,
    "draw_no_bet",
    (selection) => sameEntity(selection.name, event.away_team),
  );
  if (noDraw > 0) {
    suggestions.push(
      makeSuggestion({
        id: "dnb_home",
        category: "Resultat",
        market: "Rembourse si nul",
        selection: event.home_team,
        label: `${event.home_team} rembourse si nul`,
        probability: pred.prob_home / noDraw,
        source: dnbHome ? "bookmaker" : "model",
        odds: dnbHome ? { price: dnbHome.price, bookmaker: dnbHome.bookmaker } : undefined,
        confidence: pred.confidence,
        rationale: "Probabilite conditionnelle hors match nul.",
        conflict_key: "draw_no_bet",
        tags: ["result_home", "no_draw"],
      }),
      makeSuggestion({
        id: "dnb_away",
        category: "Resultat",
        market: "Rembourse si nul",
        selection: event.away_team,
        label: `${event.away_team} rembourse si nul`,
        probability: pred.prob_away / noDraw,
        source: dnbAway ? "bookmaker" : "model",
        odds: dnbAway ? { price: dnbAway.price, bookmaker: dnbAway.bookmaker } : undefined,
        confidence: pred.confidence,
        rationale: "Probabilite conditionnelle hors match nul.",
        conflict_key: "draw_no_bet",
        tags: ["result_away", "no_draw"],
      }),
    );
  }

  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const over = poissonOver(totalLambda, line);
    const overBook = bestOutcome(
      snapshots,
      "totals",
      (selection) => selection.name === "Over" && selection.point === line,
    );
    const underBook = bestOutcome(
      snapshots,
      "totals",
      (selection) => selection.name === "Under" && selection.point === line,
    );
    suggestions.push(
      makeSuggestion({
        id: `over_${String(line).replace(".", "_")}`,
        category: "Buts",
        market: "Total buts",
        selection: `Plus de ${line} buts`,
        label: `Plus de ${line} buts`,
        probability: over,
        source: overBook ? "bookmaker" : "model",
        odds: overBook ? { price: overBook.price, bookmaker: overBook.bookmaker } : undefined,
        confidence: "medium",
        rationale: `Total attendu ${totalLambda.toFixed(2)} buts.`,
        conflict_key: `total_${line}`,
        tags: [`over_${line}`],
      }),
      makeSuggestion({
        id: `under_${String(line).replace(".", "_")}`,
        category: "Buts",
        market: "Total buts",
        selection: `Moins de ${line} buts`,
        label: `Moins de ${line} buts`,
        probability: 1 - over,
        source: underBook ? "bookmaker" : "model",
        odds: underBook ? { price: underBook.price, bookmaker: underBook.bookmaker } : undefined,
        confidence: "medium",
        rationale: `Total attendu ${totalLambda.toFixed(2)} buts.`,
        conflict_key: `total_${line}`,
        tags: [`under_${line}`],
      }),
    );
  }

  const bttsYes = pred.markets?.btts?.yes ?? 0;
  const bttsYesBook = bestOutcome(
    snapshots,
    "btts",
    (selection) => selection.name === "Yes",
  );
  const bttsNoBook = bestOutcome(
    snapshots,
    "btts",
    (selection) => selection.name === "No",
  );
  suggestions.push(
    makeSuggestion({
      id: "btts_yes",
      category: "Buts",
      market: "Les deux equipes marquent",
      selection: "Oui",
      label: "Les deux equipes marquent",
      probability: bttsYes,
      source: bttsYesBook ? "bookmaker" : "model",
      odds: bttsYesBook ? { price: bttsYesBook.price, bookmaker: bttsYesBook.bookmaker } : undefined,
      confidence: "medium",
      rationale: `Probabilite BTTS Oui ${pct(bttsYes)}.`,
      conflict_key: "btts",
      tags: ["btts_yes"],
    }),
    makeSuggestion({
      id: "btts_no",
      category: "Buts",
      market: "Les deux equipes marquent",
      selection: "Non",
      label: "Au moins une equipe ne marque pas",
      probability: 1 - bttsYes,
      source: bttsNoBook ? "bookmaker" : "model",
      odds: bttsNoBook ? { price: bttsNoBook.price, bookmaker: bttsNoBook.bookmaker } : undefined,
      confidence: "medium",
      rationale: `Probabilite BTTS Non ${pct(1 - bttsYes)}.`,
      conflict_key: "btts",
      tags: ["btts_no"],
    }),
  );

  const bttsAndOver25 = scoreProbability(
    scores,
    (score) => score.home > 0 && score.away > 0 && score.home + score.away > 2.5,
  );
  const bttsAndUnder45 = scoreProbability(
    scores,
    (score) => score.home > 0 && score.away > 0 && score.home + score.away < 4.5,
  );
  const noBttsUnder35 = scoreProbability(
    scores,
    (score) => (score.home === 0 || score.away === 0) && score.home + score.away < 3.5,
  );
  suggestions.push(
    makeSuggestion({
      id: "btts_yes_over_25",
      category: "Buts",
      market: "BTTS + total",
      selection: "Oui + plus de 2.5",
      label: "Les deux equipes marquent + over 2.5",
      probability: bttsAndOver25,
      source: "model",
      confidence: "medium",
      rationale: "Scenario calcule depuis toute la matrice de scores.",
      conflict_key: "btts_total_combo",
      tags: ["btts_yes", "over_2.5"],
    }),
    makeSuggestion({
      id: "btts_yes_under_45",
      category: "Buts",
      market: "BTTS + total",
      selection: "Oui + moins de 4.5",
      label: "Les deux equipes marquent + under 4.5",
      probability: bttsAndUnder45,
      source: "model",
      confidence: "medium",
      rationale: "Scenario calcule depuis toute la matrice de scores.",
      conflict_key: "btts_total_combo",
      tags: ["btts_yes", "under_4.5"],
    }),
    makeSuggestion({
      id: "btts_no_under_35",
      category: "Buts",
      market: "BTTS + total",
      selection: "Non + moins de 3.5",
      label: "BTTS non + under 3.5",
      probability: noBttsUnder35,
      source: "model",
      confidence: "medium",
      rationale: "Scenario defensif derive de la matrice de scores.",
      conflict_key: "btts_total_combo",
      tags: ["btts_no", "under_3.5"],
    }),
  );

  const noGoal = Math.exp(-totalLambda);
  const firstGoalHome =
    totalLambda > 0 ? (lambdaHome / totalLambda) * (1 - noGoal) : 0;
  const firstGoalAway =
    totalLambda > 0 ? (lambdaAway / totalLambda) * (1 - noGoal) : 0;
  suggestions.push(
    makeSuggestion({
      id: "first_goal_home",
      category: "Buts",
      market: "Premiere equipe qui marque",
      selection: event.home_team,
      label: `${event.home_team} marque en premier`,
      probability: firstGoalHome,
      source: "model",
      confidence: "medium",
      rationale: "Approximation par intensite de buts attendus.",
      conflict_key: "first_goal",
      tags: ["first_goal_home", "home_scores"],
    }),
    makeSuggestion({
      id: "first_goal_away",
      category: "Buts",
      market: "Premiere equipe qui marque",
      selection: event.away_team,
      label: `${event.away_team} marque en premier`,
      probability: firstGoalAway,
      source: "model",
      confidence: "medium",
      rationale: "Approximation par intensite de buts attendus.",
      conflict_key: "first_goal",
      tags: ["first_goal_away", "away_scores"],
    }),
    makeSuggestion({
      id: "no_goal",
      category: "Buts",
      market: "Premiere equipe qui marque",
      selection: "Aucun but",
      label: "Aucun but dans le match",
      probability: noGoal,
      source: "model",
      confidence: "low",
      rationale: "Scenario rare derive du total de buts attendu.",
      conflict_key: "first_goal",
      tags: ["exact_score", "under_0.5"],
    }),
  );

  const halfTimeScores = scoreMatrix(lambdaHome * 0.46, lambdaAway * 0.46);
  const halfTime = pred.markets?.half_time || {
    home: scoreProbability(halfTimeScores, (score) => score.home > score.away),
    draw: scoreProbability(halfTimeScores, (score) => score.home === score.away),
    away: scoreProbability(halfTimeScores, (score) => score.away > score.home),
  };
  if (halfTime) {
    suggestions.push(
      makeSuggestion({
        id: "ht_home",
        category: "Mi-temps",
        market: "Resultat mi-temps",
        selection: event.home_team,
        label: `${event.home_team} mene a la mi-temps`,
        probability: halfTime.home,
        source: "model",
        confidence: pred.confidence,
        rationale: "Projection mi-temps derivee des buts attendus.",
        conflict_key: "half_time_result",
        tags: ["ht_home"],
      }),
      makeSuggestion({
        id: "ht_draw",
        category: "Mi-temps",
        market: "Resultat mi-temps",
        selection: "Nul",
        label: "Nul a la mi-temps",
        probability: halfTime.draw,
        source: "model",
        confidence: pred.confidence,
        rationale: "Projection mi-temps derivee des buts attendus.",
        conflict_key: "half_time_result",
        tags: ["ht_draw"],
      }),
      makeSuggestion({
        id: "ht_away",
        category: "Mi-temps",
        market: "Resultat mi-temps",
        selection: event.away_team,
        label: `${event.away_team} mene a la mi-temps`,
        probability: halfTime.away,
        source: "model",
        confidence: pred.confidence,
        rationale: "Projection mi-temps derivee des buts attendus.",
        conflict_key: "half_time_result",
        tags: ["ht_away"],
      }),
    );
  }

  for (const total of [0, 1, 2, 3, 4]) {
    const probability =
      total < 4
        ? poissonProbability(total, totalLambda)
        : poissonOver(totalLambda, 3.5);
    suggestions.push(
      makeSuggestion({
        id: `total_goals_${total}${total === 4 ? "_plus" : ""}`,
        category: "Buts",
        market: "Nombre exact de buts",
        selection: total === 4 ? "4+" : String(total),
        label: total === 4 ? "4 buts ou plus" : `${total} but(s) dans le match`,
        probability,
        source: "model",
        confidence: "low",
        rationale: "Distribution Poisson du total de buts.",
        conflict_key: "exact_total_goals",
        tags: total >= 3 ? ["over_2.5"] : ["under_2.5"],
      }),
    );
  }

  for (const [side, team, lambda] of [
    ["home", event.home_team, lambdaHome],
    ["away", event.away_team, lambdaAway],
  ] as const) {
    for (const line of [0.5, 1.5, 2.5]) {
      const over = poissonOver(lambda, line);
      const teamOverBook = bestOutcome(
        snapshots,
        "team_totals",
        (selection) =>
          selection.name === "Over" &&
          selection.point === line &&
          sameEntity(selection.description, team),
      );
      const teamUnderBook = bestOutcome(
        snapshots,
        "team_totals",
        (selection) =>
          selection.name === "Under" &&
          selection.point === line &&
          sameEntity(selection.description, team),
      );
      suggestions.push(
        makeSuggestion({
          id: `${side}_team_over_${String(line).replace(".", "_")}`,
          category: "Buts equipe",
          market: "Buts equipe",
          selection: `${team} plus de ${line}`,
          label: `${team} marque plus de ${line} but(s)`,
          probability: over,
          source: teamOverBook ? "bookmaker" : "model",
          odds: teamOverBook ? { price: teamOverBook.price, bookmaker: teamOverBook.bookmaker } : undefined,
          confidence: "medium",
          rationale: `${team}: ${lambda.toFixed(2)} but(s) attendu(s).`,
          conflict_key: `${side}_team_total_${line}`,
          tags: [`${side}_scores`],
        }),
        makeSuggestion({
          id: `${side}_team_under_${String(line).replace(".", "_")}`,
          category: "Buts equipe",
          market: "Buts equipe",
          selection: `${team} moins de ${line}`,
          label: `${team} marque moins de ${line} but(s)`,
          probability: 1 - over,
          source: teamUnderBook ? "bookmaker" : "model",
          odds: teamUnderBook ? { price: teamUnderBook.price, bookmaker: teamUnderBook.bookmaker } : undefined,
          confidence: "medium",
          rationale: `${team}: ${lambda.toFixed(2)} but(s) attendu(s).`,
          conflict_key: `${side}_team_total_${line}`,
          tags: [`${side}_low_score`],
        }),
      );
    }
  }

  const homeCleanSheet = Math.exp(-lambdaAway);
  const awayCleanSheet = Math.exp(-lambdaHome);
  suggestions.push(
    makeSuggestion({
      id: "home_clean_sheet",
      category: "Defense",
      market: "Clean sheet",
      selection: event.home_team,
      label: `${event.home_team} garde sa cage inviolee`,
      probability: homeCleanSheet,
      source: "model",
      confidence: "medium",
      rationale: `${event.away_team}: ${lambdaAway.toFixed(2)} but(s) attendu(s).`,
      conflict_key: "home_clean_sheet",
      tags: ["btts_no", "away_low_score"],
    }),
    makeSuggestion({
      id: "away_clean_sheet",
      category: "Defense",
      market: "Clean sheet",
      selection: event.away_team,
      label: `${event.away_team} garde sa cage inviolee`,
      probability: awayCleanSheet,
      source: "model",
      confidence: "medium",
      rationale: `${event.home_team}: ${lambdaHome.toFixed(2)} but(s) attendu(s).`,
      conflict_key: "away_clean_sheet",
      tags: ["btts_no", "home_low_score"],
    }),
  );

  const homeWinToNil = scores
    .filter((score) => score.home > score.away && score.away === 0)
    .reduce((sum, score) => sum + score.probability, 0);
  const awayWinToNil = scores
    .filter((score) => score.away > score.home && score.home === 0)
    .reduce((sum, score) => sum + score.probability, 0);
  const homeWinOver15 = scores
    .filter((score) => score.home > score.away && score.home + score.away > 1.5)
    .reduce((sum, score) => sum + score.probability, 0);
  const awayWinOver15 = scores
    .filter((score) => score.away > score.home && score.home + score.away > 1.5)
    .reduce((sum, score) => sum + score.probability, 0);

  suggestions.push(
    makeSuggestion({
      id: "home_win_to_nil",
      category: "Scenario",
      market: "Victoire + clean sheet",
      selection: event.home_team,
      label: `${event.home_team} gagne sans encaisser`,
      probability: homeWinToNil,
      source: "model",
      confidence: "medium",
      rationale: "Scenario derive de la matrice de scores.",
      conflict_key: "scenario_result",
      tags: ["result_home", "btts_no"],
    }),
    makeSuggestion({
      id: "away_win_to_nil",
      category: "Scenario",
      market: "Victoire + clean sheet",
      selection: event.away_team,
      label: `${event.away_team} gagne sans encaisser`,
      probability: awayWinToNil,
      source: "model",
      confidence: "medium",
      rationale: "Scenario derive de la matrice de scores.",
      conflict_key: "scenario_result",
      tags: ["result_away", "btts_no"],
    }),
    makeSuggestion({
      id: "home_win_over_15",
      category: "Scenario",
      market: "Victoire + buts",
      selection: event.home_team,
      label: `${event.home_team} gagne et plus de 1.5 buts`,
      probability: homeWinOver15,
      source: "model",
      confidence: "medium",
      rationale: "Scenario derive de la matrice de scores.",
      conflict_key: "scenario_result",
      tags: ["result_home", "over_1.5"],
    }),
    makeSuggestion({
      id: "away_win_over_15",
      category: "Scenario",
      market: "Victoire + buts",
      selection: event.away_team,
      label: `${event.away_team} gagne et plus de 1.5 buts`,
      probability: awayWinOver15,
      source: "model",
      confidence: "medium",
      rationale: "Scenario derive de la matrice de scores.",
      conflict_key: "scenario_result",
      tags: ["result_away", "over_1.5"],
    }),
  );

  const favoriteGap = Math.abs(pred.prob_home - pred.prob_away);
  const expectedCorners = Math.max(
    6.5,
    Math.min(12.5, 8.6 + (totalLambda - 2.4) * 0.85 + favoriteGap * 1.4),
  );
  for (const line of [7.5, 8.5, 9.5, 10.5]) {
    const probability = poissonOver(expectedCorners, line);
    suggestions.push(
      makeSuggestion({
        id: `corners_over_${String(line).replace(".", "_")}`,
        category: "Corners",
        market: "Total corners",
        selection: `Plus de ${line} corners`,
        label: `Plus de ${line} corners`,
        probability,
        source: "model",
        confidence: "low",
        rationale: `Proxy sans donnees corners officielles: volume estime ${expectedCorners.toFixed(1)}.`,
        data_level: "proxy",
        data_note:
          "Marche experimental: a confirmer avec une vraie cote bookmaker et des stats corners.",
        conflict_key: `corners_total_${line}`,
        tags: ["proxy_model", "corners"],
      }),
    );
  }

  const expectedCards = Math.max(
    2.2,
    Math.min(6.8, 3.6 + (1 - favoriteGap) * 0.9 + (event.stage ? 0.35 : 0)),
  );
  for (const line of [2.5, 3.5, 4.5]) {
    const probability = poissonOver(expectedCards, line);
    suggestions.push(
      makeSuggestion({
        id: `cards_over_${String(line).replace(".", "_")}`,
        category: "Cartons",
        market: "Total cartons",
        selection: `Plus de ${line} cartons`,
        label: `Plus de ${line} cartons`,
        probability,
        source: "model",
        confidence: "low",
        rationale: `Proxy sans arbitre ni historique cartons: volume estime ${expectedCards.toFixed(1)}.`,
        data_level: "proxy",
        data_note:
          "Marche experimental: ne pas utiliser sans verification compo, arbitre et cote.",
        conflict_key: `cards_total_${line}`,
        tags: ["proxy_model", "cards"],
      }),
    );
  }

  for (const snapshot of snapshots.filter((item) => item.market === "spreads")) {
    for (const selection of snapshot.selections) {
      const isHome = normalize(selection.name) === normalize(event.home_team);
      const lambda = { home: lambdaHome, away: lambdaAway };
      let probability = 0;
      for (const score of scores) {
        if (isHome && score.home + (selection.point || 0) > score.away) {
          probability += score.probability;
        }
        if (!isHome && score.away + (selection.point || 0) > score.home) {
          probability += score.probability;
        }
      }
      void lambda;
      suggestions.push(
        makeSuggestion({
          id: `spread_${normalize(selection.name)}_${selection.point}_${normalize(snapshot.bookmaker)}`,
          category: "Handicap",
          market: "Handicap",
          selection: `${selection.name} ${selection.point}`,
          label: `${selection.name} handicap ${selection.point}`,
          probability,
          source: "bookmaker",
          odds: { price: selection.price, bookmaker: snapshot.bookmaker },
          confidence: "medium",
          rationale: "Handicap bookmaker compare a la matrice de scores.",
          conflict_key: `spread_${selection.point}`,
          tags: [isHome ? "result_home" : "result_away"],
        }),
      );
    }
  }

  for (const score of scores
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 8)) {
    suggestions.push(
      makeSuggestion({
        id: `score_${score.home}_${score.away}`,
        category: "Score exact",
        market: "Score exact",
        selection: `${score.home}-${score.away}`,
        label: `Score exact ${score.home}-${score.away}`,
        probability: score.probability,
        source: "model",
        confidence: "low",
        rationale: "Score exact issu de la simulation Poisson.",
        conflict_key: "exact_score",
        tags: ["exact_score"],
      }),
    );
  }

  for (const player of (playerInsights?.players || []).slice(0, 10)) {
    const goalOrAssistProbability =
      player.goal_or_assist_probability ||
      1 -
        (1 - player.anytime_scorer_probability) *
          (1 - player.assist_probability);
    const shotOnTargetLambda =
      player.expected_goals *
      (player.position.toLowerCase().includes("midfield") ? 2.1 : 2.7);
    const shotOnTargetProbability =
      player.shot_on_target_probability || poissonAtLeastOne(shotOnTargetLambda);
    const twoShotsOnTargetProbability =
      player.two_shots_on_target_probability || poissonAtLeastTwo(shotOnTargetLambda);
    const playerCardProbability =
      player.card_probability || cardProbability(player.position, player.reliability);
    const playerTeamLambda = sameEntity(player.team, event.home_team)
      ? lambdaHome
      : lambdaAway;
    const teamFirstGoalProbability = sameEntity(player.team, event.home_team)
      ? firstGoalHome
      : firstGoalAway;
    const teamScoresProbability = poissonAtLeastOne(playerTeamLambda);
    const playerGoalShare =
      teamScoresProbability > 0
        ? Math.min(0.65, player.anytime_scorer_probability / teamScoresProbability)
        : 0;
    const firstScorerProbability = teamFirstGoalProbability * playerGoalShare;
    const scorerBook = bestPlayerOutcome(
      snapshots,
      "player_goal_scorer_anytime",
      player.player,
    );
    const assistBook = bestPlayerOutcome(
      snapshots,
      "player_assists",
      player.player,
      (selection) =>
        selection.name === "Yes" ||
        (selection.name === "Over" && (selection.point == null || selection.point <= 0.5)),
    );
    const shotOnTargetBook = bestPlayerOutcome(
      snapshots,
      "player_shots_on_target",
      player.player,
      (selection) => selection.name === "Over" && (selection.point == null || selection.point <= 0.5),
    );
    const twoShotsOnTargetBook = bestPlayerOutcome(
      snapshots,
      "player_shots_on_target",
      player.player,
      (selection) => selection.name === "Over" && selection.point === 1.5,
    );
    const cardBook = bestPlayerOutcome(
      snapshots,
      "player_to_receive_card",
      player.player,
    );

    suggestions.push(
      makeSuggestion({
        id: `player_score_${player.player_id}`,
        category: "Joueurs",
        market: "Buteur",
        selection: player.player,
        label: `${player.player} buteur`,
        probability: player.anytime_scorer_probability,
        source: scorerBook ? "bookmaker" : "model",
        odds: scorerBook ? { price: scorerBook.price, bookmaker: scorerBook.bookmaker } : undefined,
        confidence: player.reliability,
        rationale: `${player.expected_goals.toFixed(2)} but attendu individuel.`,
        conflict_key: `player_${player.player_id}_goal`,
        tags: ["player_goal", `player_${player.player_id}`],
      }),
      makeSuggestion({
        id: `player_brace_${player.player_id}`,
        category: "Joueurs",
        market: "Double",
        selection: player.player,
        label: `${player.player} marque 2 buts ou plus`,
        probability: player.brace_probability,
        source: "model",
        confidence: "low",
        rationale: "Projection joueur tres volatile.",
        conflict_key: `player_${player.player_id}_brace`,
        tags: ["player_goal", `player_${player.player_id}`, "high_variance"],
      }),
      makeSuggestion({
        id: `player_assist_${player.player_id}`,
        category: "Joueurs",
        market: "Passe decisive",
        selection: player.player,
        label: `${player.player} passe decisive`,
        probability: player.assist_probability,
        source: assistBook ? "bookmaker" : "model",
        odds: assistBook ? { price: assistBook.price, bookmaker: assistBook.bookmaker } : undefined,
        confidence: player.reliability,
        rationale: "Projection derivee du poste et des passes tournoi.",
        conflict_key: `player_${player.player_id}_assist`,
        tags: ["player_assist", `player_${player.player_id}`],
      }),
      makeSuggestion({
        id: `player_goal_or_assist_${player.player_id}`,
        category: "Joueurs",
        market: "But ou passe",
        selection: player.player,
        label: `${player.player} but ou passe decisive`,
        probability: goalOrAssistProbability,
        source: "model",
        confidence: player.reliability,
        rationale: "Combinaison probabiliste buteur + passeur, avec correction de chevauchement.",
        conflict_key: `player_${player.player_id}_goal_or_assist`,
        tags: ["player_goal", "player_assist", `player_${player.player_id}`],
      }),
      makeSuggestion({
        id: `player_first_goal_${player.player_id}`,
        category: "Joueurs",
        market: "Premier buteur",
        selection: player.player,
        label: `${player.player} marque le premier but`,
        probability: firstScorerProbability,
        source: "model",
        confidence: "low",
        rationale: "Approximation derivee de la probabilite que son equipe marque en premier et de sa part de buts attendue.",
        data_level: "proxy",
        data_note:
          "Marche tres volatile: attendre une vraie cote bookmaker et les compositions avant usage.",
        conflict_key: "first_goal_scorer",
        tags: ["proxy_model", "player_goal", `player_${player.player_id}`, "high_variance"],
      }),
      makeSuggestion({
        id: `player_sot_${player.player_id}`,
        category: "Joueurs - tirs",
        market: "Tir cadre",
        selection: player.player,
        label: `${player.player} 1+ tir cadre`,
        probability: shotOnTargetProbability,
        source: shotOnTargetBook ? "bookmaker" : "model",
        odds: shotOnTargetBook ? { price: shotOnTargetBook.price, bookmaker: shotOnTargetBook.bookmaker } : undefined,
        confidence: "low",
        rationale: "Proxy derive des xG individuels: pas encore une statistique de tirs observee.",
        data_level: shotOnTargetBook ? "bookmaker" : "proxy",
        data_note:
          shotOnTargetBook
            ? "Cote bookmaker disponible, mais la probabilite modele reste un proxy derive des xG."
            : "A confirmer avec les cotes de tirs cadres du bookmaker avant de jouer.",
        conflict_key: `player_${player.player_id}_sot`,
        tags: ["proxy_model", "player_shot", `player_${player.player_id}`],
      }),
      makeSuggestion({
        id: `player_sot_2_${player.player_id}`,
        category: "Joueurs - tirs",
        market: "Tirs cadres",
        selection: player.player,
        label: `${player.player} 2+ tirs cadres`,
        probability: twoShotsOnTargetProbability,
        source: twoShotsOnTargetBook ? "bookmaker" : "model",
        odds: twoShotsOnTargetBook ? { price: twoShotsOnTargetBook.price, bookmaker: twoShotsOnTargetBook.bookmaker } : undefined,
        confidence: "low",
        rationale: "Proxy tres volatil derive des xG individuels.",
        data_level: twoShotsOnTargetBook ? "bookmaker" : "proxy",
        data_note:
          twoShotsOnTargetBook
            ? "Cote bookmaker disponible, mais marche tres sensible au temps de jeu."
            : "Marche experimental: exclu des combines prudents.",
        conflict_key: `player_${player.player_id}_sot`,
        tags: ["proxy_model", "player_shot", `player_${player.player_id}`, "high_variance"],
      }),
      makeSuggestion({
        id: `player_outside_box_${player.player_id}`,
        category: "Joueurs",
        market: "But hors surface",
        selection: player.player,
        label: `${player.player} marque hors surface`,
        probability: player.outside_box_goal_probability,
        source: "model",
        confidence: "low",
        rationale: "Projection experimentale derivee du poste et de la proba buteur.",
        data_level: "proxy",
        data_note:
          "Tres haute variance: a traiter comme fun bet, pas comme pari principal.",
        conflict_key: `player_${player.player_id}_outside_box`,
        tags: ["proxy_model", "player_goal", `player_${player.player_id}`, "high_variance"],
      }),
    );

    suggestions.push(
      makeSuggestion({
        id: `player_card_${player.player_id}`,
        category: "Joueurs - discipline",
        market: "Carton joueur",
        selection: player.player,
        label: `${player.player} recoit un carton`,
        probability: playerCardProbability,
        source: cardBook ? "bookmaker" : "model",
        odds: cardBook ? { price: cardBook.price, bookmaker: cardBook.bookmaker } : undefined,
        confidence: "low",
        rationale: "Proxy discipline base sur le poste; le risque augmente pour milieux/defenseurs.",
        data_level: cardBook ? "bookmaker" : "proxy",
        data_note: cardBook
          ? "Cote bookmaker disponible, mais a confirmer avec composition, role defensif et arbitre."
          : "Pas de cote bookmaker detectee: signal informatif, pas une recommandation jouable.",
        conflict_key: `player_${player.player_id}_card`,
        tags: ["player_card", `player_${player.player_id}`, "high_variance", ...(cardBook ? [] : ["proxy_model"])],
      }),
    );
  }

  appendBookmakerOnlyPlayerProps(suggestions, snapshots);

  return suggestions
    .filter((suggestion) => suggestion.probability > 0.015)
    .sort((a, b) => {
      const aEdge = a.edge ?? -0.2;
      const bEdge = b.edge ?? -0.2;
      return (
        (bEdge + b.probability * 0.4) - (aEdge + a.probability * 0.4)
      );
    });
}

function hasConflict(legs: BetSuggestion[], next: BetSuggestion) {
  if (legs.some((leg) => leg.conflict_key === next.conflict_key)) return true;
  if (legs.some((leg) => leg.category === "Resultat" && next.category === "Resultat")) {
    return true;
  }
  if (legs.some((leg) => leg.market === "Total buts" && next.market === "Total buts")) {
    return true;
  }
  if (
    legs.some(
      (leg) =>
        leg.market === "Buts equipe" &&
        next.market === "Buts equipe" &&
        leg.tags.some((tag) => next.tags.includes(tag)),
    )
  ) {
    return true;
  }

  const tags = new Set(legs.flatMap((leg) => leg.tags));
  if (next.tags.includes("result_home") && tags.has("result_away")) return true;
  if (next.tags.includes("result_away") && tags.has("result_home")) return true;
  if (next.tags.includes("btts_yes") && tags.has("btts_no")) return true;
  if (next.tags.includes("btts_no") && tags.has("btts_yes")) return true;
  if (next.tags.includes("no_draw") && tags.has("draw")) return true;
  if (next.tags.includes("draw") && tags.has("no_draw")) return true;
  const nextDirectionalResult =
    next.tags.includes("result_home") || next.tags.includes("result_away");
  const existingDirectionalResult =
    tags.has("result_home") || tags.has("result_away");
  if (next.tags.includes("no_draw") && existingDirectionalResult) return true;
  if (tags.has("no_draw") && nextDirectionalResult) return true;
  if (next.tags.includes("no_away_win") && tags.has("result_home")) return true;
  if (tags.has("no_away_win") && next.tags.includes("result_home")) return true;
  if (next.tags.includes("no_home_win") && tags.has("result_away")) return true;
  if (tags.has("no_home_win") && next.tags.includes("result_away")) return true;
  for (const tag of next.tags) {
    if (/^player_\d+$/.test(tag) && tags.has(tag)) return true;
  }
  return false;
}

function isFrenchBetSuggestion(suggestion: BetSuggestion) {
  return (
    suggestion.odds_source === "french_bookmaker" ||
    Boolean(suggestion.is_french_bookmaker) ||
    Boolean(isFrenchBookmaker(suggestion.bookmaker, suggestion.bookmaker_key))
  );
}

function isPlayerPropSuggestion(suggestion: BetSuggestion) {
  return (
    suggestion.category.startsWith("Joueurs") ||
    suggestion.market.toLowerCase().includes("buteur") ||
    suggestion.tags.some((tag) => tag.startsWith("player_") || tag.includes("scorer"))
  );
}

function buildProfiledSameMatchParlay(
  suggestions: BetSuggestion[],
  request: MatchParlayRequest,
): MatchParlayResponse["parlay"] | null {
  const target = Math.max(1.1, request.target_odds);
  const profile = normalizeParlayProfile(request.risk_profile);
  const config = SAME_MATCH_PARLAY_PROFILES[profile];
  const maxLegs = Math.min(request.max_legs || config.maxLegs, config.maxLegs);
  const activeFilterWarnings = [
    ...(request.require_french_odds ? ["Filtre actif: seules les cotes bookmakers francais sont autorisees."] : []),
    ...(request.bookmaker_only ? ["Filtre actif: les cotes modele/proxy sont exclues du ticket automatique."] : []),
    ...(request.exclude_player_props ? ["Filtre actif: les marches joueurs/buteurs sont exclus."] : []),
    ...(maxLegs < config.maxLegs ? [`Filtre actif: maximum ${maxLegs} selection(s).`] : []),
  ];
  const scoreCandidate = (suggestion: BetSuggestion) => {
    const bookmakerBonus = suggestion.offered_odds ? 0.18 : 0;
    const edgeBonus = Math.max(-0.08, Math.min(0.16, suggestion.edge ?? 0));
    const reliabilityBonus = ((suggestion.reliability_score ?? 0) / 100) * 0.22;
    const highVariancePenalty = suggestion.tags.includes("high_variance") ? -0.08 : 0;
    return (
      suggestion.probability / oddsForSuggestion(suggestion) +
      edgeBonus +
      reliabilityBonus +
      (config.preferBookmakerOdds ? bookmakerBonus : bookmakerBonus * 0.35) +
      highVariancePenalty
    );
  };
  const candidates = suggestions
    .filter(
      (suggestion) =>
        suggestion.probability >= config.minProbability &&
        (config.allowLowConfidence || suggestion.confidence !== "low") &&
        suggestion.data_level !== "proxy" &&
        suggestion.playability !== "eviter" &&
        (suggestion.reliability_score ?? 0) >= config.minReliability &&
        !hasAdverseMarketSignal(suggestion) &&
        !suggestion.tags.includes("exact_score") &&
        !suggestion.tags.includes("proxy_model") &&
        (config.allowHighVariance || !suggestion.tags.includes("high_variance")) &&
        (!config.preferBookmakerOdds || Boolean(suggestion.offered_odds)) &&
        (!request.bookmaker_only || (suggestion.source === "bookmaker" && Boolean(suggestion.offered_odds))) &&
        (!request.require_french_odds || (suggestion.source === "bookmaker" && Boolean(suggestion.offered_odds) && isFrenchBetSuggestion(suggestion))) &&
        (!request.exclude_player_props || !isPlayerPropSuggestion(suggestion)),
    )
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, config.maxCandidates);

  let best: MatchParlayResponse["parlay"] | null = null;

  function isBetterCandidate(
    candidate: NonNullable<MatchParlayResponse["parlay"]>,
    current: NonNullable<MatchParlayResponse["parlay"]>,
  ) {
    const candidateDistance = Math.max(0, candidate.total_odds - target);
    const currentDistance = Math.max(0, current.total_odds - target);

    if (profile === "aggressive") {
      if (Math.abs(candidateDistance - currentDistance) > 0.08) {
        return candidateDistance < currentDistance;
      }
      return candidate.estimated_probability > current.estimated_probability;
    }

    if (profile === "prudent") {
      if (Math.abs(candidate.estimated_probability - current.estimated_probability) > 0.003) {
        return candidate.estimated_probability > current.estimated_probability;
      }
      if (candidate.legs.length !== current.legs.length) {
        return candidate.legs.length < current.legs.length;
      }
      return candidate.total_odds < current.total_odds;
    }

    if (Math.abs(candidate.estimated_probability - current.estimated_probability) > 0.004) {
      return candidate.estimated_probability > current.estimated_probability;
    }
    return candidateDistance < currentDistance;
  }

  function visit(start: number, legs: BetSuggestion[]) {
    if (legs.length) {
      const totalOdds = round(
        legs.reduce((product, leg) => product * oddsForSuggestion(leg), 1),
        2,
      );
      const probability =
        legs.reduce((product, leg) => product * leg.probability, 1) *
        config.correlationPenalty ** Math.max(0, legs.length - 1);

      if (totalOdds >= target) {
        const candidate = {
          legs,
          total_odds: totalOdds,
          estimated_probability: round(probability),
          potential_return: request.stake
            ? round(request.stake * totalOdds, 2)
            : undefined,
          warnings: [
            config.warning,
            ...activeFilterWarnings,
            "Combine meme match: les marches sont correles, la probabilite reste approximative.",
            "Les cotes sans bookmaker indique sont des cotes modele estimees, pas des cotes jouables garanties.",
          ],
        };
        if (!best || isBetterCandidate(candidate, best)) {
          best = candidate;
        }
        return;
      }
    }

    if (legs.length >= maxLegs) return;

    for (let i = start; i < candidates.length; i += 1) {
      const next = candidates[i];
      if (hasConflict(legs, next)) continue;
      visit(i + 1, [...legs, next]);
    }
  }

  visit(0, []);
  return best;
}

function buildSameMatchParlay(
  suggestions: BetSuggestion[],
  request: MatchParlayRequest,
): MatchParlayResponse["parlay"] | null {
  const target = Math.max(1.1, request.target_odds);
  const candidates = suggestions
    .filter(
      (suggestion) =>
        suggestion.probability >= 0.32 &&
        suggestion.confidence !== "low" &&
        suggestion.data_level !== "proxy" &&
        suggestion.playability !== "eviter" &&
        (suggestion.reliability_score ?? 0) >= 58 &&
        !hasAdverseMarketSignal(suggestion) &&
        !suggestion.tags.includes("exact_score") &&
        !suggestion.tags.includes("proxy_model") &&
        !suggestion.tags.includes("high_variance"),
    )
    .sort(
      (a, b) =>
        b.probability / oddsForSuggestion(b) -
        a.probability / oddsForSuggestion(a),
    )
    .slice(0, 38);

  let best: MatchParlayResponse["parlay"] | null = null;

  function visit(start: number, legs: BetSuggestion[]) {
    if (legs.length) {
      const totalOdds = round(
        legs.reduce((product, leg) => product * oddsForSuggestion(leg), 1),
        2,
      );
      const probability =
        legs.reduce((product, leg) => product * leg.probability, 1) *
        0.9 ** Math.max(0, legs.length - 1);

      if (totalOdds >= target) {
        const candidate = {
          legs,
          total_odds: totalOdds,
          estimated_probability: round(probability),
          potential_return: request.stake
            ? round(request.stake * totalOdds, 2)
            : undefined,
          warnings: [
            "Combiné même match: les marchés sont corrélés, la probabilité reste approximative.",
            "Les cotes sans bookmaker indiqué sont des cotes modèle estimées, pas des cotes jouables garanties.",
          ],
        };
        if (
          !best ||
          candidate.estimated_probability > best.estimated_probability ||
          (candidate.estimated_probability === best.estimated_probability &&
            candidate.total_odds < best.total_odds)
        ) {
          best = candidate;
        }
        return;
      }
    }

    if (legs.length >= (request.max_legs || 4)) return;

    for (let i = start; i < candidates.length; i += 1) {
      const next = candidates[i];
      if (hasConflict(legs, next)) continue;
      visit(i + 1, [...legs, next]);
    }
  }

  visit(0, []);
  return best;
}

export async function getMatchBetBuilder(
  eventId: number,
  options: { includeEventOdds?: boolean } = {},
): Promise<MatchBetBuilder | null> {
  const [event, players, odds] = await Promise.all([
    getMatch(eventId),
    getPlayerInsights(eventId).catch(() => null),
    getWorldCupOdds().catch(() => null),
  ]);
  if (!event?.prediction) return null;

  const oddsEvent = odds ? matchOddsEvent(event, odds.events) : undefined;
  const additionalOdds =
    options.includeEventOdds !== false && oddsEvent?.id
      ? await Promise.allSettled([
          getWorldCupEventOdds(oddsEvent.id, EVENT_CORE_SOCCER_MARKETS),
          getWorldCupEventOdds(oddsEvent.id, EVENT_PLAYER_SOCCER_MARKETS),
        ]).then((results) =>
          results
            .filter((result) => result.status === "fulfilled")
            .map((result) => result.value.event),
        )
      : [];
  const snapshots = [
    ...serializeOdds(oddsEvent),
    ...additionalOdds.flatMap((eventOdds) => serializeOdds(eventOdds)),
  ];
  const oddsHistory = await getEventOddsHistory(eventId, {
    includeBase: true,
    limit: 3000,
  }).catch(() => null);
  const movements = Array.isArray(
    (oddsHistory as { movements?: OddsMovementSignal[] } | null)?.movements,
  )
    ? ((oddsHistory as { movements?: OddsMovementSignal[] }).movements || [])
    : [];
  const suggestions = finalizeSuggestions(
    buildSuggestions(event, players, snapshots),
    movements,
  );
  const oddsCoverage = summarizeFrenchOddsCoverage(snapshots);
  const marketCatalog = buildMarketCatalog(suggestions);

  return {
    event_id: eventId,
    generated_at: new Date().toISOString(),
    suggestions,
    bookmaker_markets: snapshots.length,
    model_markets: suggestions.filter((suggestion) => suggestion.source === "model").length,
    preferred_bookmakers: [
      ...FRENCH_BOOKMAKER_PRIORITY,
      "Fallback: meilleure cote globale si aucune cote FR n'est disponible",
    ],
    market_catalog: marketCatalog,
    odds_coverage: oddsCoverage,
    warnings: [
      `Couverture FR: ${oddsCoverage.french_markets} marche(s) via ${oddsCoverage.french_bookmakers.join(", ") || "aucun bookmaker FR"}.`,
      "Priorite d'affichage: Winamax FR, Betclic FR, Unibet FR, PMU FR, puis fallback global.",
      "Les marchés joueurs et scénarios sont des projections modèle si aucune cote bookmaker n'est disponible.",
      "Les cotes joueurs bookmaker viennent des marchés événement disponibles et peuvent varier selon les books.",
      "Aucun pari n'est sûr: les propositions sont probabilistes.",
    ],
  };
}

export async function generateSameMatchParlay(
  eventId: number,
  request: MatchParlayRequest,
): Promise<MatchParlayResponse> {
  const riskProfile = normalizeParlayProfile(request.risk_profile);
  const builder = await getMatchBetBuilder(eventId);
  if (!builder) {
    return { success: false, risk_profile: riskProfile, message: "Match ou prediction indisponible." };
  }

  const parlay = buildProfiledSameMatchParlay(builder.suggestions, {
    ...request,
    risk_profile: riskProfile,
  });
  if (!parlay) {
    return {
      success: false,
      risk_profile: riskProfile,
      message:
        "Aucun combiné sain ne permet d'atteindre cette cote avec les contraintes actuelles.",
    };
  }

  return {
    success: true,
    target_odds: request.target_odds,
    risk_profile: riskProfile,
    parlay,
  };
}
