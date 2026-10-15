-- WS07 production admin persistence for WS08. Forward-only; do not edit 0001..0003.
BEGIN;

-- Skill allocation is persisted separately from live HP/MP resource values. The game/runtime
-- remains the authority for online mutation; this table is only a durable shared state surface.
CREATE TABLE oldko.character_skills (
  character_id bigint PRIMARY KEY REFERENCES oldko.characters(id) ON DELETE CASCADE,
  skills jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(skills) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Admin principals are deliberately not player-account clones. They are separate privileged
-- identities and are never inferred from a display label such as ROOT OWNER.
CREATE TABLE oldko.admin_actors (
  id varchar(128) PRIMARY KEY,
  username varchar(64) NOT NULL,
  username_key varchar(64) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK (username = btrim(username)),
  CHECK (username_key = lower(username))
);

CREATE TABLE oldko.admin_sessions (
  id uuid PRIMARY KEY,
  actor_id varchar(128) NOT NULL REFERENCES oldko.admin_actors(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  source_ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_active_idx
  ON oldko.admin_sessions(actor_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE oldko.audit_log
  ADD COLUMN actor_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL;
CREATE INDEX audit_log_admin_actor_idx
  ON oldko.audit_log(actor_admin_id, created_at DESC) WHERE actor_admin_id IS NOT NULL;

-- Admin sanction provenance/idempotency stays separate from player created_by FKs.
ALTER TABLE oldko.bans
  ADD COLUMN request_id varchar(128),
  ADD COLUMN created_by_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX bans_admin_request_uq
  ON oldko.bans(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE oldko.ip_bans
  ADD COLUMN request_id varchar(128),
  ADD COLUMN created_by_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ip_bans_admin_request_uq
  ON oldko.ip_bans(request_id) WHERE request_id IS NOT NULL;

-- Item moderation is metadata-only. It does not blind-move or delete a live game item.
CREATE TABLE oldko.admin_item_flags (
  item_instance_id bigint PRIMARY KEY REFERENCES oldko.item_instances(id) ON DELETE CASCADE,
  state varchar(16) NOT NULL CHECK (state IN ('flagged','quarantined')),
  note text,
  actor_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL,
  actor_label varchar(128) NOT NULL,
  trace_id varchar(128),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oldko.item_serial_events (
  id bigserial PRIMARY KEY,
  item_instance_id bigint REFERENCES oldko.item_instances(id) ON DELETE SET NULL,
  serial bigint NOT NULL CHECK (serial > 0),
  action varchar(64) NOT NULL,
  actor_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL,
  actor_label varchar(128),
  trace_id varchar(128),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_serial_events_serial_idx ON oldko.item_serial_events(serial, created_at DESC);
CREATE TRIGGER item_serial_events_no_update
  BEFORE UPDATE OR DELETE ON oldko.item_serial_events
  FOR EACH ROW EXECUTE FUNCTION oldko.audit_log_immutable();

-- Durable handoff to the game-server command bridge. The browser never executes these rows.
CREATE TABLE oldko.admin_command_outbox (
  id uuid PRIMARY KEY,
  command varchar(64) NOT NULL,
  target text NOT NULL DEFAULT '',
  arg text NOT NULL DEFAULT '',
  requested_by varchar(128) NOT NULL,
  requested_by_admin_id varchar(128) REFERENCES oldko.admin_actors(id) ON DELETE SET NULL,
  trace_id varchar(128) NOT NULL UNIQUE,
  source varchar(80) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','succeeded','failed','cancelled')),
  expected_character_id bigint REFERENCES oldko.characters(id) ON DELETE SET NULL,
  expected_world_version bigint,
  expected_progression_version bigint,
  expected_item_version bigint,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by varchar(128),
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_world_version IS NULL OR expected_world_version > 0),
  CHECK (expected_progression_version IS NULL OR expected_progression_version > 0),
  CHECK (expected_item_version IS NULL OR expected_item_version >= 0)
);
CREATE INDEX admin_command_outbox_pending_idx
  ON oldko.admin_command_outbox(available_at, created_at)
  WHERE status IN ('pending','failed');

-- WS08 currently keeps Idempotency-Key in process memory. This durable receipt surface is the
-- production handoff needed for restart-safe idempotency once WS08 passes the key/hash through.
CREATE TABLE oldko.admin_operation_receipts (
  actor_id varchar(128) NOT NULL,
  idempotency_key_hash bytea NOT NULL,
  request_hash bytea NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','completed','failed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idempotency_key_hash)
);

COMMIT;
