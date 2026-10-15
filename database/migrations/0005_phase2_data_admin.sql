-- P2-11 canonical persistence extensions. Forward-only and data-preserving.
-- The canonical migrator wraps this file in one transaction and records its checksum.

-- Fold the historical WS13 service-owned rate-limit table into the one authoritative migration stream.
CREATE TABLE IF NOT EXISTS oldko.account_rate_limits (
  bucket_hash char(64) PRIMARY KEY,
  count integer NOT NULL CHECK (count >= 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_rate_limits_reset_at_idx
  ON oldko.account_rate_limits(reset_at);

-- Generic quest persistence. Quest interpretation remains owned by the quest/gameplay workstream.
CREATE TABLE oldko.character_quests (
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE CASCADE,
  quest_key varchar(128) NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, quest_key),
  CHECK (quest_key = btrim(quest_key) AND length(quest_key) > 0)
);
CREATE INDEX character_quests_updated_idx ON oldko.character_quests(updated_at DESC);

-- Generic durable boss/event scheduler state. Spawn/combat rules remain with their owning services.
CREATE TABLE oldko.boss_runtime_state (
  authority varchar(96) NOT NULL,
  boss_key varchar(128) NOT NULL,
  zone_id integer,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  next_transition_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (authority, boss_key),
  CHECK (authority = btrim(authority) AND length(authority) > 0),
  CHECK (boss_key = btrim(boss_key) AND length(boss_key) > 0)
);
CREATE INDEX boss_runtime_state_transition_idx
  ON oldko.boss_runtime_state(next_transition_at) WHERE next_transition_at IS NOT NULL;

-- Dynamic non-secret runtime configuration. Secret material stays in WS35 secret references/environment.
CREATE TABLE oldko.runtime_config (
  key varchar(160) PRIMARY KEY,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  requires_restart boolean NOT NULL DEFAULT false,
  updated_by_admin_id varchar(128) NOT NULL REFERENCES oldko.admin_actors(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (key = btrim(key) AND length(key) > 0),
  CHECK (key !~* '(secret|password|passwd|token|private[_-]?key|credential|api[_-]?key)')
);

CREATE TABLE oldko.runtime_config_apply_receipts (
  config_key varchar(160) NOT NULL REFERENCES oldko.runtime_config(key) ON DELETE CASCADE,
  config_version bigint NOT NULL CHECK (config_version > 0),
  service varchar(128) NOT NULL,
  applied boolean NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (config_key, config_version, service)
);

-- Raw runtime heartbeat observations only. Rows never default a realm to online and never invent player counts.
CREATE TABLE oldko.server_runtime_heartbeats (
  source varchar(128) NOT NULL,
  realm_id varchar(96) NOT NULL,
  availability varchar(16) NOT NULL CHECK (availability IN ('online','offline','maintenance')),
  player_count integer CHECK (player_count IS NULL OR player_count >= 0),
  server_version varchar(128),
  target_patch varchar(32),
  status_message varchar(240),
  last_heartbeat timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, realm_id)
);
CREATE INDEX server_runtime_heartbeats_realm_idx
  ON oldko.server_runtime_heartbeats(realm_id, last_heartbeat DESC);

-- Read-model observations for admin v10. These are projections of owner-service facts, never gameplay authority.
CREATE TABLE oldko.runtime_content_observations (
  source varchar(128) NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('world','npc','mob','skill','economy')),
  entity_key varchar(192) NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  revision varchar(128),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (source, kind, entity_key)
);
CREATE INDEX runtime_content_observations_kind_idx
  ON oldko.runtime_content_observations(kind, observed_at DESC);

-- A command is runtime-confirmed only after a real authority reports an applied result.
-- The existing outbox remains the durable request queue; this table is the durable result-proof boundary.
CREATE TABLE oldko.admin_runtime_command_confirmations (
  command_id uuid PRIMARY KEY REFERENCES oldko.admin_command_outbox(id) ON DELETE CASCADE,
  source varchar(128) NOT NULL,
  runtime_result jsonb NOT NULL CHECK (jsonb_typeof(runtime_result) = 'object'),
  applied boolean NOT NULL CHECK (applied = true),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_runtime_command_confirmations_confirmed_idx
  ON oldko.admin_runtime_command_confirmations(confirmed_at DESC);

COMMENT ON TABLE oldko.runtime_content_observations IS
  'Admin projection only; authoritative world/NPC/mob/skill/economy rules remain in owner services.';
COMMENT ON TABLE oldko.admin_runtime_command_confirmations IS
  'Proof that a privileged command was applied by runtime authority; DB enqueue/update alone is not success.';
