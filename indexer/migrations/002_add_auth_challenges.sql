-- 002_add_auth_challenges.sql
--
-- Adds the auth_challenges table backing SEP-53 signed-message
-- authentication for listing mutations (see src/auth/*.ts). A row exists
-- only between "challenge issued" and "challenge consumed or expired" — it
-- is deleted on successful use, so no separate "used" flag is needed.
--
-- Safe to apply to an existing database: this only adds a new table and
-- index, it does not touch agreements/agreement_events/listings/sync_state.
--
-- Apply with (from the indexer/ directory):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_add_auth_challenges.sql
--
-- or, when Postgres runs in the docker-compose container:
--
--   docker exec -i kitcrate-db psql -U kitcrate -d kitcrate < migrations/002_add_auth_challenges.sql

BEGIN;

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  action TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at
  ON auth_challenges (expires_at);

COMMIT;
