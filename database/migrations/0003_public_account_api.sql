BEGIN;

ALTER TABLE oldko.accounts
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_version integer NOT NULL DEFAULT 1 CHECK (password_version > 0);

-- Accounts created before public verification existed remain usable; new WS13 registrations insert NULL explicitly.
UPDATE oldko.accounts SET verified_at = created_at WHERE verified_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_live_uq
  ON oldko.accounts (lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE oldko.account_sessions
  ADD COLUMN IF NOT EXISTS password_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS oldko.account_action_tokens (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('password_reset','account_verification')),
  account_id bigint NOT NULL REFERENCES oldko.accounts(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (kind, token_hash),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS account_action_tokens_account_idx
  ON oldko.account_action_tokens(account_id, kind, expires_at);

COMMIT;
