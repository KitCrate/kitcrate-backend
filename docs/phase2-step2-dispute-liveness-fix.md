# Phase 2, Step 2 — RentalEscrow `Disputed`-State Liveness Fix (P1)

Status: implemented, tested, live-verified on Testnet (the same
verification-only deployment convention as
`docs/phase2-step1-funded-liveness-fix.md`, not the production contract
address). Companion fix to that document's `Funded` liveness fix — the
Phase 1 audit recommended designing both together since they share a
root cause, and this step reuses the same mechanism shape deliberately.

## 1. Original P1

From the Phase 1 audit (`docs/phase1-full-audit.md`, §4/§18, finding
**P1-1**):

> `Disputed` is a dead end if the arbiter never acts. Structurally
> identical, one level deeper [than the Funded P0]: reaching `Disputed`
> requires the owner to actively raise a claim first (smaller blast
> radius), and a single trusted arbiter is a stated, honestly-disclosed
> part of the design — but that design has no fallback if the arbiter is
> unresponsive, key-compromised, or malicious by omission.

## 2. Root cause

Identical shape to the `Funded` P0: `resolve_dispute` was the only
function that read `AgreementStatus::Disputed` as a precondition, gated
to one specific address (the arbiter set once at `initialize`), with no
timeout and no fallback. Once `raise_claim` moved an agreement to
`Disputed`, the full escrowed amount (`rental_amount + deposit_amount`,
already sitting in the contract since `fund_agreement`) had no path out
if that one arbiter never called `resolve_dispute`.

## 3. Design decision

**Mechanism: permissionless after a fixed timeout, defaulting to the most
claim-skeptical outcome `resolve_dispute` could itself produce.**

- **Trigger:** anyone, once `DISPUTE_RESOLUTION_TIMEOUT_SECS` (14 days)
  has strictly elapsed since `raise_claim` (`disputed_at`, a new field
  set the same way `funded_at` was added for the `Funded` fix).
- **Economics:** the full deposit to the renter, the full rental fee to
  the owner — exactly what `resolve_dispute(arbiter, id,
  amount_to_owner: 0)` already produces today, and already covered by an
  existing test (`resolve_dispute_can_return_full_deposit_to_renter`).
  No new economic model was introduced; the fallback only forces a
  choice that was already a legitimate arbiter decision, in the single
  most defensible direction: an unadjudicated claim must not default to
  rewarding the party who raised it. The owner is not penalized beyond
  that — they still receive the rental fee, same as every other
  settlement path.
- **Status:** `Resolved` — the same terminal status `resolve_dispute`
  itself produces, not a new enum variant. Unlike the `Funded` fix (which
  needed a new `Expired` status because "refund the renter and pay the
  owner nothing at all, including no rental fee" was never reachable any
  other way), this fallback's outcome is already inside
  `resolve_dispute`'s own valid range (`0 <= amount_to_owner <=
  deposit_amount` explicitly permits `0`). Reusing `Resolved` needed no
  indexer change at all — a fact that still holds, though the original
  reasoning here (attributing it to a positional `STATUS_NAMES` decode)
  was later found to be wrong; see the correction in
  `docs/phase2-step1-funded-liveness-fix.md` §3.9 and the
  indexer-correctness fix from the final E2E pass. A distinct event
  (`dispute_auto_resolved`, see §7)
  keeps "the arbiter actually adjudicated this" observable and
  auditable apart from "nobody did, so it defaulted," without needing a
  new status to carry that distinction.
- **Does this make the arbiter omnipotent, or strip their power?**
  Neither, by construction: the arbiter's authority to call
  `resolve_dispute` is completely unchanged, at any time — including
  *after* the fallback timeout has technically elapsed, as long as
  nobody has actually called `resolve_expired_dispute` yet
  (`arbiter_can_still_resolve_normally_after_the_timeout_if_nobody_has_triggered_expiry`).
  The fallback only forecloses the arbiter's authority the instant it
  actually fires, and only because the agreement is `Resolved` by then —
  the same way a second `resolve_dispute` call already fails today. This
  is strictly a floor under abandonment, never a ceiling on legitimate
  adjudication.
- **Why 14 days, not 7 (the `Funded` fix's window)?** Confirming a
  handover (`start_rental`) is a one-click acknowledgment; adjudicating a
  damage claim from off-chain evidence is a real, possibly multi-step
  human process. An owner who raised a claim in good faith deserves a
  realistic window for that to actually happen before the system gives
  up on it. Still a fixed, compiled-in constant for the same reasons
  documented for `FUNDED_RECOVERY_TIMEOUT_SECS`.

## 4. State transition diagram

```
Active
  |
  |---- claim window passes, no claim raised
  |     release_funds (anyone) -----------------> Completed  [TERMINAL]
  |
  '---- raise_claim (owner), before the claim window closes
        v
     Disputed --------------------------------------------.
        |                                                   |
        |  resolve_dispute (arbiter)                        |  now > disputed_at + DISPUTE_RESOLUTION_TIMEOUT_SECS
        |  any 0 <= amount_to_owner <= deposit_amount        |  resolve_expired_dispute (anyone)
        v                                                    |  deposit_amount to renter, rental_amount to owner
     Resolved  [TERMINAL]  <-----------------------------------'
```

Both edges into `Resolved` are mutually exclusive in practice: whichever
transition actually executes first flips `status` away from `Disputed`,
so the other is guaranteed to fail with `InvalidStatus` afterward — the
same mutual-exclusion property `release_funds`/`raise_claim` already had
against each other, now proven for this pair too
(`once_auto_resolved_the_arbiter_can_no_longer_resolve_it`).

## 5. Authorization model

`resolve_expired_dispute(env: &Env, id: u64) -> Result<(), RentalError>`
takes no address parameter and calls no `require_auth()`, identical in
shape to `reclaim_funded_agreement` and `release_funds`. Two guards, both
independent of caller identity:

1. **Status guard:** only callable while `status == Disputed`; otherwise
   `InvalidStatus`.
2. **Time guard:** only callable once `now > disputed_at +
   DISPUTE_RESOLUTION_TIMEOUT_SECS`; otherwise
   `DisputeResolutionWindowActive` (new error code `14`).

Both transfer destinations are read from the stored agreement
(`agreement.renter`, `agreement.owner`) — no caller-supplied address
exists to redirect funds to. Verified both in unit tests
(`resolve_expired_dispute_is_permissionless_but_never_pays_the_caller`)
and live on Testnet (§7): calling from the renter's key and from the
arbiter's own key produced byte-identical rejections before the timeout.

## 6. Tests

15 new tests in
`contracts/rental-escrow/tests/test_dispute_recovery.rs`:

| Test | Proves |
| --- | --- |
| `disputed_agreement_is_not_permanently_stuck_after_timeout` | The headline fix. |
| `resolve_expired_dispute_rejected_immediately_after_claim` | No instant default merely because the arbiter hasn't acted yet. |
| `resolve_expired_dispute_rejected_exactly_at_deadline` / `_succeeds_one_second_after_deadline` | Strictly-after boundary, matching every other deadline in the contract. |
| `resolve_expired_dispute_rejects_non_disputed_agreement` | `Active` (never disputed) agreements have nothing to auto-resolve. |
| `resolve_expired_dispute_rejects_unknown_id` | Matches every other function's `NotFound` behavior. |
| `arbiter_can_still_resolve_normally_after_the_timeout_if_nobody_has_triggered_expiry` | The fallback never disables legitimate, late-but-real arbitration. |
| `once_auto_resolved_the_arbiter_can_no_longer_resolve_it` | Mutual exclusion; no double payment. |
| `resolve_expired_dispute_is_permissionless_but_never_pays_the_caller` | Correct fund destination regardless of caller. |
| `repeated_resolve_expired_dispute_attempts_fail_cleanly_after_the_first` | No double payment on repeated calls. |
| `resolve_expired_dispute_refunds_exact_amounts_no_more_no_less` | Exact amounts, non-round numbers. |
| `resolve_expired_dispute_emits_dispute_auto_resolved` | Event shape and data. |
| `normal_dispute_resolution_flow_is_unaffected_by_the_recovery_path` | Regression: `raise_claim` → `resolve_dispute`. |
| `normal_undisputed_release_flow_is_unaffected_by_the_recovery_path` | Regression: `release_funds`. |

Plus one required, non-weakening update to an existing test
(`test_agreement.rs`'s `agreement_created` event-payload literal gained
`disputed_at: 0`, the same kind of change `funded_at: 0` needed in the
prior step). Full suite: **80 tests, 0 failures** (up from the prior
step's 66; 51 → 66 → 80 across both liveness fixes).

### Tool gates

```
cargo fmt --check          # new/changed source files clean; pre-existing
                            # repo-wide drift unchanged from the prior step
cargo clippy --workspace --all-targets -- -D warnings   # clean
cargo test --workspace     # 80 passed, 0 failed
stellar contract build --package rental-escrow           # 10 exported functions
```

## 7. Live Testnet evidence

Same throwaway-identity convention as the prior step (`p2s1-admin` /
`p2s1-arbiter` / `p2s1-owner` / `p2s1-renter`, friendbot-funded, never
production keys), against a **new** contract instance built from this
step's wasm — not the production address.

- **New wasm deployed:** `CC5O3RFVPHL2MXMQFK374UBV6WX63FP7JAOF6YGCEQT6AFRI3EWO3OT2`
  (hash `be05abca01e913ae6ef04cf45426518703b0d7079cc53a4db22aa8f483e95b33`),
  10 exported functions confirmed via `stellar contract build`, including
  the new `resolve_expired_dispute`.
- **`create_agreement`** — the emitted event's data map confirms
  `disputed_at: 0` is present at creation, on a live ledger.
- **`fund_agreement`** / **`start_rental`** — both succeeded normally.
- **`raise_claim`** — succeeded, moving the agreement to `Disputed`.
- **`resolve_expired_dispute` immediately after the claim, called by the
  renter** — real, live rejection: `HostError: Error(Contract, #14)`
  (`DisputeResolutionWindowActive`).
- **The identical call, called by the arbiter's own key instead** — same
  `Error(Contract, #14)`, confirming the rejection is purely time-based,
  never identity-based, on a real host.
- **`resolve_dispute` (the normal arbiter path)** — succeeded normally
  once a required owner trustline to the test asset was established (a
  Stellar classic-asset prerequisite unrelated to this contract, not a
  bug in it): 200 to the owner, 300 to the renter, 1000 rental fee to
  the owner — confirming the ordinary dispute-resolution path is
  completely unaffected by this change on a live host.
- **`resolve_expired_dispute` once genuinely `Resolved`** — real, live
  rejection: `HostError: Error(Contract, #3)` (`InvalidStatus`).

**What was *not* live-verified, and why:** a real, successful
`resolve_expired_dispute` call after the full 14-day timeout has actually
elapsed — waiting two real weeks for one verification step in this task
is not practical, and per the task's own constraints, timestamp
advancement must never be faked. That exact behavior (the timeout
arithmetic, the boundary, the successful payout) is proven locally by
four dedicated unit tests instead
(`resolve_expired_dispute_rejected_exactly_at_deadline`,
`_succeeds_one_second_after_deadline`,
`disputed_agreement_is_not_permanently_stuck_after_timeout`,
`resolve_expired_dispute_refunds_exact_amounts_no_more_no_less`), using
the identical `checked_add` + strict-inequality structure already
live-verified for `release_funds`'s claim-window deadline and for
`reclaim_funded_agreement`'s recovery deadline in the prior step. This
one behavior is local-contract-proof only, not live-Testnet-proof, and
is called out explicitly rather than implied.

## 8. Deployment / version implications

Same situation as the `Funded` fix, and the two are now bundled into the
same wasm change: `RentalAgreement` gains a second new field
(`disputed_at`, alongside `funded_at`), and the exported function count
is now 10 (up from the pre-Phase-2 baseline of 8). This is still a single
breaking wasm change relative to the currently deployed production
contract (`CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`),
which remains untouched, unredeployed, and still carries both original
liveness gaps. Promoting either or both of this phase's fixes to
production is one combined redeployment decision, out of scope for this
step — see the prior document's §9 for the full reasoning (zero live
agreements today means no in-place migration is needed, but that is a
now-only condition, not a general precedent).

## 9. Remaining limitations

- **The dispute-resolution timeout is a fixed, compiled-in constant**
  (14 days), not negotiable per agreement — same deliberate v1 tradeoff
  as `FUNDED_RECOVERY_TIMEOUT_SECS`, for the same reason (a wrong value
  is a reviewable code change, not a runtime privilege).
- **The indexer does not yet distinguish `dispute_auto_resolved` from
  `dispute_resolved` in its derived state** — both already map to the
  same `Resolved` status string, so `indexer/src/listener.ts` needs no
  change for the derived `agreements` table to stay correct; a future
  improvement could add `dispute_auto_resolved` to `EVENT_STATUS` (it
  would still just set `status = 'Resolved'`, a no-op change) and
  surface the distinction from `agreement_events` instead, where it is
  already fully recoverable today from the topic name alone.
- **`docs/protocol-mechanics.md` and `docs/contract-reference.md`** still
  describe the pre-Phase-2 lifecycle and interface; left unmodified here,
  same as the prior step, pending a documentation pass once both fixes'
  production-deployment decision is made.
- **The live timeout-elapsed success path is local-proof only**, not
  live-Testnet-proof — see the explicit callout in §7.
