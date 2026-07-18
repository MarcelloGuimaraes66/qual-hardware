DO $$
BEGIN
  IF current_database() <> 'qual_hardware' THEN
    RAISE EXCEPTION 'Qual Hardware schema can only be installed in the dedicated qual_hardware database (current: %)', current_database();
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS qual_hardware;

CREATE TABLE IF NOT EXISTS qual_hardware.scenarios (
  id uuid PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  scenario_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qual_hardware.recommendations (
  id uuid PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES qual_hardware.scenarios(id) ON DELETE CASCADE,
  scenario_revision integer NOT NULL,
  recommendation_json jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendations_scenario_idx
  ON qual_hardware.recommendations (scenario_id, scenario_revision, generated_at DESC);

CREATE TABLE IF NOT EXISTS qual_hardware.benchmark_manifests (
  id uuid PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES qual_hardware.scenarios(id) ON DELETE CASCADE,
  scenario_revision integer NOT NULL,
  manifest_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qual_hardware.benchmark_results (
  manifest_id uuid PRIMARY KEY REFERENCES qual_hardware.benchmark_manifests(id) ON DELETE CASCADE,
  result_json jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qual_hardware.hardware_catalog (
  id text PRIMARY KEY,
  template_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qual_hardware.price_quotes (
  id uuid PRIMARY KEY,
  hardware_template_id text NOT NULL,
  quote_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS price_quotes_template_idx
  ON qual_hardware.price_quotes (hardware_template_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS qual_hardware.work_queue (
  id bigserial PRIMARY KEY,
  job_type text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_text text
);
CREATE INDEX IF NOT EXISTS work_queue_claim_idx
  ON qual_hardware.work_queue (status, available_at, id);
