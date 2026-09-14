---
layout: page
title: Protocol Mechanics
---

# Protocol Mechanics

This page covers the full lifecycle of a rental agreement in the
`RentalEscrow` contract: every status, the real function that causes each
transition, who is authorized to call it, and what actually moves on-chain.
Source: `contracts/rental-escrow/src/agreement.rs` and
`contracts/rental-escrow/src/dispute.rs`.

## The state machine

An agreement has one of eight statuses, defined in
`contracts/rental-escrow/src/types.rs`: `Created`, `Funded`, `Active`,
`Disputed`, `Resolved`, `Completed`, `Cancelled`, `Expired`.

```
Created
  |
  |  create_agreement (renter)
  v
Funded ----------------------------> Cancelled  [TERMINAL]
  |  \                 cancel_agreement is only valid
  |   \                from Created, not from Funded or later.
  |    \
  |     '-- now > funded_at + 7 days
  |         reclaim_funded_agreement (anyone) --> Expired  [TERMINAL]
  |         refunds rental_amount + deposit_amount to the renter
  |
  |  fund_agreement (renter)
  v
Active
  |
  |---- claim window passes, no claim raised
  |     release_funds (anyone) --------------------> Completed  [TERMINAL]
  |
  '---- raise_claim (owner), before the claim window closes
        v
     Disputed --------------------------------------------.
        |                                                   |
        |  resolve_dispute (arbiter)                        |  now > disputed_at + 14 days
        |  any 0 <= amount_to_owner <= deposit_amount        |  resolve_expired_dispute (anyone)
        v                                                    |  deposit_amount to renter, rental_amount to owner
     Resolved  [TERMINAL]  <-----------------------------------'
```

`Created` is the only status `cancel_agreement` accepts. Once an agreement is
`Funded`, the ways out are: `start_rental` into the `Active` -> `Completed`
or `Active` -> `Disputed` -> `Resolved` paths, or — if the owner never calls
`start_rental` at all — a timeout-based recovery into `Expired` (see below).
Once `Disputed`, a second timeout-based fallback reaches `Resolved` the same
way even if the arbiter never acts. There is no path back to an earlier
status, and no mutual-consent cancellation once money has moved. Both
liveness fallbacks are permissionless and time-gated, deliberately mirroring
`release_funds`'s own existing pattern, rather than an admin override — see
the two `docs/phase2-step*-liveness-fix.md` design documents for the full
reasoning.

### `Funded` -> `Expired`: if the owner never starts the rental

`reclaim_funded_agreement(id)`

- **Auth:** none — permissionless, like `release_funds`. No caller-supplied
  address exists to redirect funds to; the destination is always the
  agreement's own stored `renter`.
- **Requires:** status `Funded`, and the current time is more than seven
  days past `funded_at` (the ledger timestamp `fund_agreement` recorded).
- **On-chain effect:** refunds the full escrowed amount
  (`rental_amount + deposit_amount`) to the renter. The owner receives
  nothing — no handover was ever confirmed, so no rental period ever
  began. Status becomes `Expired`, a status distinct from `Cancelled`
  specifically because real funds moved here, unlike every `Cancelled`
  agreement.

### `Disputed` -> `Resolved` (fallback): if the arbiter never resolves

`resolve_expired_dispute(id)`

- **Auth:** none — permissionless, same shape as `reclaim_funded_agreement`.
- **Requires:** status `Disputed`, and the current time is more than
  fourteen days past `disputed_at` (the ledger timestamp `raise_claim`
  recorded).
- **On-chain effect:** settles exactly as `resolve_dispute(arbiter, id, 0)`
  would — the full deposit to the renter, the full rental fee to the
  owner — since `amount_to_owner = 0` is already one of `resolve_dispute`'s
  own valid outputs. An unadjudicated claim defaults to not rewarding the
  party who raised it. Status becomes `Resolved`, the same status a normal
  arbiter decision produces; a distinct `dispute_auto_resolved` event (as
  opposed to `dispute_resolved`) is what tells the two apart.
  `resolve_dispute` remains fully available to the arbiter at any time
  before this fallback actually fires, even past the nominal fourteen-day
  mark — the fallback only forecloses once it has actually run, it never
  disables genuine, late-but-real arbitration.

## Transitions

### `Created` (start)

`create_agreement(owner, renter, item_ref, rental_amount, deposit_amount, start_time, end_time, claim_window_secs) -> u64`

- **Auth:** `renter`. The renter initiates the booking, not the owner,
  because the renter is the one who will pay.
- **On-chain effect:** validates `owner != renter`, both amounts are
  positive, and `end_time > start_time`. Stores a new `RentalAgreement` with
  status `Created` and returns its id. No funds move here.

### `Created` -> `Funded`

`fund_agreement(renter, id)`

- **Auth:** `renter`, and the caller must match the agreement's stored
  renter.
- **On-chain effect:** transfers `rental_amount + deposit_amount` from the
  renter to the contract, through the escrow token's own `transfer`
  function. Status becomes `Funded`. Calling this twice on the same
  agreement fails; funding an agreement not in `Created` fails.

### `Funded` -> `Active`

`start_rental(owner, id)`

- **Auth:** `owner`, and the caller must match the agreement's stored owner.
- **On-chain effect:** requires status `Funded`. Sets status `Active`. No
  funds move; this only confirms handover happened.

### `Active` -> `Completed` (no dispute)

`release_funds(id)`

- **Auth:** none. This call is permissionless by design: anyone can trigger
  it once the claim window has passed, so settlement doesn't depend on any
  one party remembering to act.
- **Requires:** status `Active`, and the current time is past
  `end_time + claim_window_secs`.
- **On-chain effect:** transfers the full `deposit_amount` from the contract
  to the renter, and the full `rental_amount` from the contract to the
  owner. Status becomes `Completed`.

### `Active` -> `Disputed`

`raise_claim(owner, id, claim_amount, evidence_ref)`

- **Auth:** `owner`, and the caller must match the agreement's stored owner.
- **Requires:** status `Active`, `claim_amount > 0` and not more than the
  escrowed `deposit_amount`, and the current time is at or before
  `end_time + claim_window_secs` (the claim window is still open).
- **On-chain effect:** sets status `Disputed`. No funds move yet.
  `claim_amount` and `evidence_ref` (an off-chain pointer, for example an
  IPFS hash or an app URL) are only recorded in the `claim_raised` event,
  not in the stored agreement; the contract never interprets
  `evidence_ref`, it just carries it for the arbiter and the indexer.

### `Disputed` -> `Resolved`

`resolve_dispute(arbiter, id, amount_to_owner)`

- **Auth:** the `arbiter` address set once at `initialize`. Contract
  addresses cannot act as the arbiter.
- **Requires:** status `Disputed`, and `0 <= amount_to_owner <=
  deposit_amount`.
- **On-chain effect:** splits the deposit. `amount_to_owner` goes to the
  owner; the remainder (`deposit_amount - amount_to_owner`) goes to the
  renter. The full `rental_amount` also goes to the owner, separately from
  the deposit split, because the rental fee was earned regardless of the
  dispute's outcome. Status becomes `Resolved`. Note that the contract does
  not validate `amount_to_owner` against the `claim_amount` from
  `raise_claim`; that judgment is entirely the arbiter's, made off-chain
  after reviewing the evidence.

### `Created` -> `Cancelled`

`cancel_agreement(caller, id)`

- **Auth:** `caller` must be either the stored `owner` or the stored
  `renter`.
- **Requires:** status `Created`. Once funded, an agreement cannot be
  cancelled through this function; there is no path back out of `Funded`
  except through `Active`.
- **On-chain effect:** sets status `Cancelled`. No funds move, because none
  had been escrowed yet.

## Native XLM economics, as actually implemented

The contract's `initialize` function takes a `token: Address` parameter
and stores it once; every transfer in `agreement.rs` and `dispute.rs`
goes through that token's own SEP-41 `transfer` function. The contract
itself is token-agnostic; it will work with any SEP-41-compliant token.

That said, the currently documented Testnet contract
(`CBV57X2CLKX2BHG2COGJNNOHU3ZY4A45L6SCZ32IZCKBS2LFEZ7CL4FR`) was
initialized with **native XLM**, confirmed by reading the token address
from the contract's own instance storage and checking it against the
deterministic native-asset Stellar Asset Contract address for Testnet.
It is not a stablecoin. The worked example below uses XLM for this
reason, not because the contract requires it.

## Worked example: an 80.00 XLM rental, 20.00 XLM deposit

This is an illustrative example, not a specific on-chain agreement: the
80.00 / 20.00 / 50-50 figures below are example inputs, not amounts pulled
from a real funded or disputed agreement on the deployed contract. What is
real is the arithmetic itself. Every transfer shown is exactly what the
contract's code computes and moves; the transfer calls come directly from
`agreement.rs` and `dispute.rs`, not from an assumption about what they
do. Feed these same example inputs through `fund_agreement`,
`release_funds`, and `resolve_dispute` on any deployment of this contract
and you'll get exactly these numbers back. Amounts are shown as decimal
XLM for readability, matching the token actually used by the deployment
described above; on-chain the contract only ever moves `i128` integers
in the token's smallest unit, whatever that token's `transfer` function
accepts.

**Setup.** A renter books an item: `rental_amount` = 80.00 XLM,
`deposit_amount` = 20.00 XLM.

**1. `fund_agreement`.** The renter is charged the sum of both:

| From | To | Amount |
| --- | --- | --- |
| Renter | Contract | 80.00 + 20.00 = **100.00 XLM** |

The contract now holds 100.00 XLM. Status: `Funded`.

**2. `start_rental`.** No funds move. Status: `Active`.

### Path A: no claim, clean settlement

**3. `release_funds`,** called once the claim window has closed:

| From | To | Amount |
| --- | --- | --- |
| Contract | Renter | 20.00 XLM (the full deposit) |
| Contract | Owner | 80.00 XLM (the full rental fee) |

Contract balance after: 100.00 - 20.00 - 80.00 = **0.00 XLM**. Status:
`Completed`.

### Path B: a claim is raised, resolved 50/50 on the deposit

**3. `raise_claim`,** called by the owner while the rental is `Active` and
the claim window is still open. No funds move. Status: `Disputed`.

**4. `resolve_dispute`,** called by the arbiter with `amount_to_owner` set
to half the deposit: 10.00 XLM (`amount_to_renter` is computed by the
contract as `deposit_amount - amount_to_owner` = 20.00 - 10.00 = 10.00
XLM):

| From | To | Amount | Why |
| --- | --- | --- | --- |
| Contract | Owner | 10.00 XLM | half the deposit, per the arbiter's split |
| Contract | Renter | 10.00 XLM | the other half of the deposit |
| Contract | Owner | 80.00 XLM | the full rental fee, paid regardless of the dispute |

Contract balance after: 100.00 - 10.00 - 10.00 - 80.00 = **0.00 XLM**.
Status: `Resolved`. The owner ends up with 90.00 XLM total (10.00 from the
deposit split plus the 80.00 rental fee); the renter ends up with 10.00 XLM
back out of the 100.00 XLM originally paid in.

### Path C: the owner never starts the rental

**3. `reclaim_funded_agreement`,** called by anyone more than seven days
after `fund_agreement`, since `start_rental` never happened:

| From | To | Amount |
| --- | --- | --- |
| Contract | Renter | 80.00 + 20.00 = **100.00 XLM** (the full amount funded) |

Contract balance after: **0.00 XLM**. Status: `Expired`. The owner
receives nothing — no rental period ever began.

### Path D: a claim is raised, but the arbiter never resolves it

**3. `raise_claim`,** as in Path B. Status: `Disputed`.

**4. `resolve_expired_dispute`,** called by anyone more than fourteen days
after the claim was raised, since `resolve_dispute` never happened:

| From | To | Amount | Why |
| --- | --- | --- | --- |
| Contract | Renter | 20.00 XLM (the full deposit) | an unadjudicated claim defaults to no award |
| Contract | Owner | 80.00 XLM (the full rental fee) | earned regardless of the dispute's outcome, same as every other path |

Contract balance after: **0.00 XLM**. Status: `Resolved` (with a
`dispute_auto_resolved` event rather than `dispute_resolved`, so the
history still shows this wasn't an arbiter decision).

In every path the contract's balance for that agreement always nets to
zero: every unit that goes in through `fund_agreement` comes back out
through exactly one of `release_funds`, `resolve_dispute`,
`reclaim_funded_agreement`, or `resolve_expired_dispute`. The contract
never retains a balance for a completed, resolved, or expired agreement.
