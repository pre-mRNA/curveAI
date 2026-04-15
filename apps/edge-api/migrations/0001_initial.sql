CREATE TABLE IF NOT EXISTS onboarding_invites (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  staff_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  role TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  participant_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  consent_accepted INTEGER NOT NULL DEFAULT 0,
  clone_consent_accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  review_json TEXT NOT NULL,
  voice_session_json TEXT,
  calendar_json TEXT,
  voice_sample_json TEXT,
  finalized_at TEXT,
  FOREIGN KEY (invite_id) REFERENCES onboarding_invites(id)
);

CREATE INDEX IF NOT EXISTS onboarding_sessions_invite_id_idx
  ON onboarding_sessions(invite_id);

CREATE TABLE IF NOT EXISTS onboarding_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  question_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES onboarding_sessions(id)
);

CREATE INDEX IF NOT EXISTS onboarding_turns_session_id_idx
  ON onboarding_turns(session_id, created_at);

CREATE TABLE IF NOT EXISTS onboarding_staff_profiles (
  staff_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT,
  company_name TEXT,
  calendar_provider TEXT,
  communication_json TEXT,
  pricing_json TEXT,
  business_json TEXT,
  crm_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_voice_consents (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  consent INTEGER NOT NULL,
  signed_by TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_interviews (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  responses_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_tokens (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  session_id TEXT,
  job_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
