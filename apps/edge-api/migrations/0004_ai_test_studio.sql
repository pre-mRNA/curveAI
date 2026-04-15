CREATE TABLE IF NOT EXISTS ai_test_cases (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  target TEXT NOT NULL,
  system_prompt TEXT,
  user_prompt TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  success_criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT
);

CREATE INDEX IF NOT EXISTS ai_test_cases_status_updated_idx
  ON ai_test_cases(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_test_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  status TEXT NOT NULL,
  operator_notes TEXT,
  prompt_snapshot_json TEXT NOT NULL,
  criteria_snapshot_json TEXT NOT NULL,
  runner_result_json TEXT,
  judge_result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(case_id) REFERENCES ai_test_cases(id)
);

CREATE INDEX IF NOT EXISTS ai_test_runs_case_started_idx
  ON ai_test_runs(case_id, started_at DESC);
