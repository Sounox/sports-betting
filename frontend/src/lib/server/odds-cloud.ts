import type { Event, OddsSnapshot, ValueBet } from "@/lib/api";
import {
  FRENCH_BOOKMAKER_PRIORITY,
  bookmakerPreferenceRank,
  bookmakerSourceMeta,
  isFrenchBookmaker,
  preferBookmakerOdd,
} from "@/lib/server/french-bookmakers";

export {
  FRENCH_BOOKMAKER_PRIORITY,
  bookmakerPreferenceRank,
  bookmakerSourceMeta,
  isFrenchBookmaker,
  summarizeFrenchOddsCoverage,
} from "@/lib/server/french-bookmakers";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY =
  process.env.ODDS_API_KEY || "baa56883db051af74cc48c5512bfc426";
const SPORT_KEY = "soccer_fifa_world_cup";

interface OddsOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  last_update: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsBookmaker[];
}

export const EVENT_CORE_SOCCER_MARKETS = [
  "btts",
  "draw_no_bet",
  "team_totals",
];

export const EVENT_PLAYER_SOCCER_MARKETS = [
  "player_goal_scorer_anytime",
  "player_assists",
  "player_shots_on_target",
  "player_to_receive_card",
];

const ADDITIONAL_SOCCER_MARKETS = [
  ...EVENT_CORE_SOCCER_MARKETS,
  ...EVENT_PLAYER_SOCCER_MARKETS,
];

interface CandidateOdd {
  key: string;
  market: string;
  selection: string;
  price: number;
  point?: number;
  bookmaker: string;
  bookmakerTitle: string;
  impliedProb: number;
  fairProb: number;
  overround: number;
  updatedAt: string;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modelProbability(event: Event, candidate: CandidateOdd) {
  const prediction = event.prediction;
  if (!prediction) return null;

  if (candidate.market === "h2h") {
    if (normalize(candidate.selection) === normalize(event.home_team)) {
      return prediction.prob_home;
    }
    if (normalize(candidate.selection) === normalize(event.away_team)) {
      return prediction.prob_away;
    }
    if (normalize(candidate.selection) === "draw") {
      return prediction.prob_draw;
    }
  }

  if (candidate.market === "totals" && candidate.point != null) {
    const overProbability =
      prediction.markets?.over_under?.[
        `over_${String(candidate.point).replace(".", "_")}`
      ] ?? totalGoalsProbability(prediction.markets?.lambda, candidate.point);
    return candidate.selection === "Over"
      ? overProbability
      : 1 - overProbability;
  }

  if (candidate.market === "spreads" && candidate.point != null) {
    return handicapProbability(
      prediction.markets?.lambda,
      normalize(candidate.selection) === normalize(event.home_team)
        ? "home"
        : "away",
      candidate.point,
    );
  }

  return null;
}

function poissonProbability(goals: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function totalGoalsProbability(
  lambda: { home?: number; away?: number } | undefined,
  line: number,
) {
  const total = (lambda?.home ?? 1.25) + (lambda?.away ?? 1.25);
  let probability = 0;
  for (let goals = 0; goals <= 12; goals += 1) {
    if (goals > line) probability += poissonProbability(goals, total);
  }
  return probability;
}

function handicapProbability(
  lambda: { home?: number; away?: number } | undefined,
  team: "home" | "away",
  point: number,
) {
  const lambdaHome = lambda?.home ?? 1.25;
  const lambdaAway = lambda?.away ?? 1.25;
  let probability = 0;

  for (let home = 0; home <= 10; home += 1) {
    for (let away = 0; away <= 10; away += 1) {
      const p =
        poissonProbability(home, lambdaHome) *
        poissonProbability(away, lambdaAway);
      if (team === "home" && home + point > away) probability += p;
      if (team === "away" && away + point > home) probability += p;
    }
  }

  return probability;
}

function recommendationScore(
  edge: number,
  ev: number,
  confidence: string,
  dataQuality: string,
) {
  const confidenceMultiplier =
    confidence === "high" ? 1.15 : confidence === "medium" ? 1 : 0.7;
  const qualityMultiplier =
    dataQuality === "good" ? 1.1 : dataQuality === "fair" ? 0.95 : 0.65;
  return Math.min(
    100,
    Math.max(
      0,
      (edge * 300 + ev * 180) *
        confidenceMultiplier *
        qualityMultiplier *
        100,
    ),
  );
}

function buildCandidates(oddsEvent: OddsEvent) {
  const candidates: CandidateOdd[] = [];

  for (const bookmaker of oddsEvent.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (!["h2h", "totals", "spreads"].includes(market.key)) continue;
      const overround = market.outcomes.reduce(
        (sum, outcome) =>
          outcome.price > 1 ? sum + 1 / outcome.price : sum,
        0,
      );
      if (overround <= 0) continue;

      for (const outcome of market.outcomes) {
        if (outcome.price <= 1) continue;
        const pointKey = outcome.point == null ? "" : `:${outcome.point}`;
        const key = `${market.key}:${normalize(outcome.name)}${pointKey}`;
        const impliedProb = 1 / outcome.price;
        candidates.push({
          key,
          market: market.key,
          selection: outcome.name,
          point: outcome.point,
          price: outcome.price,
          bookmaker: bookmaker.key,
          bookmakerTitle: bookmaker.title,
          impliedProb,
          fairProb: impliedProb / overround,
          overround,
          updatedAt: market.last_update || bookmaker.last_update,
        });
      }
    }
  }

  return candidates;
}

function selectBestOdds(candidates: CandidateOdd[]) {
  const grouped = new Map<string, CandidateOdd[]>();
  for (const candidate of candidates) {
    const entries = grouped.get(candidate.key) || [];
    entries.push(candidate);
    grouped.set(candidate.key, entries);
  }

  const best: CandidateOdd[] = [];
  for (const entries of grouped.values()) {
    const center = median(entries.map((entry) => entry.price));
    const valid = entries.filter(
      (entry) =>
        entry.price <= center * 2 &&
        entry.price >= center / 2 &&
        entry.overround >= 0.92 &&
        entry.overround <= 1.25,
    );
    const pool = valid.length ? valid : entries;
    best.push(pool.reduce((a, b) => preferBookmakerOdd(a, b)));
  }
  return best;
}

export async function getWorldCupOdds(): Promise<{
  events: OddsEvent[];
  quota: { remaining?: string; used?: string; last?: string };
}> {
  const url = new URL(`${ODDS_API_BASE}/sports/${SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", ODDS_API_KEY);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h,totals,spreads");
  url.searchParams.set("oddsFormat", "decimal");

  const response = await fetch(url, {
    next: { revalidate: 14400 },
    // Cloudflare caches the upstream result for four hours, protecting the free quota.
    ...({
      cf: {
        cacheEverything: true,
        cacheTtl: 14400,
        cacheKey: `${ODDS_API_BASE}/cache/${SPORT_KEY}/eu/h2h-totals-spreads`,
      },
    } as Record<string, unknown>),
  });

  if (!response.ok) {
    throw new Error(`The Odds API ${response.status}`);
  }

  return {
    events: (await response.json()) as OddsEvent[],
    quota: {
      remaining: response.headers.get("x-requests-remaining") || undefined,
      used: response.headers.get("x-requests-used") || undefined,
      last: response.headers.get("x-requests-last") || undefined,
    },
  };
}

export async function getWorldCupEventOdds(
  oddsEventId: string,
  markets = ADDITIONAL_SOCCER_MARKETS,
): Promise<{
  event: OddsEvent;
  quota: { remaining?: string; used?: string; last?: string };
}> {
  const marketKey = markets.join(",");
  const safeMarketKey = markets.join("-");
  const url = new URL(`${ODDS_API_BASE}/sports/${SPORT_KEY}/events/${oddsEventId}/odds`);
  url.searchParams.set("apiKey", ODDS_API_KEY);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", marketKey);
  url.searchParams.set("oddsFormat", "decimal");

  const response = await fetch(url, {
    next: { revalidate: 21600 },
    // Event-level markets can be expensive; cache for six hours to protect the free quota.
    ...({
      cf: {
        cacheEverything: true,
        cacheTtl: 21600,
        cacheKey: `${ODDS_API_BASE}/cache/${SPORT_KEY}/${oddsEventId}/eu/additional-${safeMarketKey}`,
      },
    } as Record<string, unknown>),
  });

  if (!response.ok) {
    throw new Error(`The Odds API event odds ${response.status}`);
  }

  return {
    event: (await response.json()) as OddsEvent,
    quota: {
      remaining: response.headers.get("x-requests-remaining") || undefined,
      used: response.headers.get("x-requests-used") || undefined,
      last: response.headers.get("x-requests-last") || undefined,
    },
  };
}

export function matchOddsEvent(event: Event, oddsEvents: OddsEvent[]) {
  const home = normalize(event.home_team);
  const away = normalize(event.away_team);
  return oddsEvents.find(
    (candidate) =>
      normalize(candidate.home_team) === home &&
      normalize(candidate.away_team) === away,
  );
}

export function calculateValueBets(
  event: Event,
  oddsEvent: OddsEvent | undefined,
): ValueBet[] {
  if (!event.prediction || !oddsEvent) return [];

  const candidates = selectBestOdds(buildCandidates(oddsEvent));
  const bets: ValueBet[] = [];

  for (const candidate of candidates) {
    const probability = modelProbability(event, candidate);
    if (probability == null) continue;

    const edge = probability - candidate.fairProb;
    const ev = probability * candidate.price - 1;
    if (edge < 0.03 || ev <= 0) continue;

    const fullKelly =
      candidate.price > 1
        ? (probability * candidate.price - 1) / (candidate.price - 1)
        : 0;
    const fractionalKelly = Math.max(0, fullKelly * 0.25);
    const recommendedStake = Math.min(fractionalKelly, 0.025);

    let label = candidate.selection;
    if (candidate.market === "h2h") {
      label =
        normalize(candidate.selection) === "draw"
          ? "Match nul"
          : `Victoire ${candidate.selection}`;
    } else if (candidate.point != null) {
      label = `${candidate.selection} ${candidate.point} buts`;
    }

    bets.push({
      event_id: event.id,
      match: `${event.home_team} vs ${event.away_team}`,
      competition: event.competition,
      scheduled_at: event.scheduled_at,
      market: candidate.market,
      selection: candidate.selection,
      point: candidate.point,
      model_prob: Number(probability.toFixed(4)),
      fair_prob: Number(candidate.fairProb.toFixed(4)),
      implied_prob: Number(candidate.impliedProb.toFixed(4)),
      edge: Number(edge.toFixed(4)),
      ev: Number(ev.toFixed(4)),
      odds: candidate.price,
      bookmaker: candidate.bookmakerTitle,
      bookmaker_key: candidate.bookmaker,
      ...bookmakerSourceMeta(candidate.bookmakerTitle, candidate.bookmaker),
      recommendation_score: Number(
        recommendationScore(
          edge,
          ev,
          event.prediction.confidence,
          event.prediction.data_quality,
        ).toFixed(1),
      ),
      kelly_stake_pct: Number(fractionalKelly.toFixed(4)),
      recommended_stake_pct: Number(recommendedStake.toFixed(4)),
      label,
      risk_level:
        edge < 0.06 ? "prudent" : edge < 0.1 ? "balanced" : "aggressive",
      confidence: event.prediction.confidence,
    });
  }

  return bets.sort(
    (a, b) => b.recommendation_score - a.recommendation_score,
  );
}

export function serializeOdds(
  oddsEvent: OddsEvent | undefined,
): OddsSnapshot[] {
  if (!oddsEvent) return [];
  const snapshots: OddsSnapshot[] = [];

  for (const bookmaker of oddsEvent.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key.endsWith("_lay") || market.key.includes("_lay_")) continue;
      const sourceMeta = bookmakerSourceMeta(bookmaker.title, bookmaker.key);
      const overround = market.outcomes.reduce(
        (sum, outcome) =>
          outcome.price > 1 ? sum + 1 / outcome.price : sum,
        0,
      );
      snapshots.push({
        bookmaker: bookmaker.title,
        bookmaker_key: bookmaker.key,
        ...sourceMeta,
        market: market.key,
        selections: market.outcomes.map((outcome) => ({
          key: normalize(outcome.name),
          name: outcome.name,
          description: outcome.description,
          price: outcome.price,
          fair_prob:
            outcome.price > 1 && overround > 0
              ? (1 / outcome.price) / overround
              : 0,
          point: outcome.point,
        })),
        overround: Number(overround.toFixed(4)),
        captured_at: market.last_update || bookmaker.last_update,
      });
    }
  }

  return snapshots;
}
