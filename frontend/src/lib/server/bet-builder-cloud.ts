import type {
  Event,
  MatchBetBuilder,
  MatchParlayRequest,
  MatchParlayResponse,
  BetSuggestion,
  OddsSnapshot,
  PlayerInsights,
} from "@/lib/api";
import { getMatch } from "@/lib/server/football-cloud";
import { getPlayerInsights } from "@/lib/server/player-cloud";
import {
  getWorldCupOdds,
  matchOddsEvent,
  serializeOdds,
} from "@/lib/server/odds-cloud";

type Impact = BetSuggestion["risk_level"];

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
  for (let goals = 0; goals <= 12; goals += 1) {
    if (goals > line) probability += poissonProbability(goals, lambda);
  }
  return probability;
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
      if (!best || selection.price > best.price) {
        best = { ...selection, bookmaker: snapshot.bookmaker, market };
      }
    }
  }

  return best;
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
  conflict_key: string;
  tags?: string[];
}): BetSuggestion {
  const probability = Math.max(0.001, Math.min(0.999, input.probability));
  const offeredOdds = input.odds?.price;
  const modelFairOdds = fairOdds(probability);
  const impliedProb = offeredOdds ? 1 / offeredOdds : undefined;
  const edge = impliedProb == null ? undefined : probability - impliedProb;
  const ev = offeredOdds == null ? undefined : probability * offeredOdds - 1;

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
    edge: edge == null ? undefined : round(edge),
    ev: ev == null ? undefined : round(ev),
    risk_level: input.confidence === "low" ? "aggressive" : riskLevel(probability),
    confidence: input.confidence || (probability >= 0.55 ? "medium" : "low"),
    source: input.source,
    rationale: input.rationale,
    conflict_key: input.conflict_key,
    tags: input.tags || [],
  };
}

function oddsForSuggestion(suggestion: BetSuggestion) {
  // If a bookmaker price is available, use it. Otherwise use a cautious model
  // estimate, haircut by 6% to simulate bookmaker margin.
  return suggestion.offered_odds || round(suggestion.fair_odds * 0.94, 2);
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
  if (noDraw > 0) {
    suggestions.push(
      makeSuggestion({
        id: "dnb_home",
        category: "Resultat",
        market: "Rembourse si nul",
        selection: event.home_team,
        label: `${event.home_team} rembourse si nul`,
        probability: pred.prob_home / noDraw,
        source: "model",
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
        source: "model",
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
  suggestions.push(
    makeSuggestion({
      id: "btts_yes",
      category: "Buts",
      market: "Les deux equipes marquent",
      selection: "Oui",
      label: "Les deux equipes marquent",
      probability: bttsYes,
      source: "model",
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
      source: "model",
      confidence: "medium",
      rationale: `Probabilite BTTS Non ${pct(1 - bttsYes)}.`,
      conflict_key: "btts",
      tags: ["btts_no"],
    }),
  );

  for (const [side, team, lambda] of [
    ["home", event.home_team, lambdaHome],
    ["away", event.away_team, lambdaAway],
  ] as const) {
    for (const line of [0.5, 1.5, 2.5]) {
      const over = poissonOver(lambda, line);
      suggestions.push(
        makeSuggestion({
          id: `${side}_team_over_${String(line).replace(".", "_")}`,
          category: "Buts equipe",
          market: "Buts equipe",
          selection: `${team} plus de ${line}`,
          label: `${team} marque plus de ${line} but(s)`,
          probability: over,
          source: "model",
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
          source: "model",
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
    suggestions.push(
      makeSuggestion({
        id: `player_score_${player.player_id}`,
        category: "Joueurs",
        market: "Buteur",
        selection: player.player,
        label: `${player.player} buteur`,
        probability: player.anytime_scorer_probability,
        source: "model",
        confidence: player.reliability,
        rationale: `${player.expected_goals.toFixed(2)} but attendu individuel.`,
        conflict_key: `player_${player.player_id}_goal`,
        tags: ["player_goal"],
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
        tags: ["player_goal", "high_variance"],
      }),
      makeSuggestion({
        id: `player_assist_${player.player_id}`,
        category: "Joueurs",
        market: "Passe decisive",
        selection: player.player,
        label: `${player.player} passe decisive`,
        probability: player.assist_probability,
        source: "model",
        confidence: player.reliability,
        rationale: "Projection derivee du poste et des passes tournoi.",
        conflict_key: `player_${player.player_id}_assist`,
        tags: ["player_assist"],
      }),
    );
  }

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
  return false;
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
        !suggestion.tags.includes("exact_score") &&
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
): Promise<MatchBetBuilder | null> {
  const [event, players, odds] = await Promise.all([
    getMatch(eventId),
    getPlayerInsights(eventId).catch(() => null),
    getWorldCupOdds().catch(() => null),
  ]);
  if (!event?.prediction) return null;

  const oddsEvent = odds ? matchOddsEvent(event, odds.events) : undefined;
  const snapshots = serializeOdds(oddsEvent);
  const suggestions = buildSuggestions(event, players, snapshots);

  return {
    event_id: eventId,
    generated_at: new Date().toISOString(),
    suggestions,
    bookmaker_markets: snapshots.length,
    model_markets: suggestions.filter((suggestion) => suggestion.source === "model").length,
    preferred_bookmakers: [
      "Winamax",
      "Unibet",
      "Betfair",
      "Pinnacle",
      "PMU",
      "Betclic",
    ],
    warnings: [
      "Les marchés joueurs et scénarios sont des projections modèle si aucune cote bookmaker n'est disponible.",
      "Aucun pari n'est sûr: les propositions sont probabilistes.",
    ],
  };
}

export async function generateSameMatchParlay(
  eventId: number,
  request: MatchParlayRequest,
): Promise<MatchParlayResponse> {
  const builder = await getMatchBetBuilder(eventId);
  if (!builder) {
    return { success: false, message: "Match ou prediction indisponible." };
  }

  const parlay = buildSameMatchParlay(builder.suggestions, request);
  if (!parlay) {
    return {
      success: false,
      message:
        "Aucun combiné sain ne permet d'atteindre cette cote avec les contraintes actuelles.",
    };
  }

  return {
    success: true,
    target_odds: request.target_odds,
    parlay,
  };
}
