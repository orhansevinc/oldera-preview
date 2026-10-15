BEGIN;

CREATE TABLE IF NOT EXISTS oldko.account_rate_limits (
  bucket_hash char(64) PRIMARY KEY,
  count integer NOT NULL CHECK (count >= 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_rate_limits_reset_at_idx
  ON oldko.account_rate_limits(reset_at);

COMMIT;
