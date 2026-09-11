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

An agreement has one of seven statuses, defined in
`contracts/rental-escrow/src/types.rs`: `Created`, `Funded`, `Active`,
`Disputed`, `Resolved`, `Completed`, `Cancelled`.

```
Created
  |
  |  create_agreement (renter)
  v
Funded ----------------------------> Cancelled
  |                    cancel_agreement is only valid
  |  fund_agreement    from Created, not from Funded or later.
  |  (renter)
  v
Active
  |
  |---- claim window passes, no claim raised
  |     release_funds (anyone) --------------------> Completed
  |
  '---- raise_claim (owner), before the claim window closes
        v
     Disputed
        |
        |  resolve_dispute (arbiter)
        v
     Resolved
```

`Created` is the only status `cancel_agreement` accepts. Once an agreement is
`Funded`, the only ways out are the `Active` -> `Completed` path or the
`Active` -> `Disputed` -> `Resolved` path. There is no path back to an
earlier status, and no mutual-consent cancellation once money has moved.
That's a deliberate scope limit of the current contract, not a bug.

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

## Worked example: an 80.00 USDC rental, 20.00 USDC deposit

The numbers below come directly from the transfer calls in
`agreement.rs` and `dispute.rs`, not from an assumption. Amounts are shown
as decimal USDC for readability; on-chain the contract only ever moves
`i128` integers in the token's smallest unit, whatever that token's
`transfer` function accepts.

**Setup.** A renter books an item: `rental_amount` = 80.00 USDC,
`deposit_amount` = 20.00 USDC.

**1. `fund_agreement`.** The renter is charged the sum of both:

| From | To | Amount |
| --- | --- | --- |
| Renter | Contract | 80.00 + 20.00 = **100.00 USDC** |

The contract now holds 100.00 USDC. Status: `Funded`.

**2. `start_rental`.** No funds move. Status: `Active`.

### Path A: no claim, clean settlement

**3. `release_funds`,** called once the claim window has closed:

| From | To | Amount |
| --- | --- | --- |
| Contract | Renter | 20.00 USDC (the full deposit) |
| Contract | Owner | 80.00 USDC (the full rental fee) |

Contract balance after: 100.00 - 20.00 - 80.00 = **0.00 USDC**. Status:
`Completed`.

### Path B: a claim is raised, resolved 50/50 on the deposit

**3. `raise_claim`,** called by the owner while the rental is `Active` and
the claim window is still open. No funds move. Status: `Disputed`.

**4. `resolve_dispute`,** called by the arbiter with `amount_to_owner` set
to half the deposit: 10.00 USDC (`amount_to_renter` is computed by the
contract as `deposit_amount - amount_to_owner` = 20.00 - 10.00 = 10.00
USDC):

| From | To | Amount | Why |
| --- | --- | --- | --- |
| Contract | Owner | 10.00 USDC | half the deposit, per the arbiter's split |
| Contract | Renter | 10.00 USDC | the other half of the deposit |
| Contract | Owner | 80.00 USDC | the full rental fee, paid regardless of the dispute |

Contract balance after: 100.00 - 10.00 - 10.00 - 80.00 = **0.00 USDC**.
Status: `Resolved`. The owner ends up with 90.00 USDC total (10.00 from the
deposit split plus the 80.00 rental fee); the renter ends up with 10.00 USDC
back out of the 100.00 USDC originally paid in.

In both paths the contract's balance for that agreement always nets to
zero: every unit that goes in through `fund_agreement` comes back out
through exactly one of `release_funds` or `resolve_dispute`. The contract
never retains a balance for a completed or resolved agreement.
