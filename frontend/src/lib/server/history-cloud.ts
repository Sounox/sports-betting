import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Event, OddsSnapshot, ValueBet } from "@/lib/api";
import { buildMatchContext } from "@/lib/server/ai-cloud";
import {
  getUpcomingMatches,
  getWorldCupMatches,
} from "@/lib/server/football-cloud";
import {
  EVENT_CORE_SOCCER_MARKETS,
  EVENT_PLAYER_SOCCER_MARKETS,
  getWorldCupEventOdds,
  getWorldCupOdds,
  type OddsEvent,
  matchOddsEvent,
  serializeOdds,
} from "@/lib/server/odds-cloud";
import { getPlayerInsights } from "@/lib/server/player-cloud";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

interface RefreshRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  events_seen: number;
  predictions_saved: number;
  odds_saved: number;
  value_bets_saved: number;
  message: string | null;
}

interface SettlementRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  events_checked: number;
  events_settled: number;
  prediction_markets_settled: number;
  value_bets_settled: number;
  message: string | null;
}

interface AutomationRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  mode: string;
  trigger: string;
  events_seen: number;
  upcoming_seen: number;
  predictions_saved: number;
  odds_saved: number;
  value_bets_saved: number;
  events_settled: number;
  prediction_markets_settled: number;
  value_bets_settled: number;
  players_warmed: number;
  contexts_warmed: number;
  message: string | null;
}

interface StorageStatus {
  enabled: boolean;
  message?: string;
  events_total?: number;
  prediction_snapshots?: number;
  odds_price_snapshots?: number;
  value_bet_snapshots?: number;
  player_projection_snapshots?: number;
  backtest_results?: number;
  settlement_runs?: number;
  automation_runs?: number;
  refresh_runs?: number;
  latest_refresh?: RefreshRun | null;
  latest_settlement?: SettlementRun | null;
  latest_automation?: AutomationRun | null;
}

interface PredictionSnapshotRow {
  id: number;
  event_id: number;
  captured_at: string;
  scheduled_at: string;
  confidence: string | null;
  data_quality: string | null;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  markets_json: string | null;
}

interface ValueBetSnapshotRow {
  id: number;
  event_id: number;
  captured_at: string;
  scheduled_at: string;
  match_label: string | null;
  market: string | null;
  selection: string | null;
  point: number | null;
  label: string | null;
  odds: number | null;
  bookmaker: string | null;
  model_prob: number | null;
  edge: number | null;
  ev: number | null;
}

interface OddsPriceSnapshotRow {
  id: number;
  event_id: number;
  captured_at: string;
  scheduled_at: string;
  bookmaker: string;
  market: string;
  selection: string;
  price: number;
  point: number | null;
  fair_prob: number | null;
  overround: number | null;
}

interface FinishedEventRow {
  event_id: number;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  home_score: number;
  away_score: number;
  winner: "home" | "draw" | "away";
}

interface BacktestInput {
  source: "prediction" | "value_bet";
  event: FinishedEventRow;
  predictionSnapshotId?: number | null;
  valueBetSnapshotId?: number | null;
  capturedAt: string;
  scheduledAt: string;
  market: string;
  selection: string;
  line?: number | null;
  modelProb?: number | null;
  odds?: number | null;
  bookmaker?: string | null;
  edge?: number | null;
  ev?: number | null;
  confidence?: string | null;
  dataQuality?: string | null;
  closingOdds?: number | null;
  closingFairProb?: number | null;
  closingCapturedAt?: string | null;
  clv?: number | null;
  closingSource?: string | null;
}

export interface RecommendationCalibrationSignal {
  scope: "market" | "global";
  market?: string | null;
  bucket: number;
  label: string;
  sample_size: number;
  avg_probability: number;
  actual_rate: number;
  calibration_error: number;
  verdict: "reliable" | "overconfident" | "underconfident" | "insufficient";
  signal_strength: "low" | "medium" | "high";
  score_adjustment: number;
  reason: string;
}

export interface RecommendationClvSignal {
  scope: "market" | "global";
  market?: string | null;
  sample_size: number;
  avg_clv: number | null;
  positive_clv_rate: number | null;
  verdict: "positive" | "negative" | "neutral" | "insufficient";
  signal_strength: "low" | "medium" | "high";
  stake_factor: number;
  reason: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  competition TEXT,
  competition_code TEXT,
  scheduled_at TEXT,
  status TEXT,
  matchday INTEGER,
  stage TEXT,
  home_score INTEGER,
  away_score INTEGER,
  winner TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  model_version TEXT,
  confidence TEXT,
  data_quality TEXT,
  prob_home REAL,
  prob_draw REAL,
  prob_away REAL,
  markets_json TEXT,
  value_bets_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_prediction_event_time
  ON prediction_snapshots(event_id, captured_at);

CREATE TABLE IF NOT EXISTS odds_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  price REAL NOT NULL,
  point REAL,
  fair_prob REAL,
  overround REAL
);

CREATE INDEX IF NOT EXISTS idx_odds_event_time
  ON odds_price_snapshots(event_id, captured_at);

CREATE TABLE IF NOT EXISTS value_bet_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  match_label TEXT,
  market TEXT,
  selection TEXT,
  point REAL,
  label TEXT,
  odds REAL,
  bookmaker TEXT,
  model_prob REAL,
  fair_prob REAL,
  implied_prob REAL,
  edge REAL,
  ev REAL,
  confidence TEXT,
  risk_level TEXT
);

CREATE INDEX IF NOT EXISTS idx_value_bets_event_time
  ON value_bet_snapshots(event_id, captured_at);

CREATE TABLE IF NOT EXISTS refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  events_seen INTEGER DEFAULT 0,
  predictions_saved INTEGER DEFAULT 0,
  odds_saved INTEGER DEFAULT 0,
  value_bets_saved INTEGER DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS settlement_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  events_checked INTEGER DEFAULT 0,
  events_settled INTEGER DEFAULT 0,
  prediction_markets_settled INTEGER DEFAULT 0,
  value_bets_settled INTEGER DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  trigger TEXT NOT NULL,
  events_seen INTEGER DEFAULT 0,
  upcoming_seen INTEGER DEFAULT 0,
  predictions_saved INTEGER DEFAULT 0,
  odds_saved INTEGER DEFAULT 0,
  value_bets_saved INTEGER DEFAULT 0,
  events_settled INTEGER DEFAULT 0,
  prediction_markets_settled INTEGER DEFAULT 0,
  value_bets_settled INTEGER DEFAULT 0,
  players_warmed INTEGER DEFAULT 0,
  contexts_warmed INTEGER DEFAULT 0,
  message TEXT
);

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

CREATE TABLE IF NOT EXISTS backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  prediction_snapshot_id INTEGER,
  value_bet_snapshot_id INTEGER,
  captured_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL,
  model_prob REAL,
  odds REAL,
  bookmaker TEXT,
  edge REAL,
  ev REAL,
  confidence TEXT,
  data_quality TEXT,
  closing_odds REAL,
  closing_fair_prob REAL,
  closing_captured_at TEXT,
  clv REAL,
  closing_source TEXT,
  result TEXT NOT NULL,
  profit_flat REAL,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  winner TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_event
  ON backtest_results(event_id, source, market);

CREATE INDEX IF NOT EXISTS idx_backtest_source_market
  ON backtest_results(source, market);
`;

let schemaReady = false;

const OPTIONAL_MIGRATIONS = [
  "ALTER TABLE backtest_results ADD COLUMN closing_odds REAL",
  "ALTER TABLE backtest_results ADD COLUMN closing_fair_prob REAL",
  "ALTER TABLE backtest_results ADD COLUMN closing_captured_at TEXT",
  "ALTER TABLE backtest_results ADD COLUMN clv REAL",
  "ALTER TABLE backtest_results ADD COLUMN closing_source TEXT",
];

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  const statements = SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  for (let i = 0; i < statements.length; i += 20) {
    await db.batch(statements.slice(i, i + 20));
  }
  for (const migration of OPTIONAL_MIGRATIONS) {
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
  schemaReady = true;
}

function unavailableStatus(): StorageStatus {
  return {
    enabled: false,
    message:
      "Cloudflare D1 n'est pas encore lie. Le code est pret; il faut ajouter le binding SPORTSBET_DB.",
  };
}

function winnerFromResult(event: Event): "home" | "draw" | "away" | null {
  if (!event.result) return null;
  if (event.result.winner === "HOME_TEAM") return "home";
  if (event.result.winner === "AWAY_TEAM") return "away";
  if (event.result.winner === "DRAW") return "draw";
  if (event.result.home_score > event.result.away_score) return "home";
  if (event.result.away_score > event.result.home_score) return "away";
  return "draw";
}

function upsertEventStatement(db: D1Database, event: Event, capturedAt: string) {
  return db
    .prepare(
      `INSERT INTO events (
        event_id, home_team, away_team, competition, competition_code,
        scheduled_at, status, matchday, stage, home_score, away_score, winner,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        home_team = excluded.home_team,
        away_team = excluded.away_team,
        competition = excluded.competition,
        competition_code = excluded.competition_code,
        scheduled_at = excluded.scheduled_at,
        status = excluded.status,
        matchday = excluded.matchday,
        stage = excluded.stage,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        winner = excluded.winner,
        updated_at = excluded.updated_at`,
    )
    .bind(
      event.id,
      event.home_team,
      event.away_team,
      event.competition,
      event.competition_code,
      event.scheduled_at,
      event.status,
      event.matchday ?? null,
      event.stage ?? null,
      event.result?.home_score ?? null,
      event.result?.away_score ?? null,
      winnerFromResult(event),
      capturedAt,
    );
}

function predictionStatement(db: D1Database, event: Event, capturedAt: string) {
  const prediction = event.prediction;
  if (!prediction) return null;
  return db
    .prepare(
      `INSERT INTO prediction_snapshots (
        event_id, captured_at, scheduled_at, model_version, confidence,
        data_quality, prob_home, prob_draw, prob_away, markets_json,
        value_bets_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      capturedAt,
      event.scheduled_at,
      prediction.model_version,
      prediction.confidence,
      prediction.data_quality,
      prediction.prob_home,
      prediction.prob_draw,
      prediction.prob_away,
      json(prediction.markets),
      json(prediction.value_bets),
    );
}

function oddsSelectionLabel(selection: OddsSnapshot["selections"][number]) {
  if (!selection.description) return selection.name;
  return selection.name === "Yes"
    ? selection.description
    : `${selection.description} ${selection.name}`;
}

function oddsStatements(
  db: D1Database,
  event: Event,
  snapshots: OddsSnapshot[],
  capturedAt: string,
) {
  const statements: D1PreparedStatement[] = [];
  for (const snapshot of snapshots) {
    for (const selection of snapshot.selections) {
      statements.push(
        db
          .prepare(
            `INSERT INTO odds_price_snapshots (
              event_id, captured_at, scheduled_at, bookmaker, market,
              selection, price, point, fair_prob, overround
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.id,
            capturedAt,
            event.scheduled_at,
            snapshot.bookmaker,
            snapshot.market,
            oddsSelectionLabel(selection),
            selection.price,
            selection.point ?? null,
            selection.fair_prob,
            snapshot.overround,
          ),
      );
    }
  }
  return statements;
}

function valueBetStatements(
  db: D1Database,
  event: Event,
  valueBets: ValueBet[],
  capturedAt: string,
) {
  return valueBets.map((bet) =>
    db
      .prepare(
        `INSERT INTO value_bet_snapshots (
          event_id, captured_at, scheduled_at, match_label, market, selection,
          point, label, odds, bookmaker, model_prob, fair_prob, implied_prob, edge,
          ev, confidence, risk_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        capturedAt,
        event.scheduled_at,
        bet.match || `${event.home_team} vs ${event.away_team}`,
        bet.market,
        bet.selection,
        bet.point ?? null,
        bet.label,
        bet.odds,
        bet.bookmaker,
        bet.model_prob,
        bet.fair_prob,
        bet.implied_prob,
        bet.edge,
        bet.ev,
        bet.confidence || event.prediction?.confidence || null,
        bet.risk_level,
      ),
  );
}

async function loadAdvancedOddsForEvents(
  events: Event[],
  oddsEvents: OddsEvent[],
  limit: number,
) {
  const advancedByEvent = new Map<number, OddsEvent[]>();
  if (limit <= 0) return advancedByEvent;

  for (const event of events) {
    if (advancedByEvent.size >= limit) break;
    const oddsEvent = matchOddsEvent(event, oddsEvents);
    if (!oddsEvent?.id) continue;

    const results = await Promise.allSettled([
      getWorldCupEventOdds(oddsEvent.id, EVENT_CORE_SOCCER_MARKETS),
      getWorldCupEventOdds(oddsEvent.id, EVENT_PLAYER_SOCCER_MARKETS),
    ]);
    const fulfilled = results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof getWorldCupEventOdds>>
        > => result.status === "fulfilled",
      )
      .map((result) => result.value.event);

    if (fulfilled.length) advancedByEvent.set(event.id, fulfilled);
  }

  return advancedByEvent;
}

export async function createHistorySnapshot(
  hours = 168,
  options: { advancedOddsLimit?: number } = {},
) {
  const db = getDb();
  if (!db) {
    return { ...unavailableStatus(), saved: false };
  }
  await ensureSchema(db);

  const startedAt = new Date().toISOString();
  const run = await db
    .prepare(
      "INSERT INTO refresh_runs (started_at, status, message) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(startedAt, "running", "Snapshot en cours")
    .first<{ id: number }>();
  const runId = run?.id;

  try {
    const [allEvents, upcoming, odds] = await Promise.all([
      getWorldCupMatches(),
      getUpcomingMatches(hours),
      getWorldCupOdds(),
    ]);
    const advancedOddsByEvent = await loadAdvancedOddsForEvents(
      upcoming,
      odds.events,
      Math.max(0, Math.min(options.advancedOddsLimit ?? 0, upcoming.length)),
    );
    const capturedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    let predictionsSaved = 0;
    let oddsSaved = 0;
    let advancedOddsRowsSaved = 0;
    let valueBetsSaved = 0;

    for (const event of allEvents) {
      statements.push(upsertEventStatement(db, event, capturedAt));
    }

    for (const event of upcoming) {
      const prediction = predictionStatement(db, event, capturedAt);
      if (prediction) {
        statements.push(prediction);
        predictionsSaved += 1;
      }
      const oddsEvent = matchOddsEvent(event, odds.events);
      const advancedSnapshots = (advancedOddsByEvent.get(event.id) || [])
        .flatMap((eventOdds) => serializeOdds(eventOdds));
      const snapshots = [...serializeOdds(oddsEvent), ...advancedSnapshots];
      const oddsRows = oddsStatements(db, event, snapshots, capturedAt);
      if (advancedSnapshots.length) {
        advancedOddsRowsSaved += advancedSnapshots.reduce(
          (sum, snapshot) => sum + snapshot.selections.length,
          0,
        );
      }
      statements.push(...oddsRows);
      oddsSaved += oddsRows.length;
      const valueBets = event.prediction?.value_bets || [];
      const valueRows = valueBetStatements(db, event, valueBets, capturedAt);
      statements.push(...valueRows);
      valueBetsSaved += valueRows.length;
    }

    for (let i = 0; i < statements.length; i += 80) {
      await db.batch(statements.slice(i, i + 80));
    }

    if (runId != null) {
      await db
        .prepare(
          `UPDATE refresh_runs
           SET finished_at = ?, status = ?, events_seen = ?,
               predictions_saved = ?, odds_saved = ?, value_bets_saved = ?,
               message = ?
           WHERE id = ?`,
        )
        .bind(
          new Date().toISOString(),
          "success",
          allEvents.length,
          predictionsSaved,
          oddsSaved,
          valueBetsSaved,
          "Snapshot termine",
          runId,
        )
        .run();
    }

    return {
      enabled: true,
      saved: true,
      run_id: runId,
      events_seen: allEvents.length,
      upcoming_seen: upcoming.length,
      predictions_saved: predictionsSaved,
      odds_saved: oddsSaved,
      advanced_odds_events: advancedOddsByEvent.size,
      advanced_odds_rows_saved: advancedOddsRowsSaved,
      value_bets_saved: valueBetsSaved,
    };
  } catch (error) {
    if (runId != null) {
      await db
        .prepare(
          "UPDATE refresh_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?",
        )
        .bind(
          new Date().toISOString(),
          "error",
          error instanceof Error ? error.message : "Erreur inconnue",
          runId,
        )
        .run();
    }
    throw error;
  }
}

async function countTable(db: D1Database, table: string) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function getHistoryStatus(): Promise<StorageStatus> {
  const db = getDb();
  if (!db) return unavailableStatus();
  await ensureSchema(db);

  const latest = await db
    .prepare("SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1")
    .first<RefreshRun>();
  const latestSettlement = await db
    .prepare("SELECT * FROM settlement_runs ORDER BY id DESC LIMIT 1")
    .first<SettlementRun>();
  const latestAutomation = await db
    .prepare("SELECT * FROM automation_runs ORDER BY id DESC LIMIT 1")
    .first<AutomationRun>();

  return {
    enabled: true,
    events_total: await countTable(db, "events"),
    prediction_snapshots: await countTable(db, "prediction_snapshots"),
    odds_price_snapshots: await countTable(db, "odds_price_snapshots"),
    value_bet_snapshots: await countTable(db, "value_bet_snapshots"),
    player_projection_snapshots: await countTable(
      db,
      "player_projection_snapshots",
    ),
    backtest_results: await countTable(db, "backtest_results"),
    settlement_runs: await countTable(db, "settlement_runs"),
    automation_runs: await countTable(db, "automation_runs"),
    refresh_runs: await countTable(db, "refresh_runs"),
    latest_refresh: latest,
    latest_settlement: latestSettlement,
    latest_automation: latestAutomation,
  };
}

export async function getEventHistory(eventId: number, limit = 50) {
  const db = getDb();
  if (!db) return unavailableStatus();
  await ensureSchema(db);

  const [event, predictions, odds, valueBets] = await Promise.all([
    db
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .bind(eventId)
      .first(),
    db
      .prepare(
        `SELECT * FROM prediction_snapshots
         WHERE event_id = ?
         ORDER BY captured_at DESC
         LIMIT ?`,
      )
      .bind(eventId, limit)
      .all(),
    db
      .prepare(
        `SELECT * FROM odds_price_snapshots
         WHERE event_id = ?
         ORDER BY captured_at DESC
         LIMIT ?`,
      )
      .bind(eventId, limit * 20)
      .all(),
    db
      .prepare(
        `SELECT * FROM value_bet_snapshots
         WHERE event_id = ?
         ORDER BY captured_at DESC
         LIMIT ?`,
      )
      .bind(eventId, limit)
      .all(),
  ]);

  return {
    enabled: true,
    event,
    predictions: predictions.results,
    odds: odds.results,
    value_bets: valueBets.results,
  };
}

const ADVANCED_ODDS_MARKETS = new Set([
  "btts",
  "draw_no_bet",
  "team_totals",
  "player_goal_scorer_anytime",
  "player_assists",
  "player_shots_on_target",
  "player_to_receive_card",
]);

function marketDisplayLabel(market: string) {
  const labels: Record<string, string> = {
    btts: "Les 2 equipes marquent",
    draw_no_bet: "Nul rembourse",
    team_totals: "Buts equipe",
    h2h: "Resultat",
    spreads: "Handicap",
    totals: "Total buts",
    player_goal_scorer_anytime: "Buteur",
    player_assists: "Passe decisive",
    player_shots_on_target: "Tirs cadres",
    player_to_receive_card: "Carton joueur",
  };
  return labels[market] || market.replace(/_/g, " ");
}

function marketCategory(market: string) {
  if (market.startsWith("player_")) return "Joueurs";
  if (market === "btts" || market === "team_totals") return "Buts";
  if (market === "draw_no_bet" || market === "h2h" || market === "spreads") {
    return "Resultat";
  }
  return "Marche";
}

function movementDirection(openingPrice: number, latestPrice: number) {
  const deltaPct = openingPrice > 0 ? (latestPrice - openingPrice) / openingPrice : 0;
  if (Math.abs(deltaPct) < 0.005) return "stable";
  return latestPrice < openingPrice ? "shortening" : "drifting";
}

export async function getEventOddsHistory(
  eventId: number,
  options: { includeBase?: boolean; limit?: number } = {},
) {
  const db = getDb();
  if (!db) return unavailableStatus();
  await ensureSchema(db);

  const limit = Math.max(100, Math.min(options.limit || 3000, 8000));
  const includeBase = Boolean(options.includeBase);
  const [event, odds] = await Promise.all([
    db.prepare("SELECT * FROM events WHERE event_id = ?").bind(eventId).first(),
    db
      .prepare(
        `SELECT * FROM odds_price_snapshots
         WHERE event_id = ?
         ORDER BY captured_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(eventId, limit)
      .all<OddsPriceSnapshotRow>(),
  ]);

  const allRows = odds.results || [];
  const rows = includeBase
    ? allRows
    : allRows.filter((row) => ADVANCED_ODDS_MARKETS.has(row.market));
  const grouped = new Map<string, OddsPriceSnapshotRow[]>();
  const markets = new Map<
    string,
    { market: string; label: string; category: string; rows: number; bookmakers: Set<string>; selections: Set<string> }
  >();

  for (const row of rows) {
    const market = markets.get(row.market) || {
      market: row.market,
      label: marketDisplayLabel(row.market),
      category: marketCategory(row.market),
      rows: 0,
      bookmakers: new Set<string>(),
      selections: new Set<string>(),
    };
    market.rows += 1;
    market.bookmakers.add(row.bookmaker);
    market.selections.add(row.selection);
    markets.set(row.market, market);

    const key = [
      row.market,
      normalize(row.bookmaker),
      normalize(row.selection),
      row.point ?? "",
    ].join(":");
    const entries = grouped.get(key) || [];
    entries.push(row);
    grouped.set(key, entries);
  }

  const movements = [...grouped.values()]
    .map((entries) => {
      const byCapturedAt = new Map<string, OddsPriceSnapshotRow>();
      for (const entry of entries) byCapturedAt.set(entry.captured_at, entry);
      const timeline = [...byCapturedAt.values()].sort(
        (a, b) =>
          new Date(a.captured_at).getTime() -
          new Date(b.captured_at).getTime(),
      );
      const opening = timeline[0];
      const latest = timeline[timeline.length - 1];
      const hasMovementWindow = timeline.length > 1;
      const openingPrice = Number(opening.price || 0);
      const latestPrice = hasMovementWindow
        ? Number(latest.price || 0)
        : openingPrice;
      const impliedOpen = openingPrice > 1 ? 1 / openingPrice : null;
      const impliedLatest = latestPrice > 1 ? 1 / latestPrice : null;
      const impliedDelta =
        impliedOpen != null && impliedLatest != null
          ? impliedLatest - impliedOpen
          : null;
      const priceDelta = latestPrice - openingPrice;
      const priceDeltaPct = openingPrice > 0 ? priceDelta / openingPrice : 0;
      const absSignal = Math.abs(impliedDelta || priceDeltaPct || 0);

      return {
        market: latest.market,
        market_label: marketDisplayLabel(latest.market),
        category: marketCategory(latest.market),
        selection: latest.selection,
        bookmaker: latest.bookmaker,
        point: latest.point,
        opening_price: openingPrice,
        latest_price: latestPrice,
        price_delta: Number(priceDelta.toFixed(4)),
        price_delta_pct: Number(priceDeltaPct.toFixed(4)),
        implied_prob_open: impliedOpen == null ? null : Number(impliedOpen.toFixed(4)),
        implied_prob_latest:
          impliedLatest == null ? null : Number(impliedLatest.toFixed(4)),
        implied_prob_delta:
          impliedDelta == null ? null : Number(impliedDelta.toFixed(4)),
        direction: hasMovementWindow
          ? movementDirection(openingPrice, latestPrice)
          : "stable",
        signal_strength:
          hasMovementWindow && absSignal >= 0.05
            ? "high"
            : hasMovementWindow && absSignal >= 0.025
              ? "medium"
              : "low",
        observations: timeline.length,
        first_seen_at: opening.captured_at,
        last_seen_at: latest.captured_at,
      };
    })
    .filter((movement) => movement.latest_price > 1)
    .sort((a, b) => {
      const playerBoostA = a.market.startsWith("player_") ? 0.2 : 0;
      const playerBoostB = b.market.startsWith("player_") ? 0.2 : 0;
      return (
        Math.abs(b.implied_prob_delta || b.price_delta_pct) + playerBoostB -
        (Math.abs(a.implied_prob_delta || a.price_delta_pct) + playerBoostA)
      );
    });

  return {
    enabled: true,
    event,
    generated_at: new Date().toISOString(),
    rows_seen: allRows.length,
    rows_used: rows.length,
    player_rows: rows.filter((row) => row.market.startsWith("player_")).length,
    markets: [...markets.values()]
      .map((market) => ({
        market: market.market,
        label: market.label,
        category: market.category,
        rows: market.rows,
        bookmakers: market.bookmakers.size,
        selections: market.selections.size,
      }))
      .sort((a, b) => b.rows - a.rows),
    movements: movements.slice(0, 60),
    warnings: [
      "Un mouvement de cote est un signal de marche, pas une recommandation automatique.",
      "Les marches joueurs dependent fortement des compositions et du temps de jeu probable.",
      "L'historique devient plus fiable a mesure que les refreshs automatiques s'accumulent.",
    ],
  };
}

function outcomeProbabilities(row: {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
}) {
  return {
    home: Number(row.prob_home || 0),
    draw: Number(row.prob_draw || 0),
    away: Number(row.prob_away || 0),
  };
}

function topPick(probs: Record<string, number>) {
  return Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] || "home";
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseLineFromText(value: string | null | undefined) {
  const match = String(value || "").match(/(-?\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function settleH2h(event: FinishedEventRow, selection: string) {
  const selected = normalize(selection);
  const winner =
    event.winner === "draw"
      ? "draw"
      : event.winner === "home"
        ? normalize(event.home_team)
        : normalize(event.away_team);
  return selected === winner ? "won" : "lost";
}

function settleTotals(event: FinishedEventRow, selection: string, line: number | null) {
  if (line == null || Number.isNaN(line)) return "void";
  const total = event.home_score + event.away_score;
  const selected = normalize(selection);
  if (total === line) return "push";
  if (selected.includes("over")) return total > line ? "won" : "lost";
  if (selected.includes("under")) return total < line ? "won" : "lost";
  return "void";
}

function settleBtts(event: FinishedEventRow, selection: string) {
  const btts = event.home_score > 0 && event.away_score > 0;
  const selected = normalize(selection);
  const wantsYes = ["yes", "oui", "btts"].some((token) =>
    selected.includes(token),
  );
  const wantsNo = ["no", "non"].some((token) => selected.includes(token));
  if (!wantsYes && !wantsNo) return "void";
  return (wantsYes && btts) || (wantsNo && !btts) ? "won" : "lost";
}

function settleSpreads(event: FinishedEventRow, selection: string, line: number | null) {
  if (line == null || Number.isNaN(line)) return "void";
  const selected = normalize(selection);
  const side = selected === normalize(event.home_team) ? "home" : "away";
  const margin =
    side === "home"
      ? event.home_score + line - event.away_score
      : event.away_score + line - event.home_score;
  if (margin === 0) return "push";
  return margin > 0 ? "won" : "lost";
}

function settleExactScore(event: FinishedEventRow, selection: string) {
  const score = `${event.home_score}-${event.away_score}`;
  return String(selection).trim() === score ? "won" : "lost";
}

function settleMarket(input: BacktestInput) {
  const market = normalize(input.market);
  const line = input.line ?? null;
  if (market === "h2h" || market === "moneyline" || market === "1n2") {
    return settleH2h(input.event, input.selection);
  }
  if (market.includes("total") || market.includes("overunder")) {
    return settleTotals(input.event, input.selection, line);
  }
  if (market.includes("btts")) {
    return settleBtts(input.event, input.selection);
  }
  if (market.includes("spread") || market.includes("handicap")) {
    return settleSpreads(input.event, input.selection, line);
  }
  if (market.includes("exactscore")) {
    return settleExactScore(input.event, input.selection);
  }
  return "void";
}

function profitFlat(result: string, odds: number | null | undefined) {
  if (odds == null || Number.isNaN(Number(odds))) return null;
  if (result === "won") return Number(odds) - 1;
  if (result === "lost") return -1;
  if (result === "push") return 0;
  return null;
}

function sameLine(left: number | null | undefined, right: number | null | undefined) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function closingLineValue(
  entryOdds: number | null | undefined,
  closingOdds: number | null | undefined,
) {
  const entry = Number(entryOdds || 0);
  const closing = Number(closingOdds || 0);
  if (entry <= 1 || closing <= 1) return null;
  return entry / closing - 1;
}

async function findClosingOddsForValueBet(
  db: D1Database,
  row: ValueBetSnapshotRow,
) {
  if (!row.market || !row.selection || !row.scheduled_at) return null;
  const line = row.point ?? parseLineFromText(row.label);
  const candidates = await db
    .prepare(
      `SELECT * FROM odds_price_snapshots
       WHERE event_id = ?
         AND market = ?
         AND captured_at <= ?
       ORDER BY captured_at DESC
       LIMIT 500`,
    )
    .bind(row.event_id, row.market, row.scheduled_at)
    .all<OddsPriceSnapshotRow>();

  const matched = (candidates.results || []).filter(
    (candidate) =>
      normalize(candidate.selection) === normalize(row.selection) &&
      sameLine(candidate.point, line),
  );
  const sameBookmaker = matched.find(
    (candidate) => normalize(candidate.bookmaker) === normalize(row.bookmaker),
  );
  const closing = sameBookmaker || matched[0];
  if (!closing) return null;

  return {
    closingOdds: Number(closing.price),
    closingFairProb: closing.fair_prob,
    closingCapturedAt: closing.captured_at,
    clv: closingLineValue(row.odds, closing.price),
    closingSource: sameBookmaker ? "same_bookmaker" : "market_proxy",
  };
}

function backtestStatement(db: D1Database, input: BacktestInput, settledAt: string) {
  const result = settleMarket(input);
  return {
    result,
    statement: db
      .prepare(
        `INSERT INTO backtest_results (
          event_id, source, prediction_snapshot_id, value_bet_snapshot_id,
          captured_at, scheduled_at, settled_at, market, selection, line,
          model_prob, odds, bookmaker, edge, ev, confidence, data_quality,
          closing_odds, closing_fair_prob, closing_captured_at, clv,
          closing_source, result, profit_flat, home_score, away_score, winner
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.event.event_id,
        input.source,
        input.predictionSnapshotId ?? null,
        input.valueBetSnapshotId ?? null,
        input.capturedAt,
        input.scheduledAt,
        settledAt,
        input.market,
        input.selection,
        input.line ?? null,
        input.modelProb ?? null,
        input.odds ?? null,
        input.bookmaker ?? null,
        input.edge ?? null,
        input.ev ?? null,
        input.confidence ?? null,
        input.dataQuality ?? null,
        input.closingOdds ?? null,
        input.closingFairProb ?? null,
        input.closingCapturedAt ?? null,
        input.clv ?? null,
        input.closingSource ?? null,
        result,
        profitFlat(result, input.odds),
        input.event.home_score,
        input.event.away_score,
        input.event.winner,
      ),
  };
}

function predictionBacktestInputs(
  event: FinishedEventRow,
  snapshot: PredictionSnapshotRow,
): BacktestInput[] {
  const markets = parseJsonObject<{
    over_under?: Record<string, number>;
    btts?: { yes?: number; no?: number };
    top_scores?: Array<{ score: string; probability?: number; prob?: number }>;
  }>(snapshot.markets_json) || {};
  const h2h = [
    { selection: event.home_team, probability: Number(snapshot.prob_home || 0) },
    { selection: "draw", probability: Number(snapshot.prob_draw || 0) },
    { selection: event.away_team, probability: Number(snapshot.prob_away || 0) },
  ].sort((a, b) => b.probability - a.probability)[0];

  const inputs: BacktestInput[] = [
    {
      source: "prediction",
      event,
      predictionSnapshotId: snapshot.id,
      capturedAt: snapshot.captured_at,
      scheduledAt: snapshot.scheduled_at,
      market: "h2h",
      selection: h2h.selection,
      modelProb: h2h.probability,
      confidence: snapshot.confidence,
      dataQuality: snapshot.data_quality,
    },
  ];

  const over25 = markets.over_under?.over_2_5;
  const under25 = markets.over_under?.under_2_5;
  if (typeof over25 === "number" && typeof under25 === "number") {
    const totalPick =
      over25 >= under25
        ? { selection: "Over", probability: over25 }
        : { selection: "Under", probability: under25 };
    inputs.push({
      source: "prediction",
      event,
      predictionSnapshotId: snapshot.id,
      capturedAt: snapshot.captured_at,
      scheduledAt: snapshot.scheduled_at,
      market: "totals",
      selection: totalPick.selection,
      line: 2.5,
      modelProb: totalPick.probability,
      confidence: snapshot.confidence,
      dataQuality: snapshot.data_quality,
    });
  }

  if (
    typeof markets.btts?.yes === "number" &&
    typeof markets.btts?.no === "number"
  ) {
    const bttsPick =
      markets.btts.yes >= markets.btts.no
        ? { selection: "Yes", probability: markets.btts.yes }
        : { selection: "No", probability: markets.btts.no };
    inputs.push({
      source: "prediction",
      event,
      predictionSnapshotId: snapshot.id,
      capturedAt: snapshot.captured_at,
      scheduledAt: snapshot.scheduled_at,
      market: "btts",
      selection: bttsPick.selection,
      modelProb: bttsPick.probability,
      confidence: snapshot.confidence,
      dataQuality: snapshot.data_quality,
    });
  }

  const topScore = markets.top_scores?.[0];
  if (topScore?.score) {
    inputs.push({
      source: "prediction",
      event,
      predictionSnapshotId: snapshot.id,
      capturedAt: snapshot.captured_at,
      scheduledAt: snapshot.scheduled_at,
      market: "exact_score",
      selection: topScore.score,
      modelProb: topScore.probability ?? topScore.prob ?? null,
      confidence: snapshot.confidence,
      dataQuality: snapshot.data_quality,
    });
  }

  return inputs;
}

function uniqueLatestValueBets(rows: ValueBetSnapshotRow[]) {
  const seen = new Set<string>();
  const latest: ValueBetSnapshotRow[] = [];
  for (const row of rows) {
    const line = row.point ?? parseLineFromText(row.label);
    const key = [
      normalize(row.market),
      normalize(row.selection),
      line ?? "",
      normalize(row.bookmaker),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push({ ...row, point: line });
  }
  return latest;
}

function probabilityBucket(probability: number) {
  return Math.min(9, Math.max(0, Math.floor(Math.max(0, Math.min(0.9999, probability)) * 10)));
}

function bucketLabel(bucket: number) {
  return `${bucket * 10}-${(bucket + 1) * 10}%`;
}

function calibrationSignalFromStats(input: {
  scope: "market" | "global";
  market?: string | null;
  bucket: number;
  count: number;
  probSum: number;
  wins: number;
}): RecommendationCalibrationSignal {
  const avgProbability = input.count ? input.probSum / input.count : 0;
  const actualRate = input.count ? input.wins / input.count : 0;
  const error = actualRate - avgProbability;
  const signalStrength =
    input.count >= 20 && Math.abs(error) >= 0.15
      ? "high"
      : input.count >= 8 && Math.abs(error) >= 0.08
        ? "medium"
        : "low";
  const verdict =
    input.count < 8
      ? "insufficient"
      : error <= -0.08
        ? "overconfident"
        : error >= 0.08
          ? "underconfident"
          : "reliable";
  const shrink = Math.sqrt(input.count / (input.count + 20));
  const rawAdjustment =
    verdict === "insufficient" ? 0 : clamp(error * 80 * shrink, -12, 8);
  const scoreAdjustment = Number(rawAdjustment.toFixed(1));
  const label = bucketLabel(input.bucket);
  const scopeLabel =
    input.scope === "market" && input.market
      ? `marche ${marketDisplayLabel(input.market)}`
      : "tous marches";

  let reason = `Calibration ${scopeLabel} ${label}: ${input.count} cas, modele ${(avgProbability * 100).toFixed(1)}%, reel ${(actualRate * 100).toFixed(1)}%.`;
  if (verdict === "overconfident") {
    reason += " Penalite: le modele a ete trop confiant sur cette tranche.";
  } else if (verdict === "underconfident") {
    reason += " Bonus prudent: le modele a ete trop conservateur sur cette tranche.";
  } else if (verdict === "insufficient") {
    reason += " Historique trop court: aucun ajustement fort.";
  } else {
    reason += " Calibration correcte: ajustement faible.";
  }

  return {
    scope: input.scope,
    market: input.market ?? null,
    bucket: input.bucket,
    label,
    sample_size: input.count,
    avg_probability: Number(avgProbability.toFixed(4)),
    actual_rate: Number(actualRate.toFixed(4)),
    calibration_error: Number(error.toFixed(4)),
    verdict,
    signal_strength: signalStrength,
    score_adjustment: scoreAdjustment,
    reason,
  };
}

function clvSignalFromStats(input: {
  scope: "market" | "global";
  market?: string | null;
  count: number;
  avgClv: number | null;
  positiveClv: number;
}): RecommendationClvSignal {
  const positiveRate = input.count ? input.positiveClv / input.count : null;
  const avgClv = input.avgClv == null ? null : Number(input.avgClv);
  const weakPositiveRate = positiveRate != null && positiveRate < 0.35;
  const poorPositiveRate = positiveRate != null && positiveRate < 0.25;
  const weakAvg = avgClv != null && avgClv < -0.005;
  const poorAvg = avgClv != null && avgClv < -0.015;
  const goodAvg = avgClv != null && avgClv > 0.008;
  const goodPositiveRate = positiveRate != null && positiveRate > 0.52;

  const verdict =
    input.count < 8
      ? "insufficient"
      : poorAvg || poorPositiveRate
        ? "negative"
        : weakAvg || weakPositiveRate
          ? "negative"
          : goodAvg && goodPositiveRate
            ? "positive"
            : "neutral";
  const signalStrength =
    input.count >= 20 && (poorAvg || poorPositiveRate)
      ? "high"
      : input.count >= 8 && (weakAvg || weakPositiveRate)
        ? "medium"
        : "low";
  const stakeFactor =
    verdict === "negative"
      ? signalStrength === "high"
        ? 0.62
        : signalStrength === "medium"
          ? 0.78
          : 0.9
      : verdict === "positive"
        ? 1.04
        : 1;
  const scopeLabel =
    input.scope === "market" && input.market
      ? `marche ${marketDisplayLabel(input.market)}`
      : "tous marches";
  const clvLabel = avgClv == null ? "n/a" : `${(avgClv * 100).toFixed(2)}%`;
  const positiveLabel =
    positiveRate == null ? "n/a" : `${(positiveRate * 100).toFixed(1)}%`;

  let reason = `CLV ${scopeLabel}: ${input.count} cas, CLV moyenne ${clvLabel}, CLV positive ${positiveLabel}.`;
  if (verdict === "negative") {
    reason += " Mise reduite: l'historique de cloture est defavorable.";
  } else if (verdict === "positive") {
    reason += " Signal legerement favorable, bonus plafonne par prudence.";
  } else if (verdict === "insufficient") {
    reason += " Historique CLV trop court: pas d'ajustement fort.";
  } else {
    reason += " Signal CLV neutre.";
  }

  return {
    scope: input.scope,
    market: input.market ?? null,
    sample_size: input.count,
    avg_clv: avgClv == null ? null : Number(avgClv.toFixed(4)),
    positive_clv_rate:
      positiveRate == null ? null : Number(positiveRate.toFixed(4)),
    verdict,
    signal_strength: signalStrength,
    stake_factor: stakeFactor,
    reason,
  };
}

export async function getRecommendationCalibrationProfile() {
  const db = getDb();
  if (!db) {
    return {
      ...unavailableStatus(),
      buckets: [] as RecommendationCalibrationSignal[],
      clv: [] as RecommendationClvSignal[],
    };
  }
  await ensureSchema(db);

  const rows = await db
    .prepare(
      `SELECT market, model_prob, result
       FROM backtest_results
       WHERE source = 'value_bet'
         AND model_prob IS NOT NULL
         AND result IN ('won', 'lost')
       LIMIT 5000`,
    )
    .all<{
      market: string;
      model_prob: number;
      result: "won" | "lost";
    }>();

  const global = new Map<number, { count: number; probSum: number; wins: number }>();
  const byMarket = new Map<string, { count: number; probSum: number; wins: number }>();

  for (const row of rows.results || []) {
    const probability = Number(row.model_prob || 0);
    const bucket = probabilityBucket(probability);
    const won = row.result === "won" ? 1 : 0;
    const globalStats = global.get(bucket) || { count: 0, probSum: 0, wins: 0 };
    globalStats.count += 1;
    globalStats.probSum += probability;
    globalStats.wins += won;
    global.set(bucket, globalStats);

    const market = row.market || "unknown";
    const marketKey = `${normalize(market)}:${bucket}`;
    const marketStats = byMarket.get(marketKey) || { count: 0, probSum: 0, wins: 0 };
    marketStats.count += 1;
    marketStats.probSum += probability;
    marketStats.wins += won;
    byMarket.set(marketKey, marketStats);
  }

  const buckets: RecommendationCalibrationSignal[] = [];
  for (const [bucket, stats] of global.entries()) {
    buckets.push(
      calibrationSignalFromStats({
        scope: "global",
        bucket,
        ...stats,
      }),
    );
  }
  for (const [key, stats] of byMarket.entries()) {
    const [marketKey, bucketRaw] = key.split(":");
    buckets.push(
      calibrationSignalFromStats({
        scope: "market",
        market: marketKey,
        bucket: Number(bucketRaw),
        ...stats,
      }),
    );
  }

  const clvRows = await db
    .prepare(
      `SELECT
         market,
         COUNT(*) AS count,
         AVG(clv) AS avg_clv,
         SUM(CASE WHEN clv > 0 THEN 1 ELSE 0 END) AS positive_clv
       FROM backtest_results
       WHERE source = 'value_bet'
         AND clv IS NOT NULL
       GROUP BY market`,
    )
    .all<{
      market: string | null;
      count: number;
      avg_clv: number | null;
      positive_clv: number;
    }>();

  const clv: RecommendationClvSignal[] = [];
  const globalClv = clvRows.results.reduce(
    (acc, row) => {
      acc.count += Number(row.count || 0);
      acc.weightedClv += Number(row.avg_clv || 0) * Number(row.count || 0);
      acc.positiveClv += Number(row.positive_clv || 0);
      return acc;
    },
    { count: 0, weightedClv: 0, positiveClv: 0 },
  );
  if (globalClv.count > 0) {
    clv.push(
      clvSignalFromStats({
        scope: "global",
        count: globalClv.count,
        avgClv: globalClv.weightedClv / globalClv.count,
        positiveClv: globalClv.positiveClv,
      }),
    );
  }
  for (const row of clvRows.results) {
    clv.push(
      clvSignalFromStats({
        scope: "market",
        market: row.market || "unknown",
        count: Number(row.count || 0),
        avgClv: row.avg_clv,
        positiveClv: Number(row.positive_clv || 0),
      }),
    );
  }

  return {
    enabled: true,
    generated_at: new Date().toISOString(),
    samples: rows.results.length,
    buckets,
    clv,
    note:
      "Ajustements conservateurs: les signaux de calibration modifient le score, mais ne remplacent pas la probabilite modele.",
  };
}

export async function settleBacktestingResults() {
  const db = getDb();
  if (!db) {
    return { ...unavailableStatus(), settled: false };
  }
  await ensureSchema(db);

  const startedAt = new Date().toISOString();
  const run = await db
    .prepare(
      "INSERT INTO settlement_runs (started_at, status, message) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(startedAt, "running", "Settlement en cours")
    .first<{ id: number }>();
  const runId = run?.id;

  try {
    const allEvents = await getWorldCupMatches();
    const capturedAt = new Date().toISOString();
    const finished = allEvents.filter(
      (event) =>
        event.status === "FINISHED" &&
        event.result?.home_score != null &&
        event.result?.away_score != null,
    );

    for (let i = 0; i < allEvents.length; i += 80) {
      await db.batch(
        allEvents
          .slice(i, i + 80)
          .map((event) => upsertEventStatement(db, event, capturedAt)),
      );
    }

    for (let i = 0; i < finished.length; i += 80) {
      await db.batch(
        finished.slice(i, i + 80).map((event) =>
          db
            .prepare("DELETE FROM backtest_results WHERE event_id = ?")
            .bind(event.id),
        ),
      );
    }

    const statements: D1PreparedStatement[] = [];
    let predictionMarketsSettled = 0;
    let valueBetsSettled = 0;
    const settledAt = new Date().toISOString();

    for (const event of finished) {
      const winner = winnerFromResult(event);
      if (!winner) continue;
      const finishedEvent: FinishedEventRow = {
        event_id: event.id,
        home_team: event.home_team,
        away_team: event.away_team,
        scheduled_at: event.scheduled_at,
        home_score: event.result?.home_score ?? 0,
        away_score: event.result?.away_score ?? 0,
        winner,
      };

      const snapshot = await db
        .prepare(
          `SELECT * FROM prediction_snapshots
           WHERE event_id = ?
             AND captured_at <= scheduled_at
           ORDER BY captured_at DESC
           LIMIT 1`,
        )
        .bind(event.id)
        .first<PredictionSnapshotRow>();

      if (snapshot) {
        for (const input of predictionBacktestInputs(finishedEvent, snapshot)) {
          const { result, statement } = backtestStatement(db, input, settledAt);
          if (result !== "void") {
            statements.push(statement);
            predictionMarketsSettled += 1;
          }
        }
      }

      const valueRows = await db
        .prepare(
          `SELECT * FROM value_bet_snapshots
           WHERE event_id = ?
             AND captured_at <= scheduled_at
           ORDER BY captured_at DESC
           LIMIT 500`,
        )
        .bind(event.id)
        .all<ValueBetSnapshotRow>();

      for (const row of uniqueLatestValueBets(valueRows.results)) {
        const closing = await findClosingOddsForValueBet(db, row);
        const input: BacktestInput = {
          source: "value_bet",
          event: finishedEvent,
          valueBetSnapshotId: row.id,
          capturedAt: row.captured_at,
          scheduledAt: row.scheduled_at,
          market: row.market || "unknown",
          selection: row.selection || "",
          line: row.point ?? parseLineFromText(row.label),
          modelProb: row.model_prob,
          odds: row.odds,
          bookmaker: row.bookmaker,
          edge: row.edge,
          ev: row.ev,
          closingOdds: closing?.closingOdds ?? null,
          closingFairProb: closing?.closingFairProb ?? null,
          closingCapturedAt: closing?.closingCapturedAt ?? null,
          clv: closing?.clv ?? null,
          closingSource: closing?.closingSource ?? null,
        };
        const { result, statement } = backtestStatement(db, input, settledAt);
        if (result !== "void") {
          statements.push(statement);
          valueBetsSettled += 1;
        }
      }
    }

    for (let i = 0; i < statements.length; i += 80) {
      await db.batch(statements.slice(i, i + 80));
    }

    if (runId != null) {
      await db
        .prepare(
          `UPDATE settlement_runs
           SET finished_at = ?, status = ?, events_checked = ?,
               events_settled = ?, prediction_markets_settled = ?,
               value_bets_settled = ?, message = ?
           WHERE id = ?`,
        )
        .bind(
          new Date().toISOString(),
          "success",
          allEvents.length,
          finished.length,
          predictionMarketsSettled,
          valueBetsSettled,
          "Settlement termine",
          runId,
        )
        .run();
    }

    return {
      enabled: true,
      settled: true,
      run_id: runId,
      events_checked: allEvents.length,
      events_settled: finished.length,
      prediction_markets_settled: predictionMarketsSettled,
      value_bets_settled: valueBetsSettled,
    };
  } catch (error) {
    if (runId != null) {
      await db
        .prepare(
          "UPDATE settlement_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?",
        )
        .bind(
          new Date().toISOString(),
          "error",
          error instanceof Error ? error.message : "Erreur inconnue",
          runId,
        )
        .run();
    }
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function warmEventData(event: Event) {
  try {
    const players = await withTimeout(
      getPlayerInsights(event.id, { forceRefresh: true }),
      15000,
    );
    let contextOk = false;
    if (players) {
      await withTimeout(buildMatchContext(event, players), 20000);
      contextOk = true;
    }
    return {
      players: Boolean(players),
      context: contextOk,
    };
  } catch {
    return {
      players: false,
      context: false,
    };
  }
}

export async function runAutomatedDataRefresh(options: {
  origin?: string;
  mode?: "fast" | "full";
  trigger?: "manual" | "cron";
  hours?: number;
  warmLimit?: number;
  advancedOddsLimit?: number;
} = {}) {
  const db = getDb();
  if (!db) {
    return { ...unavailableStatus(), refreshed: false };
  }
  await ensureSchema(db);

  const mode = options.mode || "full";
  const trigger = options.trigger || "manual";
  const hours = Math.max(1, Math.min(options.hours || 168, 24 * 30));
  const warmLimit =
    options.warmLimit ?? (mode === "full" ? 4 : mode === "fast" ? 0 : 2);
  const advancedOddsLimit =
    options.advancedOddsLimit ?? (mode === "full" ? 2 : 0);
  const startedAt = new Date().toISOString();
  const run = await db
    .prepare(
      "INSERT INTO automation_runs (started_at, status, mode, trigger, message) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(startedAt, "running", mode, trigger, "Mise a jour en cours")
    .first<{ id: number }>();
  const runId = run?.id;

  try {
    const snapshot = await createHistorySnapshot(hours, {
      advancedOddsLimit,
    });
    const settlement = await settleBacktestingResults();
    let playersWarmed = 0;
    let contextsWarmed = 0;

    if (warmLimit > 0) {
      const upcoming = await getUpcomingMatches(Math.min(hours, 168));
      const targets = upcoming.slice(0, warmLimit);
      const warmResults = await Promise.allSettled(
        targets.map((event) => warmEventData(event)),
      );
      playersWarmed = warmResults.filter(
        (result) => result.status === "fulfilled" && result.value.players,
      ).length;
      contextsWarmed = warmResults.filter(
        (result) => result.status === "fulfilled" && result.value.context,
      ).length;
    }

    if (runId != null) {
      await db
        .prepare(
          `UPDATE automation_runs
           SET finished_at = ?, status = ?, events_seen = ?, upcoming_seen = ?,
               predictions_saved = ?, odds_saved = ?, value_bets_saved = ?,
               events_settled = ?, prediction_markets_settled = ?,
               value_bets_settled = ?, players_warmed = ?, contexts_warmed = ?,
               message = ?
           WHERE id = ?`,
        )
        .bind(
          new Date().toISOString(),
          "success",
          snapshot.events_seen ?? 0,
          snapshot.upcoming_seen ?? 0,
          snapshot.predictions_saved ?? 0,
          snapshot.odds_saved ?? 0,
          snapshot.value_bets_saved ?? 0,
          settlement.events_settled ?? 0,
          settlement.prediction_markets_settled ?? 0,
          settlement.value_bets_settled ?? 0,
          playersWarmed,
          contextsWarmed,
          "Mise a jour terminee",
          runId,
        )
        .run();
    }

    return {
      enabled: true,
      refreshed: true,
      run_id: runId,
      mode,
      trigger,
      events_seen: snapshot.events_seen ?? 0,
      upcoming_seen: snapshot.upcoming_seen ?? 0,
      predictions_saved: snapshot.predictions_saved ?? 0,
      odds_saved: snapshot.odds_saved ?? 0,
      advanced_odds_events: snapshot.advanced_odds_events ?? 0,
      advanced_odds_rows_saved: snapshot.advanced_odds_rows_saved ?? 0,
      value_bets_saved: snapshot.value_bets_saved ?? 0,
      events_settled: settlement.events_settled ?? 0,
      prediction_markets_settled:
        settlement.prediction_markets_settled ?? 0,
      value_bets_settled: settlement.value_bets_settled ?? 0,
      players_warmed: playersWarmed,
      contexts_warmed: contextsWarmed,
    };
  } catch (error) {
    if (runId != null) {
      await db
        .prepare(
          "UPDATE automation_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?",
        )
        .bind(
          new Date().toISOString(),
          "error",
          error instanceof Error ? error.message : "Erreur inconnue",
          runId,
        )
        .run();
    }
    throw error;
  }
}

export async function getPerformanceSummary() {
  const db = getDb();
  if (!db) return unavailableStatus();
  await ensureSchema(db);

  const rows = await db
    .prepare(
      `SELECT p.*, e.home_team, e.away_team, e.home_score, e.away_score, e.winner
       FROM prediction_snapshots p
       JOIN events e ON e.event_id = p.event_id
       WHERE e.status = 'FINISHED'
         AND e.home_score IS NOT NULL
         AND p.captured_at <= e.scheduled_at
         AND p.captured_at = (
           SELECT MAX(p2.captured_at)
           FROM prediction_snapshots p2
           WHERE p2.event_id = p.event_id
             AND p2.captured_at <= e.scheduled_at
         )
       ORDER BY e.scheduled_at DESC
       LIMIT 1000`,
    )
    .all<{
      event_id: number;
      prob_home: number;
      prob_draw: number;
      prob_away: number;
      winner: "home" | "draw" | "away";
    }>();

  let hits = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows.results) {
    const probs = outcomeProbabilities(row);
    const pick = topPick(probs);
    if (pick === row.winner) hits += 1;
    brier +=
      (probs.home - (row.winner === "home" ? 1 : 0)) ** 2 +
      (probs.draw - (row.winner === "draw" ? 1 : 0)) ** 2 +
      (probs.away - (row.winner === "away" ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(0.001, probs[row.winner] || 0.001));
  }

  const valueRows = await db
    .prepare(
      `SELECT vb.*, e.home_team, e.away_team, e.winner
       FROM value_bet_snapshots vb
       JOIN events e ON e.event_id = vb.event_id
       WHERE e.status = 'FINISHED'
         AND e.winner IS NOT NULL
         AND vb.captured_at <= e.scheduled_at
         AND vb.market = 'h2h'
       ORDER BY vb.captured_at DESC
       LIMIT 1000`,
    )
    .all<{
      selection: string;
      odds: number;
      winner: "home" | "draw" | "away";
      home_team: string;
      away_team: string;
    }>();

  let flatProfit = 0;
  let settledValueBets = 0;
  for (const row of valueRows.results) {
    const normalized = String(row.selection).toLowerCase();
    const won =
      (row.winner === "draw" && normalized === "draw") ||
      (row.winner === "home" &&
        normalized === String(row.home_team).toLowerCase()) ||
      (row.winner === "away" &&
        normalized === String(row.away_team).toLowerCase());
    flatProfit += won ? Number(row.odds) - 1 : -1;
    settledValueBets += 1;
  }

  const marketRows = await db
    .prepare(
      `SELECT
         source,
         market,
         COUNT(*) AS settled,
         SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) AS won,
         SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) AS lost,
         SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) AS push,
         SUM(CASE WHEN profit_flat IS NOT NULL THEN profit_flat ELSE 0 END) AS flat_profit,
         SUM(CASE WHEN profit_flat IS NOT NULL THEN 1 ELSE 0 END) AS flat_count,
         AVG(model_prob) AS avg_model_prob,
         AVG(clv) AS avg_clv,
         SUM(CASE WHEN clv IS NOT NULL THEN 1 ELSE 0 END) AS clv_count,
         SUM(CASE WHEN clv > 0 THEN 1 ELSE 0 END) AS positive_clv
       FROM backtest_results
       WHERE result IN ('won', 'lost', 'push')
       GROUP BY source, market
       ORDER BY source, market`,
    )
    .all<{
      source: "prediction" | "value_bet";
      market: string;
      settled: number;
      won: number;
      lost: number;
      push: number;
      flat_profit: number;
      flat_count: number;
      avg_model_prob: number | null;
      avg_clv: number | null;
      clv_count: number;
      positive_clv: number;
    }>();

  const clvSummary = await db
    .prepare(
      `SELECT
         COUNT(*) AS clv_count,
         AVG(clv) AS avg_clv,
         AVG(closing_odds) AS avg_closing_odds,
         SUM(CASE WHEN clv > 0 THEN 1 ELSE 0 END) AS positive_clv
       FROM backtest_results
       WHERE source = 'value_bet'
         AND clv IS NOT NULL`,
    )
    .first<{
      clv_count: number;
      avg_clv: number | null;
      avg_closing_odds: number | null;
      positive_clv: number;
    }>();

  const calibrationRows = await db
    .prepare(
      `SELECT source, market, model_prob, result
       FROM backtest_results
       WHERE model_prob IS NOT NULL
         AND result IN ('won', 'lost')
       LIMIT 5000`,
    )
    .all<{
      source: "prediction" | "value_bet";
      market: string;
      model_prob: number;
      result: "won" | "lost";
    }>();

  const calibrationBuckets = Array.from({ length: 10 }, (_, index) => ({
    bucket: index,
    label: `${index * 10}-${(index + 1) * 10}%`,
    count: 0,
    probSum: 0,
    wins: 0,
  }));
  for (const row of calibrationRows.results) {
    const probability = Math.max(0, Math.min(0.9999, Number(row.model_prob || 0)));
    const bucket = Math.min(9, Math.floor(probability * 10));
    calibrationBuckets[bucket].count += 1;
    calibrationBuckets[bucket].probSum += probability;
    calibrationBuckets[bucket].wins += row.result === "won" ? 1 : 0;
  }
  const calibration = calibrationBuckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => {
      const avgProb = bucket.probSum / bucket.count;
      const actualRate = bucket.wins / bucket.count;
      return {
        bucket: bucket.bucket,
        label: bucket.label,
        count: bucket.count,
        avg_probability: Number(avgProb.toFixed(4)),
        actual_rate: Number(actualRate.toFixed(4)),
        calibration_error: Number((actualRate - avgProb).toFixed(4)),
      };
    });

  const marketBreakdown = marketRows.results.map((row) => {
    const decided = Number(row.won || 0) + Number(row.lost || 0);
    const flatCount = Number(row.flat_count || 0);
    return {
      source: row.source,
      market: row.market,
      settled: Number(row.settled || 0),
      won: Number(row.won || 0),
      lost: Number(row.lost || 0),
      push: Number(row.push || 0),
      hit_rate: decided ? Number(row.won || 0) / decided : null,
      flat_profit: Number(row.flat_profit || 0),
      flat_yield: flatCount ? Number(row.flat_profit || 0) / flatCount : null,
      avg_model_prob:
        row.avg_model_prob == null ? null : Number(row.avg_model_prob),
      avg_clv: row.avg_clv == null ? null : Number(row.avg_clv),
      clv_count: Number(row.clv_count || 0),
      positive_clv_rate: Number(row.clv_count || 0)
        ? Number(row.positive_clv || 0) / Number(row.clv_count || 0)
        : null,
    };
  });
  const predictionMarketsSettled = marketBreakdown
    .filter((row) => row.source === "prediction")
    .reduce((sum, row) => sum + row.settled, 0);
  const valueBetPerformance = marketBreakdown.filter(
    (row) => row.source === "value_bet",
  );
  const settledValueBetsFromBacktest = valueBetPerformance.reduce(
    (sum, row) => sum + row.settled,
    0,
  );
  const flatProfitFromBacktest = valueBetPerformance.reduce(
    (sum, row) => sum + row.flat_profit,
    0,
  );
  const latestSettlement = await db
    .prepare("SELECT * FROM settlement_runs ORDER BY id DESC LIMIT 1")
    .first<SettlementRun>();

  const evaluated = rows.results.length;
  return {
    enabled: true,
    events_evaluated: evaluated,
    evaluated_predictions: evaluated,
    hit_rate: evaluated ? hits / evaluated : null,
    brier_score: evaluated ? brier / evaluated : null,
    log_loss: evaluated ? logLoss / evaluated : null,
    prediction_markets_settled: predictionMarketsSettled,
    settled_value_bets: settledValueBetsFromBacktest || settledValueBets,
    flat_stake_profit: flatProfitFromBacktest || flatProfit,
    flat_stake_yield:
      settledValueBetsFromBacktest || settledValueBets
        ? (flatProfitFromBacktest || flatProfit) /
          (settledValueBetsFromBacktest || settledValueBets)
        : null,
    clv_count: Number(clvSummary?.clv_count || 0),
    avg_clv:
      clvSummary?.avg_clv == null ? null : Number(clvSummary.avg_clv),
    positive_clv_rate:
      Number(clvSummary?.clv_count || 0) > 0
        ? Number(clvSummary?.positive_clv || 0) /
          Number(clvSummary?.clv_count || 0)
        : null,
    avg_closing_odds:
      clvSummary?.avg_closing_odds == null
        ? null
        : Number(clvSummary.avg_closing_odds),
    calibration,
    latest_settlement: latestSettlement,
    market_breakdown: marketBreakdown,
    note:
      evaluated === 0 && predictionMarketsSettled === 0
        ? "Pas encore assez de matchs finis avec snapshot pre-match."
        : "Mesures basees sur le dernier snapshot avant coup d'envoi et les value bets settlees.",
  };
}
