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
