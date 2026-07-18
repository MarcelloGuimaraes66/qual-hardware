PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  scenario_json TEXT NOT NULL CHECK (json_valid(scenario_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  scenario_revision INTEGER NOT NULL,
  recommendation_json TEXT NOT NULL CHECK (json_valid(recommendation_json)),
  generated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS recommendations_scenario_idx
  ON recommendations (scenario_id, scenario_revision, generated_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_manifests (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  scenario_revision INTEGER NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS benchmark_results (
  manifest_id TEXT PRIMARY KEY REFERENCES benchmark_manifests(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  received_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hardware_catalog (
  id TEXT PRIMARY KEY,
  template_json TEXT NOT NULL CHECK (json_valid(template_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS price_quotes (
  id TEXT PRIMARY KEY,
  hardware_template_id TEXT NOT NULL REFERENCES hardware_catalog(id) ON DELETE CASCADE,
  quote_json TEXT NOT NULL CHECK (json_valid(quote_json)),
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS price_quotes_template_idx
  ON price_quotes (hardware_template_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS work_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  completed_at TEXT,
  error_text TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS work_queue_claim_idx
  ON work_queue (status, available_at, id);

PRAGMA user_version = 1;
