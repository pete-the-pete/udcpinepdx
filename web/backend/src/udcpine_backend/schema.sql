-- udcpine persistence schema. Applied idempotently at startup by db.py.

CREATE TABLE IF NOT EXISTS firing (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  status      TEXT NOT NULL CHECK (status IN ('active', 'ended'))
);

CREATE TABLE IF NOT EXISTS sample (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  firing_id   INTEGER NOT NULL REFERENCES firing(id),
  t           TEXT NOT NULL,
  temp_f      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS sample_firing_idx ON sample(firing_id);
