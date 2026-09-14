---
layout: page
title: Contract Reference
---

# Contract Reference

Reference for every public function and error code in the `RentalEscrow`
contract, pulled directly from `contracts/rental-escrow/src/agreement.rs`,
`contracts/rental-escrow/src/dispute.rs`, and
`contracts/rental-escrow/src/error.rs`.

**Deployed testnet contract:**
`CBV57X2CLKX2BHG2COGJNNOHU3ZY4A45L6SCZ32IZCKBS2LFEZ7CL4FR`

**This address now runs the source described below.** It was deployed
and initialized from this repo's current `main`, including
`reclaim_funded_agreement` and `resolve_expired_dispute` (added as a
liveness fix for two previously-confirmed issues, see
`docs/phase2-step1-funded-liveness-fix.md` and
`docs/phase2-step2-dispute-liveness-fix.md`). Its wasm hash and exported
interface were independently re-verified against a fresh build of that
exact source: all 10 functions below, not 8.

**Escrow token:** an SEP-41 token, set once at `initialize`. The
contract is token-agnostic; it accepts any SEP-41-compliant token
address. The currently documented Testnet deployment above was
initialized with **native XLM**, confirmed by reading the token address
from the contract's own instance storage. Every transfer in the
contract goes through that token's own `transfer` function.

Every function below takes an implicit `env: &Env` as its first Rust
parameter. That's the Soroban host environment, supplied automatically by
the runtime; it is never something a caller passes. The parameter lists
below start from the first argument a caller actually supplies.

## Functions

### `initialize`

```rust
pub fn initialize(
    admin: Address,
    arbiter: Address,
    token: Address,
) -> Result<(), RentalError>
```

- **Auth:** `admin`.
- **Real-world action:** one-time platform setup, before any agreement can
  be created. Stores the admin address, the dispute arbiter address, and the
  SEP-41 token contract used for every fund movement.
- **Returns:** nothing on success. Fails with `AlreadyInitialized` if called
  a second time.
- **Emits:** no event.

### `create_agreement`

```rust
pub fn create_agreement(
    owner: Address,
    renter: Address,
    item_ref: String,
    rental_amount: i128,
    deposit_amount: i128,
    start_time: u64,
    end_time: u64,
    claim_window_secs: u64,
) -> Result<u64, RentalError>
```

- **Auth:** `renter`.
- **Real-world action:** the renter initiating a booking against an
  owner's listing for a specific item over a specific period. `item_ref` is
  an opaque pointer to the app-side listing (for example a listing UUID);
  no listing metadata is stored on-chain. No funds move here.
- **Returns:** the new agreement's `u64` id.
- **Emits:** `agreement_created`, topics `(Symbol("agreement_created"),
  id)`, data is the full `RentalAgreement` struct (id, owner, renter,
  item_ref, rental_amount, deposit_amount, start_time, end_time,
  claim_window_secs, status, created_at).

### `fund_agreement`

```rust
pub fn fund_agreement(renter: Address, id: u64) -> Result<(), RentalError>
```

- **Auth:** `renter`, and the caller must match the agreement's stored
  renter.
- **Real-world action:** the renter paying the rental fee and locking the
  security deposit before handover. Transfers `rental_amount +
  deposit_amount` from the renter into the contract.
- **Returns:** nothing on success.
- **Emits:** `agreement_funded`, topics `(Symbol("agreement_funded"), id)`,
  data `(id, amount)` where `amount` is the combined rental fee plus
  deposit.

### `start_rental`

```rust
pub fn start_rental(owner: Address, id: u64) -> Result<(), RentalError>
```

- **Auth:** `owner`, and the caller must match the agreement's stored
  owner.
- **Real-world action:** the owner handing the item to the renter and
  confirming it in the app. Requires status `Funded`.
- **Returns:** nothing on success.
- **Emits:** `rental_started`, topics `(Symbol("rental_started"), id)`,
  data is the bare `id`.

### `reclaim_funded_agreement`

```rust
pub fn reclaim_funded_agreement(id: u64) -> Result<(), RentalError>
```

- **Auth:** none. Permissionless, like `release_funds`: any address may
  call this once the recovery window has passed. The payout destination
  is always the agreement's own stored `renter`, so no caller can
  redirect funds regardless of who calls it.
- **Real-world action:** recovering a `Funded` agreement whose owner
  never called `start_rental`. Requires status `Funded` and the current
  ledger time to be more than `FUNDED_RECOVERY_TIMEOUT_SECS` (7 days)
  past `funded_at`, the timestamp `fund_agreement` recorded. Refunds
  `rental_amount + deposit_amount` to the renter; the owner receives
  nothing, since no handover was ever confirmed.
- **Returns:** nothing on success.
- **Emits:** `funded_agreement_expired`, topics
  `(Symbol("funded_agreement_expired"), id)`, data `(id, amount)` where
  `amount` is the total refunded.

### `release_funds`

```rust
pub fn release_funds(id: u64) -> Result<(), RentalError>
```

- **Auth:** none. Permissionless: any address may call this once the claim
  window has passed with no claim raised.
- **Real-world action:** automatic settlement of a clean rental. Requires
  status `Active` and the current ledger time to be past `end_time +
  claim_window_secs`. Transfers the deposit to the renter and the rental
  fee to the owner.
- **Returns:** nothing on success.
- **Emits:** `funds_released`, topics `(Symbol("funds_released"), id)`,
  data is the bare `id`.

### `cancel_agreement`

```rust
pub fn cancel_agreement(caller: Address, id: u64) -> Result<(), RentalError>
```

- **Auth:** `caller`, who must be the agreement's stored owner or stored
  renter.
- **Real-world action:** either party backing out before any money moves.
  Requires status `Created`. Funded agreements cannot be cancelled through
  this function; there is no mutual-consent cancellation path once an
  agreement is funded.
- **Returns:** nothing on success.
- **Emits:** `agreement_cancelled`, topics `(Symbol("agreement_cancelled"),
  id)`, data is the bare `id`.

### `raise_claim`

```rust
pub fn raise_claim(
    owner: Address,
    id: u64,
    claim_amount: i128,
    evidence_ref: String,
) -> Result<(), RentalError>
```

- **Auth:** `owner`, and the caller must match the agreement's stored
  owner.
- **Real-world action:** the owner reporting damage after the item is
  returned. Requires status `Active`, `claim_amount` positive and not more
  than the escrowed deposit, and the current time at or before `end_time +
  claim_window_secs`. `evidence_ref` is an opaque off-chain pointer (for
  example an IPFS hash or an app URL); the contract never interprets it,
  it only carries it in the emitted event. Neither `claim_amount` nor
  `evidence_ref` is stored on the agreement itself, only in the event.
- **Returns:** nothing on success.
- **Emits:** `claim_raised`, topics `(Symbol("claim_raised"), id)`, data
  `(id, claim_amount, evidence_ref)`.

### `resolve_dispute`

```rust
pub fn resolve_dispute(
    arbiter: Address,
    id: u64,
    amount_to_owner: i128,
) -> Result<(), RentalError>
```

- **Auth:** the `arbiter` address stored at `initialize`. Contract
  addresses cannot act as arbiter.
- **Real-world action:** the platform arbiter adjudicating a damage claim
  after reviewing the off-chain evidence. Requires status `Disputed` and
  `0 <= amount_to_owner <= deposit_amount`. The contract does not check
  `amount_to_owner` against the `claim_amount` from `raise_claim`; the
  arbiter's award is an independent judgment call. Pays `amount_to_owner`
  to the owner from the deposit, the remainder
  (`deposit_amount - amount_to_owner`) to the renter, and the full
  `rental_amount` to the owner separately.
- **Returns:** nothing on success.
- **Emits:** `dispute_resolved`, topics `(Symbol("dispute_resolved"),
  id)`, data `(id, amount_to_owner, amount_to_renter)`.

### `resolve_expired_dispute`

```rust
pub fn resolve_expired_dispute(id: u64) -> Result<(), RentalError>
```

- **Auth:** none. Permissionless, same shape as
  `reclaim_funded_agreement`. `resolve_dispute` remains fully available
  to the arbiter at any time before this actually fires — even past the
  nominal deadline — so this never disables genuine, late-but-real
  arbitration, only true abandonment.
- **Real-world action:** recovering a `Disputed` agreement whose arbiter
  never called `resolve_dispute`. Requires status `Disputed` and the
  current ledger time to be more than `DISPUTE_RESOLUTION_TIMEOUT_SECS`
  (14 days) past `disputed_at`, the timestamp `raise_claim` recorded.
  Settles exactly as `resolve_dispute(arbiter, id, 0)` would: the full
  deposit to the renter, the full rental fee to the owner.
- **Returns:** nothing on success.
- **Emits:** `dispute_auto_resolved`, topics
  `(Symbol("dispute_auto_resolved"), id)`, data `(id, amount_to_owner,
  amount_to_renter)` with `amount_to_owner` always `0` — a distinct topic
  from `dispute_resolved` so the two settlement paths stay
  distinguishable in the event history even though both leave the
  agreement `Resolved`.

## Errors

Every fallible function returns `Result<_, RentalError>`. `RentalError` is
a `#[contracterror]` enum with `#[repr(u32)]`, from
`contracts/rental-escrow/src/error.rs`:

| Code | Name | What triggers it |
| --- | --- | --- |
| 1 | `NotFound` | The `id` passed to any function that reads an agreement (`fund_agreement`, `start_rental`, `release_funds`, `cancel_agreement`, `raise_claim`, `resolve_dispute`, `reclaim_funded_agreement`, `resolve_expired_dispute`) does not match a stored agreement. |
| 2 | `Unauthorized` | The caller signed correctly but is the wrong address for the action: not the stored renter (`fund_agreement`), not the stored owner (`start_rental`, `raise_claim`), not the arbiter (`resolve_dispute`), or neither the stored owner nor renter (`cancel_agreement`). |
| 3 | `InvalidStatus` | The agreement is not in the status the function requires: not `Created` (`fund_agreement`'s general case, `cancel_agreement`), not `Funded` (`start_rental`, `reclaim_funded_agreement`), not `Active` (`raise_claim`, `release_funds`), or not `Disputed` (`resolve_dispute`, `resolve_expired_dispute`). |
| 4 | `ClaimWindowExpired` | `raise_claim` called after `end_time + claim_window_secs` has already passed. |
| 5 | `ClaimWindowActive` | `release_funds` called while the current time is still at or before `end_time + claim_window_secs`. |
| 6 | `AlreadyFunded` | `fund_agreement` called on an agreement whose status is already `Funded`. |
| 7 | `InsufficientAmount` | The requested amount exceeds the escrowed deposit: `claim_amount > deposit_amount` in `raise_claim`, or `amount_to_owner > deposit_amount` in `resolve_dispute`. |
| 8 | `AlreadyInitialized` | `initialize` called a second time on the same contract instance. |
| 9 | `InvalidAmount` | A required amount is zero or negative where that's not allowed: `rental_amount <= 0` or `deposit_amount <= 0` in `create_agreement`, `claim_amount <= 0` in `raise_claim`, or `amount_to_owner < 0` in `resolve_dispute`. |
| 10 | `InvalidTimeRange` | `create_agreement` called with `end_time <= start_time`. |
| 11 | `Overflow` | An arithmetic operation would overflow: the next agreement id counter in `create_agreement`, the rental-plus-deposit sum in `fund_agreement`, the `end_time + claim_window_secs` deadline in `raise_claim` and `release_funds`, or the recovery deadline in `reclaim_funded_agreement` and `resolve_expired_dispute`. |
| 12 | `SameOwnerAndRenter` | `create_agreement` called with `owner == renter`. A party cannot rent to itself. |
| 13 | `RecoveryWindowActive` | `reclaim_funded_agreement` called while the current time is still at or before `funded_at + 7 days`. |
| 14 | `DisputeResolutionWindowActive` | `resolve_expired_dispute` called while the current time is still at or before `disputed_at + 14 days`. |

A `RentalError` value only ever comes back when a function's own business
logic rejects the call. A missing or invalid signature (the caller never
signed, or signed as the wrong key entirely) fails earlier, at the Soroban
host's `require_auth()` check, as a host-level authorization failure rather
than a `RentalError`. The two are distinguishable in transaction results:
a `RentalError` is a value the contract returned deliberately, a
`require_auth()` failure is a host panic before the contract's own logic
ever ran.
