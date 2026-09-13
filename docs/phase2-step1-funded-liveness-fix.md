# Phase 2, Step 1 — RentalEscrow `Funded`-State Liveness Fix (P0)

Status: implemented, tested, live-verified on a fresh Testnet deployment
(not yet deployed over the existing production contract address — see
[Deployment / version implications](#deployment--version-implications)).

## 1. Original P0

From the Phase 1 audit (`docs/phase1-full-audit.md`, §4/§18, finding
**P0-1**):

> A funded agreement has no exit if the owner never calls `start_rental`.
> The only exit is `start_rental`, owner-gated, with no timeout, and no
> admin override exists (the `Admin` role is inert). Concretely: a renter
> who funds an agreement has their rental fee and deposit permanently and
> unconditionally inaccessible if the owner simply never calls
> `start_rental` — through negligence, a lost key, a change of mind, or
> bad faith. No attack is required; ordinary inaction is sufficient.

## 2. Root cause

`start_rental` was the *only* function in the contract that read
`AgreementStatus::Funded` as a precondition (confirmed by exhaustive grep
before this change). There was no timeout, no alternate exit, and no
admin-triggered override — `DataKey::Admin` was written once at
`initialize` and never read anywhere else. Once `fund_agreement` moved
`rental_amount + deposit_amount` into the contract, the only way out of
`Funded` depended entirely on one specific private key voluntarily calling
one specific function, with no bound on how long that could take.

## 3. Design analysis

Answered before writing any code, per the task's design-first requirement.

**3.1 Why `Funded` could get permanently stuck.** Single exit
(`start_rental`), single authorized caller (the stored `owner`), no
timeout, no fallback. A lost owner key, an owner who changes their mind
after being paid, or plain forgetfulness are all "ordinary inaction," not
attacks, and all had the identical, permanent outcome.

**3.2 Which party should trigger recovery.** The renter is the only party
with funds at risk and the only party who has done everything the
contract asked. But the specific *caller* of the recovery function need
not be restricted to the renter — see 3.3.

**3.3 Recovery mechanism chosen: permissionless after a fixed timeout.**
This deliberately mirrors `release_funds`, the contract's own existing,
already-audited pattern for "settlement should not depend on any one
party remembering to click a button": no `require_auth()` at all, gated
purely by `now > funded_at + FUNDED_RECOVERY_TIMEOUT_SECS`, with the
payout destination hard-coded to the agreement's own stored `renter`.
Alternatives considered and rejected:
- **Renter-triggered only:** adds an auth check that changes nothing about
  safety (the renter is already the sole beneficiary) but reintroduces
  exactly the "depends on one party clicking a button" fragility the fix
  is meant to remove — a renter who is themselves briefly unavailable
  would gain nothing over the permissionless design and would lose the
  "anyone can settle it, including a bot or the frontend itself" property
  `release_funds` already relies on.
- **Owner-triggered:** would ask the non-acting party to be the one who
  admits fault; no reason to expect this to be more reliable than the
  timeout itself.
- **Admin override:** explicitly ruled out by the task brief. It would
  reintroduce exactly the centralized "someone can redirect escrowed
  funds by fiat" trust model the audit flagged as *absent* elsewhere in
  the contract (§3 of the audit: "no impersonation path was found
  anywhere"). Adding one here, for the one state where funds sit idle the
  longest, would be the worst possible place to introduce it.
- **Mutual consent:** requires exactly the cooperation that is already
  missing by definition (the owner isn't responding); adds no value over
  a timeout and complicates the state machine for no safety benefit.

**3.4 Rental fee and security deposit on recovery.** Both are refunded to
the renter in full (`rental_amount + deposit_amount`, i.e. exactly the
total `fund_agreement` moved in). No handover was ever confirmed, so no
rental period ever began.

**3.5 Owner compensation for the waiting period.** None. The rental fee
compensates for a rental period that, by the contract's own model, begins
at `start_rental`. If that never happens, no service was rendered and no
fee is earned — this is consistent with every other path through the
contract, where the fee is only ever paid out alongside a real `Active`
period (`release_funds`) or a real dispute resolution
(`resolve_dispute`).

**3.6 Griefing analysis.**
- The owner cannot grief the renter beyond the now-bounded timeout: after
  `FUNDED_RECOVERY_TIMEOUT_SECS`, inaction stops being able to lock funds.
- The renter cannot grief the owner by reclaiming early: the timeout is
  enforced unconditionally regardless of caller (see 3.3 and the "premature
  recovery" tests).
- A third party cannot grief either side: the destination is always the
  stored `renter`, never the caller, so calling this function costs the
  caller a transaction fee for no possible benefit to themselves — the
  same "no incentive, no harm" shape `release_funds` already has, and
  live-Testnet-verified in §7.

**3.7 Timestamp assumptions.** A new `funded_at: u64` field is set to
`env.ledger().timestamp()` inside `fund_agreement`, the same source used
for the existing `created_at` field. The recovery deadline is
`funded_at.checked_add(FUNDED_RECOVERY_TIMEOUT_SECS)`, using the same
`checked_add` + strictly-after (`now <= deadline` rejects,
`now > deadline` allows) convention `release_funds` already uses for its
own claim-window deadline. `funded_at` is anchored to the actual funding
moment, not to the agreement's negotiated `start_time`: a renter can fund
close to, or even after, `start_time`, and gating on `start_time` alone
would let recovery become available the instant funding completes —
directly violating the requirement that ordinary funding must never grant
an immediate refund.

**3.8 New state transition.** Exactly one:
`Funded --reclaim_funded_agreement(anyone, after timeout)--> Expired`.

**3.9 Compatibility with existing statuses.** All seven existing
transitions and their guards are unchanged; no existing function's
behavior, error, or event changed. One new terminal status, `Expired`, was
**appended** to the end of `AgreementStatus` rather than inserted.

> **Correction (made during the final integrated E2E pass, after live
> Testnet events were actually decoded end-to-end):** the reasoning
> written here at the time — that `indexer/src/listener.ts` decodes this
> enum by on-chain variant index via a positional `STATUS_NAMES` array,
> so inserting anywhere but the end would silently relabel already-indexed
> agreements — was **wrong**. Real event data confirms Soroban encodes a
> fieldless enum variant as a one-element vec holding the variant's own
> name as a Symbol (e.g. `["Created"]`), not a numeric index; the
> indexer's status decisions are name-based, not positional, and
> `STATUS_NAMES` turned out to be dead code that coincidentally never
> produced a wrong answer (see the indexer-correctness fix landed
> alongside this correction, and `contracts/rental-escrow/src/types.rs`'s
> now-corrected comment). Appending `Expired` at the end was therefore
> not technically required — but it was harmless, and is kept as a
> documentation convention, not reverted.

`Expired` was chosen instead of reusing `Cancelled` because `Cancelled`
is documented and tested as "no funds move" (it only occurs pre-funding);
overloading it to also mean "funds were refunded after funding" would
make that invariant false and would be a strictly worse, less honest
signal for anyone reading agreement history later. This reasoning is
independent of the indexer-encoding correction above and still holds.

**3.10 New event.** `funded_agreement_expired`, topics
`(Symbol("funded_agreement_expired"), id)`, data `(id, amount)` where
`amount` is the total refunded (`rental_amount + deposit_amount`) —
mirrors `agreement_funded`'s existing `(id, amount)` shape.

**3.11 New storage.** One new field on `RentalAgreement`
(`funded_at: u64`, `0` until funded) and one new compiled-in constant
(`storage::FUNDED_RECOVERY_TIMEOUT_SECS = 604_800`, seven days). No new
`DataKey` variants.

**3.12 Can existing deployed contracts be migrated in place?** No, and it
doesn't need to be for this contract: the live Testnet deployment
(`CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`) has **zero**
on-chain agreements (confirmed in the Phase 1 audit — `getEvents` over the
RPC's entire retained window returned zero events for this contract).
`RentalAgreement` is a `#[contracttype]` struct, encoded as a named map;
an old stored value with no `funded_at` key would fail to decode under
the new type. Since nothing is actually stored under the old shape on the
live deployment, there is no real migration to perform — but this must
not be treated as a general precedent: a future contract change made
*after* the contract has real user funds and agreements would need either
a versioned/optional field or an explicit migration function, neither of
which was necessary here.

**3.13 Is this a v1 change requiring a fresh deployment?** Yes. The wasm
hash changes, the exported function count changes (8 → 9), and the stored
struct shape changes. See [§8](#8-deployment--version-implications).

## 4. State transition diagram

```
Created
  |
  |  create_agreement (renter)
  v
Funded --------------------------------------> Cancelled  [TERMINAL]
  |  \                          cancel_agreement is only valid
  |   \                         from Created, never from Funded.
  |    \
  |     '-- now > funded_at + FUNDED_RECOVERY_TIMEOUT_SECS
  |         reclaim_funded_agreement (anyone) --> Expired  [TERMINAL]
  |         refunds rental_amount + deposit_amount to renter
  |
  |  start_rental (owner)
  v
Active
  |
  |---- claim window passes, no claim raised
  |     release_funds (anyone) -----------------> Completed  [TERMINAL]
  |
  '---- raise_claim (owner), before the claim window closes
        v
     Disputed
        |
        |  resolve_dispute (arbiter)
        v
     Resolved  [TERMINAL]
```

Five terminal states now exist: `Cancelled`, `Completed`, `Resolved`, and
the new `Expired`. `Disputed`'s own liveness gap (P1-1: the arbiter never
resolving) is **not** addressed by this change — see
[§9](#9-remaining-limitations).

## 5. Authorization model

`reclaim_funded_agreement(env: &Env, id: u64) -> Result<(), RentalError>`
takes **no address parameter and calls no `require_auth()`**, exactly
like `release_funds`. Safety does not come from restricting who can call
it; it comes from two independent guards that any caller is equally
subject to:

1. **Status guard:** only callable while `status == Funded`; every other
   status returns `InvalidStatus`, including a second call after the
   first succeeds (the agreement is `Expired` by then).
2. **Time guard:** only callable once
   `now > funded_at + FUNDED_RECOVERY_TIMEOUT_SECS`; otherwise
   `RecoveryWindowActive` (new error code `13`).

The payout destination is read from the stored agreement
(`agreement.renter`), never from a caller-supplied address — no caller,
regardless of identity, can redirect the refund anywhere else. This was
verified both in unit tests (`reclaim_is_permissionless_but_never_pays_the_caller`)
and live on Testnet (§7): calling from the renter's own key and from the
owner's key produced byte-identical results.

No existing `require_auth()` call anywhere else in the contract was
touched, added to, or weakened.

## 6. Economic behavior

Worked example matching the contract's own worked example in
`docs/protocol-mechanics.md` (`rental_amount` = 80.00 USDC,
`deposit_amount` = 20.00 USDC):

| Step | From | To | Amount |
| --- | --- | --- | --- |
| `fund_agreement` | Renter | Contract | 100.00 USDC (80 + 20) |
| *(owner never calls `start_rental`)* | | | |
| `reclaim_funded_agreement`, after 7 days | Contract | Renter | 100.00 USDC (80 + 20) |

Contract balance after: 100.00 − 100.00 = **0.00 USDC**. The owner
receives nothing (no service was rendered); the renter is made exactly
whole, no more and no less than what they escrowed. This nets to zero
identically to the two existing settlement paths (`release_funds`,
`resolve_dispute`), preserving the contract's existing invariant that a
completed or resolved (now: or expired) agreement never leaves a residual
balance behind.

## 7. Tests

15 new tests in `contracts/rental-escrow/tests/test_recovery.rs`, plus a
one-field update to an existing event-payload assertion in
`test_agreement.rs` (`funded_at: 0` added to the literal the
`agreement_created` event test compares against — required because the
struct gained a field; no assertion was weakened or removed).

| Test | Proves |
| --- | --- |
| `funded_agreement_is_not_permanently_stuck_after_timeout` | The headline fix: a funded agreement is recoverable once the timeout elapses. |
| `reclaim_rejected_immediately_after_funding` | No instant refund merely because the owner hasn't acted yet. |
| `reclaim_rejected_exactly_at_deadline` | Boundary is strictly-after, matching `release_funds`'s convention. |
| `reclaim_succeeds_one_second_after_deadline` | The other side of the same boundary. |
| `reclaim_rejects_unfunded_agreement` | `Created` agreements have nothing to recover (`InvalidStatus`). |
| `reclaim_rejects_active_agreement` | An owner who *did* act in time is unaffected; funds stay escrowed normally. |
| `reclaim_rejects_unknown_id` | Unknown ids behave like every other function (`NotFound`). |
| `reclaim_is_permissionless_but_never_pays_the_caller` | Correct-party authorization for a permissionless function means "money never goes to the caller," verified with an unrelated third-party caller. |
| `repeated_reclaim_attempts_fail_cleanly_after_the_first` | No double-payment; second and later attempts fail with `InvalidStatus`. |
| `reclaim_refunds_exactly_rental_plus_deposit_no_more_no_less` | Token amounts are exact, using non-round numbers (12,345 / 6,789) to rule out coincidental correctness. |
| `reclaim_funded_agreement_emits_funded_agreement_expired` | Event shape and data match the design. |
| `normal_funded_to_active_flow_is_unaffected_by_the_recovery_path` | Existing `Funded → Active` flow (§ regression). |
| `normal_active_to_completed_flow_is_unaffected_by_the_recovery_path` | Existing `Active → Completed` flow (§ regression). |
| `cancellation_before_funding_is_unaffected_by_the_recovery_path` | Existing `Created → Cancelled` flow (§ regression). |
| `dispute_flow_is_unaffected_by_the_recovery_path` | Existing `Active → Disputed → Resolved` flow (§ regression). |

All pre-existing tests (`test_agreement.rs`, `test_dispute.rs`,
`test_release.rs`) pass unchanged except the one required struct-literal
update above. Full suite: **66 tests, 0 failures** (up from the audit's
baseline of 51).

### Tool gates

```
cargo fmt --check          # see note below
cargo clippy --workspace --all-targets -- -D warnings   # clean (0 errors)
cargo test --workspace     # 66 passed, 0 failed
stellar contract build --package rental-escrow           # 9 exported functions
cargo build --target wasm32v1-none --release -p rental-escrow   # succeeds
```

**`cargo fmt --check` note:** this repository's checked-in formatting
already does not match the `rustfmt` version installed in this
environment, independent of this change — confirmed by running the same
check against an unmodified `origin/main` checkout, which fails
identically (import-group ordering in `tests/common/mod.rs`,
`tests/test_agreement.rs`, `tests/test_dispute.rs`, `tests/test_release.rs`,
and a few multi-line-call-chain reflows). This pre-dates this change and
is unrelated to it. Every file this change actually adds or edits was
individually verified `rustfmt`-clean against this environment's
toolchain; the only pre-existing drift left in the tree is in files this
change does not touch. Reformatting the whole repository to satisfy a
newer local `rustfmt` was deliberately out of scope for this fix (it
belongs with the CI/tooling hygiene phase in the audit's own sequencing,
not the P0 fix).

Two small, pre-existing `clippy -D warnings` failures were fixed
incidentally because they blocked this required gate and were trivial,
behavior-preserving, and unrelated to the fix itself (also confirmed
present on unmodified `origin/main`):
- `create_agreement`'s parameter count (`#[allow(clippy::too_many_arguments)]`
  added, since each parameter is an independently meaningful economic
  term and this is the contract's public ABI).
- A needless double-borrow in `fund_agreement`
  (`&env.current_contract_address()` → `env.current_contract_address()`).
- Two dead-code/lifetime lints in the shared test fixture
  (`tests/common/mod.rs`), which only surface because each integration
  test file compiles that shared module as its own crate, so a field or
  helper used by *some* test files looks unused from others.
  `#[allow(dead_code)]` and an explicit `<'_>` were added; no test
  behavior changed.

## 8. Live Testnet evidence

CI does not run `stellar contract build`/live network calls, so this was
run directly against Stellar Testnet from this environment, using four
newly generated, friendbot-funded, throwaway identities
(`p2s1-admin`/`p2s1-arbiter`/`p2s1-owner`/`p2s1-renter`) and a **new**
contract instance deployed from the updated wasm — **not** the production
address referenced in the README
(`CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`), which was
never touched.

- **New wasm deployed:** `CDIRC7B7I2LXW3S532AHMCIU46AA6KK53LOC64C3EPH2QB5UFBIRTYIV`
  (hash `2b00d8b5e64a5f58edf9f7f4bd3fcbd6eea3ceb6a91490c8b307f8ba263066c2`),
  interface confirmed via `stellar contract build` to export all 9
  functions including the new `reclaim_funded_agreement`.
- **Test SEP-41 token deployed:** `CBHLOJDBC6L7HMRLJ763B2Y4IKEP2QRAOTHVW3A4KJDLAHKSWBIOKNDR`
  (a fresh Stellar classic asset, `P2S1TOK`, wrapped by its own SAC).
- **`initialize`** — succeeded (tx `9fb6e6fe1f3a4d9c2c102e71c0ec824c2ea6ae99f96d95ea6596a8f34eec7a08`).
- **`create_agreement`** — succeeded (tx `c6b1dc3fb19cc857d80b69038013e873d0a911002308d1dddfc0285cbc3ccf5b`);
  the emitted `agreement_created` event's data map confirms the new
  `funded_at` field is present and `0` at creation, alongside every
  pre-existing field, on a live ledger — not just in the test harness.
- **`fund_agreement`** — succeeded (tx `33fefae2f8a1c12dbe6ee63c8ca8e5b602840a96a5535eb7677e85f8abe40f18`);
  token `transfer` event shows exactly 1500 (1000 + 500) moving
  renter → contract.
- **`reclaim_funded_agreement` immediately after funding, called by the
  renter** — real, live rejection: `HostError: Error(Contract, #13)`
  (`RecoveryWindowActive`), exactly as designed.
- **`reclaim_funded_agreement` immediately after funding, called by the
  owner instead** (a different signing identity, to test permissionless
  behavior against a live host, not just the test harness's mocked auth)
  — same `Error(Contract, #13)`, proving the rejection is purely
  time-based, never identity-based, on a real network.
- **`start_rental`** — succeeded normally (tx `7e5b98ce1c36758976fee5fb94819ba5e9746c2729a611a9369ce5a687ee7ad8`),
  confirming the ordinary happy path is unaffected by this change on a
  live host.
- **`reclaim_funded_agreement` once `Active`** — real, live rejection:
  `HostError: Error(Contract, #3)` (`InvalidStatus`), confirming the
  recovery path correctly closes once the owner has acted.
- **Balance check after the sequence above:** contract holds exactly
  `1500`, renter holds `0`, matching the expected mid-lifecycle state
  exactly (funds still escrowed, nothing lost or misdirected).

**What was *not* live-verified, and why:** a real, successful
`reclaim_funded_agreement` call *after* the 7-day timeout has actually
elapsed. Waiting seven real days for a single verification step in this
task is not practical, and the task's own instructions explicitly forbid
faking timestamp advancement (which is exactly what the unit tests do
instead, deterministically, via `env.ledger().set_timestamp(...)`). The
timeout arithmetic itself (`checked_add`, strict inequality, boundary at
exactly the deadline) is otherwise identical in structure to
`release_funds`'s already-live-tested claim-window deadline, and is
covered by four dedicated unit tests
(`reclaim_rejected_exactly_at_deadline`,
`reclaim_succeeds_one_second_after_deadline`, plus the two whole-window
tests). **This one behavior is local-contract-proof only, not
live-Testnet-proof**, and is called out here explicitly rather than
implied to have been demonstrated live.

## 9. Deployment / version implications

This is a **breaking wasm change**: the exported function count changes
(8 → 9) and `RentalAgreement`'s stored shape changes (`funded_at` added).
Per the task brief, this must be treated as a **new contract version**,
not an in-place upgrade of the existing deployed instance:

- The existing production Testnet contract
  (`CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`, referenced
  in `README.md` and `docs/contract-reference.md`) was **not**
  redeployed, upgraded, or otherwise touched by this work. It still runs
  the pre-fix wasm and still has the P0 liveness gap.
- Promoting this fix to that address (or any future production address)
  is a separate, deliberate deployment step outside this task's scope —
  this task's live verification used its own throwaway contract instance
  and throwaway token specifically so no shared/production state could be
  affected.
- Because the live production contract has zero on-chain agreements
  today (per the Phase 1 audit), a redeploy to promote this fix would not
  need a data migration; this is a favorable, temporary condition and
  should not be read as "in-place contract upgrades are generally safe
  for this contract" — see §3.12.
- Once promoted, `README.md`'s and `docs/contract-reference.md`'s
  documented contract id, function list, and error table would need
  updating (out of scope here per the task brief: *"Do not modify the
  public README yet"*).

## 10. Remaining limitations

- **P1-1 (Disputed/arbiter liveness) is unaddressed.** This step was
  explicitly scoped to the `Funded` P0 only. The audit recommended
  designing both together since they share a root cause (an inert admin
  role, no timeouts); a symmetric timeout-based fallback for `Disputed`
  is a natural next step and should reuse the same
  permissionless-after-timeout shape reasoned about here, but was not
  implemented in this change.
- **The recovery timeout is a fixed, compiled-in constant** (7 days),
  not owner/renter-negotiable per agreement (unlike `claim_window_secs`,
  which already is). This was a deliberate "smallest safe fix" choice —
  a wrong value is a reviewable code change, not a new runtime privilege
  — but a future iteration could make it a `create_agreement` parameter
  if real usage shows 7 days is a poor fit for some listings.
- **The indexer does not yet know about `Expired` or
  `funded_agreement_expired`.** `indexer/src/listener.ts`'s
  `STATUS_NAMES` array and `EVENT_STATUS` map, and
  `indexer/src/api/agreements.ts`'s status allowlist, would need a
  one-line addition each (`'Expired'` appended, and
  `funded_agreement_expired: 'Expired'`) for the derived `agreements`
  cache to reflect a recovered agreement instead of showing it stuck at
  `Funded` forever. Until then, the *contract* (the actual source of
  truth) is fully correct and fund-safe; only the indexer's read-through
  cache would lag, which is the same class of pre-existing limitation
  the audit already documented for the indexer generally (§6 of the
  audit) — not a new fund-safety issue, and deliberately left alone here
  since the task scoped indexer changes to "only if strictly required to
  keep contract semantics consistent," and the contract's own semantics
  do not depend on the indexer.
- **`docs/protocol-mechanics.md` and `docs/contract-reference.md`** still
  describe the pre-fix, 7-status lifecycle and 8-function interface and
  will need updating once this fix is promoted to a real deployment;
  left unmodified here per the task's scope (README/docs untouched for
  this step).
- **The live timeout-elapsed success path is local-proof only**, not
  live-Testnet-proof — see the explicit callout in §8.
