-- 001_add_contract_id.sql
--
-- Make the agreements tables contract-aware.
--
-- The RentalEscrow contract's agreement counter restarts at 1 on every
-- redeploy, so a fresh deployment writing agreement 1 collided with
-- agreement 1 from a previous deployment still in the `agreements`
-- table (duplicate key on agreements_pkey). This migration adds a
-- `contract_id` column (the CONTRACT_ID the indexer watches) to both
-- tables and makes `agreements`' primary key the composite
-- (contract_id, id). `agreement_events` keeps its event-id primary key
-- (Soroban RPC event ids are globally unique) but is now scoped by
-- contract too, so `/agreements/:id/events` cannot mix events from
-- different deployments.
--
-- This is local testnet data with no real value, so the tables are
-- dropped and recreated rather than backfilled. The canonical schema for
-- fresh installs lives in src/db/schema.ts (applied by initDb on
-- startup); this migration only brings already-existing databases up to
-- the same shape. The checkpoint is reset so the listener re-indexes
-- from START_LEDGER instead of continuing from a checkpoint that refers
-- to events this migration just deleted.
--
-- Apply with (from the indexer/ directory):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_add_contract_id.sql
--
-- or, when Postgres runs in the docker-compose container:
--
--   docker exec -i kitcrate-db psql -U kitcrate -d kitcrate < migrations/001_add_contract_id.sql

BEGIN;

DROP TABLE IF EXISTS agreements;
CREATE TABLE agreements (
  contract_id TEXT NOT NULL,
  id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  renter TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  rental_amount NUMERIC NOT NULL,
  deposit_amount NUMERIC NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  claim_window_secs BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  created_ledger BIGINT NOT NULL,
  updated_ledger BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, id)
);

DROP TABLE IF EXISTS agreement_events;
CREATE TABLE agreement_events (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  ledger_seq BIGINT NOT NULL,
  event_index INT NOT NULL,
  agreement_id BIGINT NOT NULL,
  topic TEXT NOT NULL,
  data JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_seq, event_index)
);

CREATE INDEX idx_agreement_events_agreement
  ON agreement_events (contract_id, agreement_id, ledger_seq, event_index);
CREATE INDEX idx_agreement_events_ledger
  ON agreement_events (ledger_seq);

-- Reset the checkpoint: the events the old checkpoint referred to are
-- gone, so the listener must rebuild from START_LEDGER.
DROP TABLE IF EXISTS sync_state;
CREATE TABLE sync_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_processed_ledger BIGINT NOT NULL,
  CHECK (id = 1)
);

COMMIT;
