import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Event, OddsSnapshot, ValueBet } from "@/lib/api";
import {
  getUpcomingMatches,
  getWorldCupMatches,
} from "@/lib/server/football-cloud";
import {
  getWorldCupOdds,
  matchOddsEvent,
  serializeOdds,
} from "@/lib/server/odds-cloud";

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

interface StorageStatus {
  enabled: boolean;
  message?: string;
  events_total?: number;
  prediction_snapshots?: number;
  odds_price_snapshots?: number;
  value_bet_snapshots?: number;
  refresh_runs?: number;
  latest_refresh?: RefreshRun | null;
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
`;

let schemaReady = false;

function json(value: unknown) {
  return JSON.stringify(value ?? null);
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
  schemaReady = true;
}

function unavailableStatus(): StorageStatus {
  return {
    enabled: false,
    message:
      "Cloudflare D1 n'est pas encore lie. Le code est pret; il faut ajouter le binding SPORTSBET_DB.",
  };
}

function winnerFromResult(event: Event) {
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
            selection.name,
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
          label, odds, bookmaker, model_prob, fair_prob, implied_prob, edge,
          ev, confidence, risk_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        capturedAt,
        event.scheduled_at,
        bet.match || `${event.home_team} vs ${event.away_team}`,
        bet.market,
        bet.selection,
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

export async function createHistorySnapshot(hours = 168) {
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
    const capturedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    let predictionsSaved = 0;
    let oddsSaved = 0;
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
      const snapshots = serializeOdds(oddsEvent);
      const oddsRows = oddsStatements(db, event, snapshots, capturedAt);
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

  return {
    enabled: true,
    events_total: await countTable(db, "events"),
    prediction_snapshots: await countTable(db, "prediction_snapshots"),
    odds_price_snapshots: await countTable(db, "odds_price_snapshots"),
    value_bet_snapshots: await countTable(db, "value_bet_snapshots"),
    refresh_runs: await countTable(db, "refresh_runs"),
    latest_refresh: latest,
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

  const evaluated = rows.results.length;
  return {
    enabled: true,
    evaluated_predictions: evaluated,
    hit_rate: evaluated ? hits / evaluated : null,
    brier_score: evaluated ? brier / evaluated : null,
    log_loss: evaluated ? logLoss / evaluated : null,
    settled_value_bets: settledValueBets,
    flat_stake_profit: flatProfit,
    flat_stake_yield: settledValueBets ? flatProfit / settledValueBets : null,
    note:
      evaluated === 0
        ? "Pas encore assez de matchs finis avec snapshot pre-match."
        : "Mesures basees sur le dernier snapshot avant coup d'envoi.",
  };
}
