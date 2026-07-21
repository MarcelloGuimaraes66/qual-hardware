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

-- v6 keeps the JSON evidence records for backward compatibility and adds a
-- normalized, queryable numerical layer. No existing table or row is replaced.
CREATE TABLE IF NOT EXISTS benchmark_suites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  license_policy TEXT,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS benchmark_profiles (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL REFERENCES benchmark_suites(id),
  stage TEXT NOT NULL,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS benchmark_profiles_stage_idx
  ON benchmark_profiles(stage, suite_id);

CREATE TABLE IF NOT EXISTS benchmark_systems (
  id TEXT PRIMARY KEY,
  hardware_template_id TEXT NOT NULL,
  operating_system TEXT NOT NULL,
  fingerprint_json TEXT NOT NULL CHECK (json_valid(fingerprint_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS benchmark_systems_hardware_idx
  ON benchmark_systems(hardware_template_id, operating_system);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL UNIQUE REFERENCES public_benchmark_observations(id),
  profile_id TEXT NOT NULL REFERENCES benchmark_profiles(id),
  system_id TEXT NOT NULL REFERENCES benchmark_systems(id),
  run_json TEXT NOT NULL CHECK (json_valid(run_json)),
  observed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS benchmark_runs_profile_idx
  ON benchmark_runs(profile_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id),
  metric_name TEXT NOT NULL,
  numeric_value REAL NOT NULL,
  unit TEXT NOT NULL,
  higher_is_better INTEGER NOT NULL CHECK (higher_is_better IN (0,1)),
  aggregation TEXT NOT NULL,
  UNIQUE(run_id, metric_name, aggregation)
) STRICT;
CREATE INDEX IF NOT EXISTS benchmark_metrics_lookup_idx
  ON benchmark_metrics(metric_name, unit, numeric_value);

CREATE TABLE IF NOT EXISTS benchmark_component_links (
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id),
  component_id TEXT NOT NULL,
  component_kind TEXT,
  PRIMARY KEY(run_id, component_id)
) STRICT;

CREATE TABLE IF NOT EXISTS benchmark_quality_assessments (
  run_id TEXT PRIMARY KEY REFERENCES benchmark_runs(id),
  source_tier INTEGER NOT NULL CHECK (source_tier BETWEEN 1 AND 3),
  reproducible INTEGER NOT NULL CHECK (reproducible IN (0,1)),
  assessment_json TEXT NOT NULL CHECK (json_valid(assessment_json)),
  assessed_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS capacity_model_versions (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  model_json TEXT NOT NULL CHECK (json_valid(model_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS capacity_prediction_stage_results (
  prediction_id TEXT NOT NULL REFERENCES hardware_predictions(id),
  stage TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  raw_camera_capacity REAL NOT NULL,
  safe_camera_capacity INTEGER NOT NULL,
  reserve_percent REAL NOT NULL,
  PRIMARY KEY(prediction_id, stage)
) STRICT;

CREATE TABLE IF NOT EXISTS capacity_prediction_validations (
  prediction_id TEXT PRIMARY KEY REFERENCES hardware_predictions(id),
  procurement_eligibility TEXT NOT NULL CHECK (procurement_eligibility IN ('eligible','planning_only','blocked')),
  unsafe_overestimate_count INTEGER NOT NULL CHECK (unsafe_overestimate_count >= 0),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  validated_at TEXT NOT NULL
) STRICT;

-- v7 adds an auditable component/BOM layer without changing or replacing the
-- v1-v6 JSON records. Historical rows remain the source for legacy reports.
CREATE TABLE IF NOT EXISTS component_identities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  canonical_mpn TEXT NOT NULL,
  market_state TEXT NOT NULL CHECK (market_state IN ('active','discontinued','reference_only')),
  inventory_state TEXT NOT NULL CHECK (inventory_state IN ('discovered_inventory','qualified_recommendation_universe')),
  component_json TEXT NOT NULL CHECK (json_valid(component_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(manufacturer, canonical_mpn, kind)
) STRICT;
CREATE INDEX IF NOT EXISTS component_identities_kind_idx
  ON component_identities(kind, inventory_state, market_state, manufacturer);

CREATE TABLE IF NOT EXISTS component_aliases (
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source_url TEXT,
  PRIMARY KEY(component_id, normalized_alias)
) STRICT;
CREATE INDEX IF NOT EXISTS component_aliases_normalized_idx
  ON component_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS component_specification_versions (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  specification_version TEXT NOT NULL,
  specification_json TEXT NOT NULL CHECK (json_valid(specification_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  raw_artifact_sha256 TEXT,
  observed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(component_id, specification_version, raw_artifact_sha256)
) STRICT;

CREATE TABLE IF NOT EXISTS component_compatibility_rules (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS component_compatibility_rules_component_idx
  ON component_compatibility_rules(component_id, rule_type);

CREATE TABLE IF NOT EXISTS benchmark_artifacts (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  source_url TEXT NOT NULL,
  content_type TEXT,
  license_policy TEXT NOT NULL,
  evidence_locator TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE IF NOT EXISTS benchmark_observation_component_coverage (
  observation_id TEXT NOT NULL REFERENCES public_benchmark_observations(id),
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  stage TEXT NOT NULL,
  eligibility TEXT NOT NULL CHECK (eligibility IN ('eligible','reference_only','rejected')),
  assessment_json TEXT NOT NULL CHECK (json_valid(assessment_json)),
  PRIMARY KEY(observation_id, component_id, stage)
) STRICT;
CREATE INDEX IF NOT EXISTS benchmark_component_coverage_idx
  ON benchmark_observation_component_coverage(component_id, stage, eligibility);

CREATE TABLE IF NOT EXISTS component_builds (
  id TEXT PRIMARY KEY,
  build_kind TEXT NOT NULL CHECK (build_kind IN ('oem_exact','custom_bom','historical_template')),
  hardware_template_id TEXT,
  operating_system TEXT NOT NULL,
  build_json TEXT NOT NULL CHECK (json_valid(build_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS component_build_items (
  build_id TEXT NOT NULL REFERENCES component_builds(id),
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  role TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  PRIMARY KEY(build_id, component_id, role)
) STRICT;

CREATE TABLE IF NOT EXISTS component_build_decisions (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES component_builds(id),
  compatible INTEGER NOT NULL CHECK (compatible IN (0,1)),
  decision_code TEXT NOT NULL,
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS evidence_coverage_reports (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('component','build','catalog','prediction')),
  subject_id TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  generated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS evidence_coverage_subject_idx
  ON evidence_coverage_reports(subject_type, subject_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS capacity_cross_validations (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  excluded_calibration_run_id TEXT NOT NULL,
  predicted_capacity INTEGER,
  measured_capacity INTEGER NOT NULL,
  overprediction_percent REAL NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  validated_at TEXT NOT NULL
) STRICT;

-- v8 preserves the v1-v7 JSON documents and adds field-level manufacturer
-- specifications plus auditable neutral procurement requirements.
CREATE TABLE IF NOT EXISTS technical_specification_field_definitions (
  component_kind TEXT NOT NULL,
  field_code TEXT NOT NULL,
  label_pt TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('string','number','boolean')),
  canonical_unit TEXT,
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  roles_json TEXT NOT NULL CHECK (json_valid(roles_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(component_kind, field_code)
) STRICT;

CREATE TABLE IF NOT EXISTS manufacturer_specification_artifacts (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_type TEXT,
  license_policy TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE IF NOT EXISTS component_technical_specification_versions (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  schema_version TEXT NOT NULL,
  specification_version TEXT NOT NULL,
  specification_json TEXT NOT NULL CHECK (json_valid(specification_json)),
  generated_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(component_id, schema_version, specification_version, generated_at)
) STRICT;
CREATE INDEX IF NOT EXISTS component_technical_specification_component_idx
  ON component_technical_specification_versions(component_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS component_technical_specification_values (
  specification_id TEXT NOT NULL REFERENCES component_technical_specification_versions(id),
  field_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published','not_published','not_applicable','ambiguous','conflicting','rejected')),
  value_type TEXT NOT NULL CHECK (value_type IN ('string','number','boolean')),
  text_value TEXT,
  numeric_value REAL,
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0,1)),
  unit TEXT,
  original_label TEXT,
  original_value_json TEXT NOT NULL CHECK (json_valid(original_value_json)),
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  confidence TEXT NOT NULL CHECK (confidence IN ('official','derived_legacy','unverified')),
  normalization_rule TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY(specification_id, field_code)
) STRICT;

CREATE TABLE IF NOT EXISTS component_specification_completeness (
  specification_id TEXT PRIMARY KEY REFERENCES component_technical_specification_versions(id),
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  required_field_count INTEGER NOT NULL CHECK (required_field_count >= 0),
  published_required_field_count INTEGER NOT NULL CHECK (published_required_field_count >= 0),
  completeness_percent REAL NOT NULL CHECK (completeness_percent BETWEEN 0 AND 100),
  procurement_ready INTEGER NOT NULL CHECK (procurement_ready IN (0,1)),
  completeness_json TEXT NOT NULL CHECK (json_valid(completeness_json)),
  assessed_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS component_specification_completeness_idx
  ON component_specification_completeness(procurement_ready, completeness_percent DESC, component_id);

CREATE TABLE IF NOT EXISTS procurement_specifications (
  id TEXT PRIMARY KEY,
  recommendation_alternative_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('apt','review_required','blocked')),
  procurement_eligibility TEXT NOT NULL CHECK (procurement_eligibility IN ('eligible','planning_only','blocked')),
  specification_json TEXT NOT NULL CHECK (json_valid(specification_json)),
  generated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS procurement_specifications_recommendation_idx
  ON procurement_specifications(recommendation_alternative_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS procurement_requirements (
  id TEXT PRIMARY KEY,
  specification_id TEXT NOT NULL REFERENCES procurement_specifications(id),
  component_kind TEXT NOT NULL,
  component_role TEXT NOT NULL,
  characteristic_code TEXT NOT NULL,
  comparator TEXT NOT NULL,
  requirement_json TEXT NOT NULL CHECK (json_valid(requirement_json))
) STRICT;
CREATE INDEX IF NOT EXISTS procurement_requirements_specification_idx
  ON procurement_requirements(specification_id, component_kind, component_role);

CREATE TABLE IF NOT EXISTS procurement_market_matches (
  specification_id TEXT NOT NULL REFERENCES procurement_specifications(id),
  component_id TEXT NOT NULL REFERENCES component_identities(id),
  manufacturer TEXT NOT NULL,
  assessment_status TEXT NOT NULL CHECK (assessment_status IN ('adequate','limited','restricted','no_coverage')),
  PRIMARY KEY(specification_id, component_id)
) STRICT;

PRAGMA user_version = 8;
