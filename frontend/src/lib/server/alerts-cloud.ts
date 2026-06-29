import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {
  AutomatedAlert,
  AutomatedAlertsResponse,
  DailyPicksResponse,
  MarketSignal,
} from "@/lib/api";
import { getDailyPicksSnapshot } from "@/lib/server/daily-picks-cloud";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface AlertRow {
  id: number;
  fingerprint: string;
  type: AutomatedAlert["type"];
  severity: AutomatedAlert["severity"];
  event_id: number;
  match_name: string;
  scheduled_at: string | null;
  market: string;
  selection: string;
  bookmaker: string | null;
  odds: number | null;
  previous_odds: number | null;
  edge: number | null;
  title: string;
  message: string;
  href: string;
  created_at: string;
  expires_at: string | null;
  read_at: string | null;
}

interface AlertCandidate {
  fingerprint: string;
  type: AutomatedAlert["type"];
  severity: AutomatedAlert["severity"];
  eventId: number;
  match: string;
  scheduledAt?: string;
  market: string;
  selection: string;
  bookmaker?: string;
  odds?: number;
  previousOdds?: number;
  edge?: number;
  title: string;
  message: string;
}

const ALERT_SCHEMA = `
CREATE TABLE IF NOT EXISTS automated_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  match_name TEXT NOT NULL,
  scheduled_at TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  bookmaker TEXT,
  odds REAL,
  previous_odds REAL,
  edge REAL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  href TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_automated_alerts_latest
  ON automated_alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automated_alerts_unread
  ON automated_alerts(read_at, created_at DESC);
`;

let schemaReady = false;

function getDb(): D1Database | null {
  try {
    const { env } = getCloudflareContext();
    const candidate = env as unknown as { SPORTSBET_DB?: D1Database };
    return candidate.SPORTSBET_DB || null;
  } catch {
    return null;
  }
}

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  for (const statement of ALERT_SCHEMA.split(";")
    .map((item) => item.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run();
  }
  schemaReady = true;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function dayKey(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function alertFingerprint(
  type: AlertCandidate["type"],
  eventId: number,
  market: string,
  selection: string,
  bookmaker: string | undefined,
  scheduledAt: string | undefined,
  discriminator = "",
) {
  return [
    type,
    eventId,
    normalize(market),
    normalize(selection),
    normalize(bookmaker),
    dayKey(scheduledAt),
    discriminator,
  ].join(":");
}

function marketLabel(market: string) {
  const labels: Record<string, string> = {
    h2h: "Résultat du match",
    totals: "Total de buts",
    spreads: "Handicap",
    btts: "Les deux équipes marquent",
    draw_no_bet: "Remboursé si nul",
    team_totals: "Buts d'une équipe",
    player_goal_scorer_anytime: "Buteur",
    player_assists: "Passeur décisif",
    player_shots_on_target: "Tirs cadrés",
    player_to_receive_card: "Carton joueur",
  };
  return labels[market] || market.replace(/_/g, " ");
}

function movementCandidate(input: {
  eventId: number;
  match: string;
  scheduledAt?: string;
  market: string;
  selection: string;
  label: string;
  bookmaker?: string;
  signal?: MarketSignal;
}): AlertCandidate | null {
  const signal = input.signal;
  if (
    !signal ||
    signal.signal_strength === "low" ||
    signal.direction === "stable" ||
    !signal.latest_price ||
    !signal.opening_price
  ) {
    return null;
  }

  const delta = Math.abs(signal.implied_prob_delta || 0);
  if (signal.signal_strength !== "high" && delta < 0.025) return null;
  const direction =
    signal.direction === "shortening" ? "baisse" : "hausse";
  const discriminator = `${signal.direction}:${signal.latest_price.toFixed(2)}`;

  return {
    fingerprint: alertFingerprint(
      "strong_move",
      input.eventId,
      input.market,
      input.selection,
      input.bookmaker,
      input.scheduledAt,
      discriminator,
    ),
    type: "strong_move",
    severity: signal.signal_strength === "high" ? "high" : "medium",
    eventId: input.eventId,
    match: input.match,
    scheduledAt: input.scheduledAt,
    market: input.market,
    selection: input.selection,
    bookmaker: input.bookmaker,
    odds: signal.latest_price,
    previousOdds: signal.opening_price,
    title: `Mouvement de cote ${direction}`,
    message: `${input.label} passe de ${signal.opening_price.toFixed(2)} à ${signal.latest_price.toFixed(2)}${input.bookmaker ? ` chez ${input.bookmaker}` : ""}.`,
  };
}

function buildCandidates(snapshot: DailyPicksResponse) {
  const candidates: AlertCandidate[] = [];

  for (const single of snapshot.recommendations.singles) {
    if (single.edge >= 0.03 && single.ev > 0) {
      candidates.push({
        fingerprint: alertFingerprint(
          "new_value",
          single.event_id,
          single.market,
          single.selection,
          single.bookmaker,
          single.scheduled_at,
        ),
        type: "new_value",
        severity: single.edge >= 0.08 ? "high" : "medium",
        eventId: single.event_id,
        match: single.match,
        scheduledAt: single.scheduled_at,
        market: single.market,
        selection: single.selection,
        bookmaker: single.bookmaker,
        odds: single.odds,
        edge: single.edge,
        title: "Nouvelle value bet détectée",
        message: `${single.label} à ${single.odds.toFixed(2)} avec un edge modèle de ${(single.edge * 100).toFixed(1)} %.`,
      });
    }

    if (single.is_french_bookmaker && single.odds > 1) {
      candidates.push({
        fingerprint: alertFingerprint(
          "french_odds",
          single.event_id,
          single.market,
          single.selection,
          single.bookmaker,
          single.scheduled_at,
        ),
        type: "french_odds",
        severity: "info",
        eventId: single.event_id,
        match: single.match,
        scheduledAt: single.scheduled_at,
        market: single.market,
        selection: single.selection,
        bookmaker: single.bookmaker,
        odds: single.odds,
        edge: single.edge,
        title: "Cote française disponible",
        message: `${single.label} est coté ${single.odds.toFixed(2)} chez ${single.bookmaker}.`,
      });
    }

    const movement = movementCandidate({
      eventId: single.event_id,
      match: single.match,
      scheduledAt: single.scheduled_at,
      market: single.market,
      selection: single.selection,
      label: single.label,
      bookmaker: single.bookmaker,
      signal: single.market_signal,
    });
    if (movement) candidates.push(movement);
  }

  for (const item of snapshot.radar.suggestions) {
    if (
      item.is_french_bookmaker &&
      item.offered_odds &&
      item.offered_odds > 1
    ) {
      candidates.push({
        fingerprint: alertFingerprint(
          "french_odds",
          item.event_id,
          item.market,
          item.label,
          item.bookmaker,
          item.scheduled_at,
        ),
        type: "french_odds",
        severity: "info",
        eventId: item.event_id,
        match: item.match,
        scheduledAt: item.scheduled_at,
        market: item.market,
        selection: item.label,
        bookmaker: item.bookmaker,
        odds: item.offered_odds,
        edge: item.edge,
        title: "Nouveau marché français",
        message: `${marketLabel(item.market)} : ${item.label} à ${item.offered_odds.toFixed(2)} chez ${item.bookmaker}.`,
      });
    }

    const movement = movementCandidate({
      eventId: item.event_id,
      match: item.match,
      scheduledAt: item.scheduled_at,
      market: item.market,
      selection: item.label,
      label: item.label,
      bookmaker: item.bookmaker,
      signal: item.market_signal,
    });
    if (movement) candidates.push(movement);
  }

  return [...new Map(candidates.map((item) => [item.fingerprint, item])).values()];
}

function rowToAlert(row: AlertRow): AutomatedAlert {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    event_id: row.event_id,
    match: row.match_name,
    scheduled_at: row.scheduled_at || undefined,
    market: row.market,
    selection: row.selection,
    bookmaker: row.bookmaker || undefined,
    odds: row.odds ?? undefined,
    previous_odds: row.previous_odds ?? undefined,
    edge: row.edge ?? undefined,
    title: row.title,
    message: row.message,
    href: row.href,
    created_at: row.created_at,
    expires_at: row.expires_at || undefined,
    read: Boolean(row.read_at),
  };
}

async function responseFromDb(
  db: D1Database,
  options: { limit?: number; inserted?: number; scanned?: number } = {},
): Promise<AutomatedAlertsResponse> {
  const limit = Math.max(1, Math.min(options.limit || 30, 100));
  const now = new Date().toISOString();
  const [rows, unread] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM automated_alerts
         WHERE expires_at IS NULL OR expires_at >= ?
         ORDER BY CASE severity
           WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
           created_at DESC
         LIMIT ?`,
      )
      .bind(now, limit)
      .all<AlertRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM automated_alerts
         WHERE read_at IS NULL AND (expires_at IS NULL OR expires_at >= ?)`,
      )
      .bind(now)
      .first<{ count: number }>(),
  ]);

  return {
    enabled: true,
    generated_at: now,
    unread_count: Number(unread?.count || 0),
    scanned_candidates: options.scanned,
    inserted_alerts: options.inserted,
    alerts: (rows.results || []).map(rowToAlert),
    guardrail:
      "Une alerte signale une information à examiner, jamais un gain garanti.",
  };
}

export async function getAutomatedAlerts(options: { limit?: number } = {}) {
  const db = getDb();
  if (!db) {
    return {
      enabled: false,
      generated_at: new Date().toISOString(),
      unread_count: 0,
      alerts: [],
      message: "Stockage des alertes indisponible.",
      guardrail:
        "Une alerte signale une information à examiner, jamais un gain garanti.",
    } satisfies AutomatedAlertsResponse;
  }
  await ensureSchema(db);
  return responseFromDb(db, options);
}

export async function scanAutomatedAlerts() {
  const db = getDb();
  if (!db) return getAutomatedAlerts();
  await ensureSchema(db);

  const snapshot = await getDailyPicksSnapshot({ maxAgeHours: 12 });
  const candidates = buildCandidates(snapshot);
  const createdAt = new Date().toISOString();
  let inserted = 0;

  for (const candidate of candidates) {
    const existing = await db
      .prepare("SELECT id FROM automated_alerts WHERE fingerprint = ?")
      .bind(candidate.fingerprint)
      .first<{ id: number }>();
    if (existing) continue;

    await db
      .prepare(
        `INSERT INTO automated_alerts
          (fingerprint, type, severity, event_id, match_name, scheduled_at,
           market, selection, bookmaker, odds, previous_odds, edge, title,
           message, href, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        candidate.fingerprint,
        candidate.type,
        candidate.severity,
        candidate.eventId,
        candidate.match,
        candidate.scheduledAt || null,
        candidate.market,
        candidate.selection,
        candidate.bookmaker || null,
        candidate.odds ?? null,
        candidate.previousOdds ?? null,
        candidate.edge ?? null,
        candidate.title,
        candidate.message,
        `/analyse/${candidate.eventId}`,
        createdAt,
        candidate.scheduledAt || null,
      )
      .run();
    inserted += 1;
  }

  await db
    .prepare(
      `DELETE FROM automated_alerts
       WHERE created_at < datetime('now', '-21 days')
          OR (expires_at IS NOT NULL AND expires_at < datetime('now', '-2 days'))`,
    )
    .run();

  return responseFromDb(db, {
    limit: 30,
    inserted,
    scanned: candidates.length,
  });
}

export async function markAutomatedAlertsRead(input: {
  id?: number;
  all?: boolean;
}) {
  const db = getDb();
  if (!db) return getAutomatedAlerts();
  await ensureSchema(db);
  const readAt = new Date().toISOString();

  if (input.all) {
    await db
      .prepare("UPDATE automated_alerts SET read_at = ? WHERE read_at IS NULL")
      .bind(readAt)
      .run();
  } else if (input.id && Number.isFinite(input.id)) {
    await db
      .prepare("UPDATE automated_alerts SET read_at = ? WHERE id = ?")
      .bind(readAt, input.id)
      .run();
  }

  return responseFromDb(db);
}
