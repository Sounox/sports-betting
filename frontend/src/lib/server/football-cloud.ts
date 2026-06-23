import type { Event, Prediction } from "@/lib/api";
import {
  calculateValueBets,
  getWorldCupOdds,
  matchOddsEvent,
} from "@/lib/server/odds-cloud";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const FOOTBALL_DATA_KEY =
  process.env.FOOTBALL_DATA_API_KEY ||
  "23589c0d13d34aa1bc32e5f2017b7e34";

const UPCOMING_STATUSES = new Set(["TIMED", "SCHEDULED", "IN_PLAY", "PAUSED"]);

const FIFA_ELO: Record<string, number> = {
  Argentina: 2050,
  France: 1980,
  England: 1960,
  Belgium: 1940,
  Brazil: 1930,
  Portugal: 1910,
  Netherlands: 1890,
  Spain: 1880,
  Germany: 1860,
  Italy: 1850,
  Croatia: 1800,
  Morocco: 1780,
  Colombia: 1760,
  Uruguay: 1750,
  Japan: 1730,
  "United States": 1700,
  Mexico: 1690,
  Senegal: 1680,
  Denmark: 1670,
  Switzerland: 1660,
  Austria: 1640,
  Sweden: 1620,
  Poland: 1610,
  "South Korea": 1600,
  Australia: 1590,
  Ecuador: 1580,
  Peru: 1570,
  Ukraine: 1560,
  Serbia: 1550,
  Czechia: 1545,
  Türkiye: 1540,
  Turkey: 1540,
  Chile: 1530,
  Algeria: 1520,
  Egypt: 1515,
  Scotland: 1510,
  Canada: 1510,
  Norway: 1505,
  Ghana: 1500,
  Romania: 1500,
  Hungary: 1495,
  Slovakia: 1490,
  Cameroon: 1490,
  "Saudi Arabia": 1490,
  Iran: 1480,
  Nigeria: 1480,
  Venezuela: 1480,
  Slovenia: 1480,
  Albania: 1475,
  "Ivory Coast": 1470,
  Georgia: 1465,
  Bolivia: 1460,
  Tunisia: 1460,
  Armenia: 1460,
  Panama: 1450,
  "South Africa": 1450,
  Honduras: 1440,
  "Congo DR": 1440,
  Mali: 1440,
  "Costa Rica": 1470,
  "Bosnia-Herzegovina": 1490,
  Iceland: 1490,
  "Burkina Faso": 1435,
  Guinea: 1430,
  Qatar: 1430,
  Zambia: 1430,
  Gabon: 1420,
  Uzbekistan: 1440,
  Jamaica: 1430,
  Haiti: 1400,
  Cuba: 1380,
  "New Zealand": 1380,
  Fiji: 1320,
};

interface FootballDataMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  stage?: string;
  competition: { code: string; name: string };
  homeTeam: { id?: number | null; name?: string | null };
  awayTeam: { id?: number | null; name?: string | null };
  score?: {
    winner?: string | null;
    fullTime?: { home?: number | null; away?: number | null };
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function poissonProbability(goals: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function scoreMatrix(lambdaHome: number, lambdaAway: number) {
  const scores: Array<{ score: string; probability: number }> = [];
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  const totals: Record<number, number> = {};

  for (let home = 0; home <= 7; home += 1) {
    for (let away = 0; away <= 7; away += 1) {
      const probability =
        poissonProbability(home, lambdaHome) *
        poissonProbability(away, lambdaAway);

      scores.push({ score: `${home}-${away}`, probability });
      if (home > away) homeWin += probability;
      else if (home === away) draw += probability;
      else awayWin += probability;
      if (home > 0 && away > 0) bttsYes += probability;
      totals[home + away] = (totals[home + away] || 0) + probability;
    }
  }

  const over = (line: number) =>
    Object.entries(totals).reduce(
      (sum, [goals, probability]) =>
        Number(goals) > line ? sum + probability : sum,
      0,
    );

  return {
    homeWin,
    draw,
    awayWin,
    bttsYes,
    over,
    topScores: scores
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 8)
      .map((item) => ({
        score: item.score,
        probability: Number(item.probability.toFixed(4)),
      })),
  };
}

function createPrediction(
  eventId: number,
  homeTeam: string,
  awayTeam: string,
): Prediction {
  const homeRating = FIFA_ELO[homeTeam] ?? 1500;
  const awayRating = FIFA_ELO[awayTeam] ?? 1500;
  const ratingDiff = homeRating - awayRating;

  // Coupe du monde: avantage nominal faible, les rencontres étant généralement neutres.
  const noDrawHome = 1 / (1 + 10 ** ((awayRating - homeRating - 20) / 400));
  const closeness = 1 - Math.abs(noDrawHome - (1 - noDrawHome));
  const eloDraw = clamp(0.28 * (0.5 + 0.5 * closeness), 0.14, 0.32);
  const eloHome = noDrawHome * (1 - eloDraw);
  const eloAway = (1 - noDrawHome) * (1 - eloDraw);

  const totalGoals = clamp(2.55 + Math.abs(ratingDiff) / 900, 2.15, 3.2);
  const homeShare = clamp(0.5 + ratingDiff / 950, 0.18, 0.82);
  const lambdaHome = clamp(totalGoals * homeShare, 0.35, 2.8);
  const lambdaAway = clamp(totalGoals - lambdaHome, 0.35, 2.8);
  const matrix = scoreMatrix(lambdaHome, lambdaAway);

  // Elo reste la base du 1N2; Poisson apporte une seconde opinion stabilisatrice.
  const probHome = 0.72 * eloHome + 0.28 * matrix.homeWin;
  const probDraw = 0.72 * eloDraw + 0.28 * matrix.draw;
  const probAway = 0.72 * eloAway + 0.28 * matrix.awayWin;
  const total = probHome + probDraw + probAway;

  return {
    id: eventId,
    model_version: "cloud-elo-poisson-1.0",
    predicted_at: new Date().toISOString(),
    confidence:
      Math.abs(ratingDiff) >= 200
        ? "high"
        : Math.abs(ratingDiff) >= 100
          ? "medium"
          : "low",
    data_quality: "fair",
    warning_flags: [
      "cloud_model_without_lineups",
      "probabilistic_prediction_no_guarantee",
    ],
    prob_home: Number((probHome / total).toFixed(4)),
    prob_draw: Number((probDraw / total).toFixed(4)),
    prob_away: Number((probAway / total).toFixed(4)),
    markets: {
      lambda: {
        home: Number(lambdaHome.toFixed(3)),
        away: Number(lambdaAway.toFixed(3)),
      },
      over_under: {
        over_0_5: Number(matrix.over(0.5).toFixed(4)),
        over_1_5: Number(matrix.over(1.5).toFixed(4)),
        over_2_5: Number(matrix.over(2.5).toFixed(4)),
        over_3_5: Number(matrix.over(3.5).toFixed(4)),
        under_2_5: Number((1 - matrix.over(2.5)).toFixed(4)),
        under_3_5: Number((1 - matrix.over(3.5)).toFixed(4)),
      },
      btts: {
        yes: Number(matrix.bttsYes.toFixed(4)),
        no: Number((1 - matrix.bttsYes).toFixed(4)),
      },
      top_scores: matrix.topScores,
    },
    value_bets: [],
  };
}

function serializeMatch(match: FootballDataMatch): Event | null {
  const homeTeam = match.homeTeam.name?.trim();
  const awayTeam = match.awayTeam.name?.trim();
  if (!homeTeam || !awayTeam) return null;

  const event: Event = {
    id: match.id,
    home_team: homeTeam,
    away_team: awayTeam,
    competition: match.competition.name || "FIFA World Cup",
    competition_code: match.competition.code || "WC",
    scheduled_at: match.utcDate,
    status: match.status,
    matchday: match.matchday,
    stage: match.stage,
    home_team_id: match.homeTeam.id || undefined,
    away_team_id: match.awayTeam.id || undefined,
    prediction: createPrediction(match.id, homeTeam, awayTeam),
  };

  const homeScore = match.score?.fullTime?.home;
  const awayScore = match.score?.fullTime?.away;
  if (homeScore != null && awayScore != null) {
    event.result = {
      home_score: homeScore,
      away_score: awayScore,
      winner: match.score?.winner || "DRAW",
    };
  }

  return event;
}

async function footballDataFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_KEY },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Football-Data API ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getWorldCupMatches(): Promise<Event[]> {
  const payload = await footballDataFetch<{ matches: FootballDataMatch[] }>(
    "/competitions/WC/matches",
  );
  return payload.matches
    .map(serializeMatch)
    .filter((event): event is Event => event !== null);
}

export async function getUpcomingMatches(hours = 48): Promise<Event[]> {
  const now = Date.now();
  const end = now + clamp(hours, 1, 24 * 30) * 60 * 60 * 1000;
  const events = (await getWorldCupMatches())
    .filter(
      (event) =>
        UPCOMING_STATUSES.has(event.status) &&
        new Date(event.scheduled_at).getTime() >= now &&
        new Date(event.scheduled_at).getTime() <= end,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() -
        new Date(b.scheduled_at).getTime(),
    );
  return attachOdds(events);
}

export async function getTodayMatches(): Promise<Event[]> {
  const now = new Date();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = start + 24 * 60 * 60 * 1000;
  const events = (await getWorldCupMatches()).filter((event) => {
    const kickoff = new Date(event.scheduled_at).getTime();
    return kickoff >= start && kickoff < end;
  });
  return attachOdds(events);
}

export async function getMatch(eventId: number): Promise<Event | null> {
  const payload = await footballDataFetch<FootballDataMatch>(
    `/matches/${eventId}`,
  );
  const event = serializeMatch(payload);
  if (!event) return null;
  const [withOdds] = await attachOdds([event]);
  return withOdds;
}

async function attachOdds(events: Event[]) {
  if (!events.length) return events;
  try {
    const { events: oddsEvents } = await getWorldCupOdds();
    return events.map((event) => {
      const oddsEvent = matchOddsEvent(event, oddsEvents);
      const valueBets = calculateValueBets(event, oddsEvent);
      if (event.prediction) {
        event.prediction.value_bets = valueBets;
        event.prediction.markets.best_odds_updated_at =
          oddsEvent?.bookmakers?.[0]?.last_update || null;
      }
      return event;
    });
  } catch (error) {
    console.error("Odds enrichment unavailable", error);
    return events;
  }
}

export async function getRawMatch(eventId: number) {
  return footballDataFetch<FootballDataMatch>(`/matches/${eventId}`);
}
