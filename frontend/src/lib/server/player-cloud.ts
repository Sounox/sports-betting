import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Event } from "@/lib/api";
import { getMatch, getRawMatch } from "@/lib/server/football-cloud";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const FOOTBALL_DATA_KEY =
  process.env.FOOTBALL_DATA_API_KEY ||
  "23589c0d13d34aa1bc32e5f2017b7e34";

interface SquadPlayer {
  id: number;
  name: string;
  position?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
}

interface TeamPayload {
  id: number;
  name: string;
  squad: SquadPlayer[];
  lastUpdated?: string;
}

interface ScorerEntry {
  player: SquadPlayer;
  team: { id: number; name: string };
  goals?: number | null;
  assists?: number | null;
  penalties?: number | null;
  playedMatches?: number | null;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface PlayerSnapshotRow {
  event_id: number;
  captured_at: string;
  scheduled_at: string | null;
  player_id: number;
  player_name: string;
  team_name: string;
  position: string;
  tournament_matches: number;
  tournament_goals: number;
  tournament_assists: number;
  expected_goals: number;
  anytime_scorer_probability: number;
  brace_probability: number;
  assist_probability: number;
  outside_box_goal_probability: number;
  reliability: "low" | "medium" | "high";
  evidence_json: string | null;
  data_freshness_json: string | null;
  methodology: string | null;
  warnings_json: string | null;
}

export interface PlayerProjection {
  player_id: number;
  player: string;
  team: string;
  position: string;
  tournament_matches: number;
  tournament_goals: number;
  tournament_assists: number;
  expected_goals: number;
  anytime_scorer_probability: number;
  brace_probability: number;
  assist_probability: number;
  outside_box_goal_probability: number;
  reliability: "low" | "medium" | "high";
  evidence: string[];
}

export interface PlayerInsights {
  event_id: number;
  generated_at: string;
  methodology: string;
  data_freshness: {
    tournament_scorers: string;
    home_squad?: string;
    away_squad?: string;
  };
  players: PlayerProjection[];
  warnings: string[];
  storage?: {
    source: "cache" | "fresh";
    captured_at?: string;
  };
}

const PLAYER_SCHEMA = `
CREATE TABLE IF NOT EXISTS player_projection_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  scheduled_at TEXT,
  home_team TEXT,
  away_team TEXT,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  position TEXT,
  tournament_matches INTEGER DEFAULT 0,
  tournament_goals INTEGER DEFAULT 0,
  tournament_assists INTEGER DEFAULT 0,
  expected_goals REAL,
  anytime_scorer_probability REAL,
  brace_probability REAL,
  assist_probability REAL,
  outside_box_goal_probability REAL,
  reliability TEXT,
  evidence_json TEXT,
  data_freshness_json TEXT,
  methodology TEXT,
  warnings_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_projection_event_time
  ON player_projection_snapshots(event_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_player_projection_player_time
  ON player_projection_snapshots(player_id, captured_at);
`;

let playerSchemaReady = false;

function getDb(): D1Database | null {
  try {
    const { env } = getCloudflareContext();
    const candidate = env as unknown as {
      SPORTSBET_DB?: D1Database;
      DB?: D1Database;
    };
    return candidate.SPORTSBET_DB || candidate.DB || null;
  } catch {
    return null;
  }
}

async function ensurePlayerSchema(db: D1Database) {
  if (playerSchemaReady) return;
  const statements = PLAYER_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
  playerSchemaReady = true;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readCachedPlayerInsights(
  eventId: number,
  maxAgeHours: number,
): Promise<PlayerInsights | null> {
  const db = getDb();
  if (!db) return null;
  await ensurePlayerSchema(db);

  const latest = await db
    .prepare(
      `SELECT captured_at
       FROM player_projection_snapshots
       WHERE event_id = ?
       ORDER BY captured_at DESC
       LIMIT 1`,
    )
    .bind(eventId)
    .first<{ captured_at: string }>();
  if (!latest?.captured_at) return null;

  const ageHours =
    (Date.now() - new Date(latest.captured_at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) return null;

  const rows = await db
    .prepare(
      `SELECT *
       FROM player_projection_snapshots
       WHERE event_id = ? AND captured_at = ?
       ORDER BY anytime_scorer_probability DESC
       LIMIT 32`,
    )
    .bind(eventId, latest.captured_at)
    .all<PlayerSnapshotRow>();
  if (!rows.results.length) return null;

  const first = rows.results[0];
  return {
    event_id: eventId,
    generated_at: latest.captured_at,
    methodology:
      first.methodology ||
      "Projection joueurs recuperee depuis le cache D1 persistant.",
    data_freshness: safeJsonParse(first.data_freshness_json, {
      tournament_scorers: latest.captured_at,
    }),
    players: rows.results.map((row) => ({
      player_id: Number(row.player_id),
      player: row.player_name,
      team: row.team_name,
      position: row.position || "Unknown",
      tournament_matches: Number(row.tournament_matches || 0),
      tournament_goals: Number(row.tournament_goals || 0),
      tournament_assists: Number(row.tournament_assists || 0),
      expected_goals: Number(row.expected_goals || 0),
      anytime_scorer_probability: Number(
        row.anytime_scorer_probability || 0,
      ),
      brace_probability: Number(row.brace_probability || 0),
      assist_probability: Number(row.assist_probability || 0),
      outside_box_goal_probability: Number(
        row.outside_box_goal_probability || 0,
      ),
      reliability: row.reliability || "low",
      evidence: safeJsonParse<string[]>(row.evidence_json, []),
    })),
    warnings: safeJsonParse<string[]>(first.warnings_json, []),
    storage: {
      source: "cache",
      captured_at: latest.captured_at,
    },
  };
}

async function persistPlayerInsights(event: Event, insights: PlayerInsights) {
  const db = getDb();
  if (!db || !insights.players.length) return;
  await ensurePlayerSchema(db);

  const capturedAt = insights.generated_at;
  const statements = insights.players.map((player) =>
    db
      .prepare(
        `INSERT INTO player_projection_snapshots (
          event_id, captured_at, scheduled_at, home_team, away_team,
          player_id, player_name, team_name, position, tournament_matches,
          tournament_goals, tournament_assists, expected_goals,
          anytime_scorer_probability, brace_probability, assist_probability,
          outside_box_goal_probability, reliability, evidence_json,
          data_freshness_json, methodology, warnings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        capturedAt,
        event.scheduled_at,
        event.home_team,
        event.away_team,
        player.player_id,
        player.player,
        player.team,
        player.position,
        player.tournament_matches,
        player.tournament_goals,
        player.tournament_assists,
        player.expected_goals,
        player.anytime_scorer_probability,
        player.brace_probability,
        player.assist_probability,
        player.outside_box_goal_probability,
        player.reliability,
        JSON.stringify(player.evidence),
        JSON.stringify(insights.data_freshness),
        insights.methodology,
        JSON.stringify(insights.warnings),
      ),
  );

  for (let i = 0; i < statements.length; i += 80) {
    await db.batch(statements.slice(i, i + 80));
  }
}

function positionPrior(position?: string | null) {
  const normalized = (position || "").toLowerCase();
  if (normalized.includes("offence") || normalized.includes("forward")) {
    return { goal: 1.2, assist: 0.55, outside: 0.1 };
  }
  if (normalized.includes("midfield")) {
    return { goal: 0.55, assist: 0.85, outside: 0.18 };
  }
  if (normalized.includes("defence")) {
    return { goal: 0.16, assist: 0.2, outside: 0.12 };
  }
  return { goal: 0.015, assist: 0.02, outside: 0.02 };
}

function poissonAtLeastOne(lambda: number) {
  return 1 - Math.exp(-lambda);
}

function poissonAtLeastTwo(lambda: number) {
  return 1 - Math.exp(-lambda) * (1 + lambda);
}

async function footballFetch<T>(path: string, revalidate = 21600): Promise<T> {
  const response = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_KEY },
    next: { revalidate },
    ...({
      cf: {
        cacheEverything: true,
        cacheTtl: revalidate,
        cacheKey: `${FOOTBALL_DATA_BASE}/cache${path}`,
      },
    } as Record<string, unknown>),
  });
  if (!response.ok) throw new Error(`Football-Data ${response.status}`);
  return response.json() as Promise<T>;
}

function projectTeamPlayers(
  event: Event,
  team: TeamPayload,
  scorers: ScorerEntry[],
  expectedTeamGoals: number,
) {
  const scorerByPlayer = new Map(
    scorers
      .filter((entry) => entry.team.id === team.id)
      .map((entry) => [entry.player.id, entry]),
  );

  const eligible = (team.squad || []).filter(
    (player) =>
      !((player.position || "").toLowerCase().includes("goalkeeper")),
  );

  const weighted = eligible.map((player) => {
    const stats = scorerByPlayer.get(player.id);
    const played = stats?.playedMatches || 0;
    const goals = stats?.goals || 0;
    const assists = stats?.assists || 0;
    const prior = positionPrior(player.position);
    const goalWeight =
      prior.goal + goals * 1.6 + (played ? (goals / played) * 2.2 : 0);
    const assistWeight =
      prior.assist + assists * 1.4 + (played ? (assists / played) * 1.8 : 0);
    return {
      player,
      played,
      goals,
      assists,
      prior,
      goalWeight,
      assistWeight,
    };
  });

  const totalGoalWeight = weighted.reduce((sum, item) => sum + item.goalWeight, 0);
  const totalAssistWeight = weighted.reduce(
    (sum, item) => sum + item.assistWeight,
    0,
  );

  return weighted.map<PlayerProjection>((item) => {
    const expectedGoals =
      totalGoalWeight > 0
        ? expectedTeamGoals * (item.goalWeight / totalGoalWeight)
        : 0;
    const expectedAssists =
      totalAssistWeight > 0
        ? expectedTeamGoals * 0.7 * (item.assistWeight / totalAssistWeight)
        : 0;
    const scorerProbability = poissonAtLeastOne(expectedGoals);
    const sampleReliability =
      item.played >= 2 && item.goals + item.assists >= 1
        ? "high"
        : item.played >= 1
          ? "medium"
          : "low";

    return {
      player_id: item.player.id,
      player: item.player.name,
      team: team.name,
      position: item.player.position || "Unknown",
      tournament_matches: item.played,
      tournament_goals: item.goals,
      tournament_assists: item.assists,
      expected_goals: Number(expectedGoals.toFixed(3)),
      anytime_scorer_probability: Number(scorerProbability.toFixed(4)),
      brace_probability: Number(poissonAtLeastTwo(expectedGoals).toFixed(4)),
      assist_probability: Number(poissonAtLeastOne(expectedAssists).toFixed(4)),
      outside_box_goal_probability: Number(
        (scorerProbability * item.prior.outside).toFixed(4),
      ),
      reliability: sampleReliability,
      evidence: [
        `${item.goals} but(s), ${item.assists} passe(s), ${item.played} match(s) dans le tournoi`,
        `Projection équipe: ${expectedTeamGoals.toFixed(2)} but(s) attendu(s)`,
        `Poste déclaré: ${item.player.position || "non renseigné"}`,
      ],
    };
  });
}

export async function getPlayerInsights(
  eventId: number,
  options: { forceRefresh?: boolean; maxAgeHours?: number } = {},
): Promise<PlayerInsights | null> {
  if (!options.forceRefresh) {
    const cached = await readCachedPlayerInsights(
      eventId,
      options.maxAgeHours ?? 6,
    ).catch(() => null);
    if (cached) return cached;
  }

  const [event, rawMatch] = await Promise.all([
    getMatch(eventId),
    getRawMatch(eventId),
  ]);
  if (!event?.prediction) return null;

  const homeTeamId = rawMatch.homeTeam.id;
  const awayTeamId = rawMatch.awayTeam.id;
  if (!homeTeamId || !awayTeamId) return null;

  const [homeTeam, awayTeam, scorerPayload] = await Promise.all([
    footballFetch<TeamPayload>(`/teams/${homeTeamId}`),
    footballFetch<TeamPayload>(`/teams/${awayTeamId}`),
    footballFetch<{ scorers: ScorerEntry[]; season?: { startDate?: string } }>(
      "/competitions/WC/scorers?limit=100",
    ),
  ]);

  const lambda = event.prediction.markets?.lambda || { home: 1.25, away: 1.25 };
  const players = [
    ...projectTeamPlayers(
      event,
      homeTeam,
      scorerPayload.scorers || [],
      lambda.home,
    ),
    ...projectTeamPlayers(
      event,
      awayTeam,
      scorerPayload.scorers || [],
      lambda.away,
    ),
  ]
    .sort(
      (a, b) =>
        b.anytime_scorer_probability - a.anytime_scorer_probability,
    )
    .slice(0, 16);

  const insights: PlayerInsights = {
    event_id: eventId,
    generated_at: new Date().toISOString(),
    methodology:
      "Poisson individuel répartissant les buts attendus de l'équipe selon le poste et la forme mesurée dans le tournoi.",
    data_freshness: {
      tournament_scorers: new Date().toISOString(),
      home_squad: homeTeam.lastUpdated,
      away_squad: awayTeam.lastUpdated,
    },
    players,
    warnings: [
      "Les compositions et minutes probables ne sont pas encore intégrées.",
      "Le but hors surface est une projection expérimentale dérivée du poste, pas une statistique observée.",
      "Les marchés joueurs restent plus volatils que le 1N2 et les totaux.",
    ],
    storage: {
      source: "fresh",
    },
  };

  await persistPlayerInsights(event, insights).catch((error) => {
    console.warn("Player insights persistence skipped", error);
  });

  return insights;
}
