ALTER TABLE onboarding_staff_profiles ADD COLUMN phone_number TEXT;
ALTER TABLE onboarding_staff_profiles ADD COLUMN email TEXT;
ALTER TABLE onboarding_staff_profiles ADD COLUMN timezone TEXT;

CREATE TABLE IF NOT EXISTS crm_jobs (
  id TEXT PRIMARY KEY,
  staff_id TEXT,
  caller_id TEXT,
  caller_name TEXT,
  caller_phone TEXT,
  caller_email TEXT,
  address TEXT,
  location_json TEXT,
  issue TEXT,
  summary TEXT,
  status TEXT NOT NULL,
  quote_json TEXT,
  appointment_json TEXT,
  callback_json TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  calls_json TEXT NOT NULL DEFAULT '[]',
  proposed_next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS crm_jobs_staff_id_idx
  ON crm_jobs(staff_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  staff_id TEXT,
  variant TEXT NOT NULL,
  base_price REAL NOT NULL,
  strategy_adjustment REAL NOT NULL,
  experiment_adjustment REAL NOT NULL,
  presented_price REAL NOT NULL,
  floor_price REAL NOT NULL,
  ceiling_price REAL NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  rationale_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id)
);

CREATE INDEX IF NOT EXISTS crm_quotes_job_id_idx
  ON crm_quotes(job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS crm_appointments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  staff_id TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL,
  calendar_event_id TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id)
);

CREATE INDEX IF NOT EXISTS crm_appointments_job_id_idx
  ON crm_appointments(job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS crm_callbacks (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  staff_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  due_at TEXT,
  phone_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id)
);

CREATE INDEX IF NOT EXISTS crm_callbacks_staff_due_idx
  ON crm_callbacks(staff_id, due_at DESC);

CREATE TABLE IF NOT EXISTS crm_calls (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  staff_id TEXT,
  caller_phone TEXT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  transcript TEXT,
  summary TEXT,
  disposition TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id)
);

CREATE INDEX IF NOT EXISTS crm_calls_job_id_idx
  ON crm_calls(job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS crm_upload_requests (
  token TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  staff_id TEXT,
  caller_phone TEXT,
  notes TEXT,
  upload_link TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id)
);

CREATE INDEX IF NOT EXISTS crm_upload_requests_job_id_idx
  ON crm_upload_requests(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_photo_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  upload_token TEXT,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT,
  caption TEXT,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES crm_jobs(id),
  FOREIGN KEY(upload_token) REFERENCES crm_upload_requests(token)
);

CREATE INDEX IF NOT EXISTS crm_photo_assets_job_id_idx
  ON crm_photo_assets(job_id, uploaded_at ASC);

CREATE INDEX IF NOT EXISTS crm_photo_assets_upload_token_idx
  ON crm_photo_assets(upload_token, uploaded_at ASC);

CREATE TABLE IF NOT EXISTS dashboard_experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  variant TEXT NOT NULL,
  exposure TEXT NOT NULL,
  lift TEXT NOT NULL,
  sample_size INTEGER NOT NULL
);

INSERT OR IGNORE INTO dashboard_experiments (id, name, variant, exposure, lift, sample_size) VALUES
  ('exp_after_hours', 'After-hours urgency premium', 'dynamic-high', '34%', '+9% revenue', 148),
  ('exp_short_job', 'Short-job close-out discount', 'control', '48%', 'Baseline', 214),
  ('exp_photo_uplift', 'Customer-acquired photo uplift', 'dynamic-low', '18%', '+5% conversion', 93);
