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
  getMatchBetBuilder: (id: number) =>
    apiFetch<MatchBetBuilder>(`/api/v1/events/${id}/bet-builder`),
  generateSameMatchParlay: (id: number, data: MatchParlayRequest) =>
    apiFetch<MatchParlayResponse>(`/api/v1/events/${id}/same-match-parlay`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getPlayerInsights: (id: number) =>
    apiFetch<PlayerInsights>(`/api/v1/events/${id}/players`),
  getMatchContext: (id: number) =>
    apiFetch<MatchContext>(`/api/v1/ai/context/${id}?v=4`),
  predictEvent: (id: number) =>
    apiFetch<Prediction>(`/api/v1/events/${id}/predict`, { method: "POST" }),
  getRecommendations: (params: RecommendationRequest) => {
    const q = new URLSearchParams(params as any).toString();
    return apiFetch<RecommendationResponse>(`/api/v1/recommendations?${q}`);
  },
  getMarketRadar: (params?: MarketRadarRequest) => {
    const q = new URLSearchParams(params as any).toString();
    return apiFetch<MarketRadarResponse>(`/api/v1/recommendations/market-radar?${q}`);
  },

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
  getHistoryStatus: () =>
    apiFetch<HistoryStatus>("/api/v1/admin/history/status"),
  createHistorySnapshot: (hours = 168) =>
    apiFetch<HistorySnapshotResponse>(
      `/api/v1/admin/history/snapshot?hours=${hours}`,
      { method: "POST" },
    ),
  getEventHistory: (id: number, limit = 50) =>
    apiFetch<EventHistoryResponse>(
      `/api/v1/admin/history/events/${id}?limit=${limit}`,
    ),
  getEventOddsHistory: (id: number, includeBase = false) =>
    apiFetch<EventOddsHistoryResponse>(
      `/api/v1/admin/history/events/${id}?limit=150&odds_analysis=true&analysis_only=true&include_base=${includeBase}`,
    ),
  getPerformanceSummary: () =>
    apiFetch<PerformanceSummary>("/api/v1/admin/performance/summary"),
  settlePerformance: () =>
    apiFetch<SettlementResponse>("/api/v1/admin/performance/settle", {
      method: "POST",
    }),
  runDataRefresh: (mode: "fast" | "full" = "full") =>
    apiFetch<DataRefreshResponse>(
      `/api/v1/admin/data-refresh?mode=${mode}&trigger=manual&hours=168`,
      { method: "POST" },
    ),
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
  point?: number;
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
  selections: {
    key: string;
    name: string;
    description?: string;
    price: number;
    fair_prob: number;
    point?: number;
  }[];
  overround: number;
  captured_at: string;
}

export interface BetSuggestion {
  id: string;
  category: string;
  market: string;
  selection: string;
  label: string;
  probability: number;
  fair_odds: number;
  offered_odds?: number;
  bookmaker?: string;
  edge?: number;
  ev?: number;
  risk_level: string;
  confidence: "low" | "medium" | "high";
  source: "bookmaker" | "model";
  data_level?: "bookmaker" | "model" | "proxy";
  rationale: string;
  data_note?: string;
  conflict_key: string;
  tags: string[];
  market_signal?: MarketSignal;
}

export interface MarketSignal {
  verdict: "favorable" | "unfavorable" | "neutral" | "insufficient";
  direction: "shortening" | "drifting" | "stable";
  signal_strength: "low" | "medium" | "high";
  reason: string;
  score_adjustment: number;
  opening_price?: number;
  latest_price?: number;
  implied_prob_delta?: number | null;
  observations?: number;
}

export interface MatchBetBuilder {
  event_id: number;
  generated_at: string;
  suggestions: BetSuggestion[];
  bookmaker_markets: number;
  model_markets: number;
  preferred_bookmakers: string[];
  warnings: string[];
}

export interface MatchParlayRequest {
  target_odds: number;
  stake?: number;
  max_legs?: number;
}

export interface MatchParlayResponse {
  success: boolean;
  target_odds?: number;
  message?: string;
  parlay?: {
    legs: BetSuggestion[];
    total_odds: number;
    estimated_probability: number;
    potential_return?: number;
    warnings: string[];
  };
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
  storage?: {
    source: "cache" | "fresh";
    captured_at?: string;
  };
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

export interface RecommendationRequest {
  hours?: number;
  bankroll?: number;
  stake?: number;
  target_odds?: number;
  risk_level?: "prudent" | "balanced" | "aggressive";
  max_legs?: number;
  min_odds?: number;
  max_odds?: number;
}

export interface RecommendationSingle {
  event_id: number;
  match: string;
  competition: string;
  scheduled_at: string;
  market: string;
  selection: string;
  label: string;
  odds: number;
  bookmaker: string;
  model_prob: number;
  fair_prob: number;
  edge: number;
  ev: number;
  score: number;
  confidence: string;
  risk_level: string;
  recommended_stake: number;
  potential_return: number;
  reasons: string[];
  warnings: string[];
  market_signal?: MarketSignal;
}

export interface RecommendationParlay {
  legs: Array<{
    event_id: number;
    match: string;
    market: string;
    selection: string;
    label: string;
    odds: number;
    bookmaker: string;
    model_prob: number;
    edge: number;
    score: number;
    market_signal?: MarketSignal;
  }>;
  total_odds: number;
  theoretical_probability: number;
  expected_value: number;
  stake: number;
  potential_return: number;
  risk_level: string;
  warnings: string[];
}

export interface RecommendationResponse {
  generated_at: string;
  filters: Required<RecommendationRequest>;
  summary: {
    upcoming_events: number;
    value_bets_considered: number;
    recommended_singles: number;
    avoided_events: number;
    parlay_available: boolean;
  };
  singles: RecommendationSingle[];
  parlays: RecommendationParlay[];
  avoid: Array<{
    event_id: number;
    match: string;
    scheduled_at: string;
    reason: string;
    confidence: string;
  }>;
  guardrails: string[];
}

export interface MarketRadarRequest {
  hours?: number;
  limit?: number;
  include_proxy?: boolean;
}

export interface MarketRadarSuggestion {
  event_id: number;
  match: string;
  competition: string;
  scheduled_at: string;
  category: string;
  market: string;
  label: string;
  probability: number;
  fair_odds: number;
  offered_odds?: number;
  bookmaker?: string;
  edge?: number;
  risk_level: string;
  confidence: string;
  data_level: "bookmaker" | "model" | "proxy";
  source: "bookmaker" | "model";
  score: number;
  rationale: string;
  data_note: string;
  market_signal?: MarketSignal;
}

export interface MarketRadarResponse {
  generated_at: string;
  events_scanned: number;
  suggestions: MarketRadarSuggestion[];
  warnings: string[];
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
  history?: HistoryStatus;
}

export interface Competition {
  code: string;
  name: string;
  country: string;
}

export interface RefreshRun {
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

export interface HistoryStatus {
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

export interface HistorySnapshotResponse extends HistoryStatus {
  saved?: boolean;
  run_id?: number;
  events_seen?: number;
  upcoming_seen?: number;
  predictions_saved?: number;
  odds_saved?: number;
  advanced_odds_events?: number;
  advanced_odds_rows_saved?: number;
  value_bets_saved?: number;
}

export interface EventHistoryResponse {
  enabled: boolean;
  message?: string;
  event?: Record<string, any> | null;
  predictions?: Record<string, any>[];
  odds?: Record<string, any>[];
  value_bets?: Record<string, any>[];
  odds_analysis?: EventOddsHistoryResponse;
}

export interface OddsMarketSummary {
  market: string;
  label: string;
  category: string;
  rows: number;
  bookmakers: number;
  selections: number;
}

export interface OddsMovement {
  market: string;
  market_label: string;
  category: string;
  selection: string;
  bookmaker: string;
  point?: number | null;
  opening_price: number;
  latest_price: number;
  price_delta: number;
  price_delta_pct: number;
  implied_prob_open?: number | null;
  implied_prob_latest?: number | null;
  implied_prob_delta?: number | null;
  direction: "shortening" | "drifting" | "stable";
  signal_strength: "low" | "medium" | "high";
  observations: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface EventOddsHistoryResponse {
  enabled: boolean;
  message?: string;
  event?: Record<string, any> | null;
  generated_at?: string;
  rows_seen?: number;
  rows_used?: number;
  player_rows?: number;
  markets?: OddsMarketSummary[];
  movements?: OddsMovement[];
  warnings?: string[];
}

export interface PerformanceSummary {
  enabled: boolean;
  message?: string;
  evaluated_predictions?: number;
  hit_rate?: number | null;
  brier_score?: number | null;
  log_loss?: number | null;
  settled_value_bets?: number;
  flat_stake_profit?: number;
  flat_stake_yield?: number | null;
  events_evaluated?: number;
  prediction_markets_settled?: number;
  clv_count?: number;
  avg_clv?: number | null;
  positive_clv_rate?: number | null;
  avg_closing_odds?: number | null;
  calibration?: CalibrationBucket[];
  latest_settlement?: SettlementRun | null;
  market_breakdown?: MarketPerformance[];
  note?: string;
}

export interface SettlementResponse {
  enabled: boolean;
  message?: string;
  settled?: boolean;
  run_id?: number;
  events_checked?: number;
  events_settled?: number;
  prediction_markets_settled?: number;
  value_bets_settled?: number;
}

export interface DataRefreshResponse {
  enabled: boolean;
  message?: string;
  refreshed?: boolean;
  run_id?: number;
  mode?: "fast" | "full";
  trigger?: "manual" | "cron";
  events_seen?: number;
  upcoming_seen?: number;
  predictions_saved?: number;
  odds_saved?: number;
  advanced_odds_events?: number;
  advanced_odds_rows_saved?: number;
  value_bets_saved?: number;
  events_settled?: number;
  prediction_markets_settled?: number;
  value_bets_settled?: number;
  players_warmed?: number;
  contexts_warmed?: number;
}

export interface SettlementRun {
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

export interface AutomationRun {
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

export interface MarketPerformance {
  source: "prediction" | "value_bet";
  market: string;
  settled: number;
  won: number;
  lost: number;
  push: number;
  hit_rate: number | null;
  flat_profit: number;
  flat_yield: number | null;
  avg_model_prob: number | null;
  avg_clv?: number | null;
  clv_count?: number;
  positive_clv_rate?: number | null;
}

export interface CalibrationBucket {
  bucket: number;
  label: string;
  count: number;
  avg_probability: number;
  actual_rate: number;
  calibration_error: number;
}
