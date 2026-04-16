ALTER TABLE staff_calendar_connections ADD COLUMN status TEXT NOT NULL DEFAULT 'connected';
ALTER TABLE staff_calendar_connections ADD COLUMN calendar_label TEXT;
ALTER TABLE staff_calendar_connections ADD COLUMN auth_state TEXT;
ALTER TABLE staff_calendar_connections ADD COLUMN access_token TEXT;
ALTER TABLE staff_calendar_connections ADD COLUMN refresh_token TEXT;
ALTER TABLE staff_calendar_connections ADD COLUMN token_expires_at TEXT;
ALTER TABLE staff_calendar_connections ADD COLUMN last_error TEXT;

UPDATE staff_calendar_connections
SET status = COALESCE(status, 'connected')
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS staff_calendar_connections_auth_state_idx
  ON staff_calendar_connections(auth_state);
