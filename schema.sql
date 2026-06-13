CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todo_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  todo_id INTEGER,
  todo_title TEXT,
  todo_completed INTEGER,
  payload TEXT NOT NULL,
  occurred_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_todo_analytics_events_time
  ON todo_analytics_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_todo_analytics_events_type_time
  ON todo_analytics_events (event_type, occurred_at DESC, id DESC);
