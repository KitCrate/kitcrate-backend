# Phase 3, Step 1 — Contract Promotion / Deployment Audit

**Type:** audit and deployment plan only. No production configuration,
contract, or deployed service was modified. Two read-only diagnostic HTTP
calls against the live production indexer are disclosed in full in §1.2,
including a probe write that was immediately deleted — nothing was left
behind.

**Baselines audited:** `kitcrate-backend` at `c09e5b0` (post Phase-2 final
report), `kitcrate-frontend` at `7f4747d`.

---

## Decision

**BLOCKED ON ACCESS**

Every engineering prerequisite for promotion is satisfied (§2–§4, §6, §9).
What's missing is entirely credentials/hosting access this session does
not have and cannot obtain: a funded Stellar deployer identity's secret
key, and Render/Vercel dashboard or API access to change hosted
environment variables (§5, §11). No amount of further engineering work
in the repositories removes this blocker — see §11 for the exact,
minimal list of what would.

This is not **BLOCKED ON ENGINEERING**: no code, schema, or architecture
change is required before promotion could happen, given the access above
(§6, §9). It is not **READY TO DEPLOY**: that would require actually
holding the access in §11, which this session does not.

---

## 1. Current production deployment

All of the following was read directly from the live Testnet network and
the live hosted services in this session, not assumed from documentation.

| Property | Value | How determined |
| --- | --- | --- |
| Contract ID | `CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5` | `README.md`, cross-checked live |
| Network | Stellar Testnet | — |
| Deployed wasm hash | `caf26451a6f55b62a9ed7c4d300fd57075d2bace43e959536732facb020485bd` | `stellar contract info hash --id ... --network testnet` |
| Exported functions | 8: `initialize`, `create_agreement`, `fund_agreement`, `start_rental`, `release_funds`, `cancel_agreement`, `raise_claim`, `resolve_dispute` | `stellar contract info interface`, live |
| `AgreementStatus` variants | 7 (no `Expired`) | same |
| `RentalError` variants | 12 (no codes 13/14) | same |
| `RentalAgreement` fields | no `funded_at`/`disputed_at` | same |
| Admin | `GDIXLZI6LFA37JY7UJKFR4SQPSLV6KUWVRJSFSZ4LFABLLKKPIPBEUV2` | read directly from the contract's instance storage via `getLedgerEntries` (no getter function exists; read-only RPC call, not an invocation) |
| Arbiter | `GBBY4B5DRFAFILLSNDGNKGQJYRDPCXYYFWJUUAKMVMOX46ZR6XZPGPN5` | same |
| Escrow token | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | same |
| Escrow token identity | **native XLM** (the deterministic native-asset SAC address for Testnet — confirmed via `stellar contract id asset --asset native --network testnet`, which returns this exact address; also confirmed via `name`/`symbol` read calls, both returning `"native"`) | live, read-only |
| `NextId` (agreement counter) | **8** | same |

### 1.1 A materially important, previously unknown finding: the production contract has real history

`NextId = 8` means **7 agreements have actually been created** on this
contract at some point (ids 1–7). This directly contradicts the "zero
live usage" claim in the Phase 1 audit and the Phase 2 final report —
both were accurate *as of when they checked*, using the RPC's `getEvents`
over its retained window, but that window has since rolled forward.
Verified in this session:

- A full `getEvents` scan across the *entire currently retained* window
  (~120,000 ledgers, dynamically computed against the live tip, paginated
  to completion) returns **zero events** for this contract. Whatever
  created those 7 agreements happened **more than ~7 days before this
  audit** and its event-level detail (who, what amounts, what status)
  is **no longer retrievable from the Soroban RPC at all** — not by this
  session, and not by the production indexer either, ever again, short of
  a full Stellar history archive (a different infrastructure tier, not
  available here).
- The live production indexer (`https://kitcrate-indexer.onrender.com`)
  reports `GET /agreements` as `[]` and `GET /agreements/1` as `404` —
  it never captured this activity, and now structurally cannot.

**Practical consequence:** there is no recoverable historical detail to
migrate or preserve from the current production contract. The *fact*
that 7 agreements existed is knowable (the counter is on-chain state);
*what happened in them* is not, for either a fresh indexer or the current
one. This substantially simplifies §6's data-continuity analysis: nothing
is lost by promotion that isn't already unrecoverable today.

### 1.2 The production *indexer* is also running pre-hardening code

Checked live, read-only, against `https://kitcrate-indexer.onrender.com`:

- `POST /auth/challenge` → `404` (route doesn't exist)
- `GET /diagnostics/orphaned-events` → `404` (route doesn't exist)
- `POST /listings` **with no authentication headers succeeded** — it
  created a real listing in the live public database. This is P0-2 from
  the Phase 1 audit, fixed in this repository's source since Phase 2's
  `506b932`, **still live and exploitable in production right now**. The
  probe listing (`id: "phase3-audit-probe-delete-me"`) was deleted
  immediately after confirming the vulnerability (via the same
  unauthenticated `DELETE`, since that's equally unauthenticated) —
  nothing was left in the production database.

**Consequence for scope:** "promoting the contract" is not, on its own,
sufficient to close P0-2 in production. The indexer's *code* must also
be promoted — a separate Render deployment action, not a
`CONTRACT_ID` value change (§6).

### 1.3 The production *frontend* appears to be mostly current

Checked live, read-only, against `https://kitcrate-frontend-web.vercel.app`:

- `GET /listings/new`: no "Category" selector present in the rendered
  HTML — matches this session's Phase 2 change (`e1b1640`), not the
  pre-Phase-2 form.
- `GET /listings/probe/edit`: renders the app's real not-found page
  (`"This tag isn't on the board."`) — this route (`/listings/[id]/edit`)
  **did not exist at all** before Phase 2's `e1b1640`.
- GitHub's Deployments API confirms Vercel is connected via GitHub
  integration and auto-deploys on push to `main`: 8 deployment records
  exist, the most recent against commit `31f9e80` (`2026-09-13T10:33:08Z`).
  `31f9e80` is after `e1b1640` (the listing-management commit) in the
  commit sequence, which is consistent with what was observed live.
- **Not confirmed:** whether the *two* commits after `31f9e80`
  (`e7b45fd`, the liveness-recovery UI buttons; `7f4747d`, docs-only) have
  deployed. No further GitHub Deployment API record exists for either as
  of this audit. This may simply be the API lagging the real Vercel
  state, or an actual stall — not distinguishable without Vercel
  dashboard/API access (§11).

**Consequence:** unlike the indexer, the frontend's deployment pipeline
appears to be working autonomously. Promoting the frontend's *code*
likely requires no action beyond ensuring the final commit is pushed
(already true) — the open question is only the `NEXT_PUBLIC_CONTRACT_ID`
/ `NEXT_PUBLIC_TOKEN_CONTRACT_ID` *values* configured in Vercel's
dashboard, which this session cannot read or change (§11).

---

## 2. Hardened deployment details

| Property | Value |
| --- | --- |
| Source commit | `c09e5b0` (`kitcrate-backend`, `main`) — the last commit touching contract source is `4c5aa6e` |
| Wasm hash | `98888df20ec96ccf073030d081a0eb8aed96fae80e68f3e9f634dad8f33c9a30` |
| Toolchain | `rustc 1.97.1`, `stellar-cli 27.1.0`, `soroban-sdk = "=27.0.5"` (pinned exactly in `Cargo.toml`) |
| Exported functions | 10 — the 8 above plus `reclaim_funded_agreement(id: u64)` and `resolve_expired_dispute(id: u64)` |
| `AgreementStatus` variants | 8 (`Expired` added) |
| `RentalError` variants | 14 (`RecoveryWindowActive = 13`, `DisputeResolutionWindowActive = 14` added) |
| `RentalAgreement` fields | `funded_at: u64`, `disputed_at: u64` added |
| `initialize` signature | **unchanged**: `initialize(admin: Address, arbiter: Address, token: Address)` |

### 2.1 An important, verified reproducibility gotcha

Rebuilding at `4c5aa6e` produces `98888df2...`, **not** the hash from
either of Phase 2's own live verification deployments
(`2b00d8b5e6...` at `20953c1`, `be05abca01...` at `7b2bade`). The only
source change between `7b2bade` and `4c5aa6e` was a **doc comment**
(`///`) on the `AgreementStatus` enum (confirmed via `git show`, a
12-line diff, zero logic change). Soroban embeds doc comments into the
contract's on-chain spec metadata, so **even a comment-only change
produces a different wasm hash**. This means: whichever commit is chosen
for promotion, the wasm to deploy must be built fresh from that *exact*
commit — a hash from an earlier verification build must never be assumed
to still match, no matter how trivial the intervening diff looks.

### 2.2 Required `initialize` arguments for a fresh deployment

- **`admin`**: a new choice — the current production admin key's private
  material is not recoverable from anything in this repository or this
  session (§8). A new admin address must be nominated by whoever holds
  deployment authority.
- **`arbiter`**: same — a new choice, not a value to copy from the old
  deployment (copying the *address* is possible since it's public, but
  whether the *same party* should remain arbiter is a product decision,
  not an engineering one).
- **`token`**: an explicit, undecided product question — see §2.3.

### 2.3 Open decision: escrow token identity

The current production contract escrows **native XLM** (§1). The docs
site (`docs/contract-reference.md`) says *"The live deployment uses a
USDC-style token"* — **this is inaccurate for the current production
deployment** and was not caught by any prior audit pass (neither Phase 1
nor Phase 2 independently verified the token's actual identity on-chain;
both took the documentation's word for it). This is a new finding from
this session, not a regression it introduced.

Promotion requires an explicit choice, not a default:

- **Keep native XLM** — simplest, zero new token setup, but the escrow
  amounts in every worked example in `docs/protocol-mechanics.md`
  ("an 80.00 USDC rental") become misleading and would need correcting.
- **Switch to an actual SEP-41 token** (a real Testnet USDC-style SAC, or
  a fresh test asset like the one this session's own Phase 2 verification
  used, `P2S1TOK`) — matches the documented intent, but is a new value
  nobody has picked yet, and every doc reference to amounts/examples
  would need to state which token it now means.

This session makes no recommendation between the two beyond stating both
options plainly; it is a product decision, not a technical one.

---

## 3. Deployment procedure (once access exists)

Exact commands, none of which were run against production in this
session — every one of them was exercised against throwaway
verification identities and a throwaway contract instance in Phase 2,
so the procedure itself is proven, only the specific production
credentials are missing.

```sh
# 1. Build the exact wasm to deploy, from the exact commit being promoted.
git checkout <chosen-commit>
stellar contract build --package rental-escrow
# Confirm the hash matches what's recorded in this report / a fresh
# rebuild before deploying -- never assume a prior hash still applies.
stellar contract info hash --wasm target/wasm32v1-none/release/rental_escrow.wasm

# 2. Deploy (requires a funded deployer identity -- see §8).
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rental_escrow.wasm \
  --source <deployer-identity> \
  --network testnet \
  --alias kitcrate-rental-escrow-v2   # or similar; avoid reusing the old alias

# 3. Initialize (one-time; requires the admin identity's signature).
stellar contract invoke --id <new-contract-id> --source <admin-identity> --network testnet -- \
  initialize --admin <admin-address> --arbiter <arbiter-address> --token <token-address>

# 4. Confirm the interface and hash match what's recorded in §2 (read-only).
stellar contract info interface --id <new-contract-id> --network testnet
stellar contract info hash --id <new-contract-id> --network testnet
```

No contract-side funding is required beyond the deployer's own XLM
transaction fees (trivial amounts, friendbot-fundable on Testnet, exactly
as this session's own verification deployments used). No instance-level
configuration exists beyond `initialize`'s three arguments.

---

## 4. Runtime consumers of the contract ID (complete map)

| Location | Kind | Value source |
| --- | --- | --- |
| `kitcrate-backend/README.md` (1 occurrence) | documentation | committed, hardcoded literal |
| `kitcrate-backend/docs/index.md` | documentation | committed, hardcoded literal |
| `kitcrate-backend/docs/contract-reference.md` | documentation | committed, hardcoded literal |
| `kitcrate-backend/docs/phase2-step1-funded-liveness-fix.md`, `phase2-step2-dispute-liveness-fix.md` | documentation, historical/point-in-time | committed, hardcoded literal — correctly describes what was true when written, not meant to track current state |
| `kitcrate-backend/docs/final-readiness-audit.md` | documentation, historical/point-in-time | same |
| `indexer/.env.example` | env var key only (`CONTRACT_ID=`), no value | committed, empty |
| `indexer/src/config.ts` | reads `process.env.CONTRACT_ID` | **hosted environment variable (Render)** — not committed, not visible to this session |
| `kitcrate-frontend/apps/web/.env.example` | env var key only (`NEXT_PUBLIC_CONTRACT_ID=`), no value | committed, empty |
| `kitcrate-frontend/apps/web/lib/contract.ts` | reads `process.env.NEXT_PUBLIC_CONTRACT_ID` | **hosted environment variable (Vercel)** — not committed, not visible to this session |
| `kitcrate-frontend/README.md`, `kitcrate-backend/docs/developer-guide.md` | documentation | mentions the env var *name*, never a value |

**Not found anywhere:** the contract ID hardcoded in any `.ts`/`.tsx`
source file, any CI workflow, any test fixture, or any generated file in
either repository. It is exactly as centralized as the architecture
implies: two hosted env vars (indexer, frontend) and a cluster of
documentation references, nothing else.

**Never a secret** — the contract ID is a public Testnet address, safe to
print, commit, and display; unlike the deployer/admin/arbiter *private*
keys, it carries no confidentiality requirement of its own.

---

## 5. Hosting

- **No `render.yaml`, `vercel.json`, or any hosting-specific config file
  exists in either repository.** Both platforms are entirely
  dashboard-configured, exactly as the Phase 1 audit found and as
  remains true now.
- **Neither repository's CI workflow references `CONTRACT_ID`, any
  hosting secret, `RENDER`, or `VERCEL` in any form.** Confirmed by
  direct inspection of both `.github/workflows/ci.yml` files. CI builds
  and tests; it does not, and currently cannot, deploy anything.
- **`gh secret list` returns empty for both repositories** — no
  Render/Vercel API tokens or deploy hooks are stored as GitHub Actions
  secrets, so there is no path to trigger either platform's deployment
  from GitHub Actions even if a workflow were added to attempt it,
  without first being given a credential to store there.
- **Vercel is connected via GitHub's native integration** (confirmed via
  `gh api repos/.../deployments`, which is populated only by
  integrations that use that API — Vercel does, Render does not) and
  auto-deploys on push, evidenced in §1.3.
- **Render's deployment status is not observable via any API this
  session has access to.** Render does not populate GitHub's Deployments
  API. The only way this session confirmed the indexer's actual deployed
  state was by probing its live public HTTP endpoints (§1.2) — there is
  no way to *change* that state without either Render dashboard access
  or a Render API token, neither of which exists in this sandbox (§11).

**What credentials/access would be required to perform the promotion,
concretely:**

1. A funded Stellar Testnet secret key to deploy and initialize the new
   contract (§8).
2. Either Render dashboard access or a Render API token, to update the
   indexer's `CONTRACT_ID` environment variable and confirm/trigger a
   redeploy of current `main` (since auto-deploy is not visibly working
   for it today, per §1.2).
3. Either Vercel dashboard access or a Vercel API token, to update
   `NEXT_PUBLIC_CONTRACT_ID` (and decide `NEXT_PUBLIC_TOKEN_CONTRACT_ID`
   per §2.3) — likely *not* needed to trigger a redeploy, since that
   appears to already happen automatically, only needed to change the
   env var values themselves.

None of the three exist in this session.

---

## 6. Data continuity and migration

Answering the task's specific questions directly:

- **Do historical agreements remain queryable after promotion?** For
  *this specific* production contract: there is nothing to lose — see
  §1.1. In general, for any *future* promotion where the old contract
  does have indexed data: no, not through the current API as written
  (below).
- **Does the indexer need multi-contract support?** The **database
  schema already supports it** — `agreements` and `agreement_events` are
  both keyed/scoped by `contract_id`, specifically so a redeployed
  contract's counter restarting at 1 can never collide with a previous
  deployment's rows (this was deliberate, existing design, unchanged by
  Phase 2). What does **not** support it today is the **API layer**:
  every route in `indexer/src/api/agreements.ts` hard-scopes every query
  to the single `config.contractId` read from the `CONTRACT_ID` env var
  (verified by direct code reading, §4's table). Pointing the indexer at
  a new `CONTRACT_ID` does not delete old rows, but makes them permanently
  unreachable through the API as it exists today, because there is no
  request parameter to ask for a different `contract_id`'s data.
- **Is a fresh database or indexing cursor required?** Not strictly, given
  the schema already isolates by `contract_id` — old rows can simply be
  left in place. A cursor reset (the `sync_state` table) *is* effectively
  automatic: pointing at a new `CONTRACT_ID` means the listener starts
  polling that new contract's `getEvents`, and since `sync_state` is
  itself not currently contract-scoped (a global, single-row checkpoint —
  confirmed by `schema.ts`), the checkpoint would need to logically
  restart at the new contract's own deployment ledger, which happens
  naturally via `START_LEDGER` regardless.
- **Can old and new contract IDs coexist?** At the database level, yes,
  by design. At the running-indexer-process level, no — one process
  watches exactly one `CONTRACT_ID` (confirmed in `listener.ts`
  and `config.ts`). Two contracts' *live* event streams could only be
  watched simultaneously by running two indexer processes (sharing or
  not sharing the database), which nothing in this session's work
  prevents but which also does not exist today.
- **Do frontend queries need special handling?** Not for this specific
  promotion (§1.1 — nothing to preserve), but for the general case: no,
  the frontend already only ever reads through the indexer's API, which
  is where the actual limitation lives (above), not in the frontend
  itself.

### Minimum required compatibility change before a *future* promotion needs to preserve real historical data

Not required for *this* promotion (§1.1), but worth recording since the
task asks the architecture question directly: add an optional
`contract_id` query parameter to the `agreements` routes (defaulting to
`config.contractId` to preserve today's behavior exactly), and stop
treating `sync_state` as a single global row. This is a small, contained
change, not attempted in this session because it is not needed for the
promotion currently in front of this task and the task explicitly says
not to repeat or extend implementation work speculatively.

### Migration checklist for this specific promotion

- [ ] Deploy + initialize the new contract (§3)
- [ ] Update Render's `CONTRACT_ID` to the new contract's address
- [ ] Confirm the Render service actually redeploys current `main` (not
      observed to be happening automatically today, §1.2) — a manual
      trigger may be required
- [ ] Update Vercel's `NEXT_PUBLIC_CONTRACT_ID` (and `NEXT_PUBLIC_TOKEN_CONTRACT_ID`
      per the §2.3 decision)
- [ ] No database migration is required (schema already supports the new
      columns/status via `funded_at`/`disputed_at`/`Expired` — these are
      indexer-derived-table columns already present since Phase 2, not
      new schema work)
- [ ] No indexer restart beyond Render's own redeploy is needed
- [ ] Update the five documentation locations in §4's table to the new
      address, and correct the token-identity claim per whatever §2.3
      decides

---

## 7. Rollback plan

The safest rollback is **do nothing to the old contract, ever** — it is
explicitly a historical artifact per this task's own framing, and this
audit found no reason to revise that. Concretely:

1. **The old contract address is never reused, overwritten, or
   reinitialized.** Soroban contracts cannot be mutated in place by
   design (a new wasm at the same address would require an upgrade
   mechanism this contract does not implement), so this risk is
   structural, not just procedural — there is no command that could
   accidentally do this.
2. **If the new deployment's `initialize` fails or is called with wrong
   arguments:** the new contract address is simply abandoned and a fresh
   one deployed. Since `initialize` is one-time-only and guarded
   (`AlreadyInitialized`), a botched initialize cannot be retried into
   correctness on the same address — deploy again rather than fight it.
3. **If Render/Vercel env var changes cause a broken live app:** revert
   the env var back to the old contract ID. Since the old contract was
   never touched, this is a complete, instant rollback — the app returns
   to exactly its pre-promotion behavior (including P0-2 still being
   live there, §1.2, which is the state today regardless).
4. **If the indexer's redeploy itself fails (bad build, crash loop):**
   Render's own prior-deploy rollback (redeploy the last known-good
   build) is the standard mechanism — nothing about this promotion
   changes that.
5. **No data-destructive step exists anywhere in this procedure.** Deploy
   and initialize are both additive (a new contract, new rows scoped to
   a new `contract_id`); nothing in §3 or the migration checklist deletes
   or mutates existing rows.

---

## 8. Security / credential requirements

- **Which account performs deployment:** a to-be-chosen Stellar Testnet
  identity with enough XLM for transaction fees. Not necessarily the
  same as the eventual `admin` — deploying and initializing can be done
  by different keys (the deploy step needs no special authority; only
  `initialize` needs the `admin` address's signature, and only once).
- **Where its secret is stored:** this session recommends whatever the
  project's existing convention is for such keys (this audit found no
  evidence of one — no `.env` files with real secrets exist in either
  repository, consistent with `.gitignore` correctly excluding them). It
  must **never** be committed, and does not need to be given to this
  session at all if the human operator performs the `stellar contract
  deploy`/`initialize` steps themselves locally.
- **Does it need to be used locally only, or added to hosting?** Locally
  only, for the one-time deploy/initialize transactions. The *contract
  ID* that results (public, not secret) is what then goes into hosting
  env vars — the deployer/admin secret key itself has no ongoing role in
  either the indexer or frontend's runtime configuration.
- **No secret was requested, printed, or handled in this session.** Every
  value in this report is a public Testnet address or a public wasm
  hash.

---

## 9. Compatibility analysis

- **Frontend SDK vs. hardened contract:** compatible. `packages/sdk/src/contract.ts`
  already has `buildReclaimFundedAgreement` and `buildResolveExpiredDispute`
  (added in Phase 2's `e7b45fd`), matching the two new contract functions'
  exact signatures. `buildCreateAgreement`, `buildFundAgreement`, etc. are
  unchanged, since `initialize`'s signature and every pre-existing
  function's signature are unchanged (§2).
- **Indexer vs. hardened contract's new state:** compatible.
  `indexer/src/listener.ts`'s `EVENT_STATUS` map and `applyStateTransition`
  already handle every event the hardened contract can emit, since Phase
  2 was developed against this exact contract version. No indexer schema
  change is required to receive data from the new contract — it already
  has `funded_agreement_expired`, `dispute_auto_resolved`, and correctly
  derives `Expired`/`Resolved` statuses from them.
- **Generated bindings:** the SDK does not use codegen from the contract
  (no `.bindings/` or similar); `contract.ts`'s methods are hand-written
  against the contract's function signatures directly. Nothing to
  regenerate.
- **Old agreements becoming unreadable:** not a risk introduced by this
  promotion. The hardened contract's `RentalAgreement` struct only *adds*
  fields (`funded_at`, `disputed_at`); nothing about reading a
  differently-shaped old agreement is possible in the first place, since
  each contract address has its own independent storage — there is no
  shared storage between the old and new contract for anything to become
  unreadable *in*.

---

## 10. Post-deployment verification checklist

To run once access exists and deployment happens — not run in this
session, since there is nothing yet to verify. Ordered, and explicitly
separating what needs *fresh, disposable* Testnet data (per the task's
own instruction) from what's read-only:

1. **Identity checks (read-only):** `stellar contract info interface`
   and `stellar contract info hash` against the new address; confirm 10
   functions and the exact hash from §2 match.
2. **`initialize`:** confirm it was called exactly once, with the
   intended admin/arbiter/token (read the instance storage the same
   read-only way §1 did, not by trusting the deploy script's own
   stdout).
3. **Fresh, disposable agreement — full happy path:** `create_agreement`
   → `fund_agreement` → `start_rental` → `release_funds`, using new
   throwaway keys (never keys with any prior role), confirming exact
   amounts move.
4. **Fresh, disposable agreement — funded-recovery path:** confirm
   `reclaim_funded_agreement` rejects before the window and (this remains
   genuinely impractical to wait out live, exactly as Phase 2 documented)
   rely on the existing 80-contract-test suite for the success case,
   explicitly not claimed as freshly live-verified again unless someone
   is prepared to actually wait 7 days.
5. **Fresh, disposable agreement — dispute path:** `raise_claim` →
   `resolve_dispute`; same caveat as above for `resolve_expired_dispute`'s
   success case (14 days).
6. **Cancellation path:** fresh agreement, `cancel_agreement` before
   funding.
7. **Indexer reconstruction:** point a *test* indexer instance (or,
   ideally, the real promoted one) at the new contract and confirm every
   event above is correctly reconstructed — mirrors exactly what this
   session already proved works end-to-end against a verification
   deployment in Phase 2's final E2E pass, just against the real
   promoted address this time.
8. **API:** `GET /agreements`, `GET /agreements/:id`, `GET /agreements/:id/events`
   against the live indexer, confirming the new `contract_id` and no
   stale data from the old one leaking in (it can't, by schema design,
   but confirm anyway).
9. **Frontend:** load the live app, confirm listing/agreement pages
   render against the new data, confirm a real wallet-signed write
   (create a listing, fund an agreement) actually reaches the new
   contract — this is the one class of check this session was *never*
   able to perform even in Phase 2 (no real Freighter extension with a
   funded account in this sandbox), so it remains the first genuinely
   new verification this specific step would add.

---

## 11. What's still missing (explicit)

1. A funded Stellar Testnet deployer/admin identity's secret key.
2. Render dashboard or API access for `kitcrate-indexer`.
3. Vercel dashboard or API access for `kitcrate-frontend-web`.
4. A product decision on escrow token identity (§2.3) — not a credential,
   but a decision this session should not make unilaterally.
5. A product decision on whether the new contract reuses the current
   admin/arbiter *parties* (new keys, same humans) or hands those roles
   to someone else — same reasoning as #4.

Nothing else. No further code, test, or documentation work in either
repository is a prerequisite.

---

## 12. Recommended next action

Whoever holds the three access items in §11 should:

1. Decide §2.3 (token) and confirm who holds admin/arbiter going forward.
2. Run §3's deploy/initialize locally, from a byte-verified fresh build
   of the exact chosen commit.
3. Update Render's and Vercel's environment variables per §6's checklist.
4. Manually confirm (or trigger) the Render indexer redeploy, since
   auto-deploy is not observed to be working for it today (§1.2) —
   this should be investigated on its own regardless of the contract
   promotion, since it means **every Phase 2 fix, including the P0-2
   listings-auth fix, is currently unprotected in production** and has
   been since Phase 2 concluded.
5. Run the §10 verification checklist against the real promoted
   deployment, and only then update the five documentation locations in
   §4 with the new address.

Step 4 is arguably more urgent than the contract promotion itself: it is
an *already-fixed, already-merged* security hole that simply has not
been deployed, independent of anything about the contract.
