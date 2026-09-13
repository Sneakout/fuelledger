-- Nerve control-plane database. This schema intentionally contains no application business records.
CREATE TABLE nerve_applications (
  application_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  environments jsonb NOT NULL,
  regions jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE nerve_application_credentials (
  key_id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  secret_hash text NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX nerve_credentials_lookup ON nerve_application_credentials(application_id, environment, revoked_at);
CREATE TABLE nerve_tenant_mappings (
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  application_tenant_id text NOT NULL,
  nerve_tenant_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  region text NOT NULL,
  enabled_agent_keys jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (application_id, application_tenant_id, environment),
  UNIQUE (nerve_tenant_id, environment)
);
CREATE TABLE nerve_jobs (
  job_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL,
  available_at timestamptz NOT NULL,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL
);
CREATE INDEX nerve_jobs_ready ON nerve_jobs(status, available_at);
CREATE TABLE nerve_meter_events (
  event_id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  kind text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity >= 0),
  dimensions jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX nerve_meter_tenant_time ON nerve_meter_events(application_id, tenant_id, occurred_at);
CREATE TABLE nerve_business_events (
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  event_id text NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  event_type text NOT NULL,
  stream_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  occurred_at timestamptz NOT NULL,
  subject jsonb NOT NULL,
  evidence jsonb NOT NULL,
  attributes jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('BUFFERED', 'RELEASED')),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (application_id, event_id),
  UNIQUE (application_id, environment, tenant_id, stream_id, sequence)
);
CREATE INDEX nerve_events_stream_order ON nerve_business_events(application_id, environment, tenant_id, stream_id, sequence);
CREATE TABLE nerve_schedules (
  schedule_id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  agent_key text NOT NULL,
  timezone text NOT NULL,
  cadence jsonb NOT NULL,
  quiet_periods jsonb NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE nerve_alerts (
  alert_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  agent_key text NOT NULL,
  deduplication_key text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  occurrence_count bigint NOT NULL,
  first_detected_at timestamptz NOT NULL,
  last_detected_at timestamptz NOT NULL,
  resolved_at timestamptz,
  UNIQUE (tenant_id, deduplication_key)
);
CREATE TABLE nerve_alert_deliveries (
  delivery_id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES nerve_alerts(alert_id),
  channel text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (alert_id, channel)
);
CREATE TABLE nerve_industry_packs (
  pack_id text NOT NULL,
  version text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (pack_id, version)
);
CREATE TABLE nerve_agent_configurations (
  configuration_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  pack_id text NOT NULL,
  pack_version text NOT NULL,
  configuration jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (configuration_id, version),
  UNIQUE (application_id, tenant_id, environment, version),
  FOREIGN KEY (pack_id, pack_version) REFERENCES nerve_industry_packs(pack_id, version)
);
CREATE TABLE nerve_plans (
  plan_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (plan_id, version)
);
CREATE TABLE nerve_tenant_subscriptions (
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  status text NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  PRIMARY KEY (application_id, tenant_id, environment),
  FOREIGN KEY (plan_id, plan_version) REFERENCES nerve_plans(plan_id, version)
);
CREATE TABLE nerve_data_processing_acceptances (
  acceptance_id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES nerve_applications(application_id),
  tenant_id uuid NOT NULL,
  terms_version text NOT NULL,
  accepted_by text NOT NULL,
  accepted_at timestamptz NOT NULL,
  region text NOT NULL
);
CREATE TABLE nerve_sdk_releases (
  package_name text NOT NULL,
  version text NOT NULL,
  contract_versions jsonb NOT NULL,
  status text NOT NULL,
  released_at timestamptz NOT NULL,
  support_ends_at timestamptz,
  PRIMARY KEY (package_name, version)
);

-- Runtime audit, findings, proposals, approvals, receipts, nonces, and idempotency
-- are separate append/transactional tables in production. They store only minimized
-- facts and evidence references, never replicated application tables.
