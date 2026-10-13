CREATE SCHEMA IF NOT EXISTS oldko;

CREATE TABLE oldko.accounts (
  id bigserial PRIMARY KEY,
  username varchar(32) NOT NULL,
  username_key varchar(32) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email varchar(254),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','banned','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK (username_key = lower(username))
);

CREATE TABLE oldko.account_sessions (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  source_ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX account_sessions_active_idx ON oldko.account_sessions(account_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE oldko.characters (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  name varchar(20) NOT NULL,
  name_key varchar(20) NOT NULL,
  nation smallint NOT NULL CHECK (nation IN (1,2)),
  race smallint NOT NULL,
  class_id smallint NOT NULL,
  face smallint NOT NULL DEFAULT 0,
  hair smallint NOT NULL DEFAULT 0,
  zone_id smallint NOT NULL DEFAULT 21,
  pos_x real NOT NULL DEFAULT 0,
  pos_y real NOT NULL DEFAULT 0,
  pos_z real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (name_key = lower(name))
);
CREATE UNIQUE INDEX characters_account_slot_live_uq ON oldko.characters(account_id, slot) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX characters_name_live_uq ON oldko.characters(name_key) WHERE deleted_at IS NULL;

CREATE TABLE oldko.character_stats (
  character_id bigint PRIMARY KEY REFERENCES oldko.characters(id) ON DELETE CASCADE,
  level smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 83),
  experience bigint NOT NULL DEFAULT 0 CHECK (experience >= 0),
  hp integer NOT NULL DEFAULT 100 CHECK (hp >= 0),
  mp integer NOT NULL DEFAULT 100 CHECK (mp >= 0),
  str smallint NOT NULL DEFAULT 50 CHECK (str >= 0),
  sta smallint NOT NULL DEFAULT 50 CHECK (sta >= 0),
  dex smallint NOT NULL DEFAULT 50 CHECK (dex >= 0),
  intel smallint NOT NULL DEFAULT 50 CHECK (intel >= 0),
  cha smallint NOT NULL DEFAULT 50 CHECK (cha >= 0),
  stat_points smallint NOT NULL DEFAULT 0 CHECK (stat_points >= 0),
  skill_points smallint NOT NULL DEFAULT 0 CHECK (skill_points >= 0),
  loyalty integer NOT NULL DEFAULT 0,
  gold bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oldko.clans (
  id bigserial PRIMARY KEY,
  nation smallint NOT NULL CHECK (nation IN (1,2)),
  name varchar(32) NOT NULL,
  name_key varchar(32) NOT NULL UNIQUE,
  chief_character_id bigint REFERENCES oldko.characters(id) ON DELETE SET NULL,
  grade smallint NOT NULL DEFAULT 5,
  ranking_points bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name_key = lower(name))
);

CREATE TABLE oldko.clan_members (
  clan_id bigint NOT NULL REFERENCES oldko.clans(id) ON DELETE CASCADE,
  character_id bigint NOT NULL UNIQUE REFERENCES oldko.characters(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL DEFAULT 'member' CHECK (role IN ('chief','vicechief','officer','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, character_id)
);

CREATE TABLE oldko.item_instances (
  id bigserial PRIMARY KEY,
  serial bigint NOT NULL UNIQUE CHECK (serial > 0),
  item_template_id bigint NOT NULL,
  item_template_revision integer NOT NULL DEFAULT 1298,
  stack_count integer NOT NULL DEFAULT 1 CHECK (stack_count > 0),
  durability integer NOT NULL DEFAULT 0 CHECK (durability >= 0),
  flags integer NOT NULL DEFAULT 0,
  custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_instances_template_idx ON oldko.item_instances(item_template_id);

CREATE TABLE oldko.character_items (
  id bigserial PRIMARY KEY,
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 63),
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, slot)
);

CREATE TABLE oldko.inventory (
  id bigserial PRIMARY KEY,
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 63),
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, slot)
);

CREATE TABLE oldko.inn_storage (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  page smallint NOT NULL CHECK (page BETWEEN 0 AND 31),
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 63),
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, page, slot)
);

CREATE OR REPLACE FUNCTION oldko.prevent_duplicate_item_placement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_row_id bigint := NULL;
  locked_id bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN old_row_id := OLD.id; END IF;
  SELECT id INTO locked_id FROM oldko.item_instances WHERE id = NEW.item_instance_id FOR UPDATE;
  IF locked_id IS NULL THEN RAISE EXCEPTION 'item instance % does not exist', NEW.item_instance_id USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM oldko.character_items WHERE item_instance_id = NEW.item_instance_id AND NOT (TG_TABLE_NAME = 'character_items' AND id = old_row_id))
     OR EXISTS (SELECT 1 FROM oldko.inventory WHERE item_instance_id = NEW.item_instance_id AND NOT (TG_TABLE_NAME = 'inventory' AND id = old_row_id))
     OR EXISTS (SELECT 1 FROM oldko.inn_storage WHERE item_instance_id = NEW.item_instance_id AND NOT (TG_TABLE_NAME = 'inn_storage' AND id = old_row_id)) THEN
    RAISE EXCEPTION 'item instance % is already placed', NEW.item_instance_id USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER character_items_no_duplicate BEFORE INSERT OR UPDATE OF item_instance_id ON oldko.character_items FOR EACH ROW EXECUTE FUNCTION oldko.prevent_duplicate_item_placement();
CREATE TRIGGER inventory_no_duplicate BEFORE INSERT OR UPDATE OF item_instance_id ON oldko.inventory FOR EACH ROW EXECUTE FUNCTION oldko.prevent_duplicate_item_placement();
CREATE TRIGGER inn_storage_no_duplicate BEFORE INSERT OR UPDATE OF item_instance_id ON oldko.inn_storage FOR EACH ROW EXECUTE FUNCTION oldko.prevent_duplicate_item_placement();

CREATE TABLE oldko.bans (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_by bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  revoke_reason text,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX bans_active_account_idx ON oldko.bans(account_id) WHERE revoked_at IS NULL;

CREATE TABLE oldko.ip_bans (
  id bigserial PRIMARY KEY,
  network cidr NOT NULL,
  reason text NOT NULL,
  created_by bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  revoke_reason text,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX ip_bans_network_spgist_idx ON oldko.ip_bans USING spgist (network inet_ops) WHERE revoked_at IS NULL;

CREATE TABLE oldko.audit_log (
  id bigserial PRIMARY KEY,
  actor_account_id bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL,
  action varchar(96) NOT NULL,
  target_type varchar(48) NOT NULL,
  target_id text,
  request_id varchar(128),
  source_ip inet,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON oldko.audit_log(created_at DESC);
CREATE INDEX audit_log_target_idx ON oldko.audit_log(target_type, target_id, created_at DESC);

CREATE OR REPLACE FUNCTION oldko.audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON oldko.audit_log FOR EACH ROW EXECUTE FUNCTION oldko.audit_log_immutable();

CREATE TABLE oldko.server_state (
  key varchar(96) PRIMARY KEY,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES oldko.accounts(id) ON DELETE SET NULL
);
