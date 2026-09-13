// Schema for the KitCrate indexer database.
//
// `agreement_events` is the append-only history of contract events. Its
// primary key is the Soroban RPC event id (TOID based), so reprocessing
// the same event is a no-op; the (ledger_seq, event_index) unique
// constraint is a second guard for the spec's idempotency requirement.
//
// `agreements` is the current-state table derived from events, one row
// per agreement, updated by each event in ledger order.
//
// Both tables carry `contract_id` (the CONTRACT_ID this indexer watches)
// so rows from different contract deployments never collide: the
// contract's agreement counter restarts at 1 on every redeploy, so the
// `agreements` primary key is the composite (contract_id, id).
//
// `listings` is app-side metadata only. It is referenced on-chain only
// through the opaque `item_ref` string; nothing here ever reaches the
// contract.
//
// `sync_state` stores the indexer checkpoint (last fully consumed
// ledger) used to resume polling after a restart.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agreements (
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

CREATE TABLE IF NOT EXISTS agreement_events (
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

CREATE INDEX IF NOT EXISTS idx_agreement_events_agreement
  ON agreement_events (contract_id, agreement_id, ledger_seq, event_index);
CREATE INDEX IF NOT EXISTS idx_agreement_events_ledger
  ON agreement_events (ledger_seq);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  photo_urls TEXT[] NOT NULL DEFAULT '{}',
  location TEXT NOT NULL,
  daily_rate NUMERIC NOT NULL,
  deposit NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_processed_ledger BIGINT NOT NULL,
  CHECK (id = 1)
);

-- One-shot SEP-53 signed-message challenges used to authenticate listing
-- mutations (POST/PUT/DELETE /listings). A row is deleted the moment it is
-- consumed (see auth/challenges.ts), so its presence alone means "issued,
-- unused, unexpired" — no separate "used" flag is needed. Bound to one
-- (address, action, listing_id) triple so a signed challenge can only ever
-- authorize the exact mutation it was issued for, never a different one.
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

-- Records every non-creation event that arrived for an agreement id with
-- no matching row in agreements (P1-3 in the Phase 1 audit: previously
-- this case updated zero rows and was silently discarded). The raw event
-- itself is never lost -- it is always in agreement_events first, since
-- this table is only written from within applyStateTransition, which
-- only runs after that insert succeeds -- this table exists purely to
-- make the resulting gap in the derived agreements table discoverable
-- (via GET /diagnostics/orphaned-events) instead of requiring someone to
-- notice a missing row and go looking through logs.
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
`;
