const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erreur API ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Events
  getTodayEvents: () => apiFetch<Event[]>("/api/v1/events/today"),
  getUpcoming: (hours = 48) => apiFetch<Event[]>(`/api/v1/events/upcoming?hours=${hours}`),
  getValueBets: (params?: { min_edge?: number; min_odds?: number; max_odds?: number }) => {
    const q = new URLSearchParams(params as any).toString();
    return apiFetch<ValueBet[]>(`/api/v1/events/value-bets?${q}`);
  },
  getEvent: (id: number) => apiFetch<Event>(`/api/v1/events/${id}`),
  getEventOdds: (id: number) => apiFetch<OddsSnapshot[]>(`/api/v1/events/${id}/odds`),
  getPlayerInsights: (id: number) =>
    apiFetch<PlayerInsights>(`/api/v1/events/${id}/players`),
  getMatchContext: (id: number) =>
    apiFetch<MatchContext>(`/api/v1/ai/context/${id}?v=3`),
  predictEvent: (id: number) =>
    apiFetch<Prediction>(`/api/v1/events/${id}/predict`, { method: "POST" }),

  // Parlays
  generateParlay: (data: ParlayRequest) =>
    apiFetch<ParlayResponse>("/api/v1/parlays/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Bankroll
  getBankroll: () => apiFetch<BankrollData>("/api/v1/bankroll"),
  createBankroll: (data: BankrollCreate) =>
    apiFetch<BankrollData>("/api/v1/bankroll", { method: "POST", body: JSON.stringify(data) }),
  getBetHistory: () => apiFetch<BetRecord[]>("/api/v1/bankroll/history"),
  recordBet: (data: RecordBet) =>
    apiFetch<BetRecord>("/api/v1/bankroll/bets", { method: "POST", body: JSON.stringify(data) }),
  settleBet: (id: number, result: "won" | "lost" | "void") =>
    apiFetch<BetRecord>(`/api/v1/bankroll/bets/${id}/settle`, {
      method: "PATCH",
      body: JSON.stringify({ result }),
    }),

  // Admin
  getStatus: () => apiFetch<SystemStatus>("/api/v1/admin/status"),
  importCompetition: (code: string, season?: number) =>
    apiFetch(`/api/v1/admin/import/${code}${season ? `?season=${season}` : ""}`, { method: "POST" }),
  refreshOdds: () => apiFetch("/api/v1/admin/odds/refresh", { method: "POST" }),
  runPredictions: () => apiFetch("/api/v1/admin/predict/all", { method: "POST" }),
  getCompetitions: () => apiFetch<Competition[]>("/api/v1/admin/competitions"),
};

// Types
export interface Event {
  id: number;
  home_team: string;
  away_team: string;
  competition: string;
  competition_code: string;
  scheduled_at: string;
  status: string;
  matchday?: number;
  stage?: string;
  home_team_id?: number;
  away_team_id?: number;
  result?: { home_score: number; away_score: number; winner: string };
  prediction?: Prediction;
}

export interface Prediction {
  id: number;
  model_version: string;
  predicted_at: string;
  confidence: "low" | "medium" | "high";
  data_quality: "poor" | "fair" | "good";
  warning_flags: string[];
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  markets: Record<string, any>;
  value_bets: ValueBet[];
}

export interface ValueBet {
  event_id: number;
  match?: string;
  competition?: string;
  scheduled_at?: string;
  market: string;
  selection: string;
  model_prob: number;
  fair_prob: number;
  implied_prob: number;
  edge: number;
  ev: number;
  odds: number;
  bookmaker: string;
  recommendation_score: number;
  kelly_stake_pct: number;
  recommended_stake_pct: number;
  label: string;
  risk_level: string;
  confidence?: string;
}

export interface OddsSnapshot {
  bookmaker: string;
  market: string;
  selections: { key: string; name: string; price: number; fair_prob: number; point?: number }[];
  overround: number;
  captured_at: string;
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
  data_freshness: Record<string, string | undefined>;
  players: PlayerProjection[];
  warnings: string[];
}

export interface MatchContext {
  generated_at: string;
  summary: string;
  factors: Array<{
    text: string;
    impact: "positive_home" | "positive_away" | "neutral" | "risk";
    confidence: "low" | "medium" | "high";
    source_indices: number[];
  }>;
  data_gaps: string[];
  sources: Array<{
    title: string;
    url: string;
    published_at?: string;
    source?: string;
  }>;
}

export interface ParlayRequest {
  target_odds: number;
  stake: number;
  risk_level: "prudent" | "balanced" | "aggressive";
  bankroll: number;
  max_legs: number;
}

export interface ParlayResponse {
  success: boolean;
  error?: string;
  message?: string;
  parlay?: {
    legs: ParlayLeg[];
    total_odds: number;
    theoretical_probability: number;
    expected_value: number;
    stake: number;
    recommended_stake: number;
    potential_return: number;
    risk_level: string;
    warnings: string[];
  };
}

export interface ParlayLeg {
  match: string;
  market: string;
  selection: string;
  odds: number;
  model_prob: number;
  edge: number;
  bookmaker: string;
  ev: number;
}

export interface BankrollData {
  initial_amount: number;
  current_amount: number;
  currency: string;
  profit_loss: number;
  roi_pct: number;
  total_bets: number;
  win_rate: number;
  max_stake_pct: number;
  max_stake_amount: number;
  kelly_fraction: number;
  stop_loss_pct: number;
  drawdown: number;
  alerts: string[];
}

export interface BankrollCreate {
  initial_amount: number;
  max_stake_pct?: number;
  kelly_fraction?: number;
  stop_loss_pct?: number;
}

export interface BetRecord {
  id: number;
  event_id: number;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  potential_return: number;
  bookmaker: string;
  status: string;
  profit_loss?: number;
  placed_at: string;
}

export interface RecordBet {
  event_id: number;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  bookmaker?: string;
}

export interface SystemStatus {
  events_total: number;
  events_scheduled: number;
  predictions_computed: number;
  odds_snapshots: number;
  competitions_active: number;
  odds_api_quota: { remaining?: string; used?: string };
}

export interface Competition {
  code: string;
  name: string;
  country: string;
}
