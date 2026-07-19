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

CREATE TABLE IF NOT EXISTS catalog_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_snapshot_membership (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id),
  hardware_template_id TEXT NOT NULL REFERENCES hardware_catalog(id),
  PRIMARY KEY (snapshot_id, hardware_template_id)
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_snapshot_quote_membership (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id),
  quote_id TEXT NOT NULL REFERENCES price_quotes(id),
  PRIMARY KEY (snapshot_id, quote_id)
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_active_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id),
  activated_at TEXT NOT NULL
) STRICT;

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

CREATE TABLE IF NOT EXISTS calibration_runs (
  id TEXT PRIMARY KEY,
  hardware_template_id TEXT,
  run_json TEXT NOT NULL CHECK (json_valid(run_json)),
  completed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS calibration_runs_hardware_idx
  ON calibration_runs (hardware_template_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS calibration_sessions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','launching','running','completed','failed','expired')),
  session_json TEXT NOT NULL CHECK (json_valid(session_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS calibration_sessions_state_idx
  ON calibration_sessions (state, expires_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS public_benchmark_observations (
  id TEXT PRIMARY KEY,
  hardware_template_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
  observed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS public_benchmark_observations_lookup_idx
  ON public_benchmark_observations (hardware_template_id, stage, profile_id);

CREATE TABLE IF NOT EXISTS evidence_catalog_snapshots (
  catalog_version TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  generated_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hardware_components (
  id TEXT PRIMARY KEY,
  component_json TEXT NOT NULL CHECK (json_valid(component_json)),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS evidence_snapshot_observations (
  catalog_version TEXT NOT NULL REFERENCES evidence_catalog_snapshots(catalog_version),
  observation_id TEXT NOT NULL REFERENCES public_benchmark_observations(id),
  PRIMARY KEY (catalog_version, observation_id)
) STRICT;
CREATE TABLE IF NOT EXISTS evidence_snapshot_components (
  catalog_version TEXT NOT NULL REFERENCES evidence_catalog_snapshots(catalog_version),
  component_id TEXT NOT NULL REFERENCES hardware_components(id),
  PRIMARY KEY (catalog_version, component_id)
) STRICT;
CREATE TABLE IF NOT EXISTS evidence_active_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  catalog_version TEXT NOT NULL REFERENCES evidence_catalog_snapshots(catalog_version),
  activated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS catalog_update_runs (
  id TEXT PRIMARY KEY,
  update_type TEXT NOT NULL CHECK (update_type IN ('inventory_prices', 'evidence')),
  status TEXT NOT NULL CHECK (status IN ('checking', 'verified', 'applied', 'failed')),
  run_json TEXT NOT NULL CHECK (json_valid(run_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS hardware_predictions (
  id TEXT PRIMARY KEY,
  hardware_template_id TEXT NOT NULL,
  prediction_json TEXT NOT NULL CHECK (json_valid(prediction_json)),
  generated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS hardware_predictions_hardware_idx
  ON hardware_predictions (hardware_template_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_sources (
  id TEXT PRIMARY KEY,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  state TEXT NOT NULL CHECK (state IN ('active', 'degraded', 'unavailable', 'disabled')),
  last_run_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS source_fetch_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  run_json TEXT NOT NULL CHECK (json_valid(run_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS source_fetch_runs_source_idx
  ON source_fetch_runs (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
  content_hash TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS source_observations_source_idx
  ON source_observations (source_id, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS catalog_publications (
  sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
  publication_id TEXT NOT NULL UNIQUE,
  catalog_version TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL UNIQUE,
  previous_bundle_sha256 TEXT,
  key_id TEXT NOT NULL,
  publication_json TEXT NOT NULL CHECK (json_valid(publication_json)),
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  published_at TEXT NOT NULL,
  valid_until TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS catalog_bundle_active_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sequence INTEGER NOT NULL REFERENCES catalog_publications(sequence),
  etag TEXT,
  activated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS catalog_component_price_quotes (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES hardware_components(id),
  publication_sequence INTEGER NOT NULL REFERENCES catalog_publications(sequence),
  quote_json TEXT NOT NULL CHECK (json_valid(quote_json)),
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_component_price_quotes_active_idx
  ON catalog_component_price_quotes (publication_sequence, component_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS catalog_publication_component_membership (
  publication_sequence INTEGER NOT NULL REFERENCES catalog_publications(sequence),
  component_id TEXT NOT NULL REFERENCES hardware_components(id),
  PRIMARY KEY (publication_sequence, component_id)
) STRICT;

CREATE TABLE IF NOT EXISTS catalog_publication_benchmark_membership (
  publication_sequence INTEGER NOT NULL REFERENCES catalog_publications(sequence),
  observation_id TEXT NOT NULL REFERENCES public_benchmark_observations(id),
  PRIMARY KEY (publication_sequence, observation_id)
) STRICT;

PRAGMA user_version = 5;
