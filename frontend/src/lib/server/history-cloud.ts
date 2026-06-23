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

interface StorageStatus {
  enabled: boolean;
  message?: string;
  events_total?: number;
  prediction_snapshots?: number;
  odds_price_snapshots?: number;
  value_bet_snapshots?: number;
  backtest_results?: number;
  settlement_runs?: number;
  refresh_runs?: number;
  latest_refresh?: RefreshRun | null;
  latest_settlement?: SettlementRun | null;
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
  const latestSettlement = await db
    .prepare("SELECT * FROM settlement_runs ORDER BY id DESC LIMIT 1")
    .first<SettlementRun>();

  return {
    enabled: true,
    events_total: await countTable(db, "events"),
    prediction_snapshots: await countTable(db, "prediction_snapshots"),
    odds_price_snapshots: await countTable(db, "odds_price_snapshots"),
    value_bet_snapshots: await countTable(db, "value_bet_snapshots"),
    backtest_results: await countTable(db, "backtest_results"),
    settlement_runs: await countTable(db, "settlement_runs"),
    refresh_runs: await countTable(db, "refresh_runs"),
    latest_refresh: latest,
    latest_settlement: latestSettlement,
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
          result, profit_flat, home_score, away_score, winner
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
         AVG(model_prob) AS avg_model_prob
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
    }>();

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
    latest_settlement: latestSettlement,
    market_breakdown: marketBreakdown,
    note:
      evaluated === 0 && predictionMarketsSettled === 0
        ? "Pas encore assez de matchs finis avec snapshot pre-match."
        : "Mesures basees sur le dernier snapshot avant coup d'envoi et les value bets settlees.",
  };
}
