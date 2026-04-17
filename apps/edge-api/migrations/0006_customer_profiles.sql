CREATE TABLE IF NOT EXISTS crm_customers (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  phone_number TEXT,
  normalized_phone TEXT,
  email TEXT,
  normalized_email TEXT,
  address TEXT,
  location_json TEXT,
  latest_summary TEXT,
  latest_call_summary TEXT,
  latest_call_at TEXT,
  last_job_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_contact_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(last_job_id) REFERENCES crm_jobs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_normalized_phone_idx
  ON crm_customers(normalized_phone);

CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_normalized_email_idx
  ON crm_customers(normalized_email);

CREATE INDEX IF NOT EXISTS crm_customers_last_contact_idx
  ON crm_customers(last_contact_at DESC);

INSERT OR IGNORE INTO crm_customers (
  id,
  display_name,
  phone_number,
  normalized_phone,
  email,
  normalized_email,
  address,
  location_json,
  latest_summary,
  latest_call_summary,
  latest_call_at,
  last_job_id,
  first_seen_at,
  last_seen_at,
  last_contact_at,
  created_at,
  updated_at
)
SELECT
  COALESCE(NULLIF(caller_id, ''), 'legacy_customer_' || id),
  caller_name,
  caller_phone,
  CASE
    WHEN caller_phone IS NULL OR TRIM(caller_phone) = '' THEN NULL
    ELSE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(caller_phone), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''))
  END,
  caller_email,
  CASE
    WHEN caller_email IS NULL OR TRIM(caller_email) = '' THEN NULL
    ELSE LOWER(TRIM(caller_email))
  END,
  address,
  location_json,
  summary,
  NULL,
  NULL,
  id,
  created_at,
  updated_at,
  updated_at,
  created_at,
  updated_at
FROM crm_jobs
WHERE caller_id IS NOT NULL OR caller_phone IS NOT NULL OR caller_email IS NOT NULL;
