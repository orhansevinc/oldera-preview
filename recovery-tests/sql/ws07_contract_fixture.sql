\set ON_ERROR_STOP on

CREATE TABLE public._oldko_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public._oldko_migrations(name, checksum)
VALUES ('0001_init.sql', repeat('a', 64));

CREATE SCHEMA oldko;

CREATE TABLE oldko.accounts (
  id bigserial PRIMARY KEY,
  username varchar(32) NOT NULL,
  username_key varchar(32) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (username_key = lower(username))
);

CREATE TABLE oldko.characters (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  name varchar(20) NOT NULL,
  name_key varchar(20) NOT NULL,
  deleted_at timestamptz,
  CHECK (name_key = lower(name))
);
CREATE UNIQUE INDEX characters_account_slot_live_uq ON oldko.characters(account_id, slot) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX characters_name_live_uq ON oldko.characters(name_key) WHERE deleted_at IS NULL;

CREATE TABLE oldko.item_instances (
  id bigserial PRIMARY KEY,
  serial bigint NOT NULL UNIQUE CHECK (serial > 0),
  item_template_id bigint NOT NULL,
  stack_count integer NOT NULL DEFAULT 1 CHECK (stack_count > 0)
);

CREATE TABLE oldko.character_items (
  id bigserial PRIMARY KEY,
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE CASCADE,
  slot smallint NOT NULL,
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  UNIQUE(character_id, slot)
);

CREATE TABLE oldko.inventory (
  id bigserial PRIMARY KEY,
  character_id bigint NOT NULL REFERENCES oldko.characters(id) ON DELETE CASCADE,
  slot smallint NOT NULL,
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  UNIQUE(character_id, slot)
);

CREATE TABLE oldko.inn_storage (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  page smallint NOT NULL,
  slot smallint NOT NULL,
  item_instance_id bigint NOT NULL UNIQUE REFERENCES oldko.item_instances(id) ON DELETE RESTRICT,
  UNIQUE(account_id, page, slot)
);

INSERT INTO oldko.accounts(id, username, username_key, password_hash) VALUES
  (1, 'fixture_one', 'fixture_one', 'not-a-real-password-hash'),
  (2, 'fixture_two', 'fixture_two', 'not-a-real-password-hash');
SELECT setval(pg_get_serial_sequence('oldko.accounts','id'), 2, true);

INSERT INTO oldko.characters(id, account_id, slot, name, name_key) VALUES
  (10, 1, 0, 'FixtureA', 'fixturea'),
  (11, 2, 0, 'FixtureB', 'fixtureb');
SELECT setval(pg_get_serial_sequence('oldko.characters','id'), 11, true);

INSERT INTO oldko.item_instances(id, serial, item_template_id, stack_count) VALUES
  (100, 900000000001, 120010001, 1),
  (101, 900000000002, 120010002, 5),
  (102, 900000000003, 120010003, 1);
SELECT setval(pg_get_serial_sequence('oldko.item_instances','id'), 102, true);

INSERT INTO oldko.character_items(character_id, slot, item_instance_id) VALUES (10, 0, 100);
INSERT INTO oldko.inventory(character_id, slot, item_instance_id) VALUES (10, 1, 101);
INSERT INTO oldko.inn_storage(account_id, page, slot, item_instance_id) VALUES (1, 0, 0, 102);
