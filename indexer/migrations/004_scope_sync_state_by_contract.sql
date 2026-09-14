-- 004_scope_sync_state_by_contract.sql
--
-- Scopes sync_state by contract_id, matching the pattern already used by
-- agreements/agreement_events (see 001_add_contract_id.sql). Without this,
-- the single global checkpoint row silently resumes polling from whatever
-- contract was previously watched, ignoring a newly-set CONTRACT_ID and
-- START_LEDGER entirely -- readCheckpoint() only ever falls back to
-- START_LEDGER when no row exists at all, and one always did.
--
-- Dropped and recreated rather than backfilled, matching 001's own
-- precedent for this same table: the one existing row is a checkpoint for
-- whatever contract was previously configured, not real historical data
-- (the checkpoint value has no meaning once decoupled from the contract_id
-- it was tracking). Once this table is contract-id-keyed, a currently-set
-- CONTRACT_ID with no row yet naturally falls back to START_LEDGER on its
-- very next poll -- no row needs to be manually seeded.
--
-- Apply with (from the indexer/ directory):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_scope_sync_state_by_contract.sql
--
-- or, when Postgres runs in the docker-compose container:
--
--   docker exec -i kitcrate-db psql -U kitcrate -d kitcrate < migrations/004_scope_sync_state_by_contract.sql

BEGIN;

DROP TABLE IF EXISTS sync_state;
CREATE TABLE sync_state (
  contract_id TEXT PRIMARY KEY,
  last_processed_ledger BIGINT NOT NULL
);

COMMIT;
