ALTER TABLE onboarding_staff_profiles ADD COLUMN created_at TEXT;

UPDATE onboarding_staff_profiles
SET created_at = COALESCE(created_at, updated_at)
WHERE created_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_auth_state (
  staff_id TEXT PRIMARY KEY,
  invite_token_hash TEXT,
  otp_code_hash TEXT,
  otp_issued_at TEXT,
  otp_failed_attempts INTEGER NOT NULL DEFAULT 0,
  otp_verified_at TEXT,
  auth_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES onboarding_staff_profiles(staff_id)
);

CREATE INDEX IF NOT EXISTS staff_auth_state_invite_token_hash_idx
  ON staff_auth_state(invite_token_hash);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES onboarding_staff_profiles(staff_id)
);

CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx
  ON staff_sessions(staff_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS staff_calendar_connections (
  staff_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_email TEXT,
  calendar_id TEXT,
  timezone TEXT,
  external_connection_id TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES onboarding_staff_profiles(staff_id)
);
