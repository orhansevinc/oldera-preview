-- WS45 service-owned production lease-store migration.
-- Apply after WS07 database/migrations/0002_persistence_hardening.sql when the shared
-- oldko schema is used. This file is intentionally outside the WS07 numbered ledger.

CREATE SCHEMA IF NOT EXISTS oldko;

CREATE TABLE IF NOT EXISTS oldko.session_leases (
  scope varchar(16) NOT NULL CHECK (scope IN ('account','character')),
  lease_key varchar(128) NOT NULL,
  session_id varchar(128) NOT NULL,
  server_id varchar(128) NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('active','grace')),
  account_id varchar(128) NOT NULL,
  character_id varchar(128),
  generation bigint NOT NULL CHECK (generation > 0),
  acquired_at bigint NOT NULL,
  heartbeat_at bigint NOT NULL,
  lease_until bigint NOT NULL,
  grace_until bigint,
  replaced_session_id varchar(128),
  version bigint NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, lease_key)
);

-- Explicit expiry alias for service/operations tooling. The canonical WS45 runtime field is
-- lease_until (epoch milliseconds), retained for exact compatibility with WS07 0002.
ALTER TABLE oldko.session_leases
  ADD COLUMN IF NOT EXISTS expires_at bigint GENERATED ALWAYS AS (lease_until) STORED;

CREATE INDEX IF NOT EXISTS session_leases_session_idx
  ON oldko.session_leases(session_id);
CREATE INDEX IF NOT EXISTS session_leases_expiry_idx
  ON oldko.session_leases(lease_until);
CREATE INDEX IF NOT EXISTS session_leases_account_idx
  ON oldko.session_leases(account_id, scope);
CREATE INDEX IF NOT EXISTS session_leases_character_idx
  ON oldko.session_leases(character_id)
  WHERE character_id IS NOT NULL;
