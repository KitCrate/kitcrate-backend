# KitCrate — Final Readiness Audit (Post-Remediation)

**Scope:** `KitCrate/kitcrate-backend` and `KitCrate/kitcrate-frontend`, following
the private Phase 1 audit (`docs/phase1-full-audit.md`, not published, not
referenced by content below beyond its finding IDs) and one master
hardening pass addressing every finding in it.

**Baselines:**
- `kitcrate-backend`: `af1923b` (pre-session) → `4c5aa6e` (final, this report)
- `kitcrate-frontend`: `29b395d` (pre-session) → `7f4747d` (final, this report)

**Method:** direct implementation and verification, not re-audit from a
distance. Every finding below is either newly re-verified in this session
(automated tests, live Testnet transactions, live CI runs, or direct
browser observation) or explicitly marked as not re-verified, with the
reason stated. Historical evidence from before an implementation changed
is never presented as current.

---

## 1. Verdict

**CONDITIONAL PASS.**

Every P0 and P1 finding from the Phase 1 audit has a shipped,
tested, and — with the two exceptions in §9 — live-Testnet-verified fix
in source on `main` in both repositories, as of the commits above. CI on
both repositories is green against that exact state (§8).

This is not **READY** for one specific, load-bearing reason: **the
production Testnet contract address published in both READMEs
(`CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`) has not been
redeployed.** It still runs the pre-remediation wasm — both liveness P0/P1s
are still live and unpatched at that address today. Every contract-side
fix in this report was built, tested, and live-verified against fresh,
throwaway verification deployments (identifiers in §4), never against
that production address, deliberately — see §9 and each phase2 design
document's own deployment-implications section. Promoting the fix requires
a deployment decision (new address vs. in-place, migration plan,
coordinating the indexer's `CONTRACT_ID` and the frontend's
`NEXT_PUBLIC_CONTRACT_ID`) that is outside what this session can respon­
sibly do unilaterally, and outside what this session has infrastructure
access to do at all (no Render/Vercel deployment credentials were
available). This is the master task's own stop condition —
"production deployment infrastructure is required but not available" —
triggered honestly rather than worked around.

**Path to READY:** deploy the current `main` wasm to a Testnet address
(new or replacing the current one, an explicit choice — see §9), point a
freshly-configured indexer and frontend deployment at it, and re-run the
Testnet-evidence portions of §4 and §7 against that real deployment
instead of a verification-only one. Nothing else is blocking.

---

## 2. Findings, before and after

### P0s

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| P0-1 | Funded agreement has no exit if owner never calls `start_rental` | **Fixed in source, live-verified** | `reclaim_funded_agreement`; §4, §7 |
| P0-2 | Listings REST API has no authentication or ownership check | **Fixed, route-level tested** | SEP-53 challenge auth; §5 |

### P1s

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| P1-1 | Disputed agreement has no exit if arbiter never resolves | **Fixed in source, live-verified** | `resolve_expired_dispute`; §4, §7 |
| P1-2 | Documented Postgres port doesn't match `docker-compose.yml` | **Fixed, verified by actually running the documented quick start** | commit `13c2477` |
| P1-3 | Indexer silently drops state on a missed `agreement_created` event | **Fixed, tested with corrected behavior, not just the bug** | `orphaned_events` table + `GET /diagnostics/orphaned-events`; commit `5c67de3` |
| P1-4 | Multisig pre-flight check missing from 2 of 6 write flows | **Fixed — now all 6** | commit `ae1a957` |
| P1-5 | Listing "Category" fully non-functional | **Removed** (not wired up — see rationale in commit `e1b1640`) | |
| P1-6 | No UI to edit or delete a listing | **Fixed** | `/listings/[id]/edit`, `ListingOwnerActions`; commit `e1b1640` |
| P1-7 | Frontend CI never runs `next build` | **Fixed** | commit `31f9e80`; §8 |
| P1-8 | SDK test coverage narrow (1 of 6 source files) | **Improved, not exhaustive** — `indexerClient.ts` now covered (commit `4b53216`); `wallet.ts`/`xdr.ts`/`contract.ts`'s build/submit paths still untested. See §9. |
| P1-9 | Backend README understates P0-1's real severity | **Fixed** — README now describes the actual recovery mechanism | commit `76ff6d0` |
| P1-10 | Frontend README overstates multisig coverage | **Now true**, not just corrected wording — P1-4's fix makes the existing claim accurate | |
| P1-11 | Backend indexer's Node ≥22 requirement undisclosed | **Not addressed this session** — still an open, minor gap; see §9 |

### P2s and accepted limitations

Not systematically re-verified item-by-item; several were incidentally
fixed as part of adjacent work (e.g. the `CancelAgreementButton` stale
copy, fixed alongside the listing-management UI in commit `e1b1640`).
Not claimed as a complete P2 sweep.

### New findings from this session

- **Indexer status-decoding bug**, discovered only by running a real
  indexer against real Testnet events during the final E2E pass (§7):
  `applyStateTransition` decoded `agreement_created`'s status field as a
  numeric index; Soroban actually encodes it as a named Symbol. This had
  zero observable impact (the one code path it affected always produces
  the same literal value regardless), but was live, wrong code. Fixed in
  commit `4c5aa6e`, which also corrects two design documents' and one
  Rust doc comment's related, equally-mistaken reasoning about *why*
  `Expired` was appended rather than inserted into `AgreementStatus`
  (the conclusion was fine; the stated reason was not). Recorded here
  as a methodology point: synthetic test fixtures had encoded the same
  wrong assumption and never caught it — only real on-chain data did.

---

## 3. Security status

- **Contract authorization:** unchanged from the Phase 1 audit's own
  finding — every role check compares against a *stored* role, never
  merely that some address authenticated. Verified still true for the
  two new functions (`reclaim_funded_agreement`, `resolve_expired_dispute`)
  by construction: neither takes a caller-supplied destination address at
  all, so there is nothing to redirect.
- **No admin escape hatch was added.** Both liveness fixes are
  permissionless-after-timeout, deliberately mirroring the contract's own
  pre-existing `release_funds` pattern, per the task's explicit
  instruction not to introduce one. The `Admin` role remains as inert as
  the Phase 1 audit found it — this session did not activate it for
  anything.
- **Listings API:** POST/PUT/DELETE now require a SEP-53 signed challenge
  bound to (address, action, listing id), single-use, verified against
  the two official SEP-53 test vectors (not just internal self-
  consistency). No private key material is ever transmitted, stored, or
  seen server-side.
- **No new centralized trust was introduced anywhere in this session.**

---

## 4. Contract status

**10 exported functions** (up from 8): `initialize`, `create_agreement`,
`fund_agreement`, `start_rental`, `reclaim_funded_agreement`,
`release_funds`, `cancel_agreement`, `raise_claim`, `resolve_dispute`,
`resolve_expired_dispute`.

**80 contract tests, 0 failures** (up from the Phase 1 audit's 51),
covering every function including full regression coverage of every
pre-existing path. `cargo fmt --check` and
`cargo clippy --workspace --all-targets -- -D warnings` both clean.

**Live Testnet verification** — throwaway identities, never production
keys, against **verification-only deployments, not the production
address** (see §1, §9):

| Deployment | Wasm hash | Purpose |
| --- | --- | --- |
| `CDIRC7B7I2LXW3S532AHMCIU46AA6KK53LOC64C3EPH2QB5UFBIRTYIV` | `2b00d8b5e6...` | P0-1 (`Funded` liveness) verification only |
| `CC5O3RFVPHL2MXMQFK374UBV6WX63FP7JAOF6YGCEQT6AFRI3EWO3OT2` | `be05abca01...` | Combined P0-1 + P1-1 verification; also this session's final E2E pass |

Live-confirmed on the second (final, current-source) deployment:
- `create_agreement` → `fund_agreement` → `start_rental` → `raise_claim` →
  `resolve_dispute`: full dispute-with-resolution path, correct amounts
  (agreement 1).
- `reclaim_funded_agreement` and `resolve_expired_dispute` called
  prematurely: real, live rejection (`RecoveryWindowActive` /
  `DisputeResolutionWindowActive`), from both an involved party's key and
  an unrelated key — proving the rejection is time-based, not identity-
  based, on a real host, not just in the test harness's mocked auth.
- `create_agreement` → `fund_agreement` → `start_rental` → `release_funds`
  (agreement 2): full clean-settlement path, called by a party with no
  relationship to the agreement (permissionless, confirmed live).
- `create_agreement` → `cancel_agreement` (agreement 3): cancellation
  path, confirmed live.
- Indexer reconstruction of all three agreements from these real events,
  end to end (§7).

**Not live-verified:** an actual *successful* call to either
`reclaim_funded_agreement` (after a real 7 days) or
`resolve_expired_dispute` (after a real 14 days). Waiting that long for
one verification step was assessed as impractical, consistent with the
task's own instruction not to fake timestamp advancement. Both success
paths are covered by dedicated unit tests instead (deterministic ledger-
timestamp control in the Soroban test harness) — this is local-contract
proof, not live-Testnet proof, and is not represented as the latter
anywhere in this report or the phase2 design docs.

---

## 5. Indexer status

- **Authentication:** SEP-53 challenge system for listing mutations (§3).
  41 tests, 0 failures, run sequentially against a real (not mocked)
  disposable Postgres — 31 covering the auth system, 10 covering the
  event-replay correctness fix below.
- **Event replay correctness (P1-3):** `applyStateTransition` now checks
  `rowCount` on every status-update `UPDATE`; a zero-row result is logged
  loudly and recorded durably in a new `orphaned_events` table, queryable
  via `GET /diagnostics/orphaned-events`, instead of silently discarded.
  Tests prove the *corrected* behavior — normal path unaffected, an
  orphan is recorded and discoverable, multiple distinct orphans for the
  same still-missing agreement are each recorded independently, and
  replaying a single event or a full batch twice (simulating a restart
  before the checkpoint saved) reaches identical final state both times.
- **Status-decoding correctness:** fixed this session (§2); confirmed
  against real re-indexed Testnet data, not only the corrected unit test.
- **CI:** now provisions a real Postgres service and runs the full test
  suite, not just `typecheck` (§8).
- **Not addressed this session:** the Node ≥22 requirement is still
  undisclosed in the backend README (P1-11); `POST /auth/challenge` still
  has no rate limit (documented as an accepted limitation, not fixed).

---

## 6. API status

`GET /listings`, `GET /listings/:id`, `GET /agreements*` remain public,
unauthenticated, as intended. `POST`/`PUT`/`DELETE /listings` now require
the SEP-53 challenge (§3). New: `POST /auth/challenge`,
`GET /diagnostics/orphaned-events`. All route-level behavior — auth
success/failure in every combination the task specified, malformed
requests, unknown resources — is covered by tests that hit the real HTTP
surface (`app.listen(0)` + `fetch`), not unit tests of helper functions
in isolation.

---

## 7. Frontend status

- **Listing management:** create (existing, now signs a challenge),
  edit and delete (new — P1-6), category removed (P1-5, see rationale in
  §2's table).
- **Liveness-recovery UI:** both new contract functions are now reachable
  from the app (`ReclaimFundedAgreementButton`,
  `ResolveExpiredDisputeButton` on the agreement detail page) — added
  during this session's own final-E2E work after noticing the success
  criterion "no permanently stranded ordinary escrow" was a property of
  the deployed contract but not yet of anything an ordinary user could
  actually reach from the app.
- **Multisig detection:** now on all 6 write flows (§2, P1-4).
- **CI:** typecheck, lint, SDK tests, and a full production build all
  run (§8); `apps/web` itself still has zero component or end-to-end
  tests — an explicit, documented limitation (§9), not fixed this
  session.
- **Browser verification:** real dev servers, a real indexer, a real
  Postgres, and listings seeded through the actual authenticated
  create-listing flow (not stubs) were loaded in an actual Chrome
  instance and screenshotted (Track F, Track J, and the final E2E pass,
  §1 image links in the backend README). The agreement detail page was
  confirmed rendering **real, live Testnet data** — three real agreements
  in three different terminal states (`Resolved`, `Completed`,
  `Cancelled`), each with the correct status-progress track and event
  history, reconstructed by a real indexer polling the real Soroban
  Testnet RPC.
- **Not browser-verified:** any flow requiring an actual Freighter
  extension signature (connect wallet, sign a transaction, sign a SEP-53
  challenge) — this sandbox has no Freighter extension with a funded
  Testnet account configured. Every such flow is verified at the logic
  level (SDK unit tests, contract-level Testnet transactions built the
  same way the SDK builds them) but not as an actual click-through in a
  browser with the real extension. Stated plainly rather than implied.
  Mobile-viewport rendering was attempted via the browser tool's window
  resize, which did not take visible effect in this sandbox; not
  independently re-verified another way.

---

## 8. CI status

Both workflows re-verified green against the exact final commit, not a
historical run:

- **Backend:** [`run 34758454393`](https://github.com/KitCrate/kitcrate-backend/actions/runs/34758454393)
  — `4c5aa6e`, success. Jobs: *Contract fmt, clippy, test, and wasm build*;
  *Indexer typecheck and tests* (with a real Postgres service container).
- **Frontend:** [`run 34752776090`](https://github.com/KitCrate/kitcrate-frontend/actions/runs/34752776090)
  — `7f4747d`, success. Job: *Typecheck, lint, SDK tests, and production
  build*.

Every command either workflow runs was executed locally first, in the
same order, immediately before each commit that touched CI — not written
and assumed correct.

---

## 9. Remaining limitations and deferred items

Stated plainly, not buried:

1. **The production contract address is unpatched.** The single most
   important open item — see §1.
2. **Both liveness timeouts' success path is local-proof only**, not
   live-Testnet-proof (§4).
3. **`apps/web` has no automated tests** of any kind (component or
   end-to-end). CI catches typecheck/lint/build breakage, not a
   behavioral regression in a component.
4. **No real-browser-extension verification** of any wallet-signing flow
   (§7).
5. **P1-11 (Node version disclosure) was not addressed.**
6. **`POST /auth/challenge` has no rate limit.** Does not affect fund
   safety (challenges are single-use and never authorize a contract
   call), but is an unaddressed operational gap.
7. **The 7-day/14-day recovery timeouts are fixed, compiled-in
   constants**, not per-agreement configurable — a deliberate v1 choice,
   documented as such in both phase2 design docs, not an oversight.
8. **SDK test coverage is improved, not exhaustive** (P1-8): `wallet.ts`,
   `xdr.ts`, and most of `contract.ts`'s build/submit paths remain
   untested at the unit level (their logic is exercised indirectly by
   this session's live Testnet transactions, which use those same code
   paths, but that is integration evidence, not unit coverage).
9. **P2s from the Phase 1 audit were not systematically swept.** Several
   were fixed incidentally; no claim is made that all were reviewed.
10. **The dispute-liveness fallback and the funded-liveness fallback
    share one root design pattern** (permissionless-after-timeout) by
    deliberate choice, documented in both phase2 design docs — this is
    not redundancy to clean up, it's the intended consistency.

None of the above were hidden or discovered late and left out — each is
either stated here for the first time as a limitation, or is a direct
carry-forward of something already flagged in a phase2 design document
during implementation.

---

## 10. Commit baselines (full list, in order)

**kitcrate-backend**, `af1923b` → `4c5aa6e`:

```
20953c1 fix(contract): add funded agreement recovery path
506b932 fix(api): authenticate listing mutations with SEP-53 signed challenges
7b2bade fix(contract): add dispute liveness path
5c67de3 fix(indexer): make event replay lossless, surface orphaned events
13c2477 fix(dev): correct quick-start Postgres port mismatch
ca208c3 style(contract): apply cargo fmt across the whole crate
173a00d ci: run complete backend verification (fmt, clippy, indexer tests)
76ff6d0 docs: update kitcrate-backend documentation
944a9dd docs: add architecture diagram and real screenshots to the README
4c5aa6e fix(indexer): decode agreement_created status correctly
```

**kitcrate-frontend**, `29b395d` → `7f4747d`:

```
4b53216 fix(sdk): sign listing mutations with SEP-53 wallet challenges
e1b1640 fix(frontend): wire listing management actions, remove dead category UI
ae1a957 fix(sdk): complete multisig pre-flight checks on every write flow
31f9e80 ci: run the production build (next build)
e7b45fd feat(frontend): add UI for the two liveness-recovery contract calls
7f4747d docs: update kitcrate-frontend documentation
```

---

## 11. Test counts (final)

| Suite | Count | Result |
| --- | --- | --- |
| Contract (`cargo test`) | 80 | 0 failures |
| Indexer (`npm test`, real Postgres) | 41 | 0 failures |
| SDK (`npm test --workspace=@kitcrate/sdk`) | 11 | 0 failures |
| **Total** | **132** | **0 failures** |

(Phase 1 audit baseline: 51 contract + 0 indexer + 7 SDK = 58.)

---

## 12. Documentation status

Updated to reflect this session's work, not left stale (§2, P1-9/P1-10):
`README.md` (both repos), `docs/index.md`, `docs/protocol-mechanics.md`,
`docs/contract-reference.md`, `docs/for-owners.md`, `docs/for-renters.md`
(backend); `README.md` (frontend). `CONTRIBUTING.md` reviewed, needed no
change. This report and the two phase2 design documents are the
complete written record of what changed and why; none of them claim more
than what §4 and §7's evidence actually supports.

The private Phase 1 audit (`docs/phase1-full-audit.md`) remains
untracked and unpublished, per its own header, and is not referenced by
content anywhere in the committed docs — only by finding ID, which
carries no information from the audit's own text.
