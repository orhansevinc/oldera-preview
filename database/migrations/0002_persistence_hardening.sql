-- WS07 persistence hardening. Forward-only migration; see workstreams/ws07/MIGRATIONS.md.

ALTER TABLE oldko.accounts
  ADD COLUMN nation smallint NOT NULL DEFAULT 0 CHECK (nation IN (0,1,2)),
  ADD COLUMN inn_version bigint NOT NULL DEFAULT 0 CHECK (inn_version >= 0),
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE oldko.accounts
  ADD CONSTRAINT accounts_username_trimmed_ck CHECK (username = btrim(username));

ALTER TABLE oldko.characters
  ADD COLUMN lifecycle_state varchar(16) NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active','deleting','deleted')),
  ADD COLUMN item_version bigint NOT NULL DEFAULT 0 CHECK (item_version >= 0),
  ADD COLUMN world_version bigint NOT NULL DEFAULT 1 CHECK (world_version > 0),
  ADD COLUMN world_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(world_state) = 'object'),
  ADD COLUMN last_world_saved_at timestamptz,
  ADD COLUMN name_released_at timestamptz;

ALTER TABLE oldko.character_stats
  ADD COLUMN progression_version bigint NOT NULL DEFAULT 1 CHECK (progression_version > 0);

ALTER TABLE oldko.item_instances
  ALTER COLUMN durability DROP NOT NULL,
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

-- Tighten WS17 persistence capacity. Migration intentionally fails if legacy rows violate
-- the verified repository contract instead of silently re-numbering player items.
ALTER TABLE oldko.character_items DROP CONSTRAINT IF EXISTS character_items_slot_check;
ALTER TABLE oldko.character_items
  ADD CONSTRAINT character_items_slot_ck CHECK (slot BETWEEN 0 AND 13);

ALTER TABLE oldko.inventory DROP CONSTRAINT IF EXISTS inventory_slot_check;
ALTER TABLE oldko.inventory
  ADD CONSTRAINT inventory_slot_ck CHECK (slot BETWEEN 0 AND 27);

-- Inn storage uses an internal 28-slot page layout solely to persist WS17's flat 196-slot
-- repository state. This is a DB mapping, not a claim about a 1298 packet/page UI format.
ALTER TABLE oldko.inn_storage DROP CONSTRAINT IF EXISTS inn_storage_page_check;
ALTER TABLE oldko.inn_storage DROP CONSTRAINT IF EXISTS inn_storage_slot_check;
ALTER TABLE oldko.inn_storage
  ADD CONSTRAINT inn_storage_page_ck CHECK (page BETWEEN 0 AND 6),
  ADD CONSTRAINT inn_storage_slot_ck CHECK (slot BETWEEN 0 AND 27),
  ADD COLUMN flat_slot smallint GENERATED ALWAYS AS ((page * 28) + slot) STORED;
ALTER TABLE oldko.inn_storage
  ADD CONSTRAINT inn_storage_flat_slot_ck CHECK (flat_slot BETWEEN 0 AND 195);
CREATE UNIQUE INDEX inn_storage_account_flat_slot_uq ON oldko.inn_storage(account_id, flat_slot);

CREATE INDEX characters_account_live_idx
  ON oldko.characters(account_id, id) WHERE deleted_at IS NULL;
CREATE INDEX characters_zone_live_idx
  ON oldko.characters(zone_id, id) WHERE deleted_at IS NULL;

-- WS22 transaction persistence. Payload stays domain-shaped JSON; relational participant rows
-- provide authoritative active-trade exclusion and locking without moving business rules here.
CREATE TABLE oldko.economy_trades (
  id varchar(128) PRIMARY KEY,
  inviter_character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE RESTRICT,
  invitee_character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (inviter_character_id <> invitee_character_id)
);
CREATE INDEX economy_trades_status_updated_idx ON oldko.economy_trades(status, updated_at DESC);

CREATE TABLE oldko.economy_trade_participants (
  trade_id varchar(128) NOT NULL REFERENCES oldko.economy_trades(id) ON DELETE CASCADE,
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE RESTRICT,
  role varchar(16) NOT NULL CHECK (role IN ('inviter','invitee')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (trade_id, character_id),
  UNIQUE (trade_id, role)
);
CREATE UNIQUE INDEX economy_trade_one_active_per_character_uq
  ON oldko.economy_trade_participants(character_id) WHERE active;
CREATE INDEX economy_trade_participants_trade_idx
  ON oldko.economy_trade_participants(trade_id, active);

-- WS45 shared multi-process CAS lease store. lease_key is text because the ownership
-- service deliberately treats account/character identities as opaque strings.
CREATE TABLE oldko.session_leases (
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
CREATE INDEX session_leases_session_idx ON oldko.session_leases(session_id);
CREATE INDEX session_leases_expiry_idx ON oldko.session_leases(lease_until);

-- Cross-domain idempotency/transaction receipts. Consumers reserve an operation id inside
-- the same transaction as the mutation (loot pickup, economy command, etc.).
CREATE TABLE oldko.persistence_operations (
  operation_id varchar(128) PRIMARY KEY,
  kind varchar(64) NOT NULL,
  actor_account_id bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  character_id bigint REFERENCES oldko.characters(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);
CREATE INDEX persistence_operations_kind_created_idx
  ON oldko.persistence_operations(kind, created_at DESC);
CREATE INDEX persistence_operations_character_created_idx
  ON oldko.persistence_operations(character_id, created_at DESC) WHERE character_id IS NOT NULL;

-- Routine account removal is a lifecycle operation, not an unrestricted cascading DELETE.
-- A maintenance transaction must explicitly opt in after backup/audit prerequisites are met.
CREATE OR REPLACE FUNCTION oldko.guard_account_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('oldko.allow_hard_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'hard account delete is disabled; use lifecycle/soft-delete flow'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER accounts_guard_hard_delete
  BEFORE DELETE ON oldko.accounts
  FOR EACH ROW EXECUTE FUNCTION oldko.guard_account_hard_delete();
