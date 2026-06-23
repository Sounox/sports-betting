ALTER TABLE value_bet_snapshots ADD COLUMN point REAL;

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
