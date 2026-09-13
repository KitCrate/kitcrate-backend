-- 003_add_orphaned_events.sql
--
-- Adds the orphaned_events table backing the fix for P1-3 (silent state
-- loss on a missed agreement_created event) from the Phase 1 audit: an
-- UPDATE against a non-creation event that matches zero agreements rows
-- now records the gap here instead of being silently discarded (see
-- listener.ts's applyStateTransition and api/diagnostics.ts's
-- GET /diagnostics/orphaned-events).
--
-- Safe to apply to an existing database: this only adds a new table and
-- index, it does not touch any other table.
--
-- Apply with (from the indexer/ directory):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_add_orphaned_events.sql
--
-- or, when Postgres runs in the docker-compose container:
--
--   docker exec -i kitcrate-db psql -U kitcrate -d kitcrate < migrations/003_add_orphaned_events.sql

BEGIN;

CREATE TABLE IF NOT EXISTS orphaned_events (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  agreement_id BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  ledger_seq BIGINT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orphaned_events_agreement
  ON orphaned_events (contract_id, agreement_id);

COMMIT;
