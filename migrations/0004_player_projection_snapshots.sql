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
