import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {
  DailyPicksParlayProfile,
  DailyPicksResponse,
  MarketRadarResponse,
  MatchParlayRiskProfile,
  MatchParlayScanRequest,
  MatchParlayScanResponse,
  RecommendationResponse,
} from "@/lib/api";
import { generateMultiMatchParlayScanner } from "@/lib/server/bet-builder-cloud";
import {
  getDailyRecommendations,
  getMarketRadar,
} from "@/lib/server/recommendation-cloud";

type DailyPicksStorage = DailyPicksResponse["storage"];

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface DailyPickSnapshotRow {
  id: number;
  date_key: string;
  generated_at: string;
  trigger: string;
  profile: string;
  status: string;
  payload_json: string;
  message: string | null;
}

interface DailyParlayProfileSnapshotRow {
  id: number;
  profile_id: DailyPicksParlayProfile["id"];
  generated_at: string;
  status: DailyPicksParlayProfile["status"];
  payload_json: string;
}

const PROFILE = "automated-v2";
const TICKET_PROFILES: Array<{
  id: DailyPicksParlayProfile["id"];
  label: string;
  description: string;
  request: MatchParlayScanRequest & {
    stake: number;
    risk_profile: MatchParlayRiskProfile;
    max_legs: number;
    max_events: number;
  };
}> = [
  {
    id: "prudent_3",
    label: "Prudent cote 3",
    description: "Ticket court, joueurs exclus, seuils de fiabilite stricts.",
    request: {
      target_odds: 3,
      stake: 20,
      risk_profile: "prudent",
      max_legs: 3,
      hours: 168,
      max_events: 5,
      exclude_player_props: true,
    },
  },
  {
    id: "value_5",
    label: "Value cote 5",
    description: "Cherche un compromis edge positif, EV et cote totale.",
    request: {
      target_odds: 5,
      stake: 20,
      risk_profile: "balanced",
      max_legs: 4,
      hours: 168,
      max_events: 6,
      exclude_player_props: true,
    },
  },
  {
    id: "aggressive_10",
    label: "Agressif cote 10",
    description: "Variance elevee acceptee, mise symbolique recommandee.",
    request: {
      target_odds: 10,
      stake: 10,
      risk_profile: "aggressive",
      max_legs: 5,
      hours: 168,
      max_events: 5,
      exclude_player_props: false,
    },
  },
];
const DAILY_SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_pick_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_pick_latest
  ON daily_pick_snapshots(profile, generated_at DESC);

CREATE TABLE IF NOT EXISTS daily_parlay_profile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_parlay_profile_latest
  ON daily_parlay_profile_snapshots(profile_id, generated_at DESC);
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

async function ensureDailySchema(db: D1Database) {
  if (schemaReady) return;
  const statements = DAILY_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  schemaReady = true;
}

function parisDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

function emptyRecommendations(now: string): RecommendationResponse {
  return {
    generated_at: now,
    filters: {
      hours: 168,
      risk_level: "balanced",
      bankroll: 1000,
      stake: 20,
      target_odds: 3,
      max_legs: 4,
      min_odds: 1.2,
      max_odds: 4,
    },
    summary: {
      upcoming_events: 0,
      value_bets_considered: 0,
      recommended_singles: 0,
      avoided_events: 0,
      parlay_available: false,
    },
    singles: [],
    parlays: [],
    avoid: [],
    guardrails: [
      "Aucun gain garanti: les sorties sont probabilistes.",
      "Ne jamais augmenter la mise pour se refaire apres une perte.",
    ],
  };
}

function emptyParlay(now: string, message: string): MatchParlayScanResponse {
  return {
    success: false,
    generated_at: now,
    target_odds: 3,
    risk_profile: "balanced",
    events_scanned: 0,
    candidates_considered: 0,
    message,
    warnings: ["Ticket du jour non disponible sur ce snapshot."],
  };
}

function emptyProfileParlay(
  now: string,
  profile: (typeof TICKET_PROFILES)[number],
  message: string,
): MatchParlayScanResponse {
  return {
    success: false,
    generated_at: now,
    target_odds: profile.request.target_odds,
    risk_profile: profile.request.risk_profile,
    events_scanned: 0,
    candidates_considered: 0,
    message,
    warnings: ["Profil automatique non disponible sur ce snapshot."],
  };
}

function emptyRadar(now: string): MarketRadarResponse {
  return {
    generated_at: now,
    events_scanned: 0,
    suggestions: [],
    warnings: ["Radar marche indisponible sur ce snapshot."],
  };
}

function profileDefinition(profileId: string) {
  return TICKET_PROFILES.find((profile) => profile.id === profileId) || null;
}

function profileResult(
  profile: (typeof TICKET_PROFILES)[number],
  parlay: MatchParlayScanResponse,
  status?: DailyPicksParlayProfile["status"],
): DailyPicksParlayProfile {
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    target_odds: profile.request.target_odds,
    stake: profile.request.stake,
    risk_profile: profile.request.risk_profile,
    status:
      status || (parlay.success && parlay.parlay ? "available" : "refused"),
    parlay,
  };
}

function placeholderProfiles(now: string): DailyPicksParlayProfile[] {
  return TICKET_PROFILES.map((profile) =>
    profileResult(
      profile,
      emptyProfileParlay(
        now,
        profile,
        "Profil en attente de son prochain scan automatique.",
      ),
      "refused",
    ),
  );
}

function parseProfileSnapshot(
  row: DailyParlayProfileSnapshotRow,
): DailyPicksParlayProfile | null {
  try {
    return JSON.parse(row.payload_json) as DailyPicksParlayProfile;
  } catch {
    return null;
  }
}

async function loadCachedTicketProfiles(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT *
       FROM daily_parlay_profile_snapshots
       ORDER BY generated_at DESC
       LIMIT 30`,
    )
    .all<DailyParlayProfileSnapshotRow>();
  const byProfile = new Map<
    DailyPicksParlayProfile["id"],
    DailyPicksParlayProfile
  >();
  for (const row of rows.results) {
    if (byProfile.has(row.profile_id)) continue;
    const parsed = parseProfileSnapshot(row);
    if (parsed) byProfile.set(row.profile_id, parsed);
  }
  return TICKET_PROFILES.map(
    (profile) =>
      byProfile.get(profile.id) ||
      profileResult(
        profile,
        emptyProfileParlay(
          new Date().toISOString(),
          profile,
          "Profil en attente de son prochain scan automatique.",
        ),
        "refused",
      ),
  );
}

async function saveProfileSnapshot(
  db: D1Database,
  profile: DailyPicksParlayProfile,
) {
  await db
    .prepare(
      `INSERT INTO daily_parlay_profile_snapshots
        (profile_id, generated_at, status, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      profile.id,
      profile.parlay.generated_at || new Date().toISOString(),
      profile.status,
      JSON.stringify(profile),
    )
    .run();
}

async function latestProfileSnapshot(
  db: D1Database,
  profileId: DailyPicksParlayProfile["id"],
) {
  return db
    .prepare(
      `SELECT *
       FROM daily_parlay_profile_snapshots
       WHERE profile_id = ?
       ORDER BY generated_at DESC
       LIMIT 1`,
    )
    .bind(profileId)
    .first<DailyParlayProfileSnapshotRow>();
}

export async function refreshDailyParlayProfile(
  profileId: string,
): Promise<DailyPicksParlayProfile> {
  const profile = profileDefinition(profileId);
  if (!profile) {
    throw new Error("Profil automatique inconnu.");
  }

  let result: DailyPicksParlayProfile;
  try {
    const parlay = await generateMultiMatchParlayScanner(profile.request);
    result = profileResult(profile, parlay);
  } catch {
    result = profileResult(
      profile,
      emptyProfileParlay(
        new Date().toISOString(),
        profile,
        "Scanner multi-match indisponible.",
      ),
      "error",
    );
  }

  const db = getDb();
  if (db) {
    try {
      await ensureDailySchema(db);
      await saveProfileSnapshot(db, result);
    } catch {
      return result;
    }
  }
  return result;
}

export async function getDailyParlayProfile(
  profileId: string,
  options: { forceRefresh?: boolean; maxAgeHours?: number } = {},
): Promise<DailyPicksParlayProfile> {
  const profile = profileDefinition(profileId);
  if (!profile) {
    throw new Error("Profil automatique inconnu.");
  }

  const db = getDb();
  if (!db) {
    return refreshDailyParlayProfile(profileId);
  }

  try {
    await ensureDailySchema(db);
    const row = await latestProfileSnapshot(db, profile.id);
    const parsed = row ? parseProfileSnapshot(row) : null;
    const maxAgeHours = Math.max(1, Math.min(options.maxAgeHours || 6, 48));
    const generatedAt = parsed?.parlay.generated_at;
    const ageHours = generatedAt
      ? (Date.now() - new Date(generatedAt).getTime()) / 3_600_000
      : Infinity;
    if (!options.forceRefresh && parsed && ageHours <= maxAgeHours) {
      return parsed;
    }
  } catch {
    return refreshDailyParlayProfile(profileId);
  }

  return refreshDailyParlayProfile(profileId);
}

function applyStorage(
  payload: DailyPicksResponse,
  storage: DailyPicksStorage,
  stale = false,
): DailyPicksResponse {
  return {
    ...payload,
    storage,
    stale,
  };
}

async function generatePayload(
  trigger: "manual" | "cron" | "auto" = "auto",
  fallback?: DailyPicksResponse | null,
  profiles?: DailyPicksParlayProfile[],
): Promise<DailyPicksResponse> {
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const parlayProfiles =
    profiles?.length
      ? profiles
      : fallback?.parlay_profiles?.length
        ? fallback.parlay_profiles
        : placeholderProfiles(now);

  const [recommendationsResult, radarResult] = await Promise.allSettled([
      getDailyRecommendations({
        hours: 168,
        bankroll: 1000,
        stake: 20,
        target_odds: 3,
        risk_level: "balanced",
        max_legs: 4,
        min_odds: 1.2,
        max_odds: 4,
      }),
      getMarketRadar({
        hours: 168,
        limit: 3,
        include_proxy: false,
      }),
  ]);

  const recommendations =
    recommendationsResult.status === "fulfilled"
      ? recommendationsResult.value
      : fallback?.recommendations || emptyRecommendations(now);
  const primaryProfile =
    parlayProfiles.find((profile) => profile.id === "value_5" && profile.status === "available") ||
    parlayProfiles.find((profile) => profile.status === "available");
  const multiMatchParlay =
    primaryProfile?.parlay || emptyParlay(now, "Aucun profil automatique disponible.");
  const radar =
    radarResult.status === "fulfilled"
      ? radarResult.value
      : fallback?.radar || emptyRadar(now);

  if (recommendationsResult.status === "rejected") {
    warnings.push(
      fallback?.recommendations
        ? "Recommandations reprises du dernier snapshot valide."
        : "Bloc recommandations indisponible sur ce run.",
    );
  }
  if (radarResult.status === "rejected") {
    warnings.push(
      fallback?.radar
        ? "Radar repris du dernier snapshot valide."
        : "Bloc radar marche indisponible sur ce run.",
    );
  }

  return {
    enabled: true,
    storage: "fresh",
    stale: false,
    profile: PROFILE,
    generated_at: now,
    refreshed_at: now,
    trigger,
    summary: {
      upcoming_events: recommendations.summary.upcoming_events,
      singles: recommendations.singles.length,
      radar_suggestions: radar.suggestions.length,
      parlay_available: Boolean(multiMatchParlay.success && multiMatchParlay.parlay),
      parlay_profiles_available: parlayProfiles.filter(
        (profile) => profile.status === "available",
      ).length,
      parlay_events_scanned: multiMatchParlay.events_scanned || 0,
      next_auto_refresh_note:
        "Refresh automatique Cloudflare: rapide toutes les 4h, complet toutes les 6h.",
    },
    recommendations,
    multi_match_parlay: multiMatchParlay,
    parlay_profiles: parlayProfiles,
    radar,
    warnings,
    guardrails: [
      "Aucun gain garanti: les suggestions restent probabilistes.",
      "Les tickets sont refuses si les filtres ne trouvent pas de combinaison saine.",
      "Mise prudente recommandee: ne pas augmenter apres une perte.",
      "Verifier les cotes dans ton bookmaker avant toute decision.",
    ],
  };
}

function parseSnapshot(row: DailyPickSnapshotRow): DailyPicksResponse | null {
  try {
    return JSON.parse(row.payload_json) as DailyPicksResponse;
  } catch {
    return null;
  }
}

async function latestSnapshot(db: D1Database) {
  return db
    .prepare(
      `SELECT *
       FROM daily_pick_snapshots
       WHERE profile = ?
       ORDER BY generated_at DESC
       LIMIT 1`,
    )
    .bind(PROFILE)
    .first<DailyPickSnapshotRow>();
}

async function latestUsefulSnapshot(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT *
       FROM daily_pick_snapshots
       ORDER BY generated_at DESC
       LIMIT 20`,
    )
    .all<DailyPickSnapshotRow>();
  for (const row of rows.results) {
    const parsed = parseSnapshot(row);
    if (
      parsed &&
      (parsed.recommendations?.singles?.length > 0 ||
        parsed.radar?.suggestions?.length > 0)
    ) {
      return parsed;
    }
  }
  return null;
}

async function saveSnapshot(
  db: D1Database,
  payload: DailyPicksResponse,
  trigger: "manual" | "cron" | "auto",
) {
  await db
    .prepare(
      `INSERT INTO daily_pick_snapshots
        (date_key, generated_at, trigger, profile, status, payload_json, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      parisDateKey(),
      payload.generated_at,
      trigger,
      PROFILE,
      "success",
      JSON.stringify(payload),
      payload.warnings?.join(" | ") || null,
    )
    .run();
}

export async function refreshDailyPicksSnapshot(options: {
  trigger?: "manual" | "cron" | "auto";
} = {}): Promise<DailyPicksResponse> {
  const trigger = options.trigger || "manual";
  const db = getDb();
  let fallback: DailyPicksResponse | null = null;
  let profiles: DailyPicksParlayProfile[] | undefined;
  if (db) {
    try {
      await ensureDailySchema(db);
      fallback = await latestUsefulSnapshot(db);
      profiles = await loadCachedTicketProfiles(db);
    } catch {
      fallback = null;
      profiles = undefined;
    }
  }
  const payload = await generatePayload(trigger, fallback, profiles);
  if (!db) {
    return {
      ...payload,
      enabled: false,
      storage: "live",
      message: "Stockage D1 indisponible: daily picks generes en direct.",
    };
  }

  try {
    await ensureDailySchema(db);
    await saveSnapshot(db, payload, trigger);
    return applyStorage(payload, "fresh");
  } catch (error) {
    return {
      ...applyStorage(payload, "live"),
      warnings: [
        ...payload.warnings,
        "Snapshot D1 non sauvegarde: daily picks generes en direct.",
      ],
      message:
        error instanceof Error
          ? `Stockage daily picks indisponible: ${error.message}`
          : "Stockage daily picks indisponible.",
    };
  }
}

export async function getDailyPicksSnapshot(options: {
  forceRefresh?: boolean;
  maxAgeHours?: number;
} = {}): Promise<DailyPicksResponse> {
  const db = getDb();
  if (!db) {
    return refreshDailyPicksSnapshot({ trigger: "auto" });
  }

  let parsed: DailyPicksResponse | null = null;
  try {
    await ensureDailySchema(db);
    const maxAgeHours = Math.max(1, Math.min(options.maxAgeHours || 6, 48));
    const row = await latestSnapshot(db);
    parsed = row ? parseSnapshot(row) : null;
    const ageHours = parsed
      ? (Date.now() - new Date(parsed.generated_at).getTime()) / 3_600_000
      : Infinity;

    if (!options.forceRefresh && parsed && ageHours <= maxAgeHours) {
      return {
        ...applyStorage(parsed, "snapshot"),
        refreshed_at: row?.generated_at,
        message: "Dernier daily picks charge depuis le snapshot D1.",
      };
    }
  } catch {
    return refreshDailyPicksSnapshot({
      trigger: options.forceRefresh ? "manual" : "auto",
    });
  }

  try {
    return await refreshDailyPicksSnapshot({
      trigger: options.forceRefresh ? "manual" : "auto",
    });
  } catch (error) {
    if (parsed) {
      return {
        ...applyStorage(parsed, "snapshot", true),
        message:
          "Generation fraiche impossible: dernier snapshot disponible retourne.",
        warnings: [
          ...(parsed.warnings || []),
          error instanceof Error ? error.message : "Erreur generation daily picks.",
        ],
      };
    }
    throw error;
  }
}
