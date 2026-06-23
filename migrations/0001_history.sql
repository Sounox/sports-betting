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
