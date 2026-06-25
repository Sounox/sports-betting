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
  expected_assists: number;
  anytime_scorer_probability: number;
  brace_probability: number;
  assist_probability: number;
  goal_or_assist_probability: number;
  shot_on_target_probability: number;
  two_shots_on_target_probability: number;
  card_probability: number;
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
  expected_assists: number;
  anytime_scorer_probability: number;
  brace_probability: number;
  assist_probability: number;
  goal_or_assist_probability: number;
  shot_on_target_probability: number;
  two_shots_on_target_probability: number;
  card_probability: number;
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
  expected_assists REAL,
  anytime_scorer_probability REAL,
  brace_probability REAL,
  assist_probability REAL,
  goal_or_assist_probability REAL,
  shot_on_target_probability REAL,
  two_shots_on_target_probability REAL,
  card_probability REAL,
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

const OPTIONAL_PLAYER_MIGRATIONS = [
  "ALTER TABLE player_projection_snapshots ADD COLUMN expected_assists REAL",
  "ALTER TABLE player_projection_snapshots ADD COLUMN goal_or_assist_probability REAL",
  "ALTER TABLE player_projection_snapshots ADD COLUMN shot_on_target_probability REAL",
  "ALTER TABLE player_projection_snapshots ADD COLUMN two_shots_on_target_probability REAL",
  "ALTER TABLE player_projection_snapshots ADD COLUMN card_probability REAL",
];

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
  for (const migration of OPTIONAL_PLAYER_MIGRATIONS) {
    try {
      await db.prepare(migration).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.toLowerCase().includes("duplicate column") &&
        !message.toLowerCase().includes("already exists")
      ) {
        throw error;
      }
    }
  }
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

function projectedGoalOrAssist(goalProbability: number, assistProbability: number) {
  return 1 - (1 - goalProbability) * (1 - assistProbability);
}

function round4(value: number) {
  return Number(value.toFixed(4));
}

function fallbackShotOnTarget(expectedGoals: number, position: string) {
  return poissonAtLeastOne(expectedGoals * positionPrior(position).shot);
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
      expected_assists: Number(row.expected_assists || 0),
      anytime_scorer_probability: Number(
        row.anytime_scorer_probability || 0,
      ),
      brace_probability: Number(row.brace_probability || 0),
      assist_probability: Number(row.assist_probability || 0),
      goal_or_assist_probability: Number(
        row.goal_or_assist_probability ||
          round4(projectedGoalOrAssist(
            Number(row.anytime_scorer_probability || 0),
            Number(row.assist_probability || 0),
          )),
      ),
      shot_on_target_probability: Number(
        row.shot_on_target_probability ||
          round4(fallbackShotOnTarget(
            Number(row.expected_goals || 0),
            row.position || "Unknown",
          )),
      ),
      two_shots_on_target_probability: Number(
        row.two_shots_on_target_probability ||
          round4(poissonAtLeastTwo(
            Number(row.expected_goals || 0) *
              positionPrior(row.position || "Unknown").shot,
          )),
      ),
      card_probability: Number(
        row.card_probability || round4(positionPrior(row.position || "Unknown").card),
      ),
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
          tournament_goals, tournament_assists, expected_goals, expected_assists,
          anytime_scorer_probability, brace_probability, assist_probability,
          goal_or_assist_probability, shot_on_target_probability,
          two_shots_on_target_probability, card_probability,
          outside_box_goal_probability, reliability, evidence_json,
          data_freshness_json, methodology, warnings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        player.expected_assists,
        player.anytime_scorer_probability,
        player.brace_probability,
        player.assist_probability,
        player.goal_or_assist_probability,
        player.shot_on_target_probability,
        player.two_shots_on_target_probability,
        player.card_probability,
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
    return { goal: 1.2, assist: 0.55, outside: 0.1, shot: 2.8, card: 0.1 };
  }
  if (normalized.includes("midfield")) {
    return { goal: 0.55, assist: 0.85, outside: 0.18, shot: 2.15, card: 0.17 };
  }
  if (normalized.includes("defence")) {
    return { goal: 0.16, assist: 0.2, outside: 0.12, shot: 1.25, card: 0.22 };
  }
  return { goal: 0.015, assist: 0.02, outside: 0.02, shot: 0.5, card: 0.08 };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
    const assistProbability = poissonAtLeastOne(expectedAssists);
    const goalOrAssistProbability =
      1 - (1 - scorerProbability) * (1 - assistProbability);
    const shotOnTargetLambda = expectedGoals * item.prior.shot;
    const shotOnTargetProbability = poissonAtLeastOne(shotOnTargetLambda);
    const twoShotsOnTargetProbability = poissonAtLeastTwo(shotOnTargetLambda);
    const cardProbability = clamp(
      item.prior.card *
        (item.played >= 2 ? 1.05 : item.played >= 1 ? 1 : 0.85),
      0.03,
      0.32,
    );
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
      expected_assists: Number(expectedAssists.toFixed(3)),
      anytime_scorer_probability: Number(scorerProbability.toFixed(4)),
      brace_probability: Number(poissonAtLeastTwo(expectedGoals).toFixed(4)),
      assist_probability: Number(assistProbability.toFixed(4)),
      goal_or_assist_probability: Number(goalOrAssistProbability.toFixed(4)),
      shot_on_target_probability: Number(shotOnTargetProbability.toFixed(4)),
      two_shots_on_target_probability: Number(
        twoShotsOnTargetProbability.toFixed(4),
      ),
      card_probability: Number(cardProbability.toFixed(4)),
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
