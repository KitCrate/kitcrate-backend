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
// `listings` is app-side metadata only. It is referenced on-chain only
// through the opaque `item_ref` string; nothing here ever reaches the
// contract.
//
// `sync_state` stores the indexer checkpoint (last fully consumed
// ledger) used to resume polling after a restart.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agreements (
  id BIGINT PRIMARY KEY,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreement_events (
  id TEXT PRIMARY KEY,
  ledger_seq BIGINT NOT NULL,
  event_index INT NOT NULL,
  agreement_id BIGINT NOT NULL,
  topic TEXT NOT NULL,
  data JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_seq, event_index)
);

CREATE INDEX IF NOT EXISTS idx_agreement_events_agreement
  ON agreement_events (agreement_id, ledger_seq, event_index);
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
`;
