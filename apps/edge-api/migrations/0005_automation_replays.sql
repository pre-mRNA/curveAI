CREATE TABLE IF NOT EXISTS automation_request_replays (
  fingerprint TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS automation_request_replays_expires_at_idx
  ON automation_request_replays(expires_at ASC);
