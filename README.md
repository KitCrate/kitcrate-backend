# KitCrate Backend

Peer-to-peer marketplace backend for renting physical equipment (tools,
cameras, construction gear, event equipment). Renters and owners agree on a
rental period and a security deposit. The deposit is held in a non-custodial
[Soroban](https://developers.stellar.org/docs/build/smart-contracts/overview)
smart contract, not by either party or a platform. If no damage claim is
raised within a claim window after the rental ends, the deposit
auto-refunds. If a claim is raised, a designated arbiter resolves the split.

## Repository layout

```
kitcrate-backend/
├── contracts/
│   └── rental-escrow/          # The Soroban smart contract (Rust)
│       ├── src/
│       │   ├── lib.rs          # Contract declaration, module wiring
│       │   ├── types.rs        # DataKey, RentalAgreement, AgreementStatus
│       │   ├── storage.rs      # Instance and persistent storage helpers
│       │   ├── agreement.rs    # create, fund, start, release, cancel
│       │   ├── dispute.rs      # raise_claim, resolve_dispute
│       │   ├── events.rs       # Event emission helpers
│       │   └── error.rs        # RentalError contract errors
│       └── tests/              # Integration tests per major flow
├── indexer/                    # Event indexer + REST API (TypeScript)
│   ├── src/
│   │   ├── index.ts            # Entrypoint: API server + listener
│   │   ├── listener.ts         # Polls contract events via Soroban RPC
│   │   ├── db/schema.ts        # Postgres schema
│   │   ├── db/client.ts        # Connection pool
│   │   ├── api/agreements.ts   # Agreement REST endpoints
│   │   ├── api/listings.ts     # Listing CRUD endpoints
│   │   └── config.ts           # Environment configuration
│   ├── docker-compose.yml      # Local Postgres for development
│   └── package.json
├── Cargo.toml                  # Rust workspace root
├── Makefile
└── README.md
```

## Architecture

Two components, connected by on-chain events:

1. **Contract** (`contracts/rental-escrow`): a `no_std` Rust crate built with
   `soroban-sdk 27.0.5`. All state transitions emit events. The contract
   never holds more than the escrowed funds and every movement of tokens
   goes through the SEP-41 token contract's own `transfer` function.

2. **Indexer** (`indexer`): a Node.js/TypeScript service that polls the
   Soroban RPC `getEvents` endpoint on a short interval (RPC has no push
   mechanism), persists every event to Postgres idempotently, derives a
   current-state `agreements` table from the events, and exposes REST
   endpoints for the frontend. Listing metadata (titles, photos,
   descriptions, location) is off-chain only and lives entirely in
   Postgres, referenced on-chain by the opaque `item_ref` string.

## Contract specification

Contract name: `RentalEscrow`.

### Storage

- `instance` storage holds the small config values: `Admin`, `Arbiter`,
  `Token`, `NextId`.
- `persistent` storage holds one `RentalAgreement` per id. Every write
  explicitly calls `extend_ttl` (target: one year of ledgers), so an
  agreement can never expire mid-rental or during a claim window. Nothing
  uses `temporary` storage: nothing in this contract is safe to lose.

### Functions

| Function | Auth | Requires | Effect |
| --- | --- | --- | --- |
| `initialize(admin, arbiter, token)` | admin | not yet initialized | stores config, one-time setup |
| `create_agreement(owner, renter, item_ref, rental_amount, deposit_amount, start_time, end_time, claim_window_secs) -> u64` | owner | amounts > 0, end_time > start_time | stores agreement as `Created`, returns id |
| `fund_agreement(renter, id)` | renter | status `Created`, caller is the stored renter | transfers rental + deposit from renter to the contract, status `Funded` |
| `start_rental(owner, id)` | owner | status `Funded` | confirms handover, status `Active` |
| `raise_claim(owner, id, claim_amount, evidence_ref)` | owner | status `Active`, `now <= end_time + claim_window_secs`, claim <= deposit | status `Disputed` |
| `resolve_dispute(arbiter, id, amount_to_owner)` | arbiter | status `Disputed`, 0 <= amount_to_owner <= deposit | splits deposit and pays rental to owner, status `Resolved` |
| `release_funds(id)` | none (permissionless) | status `Active`, `now > end_time + claim_window_secs` | returns deposit to renter, rental to owner, status `Completed` |
| `cancel_agreement(caller, id)` | caller is owner or renter | status `Created` | status `Cancelled` |

Every state-changing function calls `require_auth()` on the address that
must approve the action, and then verifies that address against the stored
agreement before trusting it. Business-logic failures return
`Result<_, RentalError>`; panics are reserved for host-level conditions.

### Events

Every state transition emits an event with a short symbol topic and the
agreement id as the second topic element, so indexers can filter on
`(contract, topic[0])` and read the id from `topic[1]`.

| Topic | Data payload |
| --- | --- |
| `agreement_created` | full agreement as a named map (`id`, `owner`, `renter`, `item_ref`, `rental_amount`, `deposit_amount`, `start_time`, `end_time`, `claim_window_secs`, `status`, `created_at`) |
| `agreement_funded` | `[id, amount]` |
| `rental_started` | `id` |
| `claim_raised` | `[id, claim_amount, evidence_ref]` |
| `dispute_resolved` | `[id, amount_to_owner, amount_to_renter]` |
| `funds_released` | `id` |
| `agreement_cancelled` | `id` |

Two deliberate extensions to the base event table, both required so the
indexer can derive a usable current-state table from events alone:

1. `agreement_created` carries the full agreement (the minimal
   `id, owner, renter` payload would not include the amounts, times or
   item ref the indexer needs).
2. `claim_raised` appends `evidence_ref`, the opaque off-chain evidence
   pointer (IPFS hash or app URL), which would otherwise have no on-chain
   trace at all. It is never interpreted on-chain.

## Indexer

### Idempotency and rollbacks

- Every event is keyed by its Soroban RPC event id (TOID based). Inserts
  use `ON CONFLICT DO NOTHING`, and the state transition is applied only
  when the event row was actually new, inside the same transaction.
  Reprocessing the same event (restart, re-fetch at a ledger boundary) can
  never duplicate rows or double-apply a transition. The
  `(ledger_seq, event_index)` unique constraint is a second guard.
- A `sync_state` table stores the last processed ledger. On every poll the
  listener compares the checkpoint with the RPC tip. If the chain has
  rolled back behind the checkpoint (reorg), the indexer wipes both tables
  and rebuilds from `START_LEDGER`, so it can never silently drift out of
  sync. The full rebuild is intentional: with the dataset sizes this
  project targets, it is simpler and more correct than surgically
  patching rolled-back ledgers.

### REST API

- `GET /agreements/:id`
- `GET /agreements?owner=&renter=&status=`
- `GET /agreements/:id/events`
- `GET /listings?owner=`, `GET /listings/:id`
- `POST /listings`, `PUT /listings/:id`, `DELETE /listings/:id`
- `GET /health`

## Setup

Prerequisites: Rust (rustc >= 1.91), Node.js >= 20, Docker.

### Contract

```sh
make contract-build     # cargo build
make contract-test      # cargo test (the full integration suite)
make wasm               # build the deployable wasm (wasm32v1-none target)
```

Deploy to testnet with the Stellar CLI (build first, then):

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rental_escrow.wasm \
  --source <deployer-account> --network testnet
```

Then call `initialize` with the admin, arbiter and token addresses before
creating agreements.

### Indexer

```sh
make db-up               # start local Postgres (indexer/docker-compose.yml)
cd indexer
cp .env.example .env     # set CONTRACT_ID to the deployed contract id
npm install
npm run dev              # or: npm run build && npm start
```

The API listens on `PORT` (default 3000) and the listener polls
`RPC_URL` (default Soroban testnet) every `POLL_INTERVAL_MS`
(default 5000 ms). Set `START_LEDGER` to the ledger where the contract was
deployed (or slightly earlier); the RPC node only retains recent history.

## Known scope limits (deliberate, not bugs)

- Funded agreements cannot be cancelled in v1. There is no
  mutual-consent cancellation path; cancellation is allowed only while an
  agreement is `Created`.
- There is no partial refund mechanism other than the arbiter's
  `resolve_dispute` path.
- No multi-token support, token swaps, or interest/yield logic.
- Listing metadata is off-chain only, in Postgres. Nothing but the opaque
  `item_ref` string ever reaches the chain.

## Design notes

- All amounts are `i128` integers in the token's smallest unit. No
  floating-point math anywhere in the contract. The indexer stores them
  as exact `NUMERIC` values and decodes on-chain integers to decimal
  strings (they can exceed JavaScript's safe integer range).
- The escrow token is set once at `initialize` and all transfers use the
  token contract's own `transfer` function; funds never move by any other
  path.
- A failed token transfer aborts and reverts the whole transaction at the
  host level, which is the correct escrow behavior: no partial state
  changes.
