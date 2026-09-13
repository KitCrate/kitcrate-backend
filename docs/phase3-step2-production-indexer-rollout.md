# Phase 3, Step 2 — Production Indexer Security Rollout Audit

**Type:** deployment/rollout audit only. No production service, database, or
configuration was changed. All production interactions in this session were
either read-only (`GET /health`, `GET /listings`, `GET /agreements`, and two
route-existence probes designed to create no state — see §10) or, in the
prior Phase 3 Step 1 session, one diagnostic write immediately reverted
(cited here, not repeated).

**Baseline audited:** `kitcrate-backend` at `34069bb` (`main`), CI green at
that exact commit —
[run 34761092266](https://github.com/KitCrate/kitcrate-backend/actions/runs/34761092266).
No code or configuration change was made in this session, so no new CI run
was needed; the existing one is current and applicable.

---

## Decision

**BLOCKED ON ACCESS**

Every engineering prerequisite is already satisfied (§3–§6): the hardened
code is self-migrating, introduces zero new environment variables, and is
already proven by 41 passing indexer tests plus this session's own
route-existence checks against production. Nothing about the rollout
requires new code, a new migration script, or a new config file. What is
missing is exactly one thing: **the ability to actually deploy to the
Render service**, which requires Render dashboard or API access this
session does not have (confirmed again in this session, §2, §13).

This is not **BLOCKED ON ENGINEERING** — see §3–§6 for why nothing further
needs building. It is not **PASS** — the hardened indexer is not live, and
this report does not claim otherwise anywhere below; every result in §10
is explicitly marked as pre-rollout (current, vulnerable state) or as a
prepared-but-not-yet-run step.

---

## 1. Current production indexer deployment

| Property | Value | Confidence |
| --- | --- | --- |
| Host | Render (free-tier web service, per the already-documented cold-start behavior in `README.md`'s Known Limitations) | Established in Phase 1 audit; no reason to doubt, not independently re-verified this session |
| API base URL | `https://kitcrate-indexer.onrender.com` | Directly confirmed live, this session |
| Build mechanism | No `Dockerfile`, `render.yaml`, or any hosting-specific file exists in the repository (confirmed again this session) — Render must be running a dashboard-configured Node web service, build command presumably `npm install && npm run build` (`tsc` → `dist/`), start command presumably `npm start` (`node dist/index.js`), inferred from `indexer/package.json`'s own scripts, since nothing else defines how it's actually built | Inferred from the only scripts that exist; not confirmed against the actual Render service config, which this session cannot read |
| Branch/source | Presumably `main`, since that's the only branch either repository uses (confirmed: solo-maintainer, direct-to-main workflow, no other branches exist) | Inferred, not directly confirmed |
| Currently deployed commit | Not exactly determinable without dashboard/API access. Bounded from both directions by route-existence probing (§10): definitely **before** `506b932` (the auth routes it introduces are absent) and by extension before everything in this session's and the prior hardening session's work. Most likely still at or near `af1923b` (the commit immediately preceding all hardening work), since nothing in the repository's history suggests any deploy happened since | Bounded, not exact |
| Current runtime version | Not observable. `indexer/package.json` states `"node": ">=20"`, but `@stellar/stellar-sdk@16.2.0` actually requires Node ≥22 (an already-documented, pre-existing gap, P1-11 in the Phase 1 audit, still not disclosed in the backend README) — whichever Node version Render is actually configured with is unknown to this session | Not observable |
| Database | Render-hosted Postgres, connected via `DATABASE_URL` (a hosted env var, not visible to this session) | Established in Phase 1 audit |

---

## 2. Vulnerable production behavior (confirmed, this session)

Re-confirmed live and read-only/side-effect-free (§10 has the exact
commands and full raw output):

- `GET /health` → `200 {"status":"ok"}` — service is up and responsive.
- `POST /auth/challenge` (empty body — cannot create any state even if the
  route existed, since the handler validates before touching the
  database) → **`404 Cannot POST /auth/challenge`**. The route does not
  exist. This is Express's own default 404 handler text, not an
  application-level response — conclusive evidence the currently running
  process has no `/auth` router registered at all.
- `GET /diagnostics/orphaned-events` → **`404 Cannot GET /diagnostics/orphaned-events`**.
  Same conclusion.
- `GET /listings` → `200 []`. `GET /agreements` → `200 []`. Both public
  read routes work correctly and the database is reachable and healthy.

**The specific P0-2 exploit** (anonymous `POST`/`PUT`/`DELETE /listings`
succeeding with no authentication) was already directly demonstrated live
in the prior Phase 3 Step 1 session: an unauthenticated `POST /listings`
created a real row in the production database, and an unauthenticated
`DELETE /listings/:id` removed it. That evidence is not re-created here —
repeating a write against the same public production service to
re-prove an already-proven, unchanged fact would be an unnecessary
additional live mutation with no new information, and this session
instead confirms the *code version* hasn't changed since (the two 404s
above), which is sufficient: the same unpatched code is still running,
so the same vulnerability necessarily still applies. `GET /listings`
returning `[]` also confirms the earlier diagnostic listing left no
residue.

---

## 3. Hardened target commit

- **Commit that introduces listing authentication, ownership checks,
  challenge/signature verification, and replay protection specifically:**
  `506b932` — `fix(api): authenticate listing mutations with SEP-53
  signed challenges`.
- **Recommended actual deployment target: current `main` (`34069bb`)**,
  not `506b932` in isolation. Everything after `506b932` is either
  unrelated-but-compatible (contract-side liveness fixes, which the
  indexer already correctly decodes — see the Phase 3 Step 1 report's
  §9 compatibility analysis) or a direct correctness improvement to the
  indexer itself (`5c67de3`, the event-replay/orphan-detection fix;
  `4c5aa6e`, the status-decoding fix). Deploying `506b932` alone and not
  the commits after it would mean deliberately leaving two already-fixed,
  already-tested bugs in production for no benefit — there is no
  reason to pin to an older commit than current `main`.

---

## 4. Database schema compatibility and migration requirements

**No manual migration step is required.** Confirmed by direct code
reading, not assumption:

- `indexer/src/index.ts`'s `main()` calls `await initDb()`
  **unconditionally, before the HTTP server starts listening** (line 18,
  before `createApp()`/`app.listen()`).
- `initDb()` (`indexer/src/db/client.ts`) runs the **entire current**
  `SCHEMA_SQL` from `indexer/src/db/schema.ts` on every single process
  startup — every statement in it is `CREATE TABLE IF NOT EXISTS` /
  `CREATE INDEX IF NOT EXISTS`, fully idempotent.
- The two tables the hardened code needs that don't exist in the current
  production database (`auth_challenges`, for the SEP-53 challenge store;
  `orphaned_events`, for the indexer-correctness fix) are both part of
  that same `SCHEMA_SQL`.

**Practical consequence:** a plain redeploy of current `main`, followed by
the service's own normal startup sequence, self-migrates the production
database with no separate step, no downtime for a migration window, and
no risk of forgetting to run one. The numbered files in `indexer/migrations/`
(`002_add_auth_challenges.sql`, `003_add_orphaned_events.sql`) exist as
documented, explicit alternatives for someone who wants to apply them
ahead of a deploy without restarting the service, but they are not
required — confirmed redundant with `initDb()`'s own behavior, not
merely assumed to be.

**Nothing in this schema change touches, drops, or alters any existing
table** (`listings`, `agreements`, `agreement_events`, `sync_state`). The
7 real on-chain agreements' absence from the indexer (§ Phase 3 Step 1's
§1.1) is unrelated to this migration and is not affected by it either
way — those rows don't exist to begin with, for reasons unrelated to
schema (the underlying chain events already aged out of RPC retention).

---

## 5. Required environment variables

**None are new.** Confirmed by grepping the entire `indexer/src/auth/`
module for `process.env` references: zero results. The hardened
authentication code reads no environment variable of its own — it only
uses the already-existing, already-configured `pool` (from
`DATABASE_URL`, unchanged) for challenge storage and
`@stellar/stellar-sdk`'s `Keypair` class for signature verification (no
key material of its own — it verifies against the *caller-supplied*
public address, never holds a private key).

The indexer's complete environment variable surface is, and remains
after this rollout, exactly: `RPC_URL`, `CONTRACT_ID`, `DATABASE_URL`,
`PORT`, `POLL_INTERVAL_MS`, `START_LEDGER`, `CORS_ORIGIN` — all
pre-existing, none of them needing a new value for this specific rollout
(the `CONTRACT_ID` promotion question is separate, covered in the Phase
3 Step 1 report, and explicitly out of scope for this task).

---

## 6. Statelessness / server-side storage

**Not fully stateless — deliberately DB-backed, not session-based.** The
SEP-53 challenge system requires server-side storage for its replay
protection: each challenge is a row in the `auth_challenges` Postgres
table, atomically deleted the moment it's consumed (`DELETE ... RETURNING`),
so it can be used exactly once. This is:

- **Not** a cookie or HTTP session — no session middleware, no
  server-held session ID, nothing tied to a particular client connection.
- **Not** in-memory process state — confirmed by grep, zero results for
  any `Map`/cache/`global` pattern in `indexer/src/auth/`. This matters
  operationally: a restart mid-flight (a challenge issued, not yet
  consumed) simply invalidates that one outstanding challenge (the
  client would need to request a new one), never corrupts anything, and
  the design is safe for Render potentially replacing the running
  instance during a deploy (§8) without any special draining logic
  needed.
- **Is** a required Postgres table — meaning the database must be
  reachable for authentication to work at all, exactly as it already
  must be for every other route.

---

## 7. Is a restart sufficient, or is a full redeploy required?

**A full redeploy is required — a restart alone accomplishes nothing.**
"Restart" (recycling the currently running process) would simply start
the same old, unpatched code again. The hardened routes, the
`auth_challenges`/`orphaned_events` schema (self-applied on startup, §4),
and the corrected `applyStateTransition` logic all only exist in the
`main` branch's *source*; nothing changes until Render actually pulls,
rebuilds, and starts that newer source. This is the operator action in
§13.

---

## 8. Expected downtime

Not directly observable without Render dashboard access — no deploy was
performed. Based on Render's standard, documented behavior for a web
service (not specific to this project, general platform behavior): a
**free-tier** service (which this appears to be, per the already-known
cold-start/sleep behavior) typically has a single instance replaced
during a deploy, causing a brief gap — commonly on the order of seconds
to roughly a minute — between the old instance stopping and the new one
passing its first health check and receiving traffic. This is stated as
an expectation, not a measurement; **no downtime figure in this report
should be treated as observed**.

---

## 9. Frontend: already deployed, or a separate action?

Established in Phase 3 Step 1 (§1.3 there) and not repeated live in this
session (out of this task's scope — this task's own instructions say not
to modify frontend functionality, and re-probing Vercel would add nothing
new): the frontend already appears to auto-deploy from GitHub via
Vercel's native integration, and the most recent confirmed-deployed
commit already includes the listing-management UI. **No separate Vercel
action is required for this specific rollout.** The frontend SDK's
listing-mutation methods (`createListing`/`updateListing`/`deleteListing`)
have sent the SEP-53 auth headers since Phase 2's `4b53216`/`e1b1640` —
once the indexer actually accepts them, the already-deployed frontend
code should work against it with no frontend-side change, since it was
built and tested against exactly this indexer API contract.

---

## 10. Live verification: current (pre-rollout) state, and the prepared post-rollout plan

### 10.1 What was actually run against production in this session (full transparency)

```sh
curl https://kitcrate-indexer.onrender.com/health
# -> 200 {"status":"ok"}

curl -X POST https://kitcrate-indexer.onrender.com/auth/challenge \
  -H "Content-Type: application/json" -d '{}'
# -> 404, "Cannot POST /auth/challenge" (Express's own default handler --
#    conclusive that no /auth router is registered in the running process)

curl https://kitcrate-indexer.onrender.com/diagnostics/orphaned-events
# -> 404, "Cannot GET /diagnostics/orphaned-events"

curl https://kitcrate-indexer.onrender.com/listings
# -> 200 []

curl https://kitcrate-indexer.onrender.com/agreements
# -> 200 []
```

No listing, agreement, or any other row was created, modified, or
deleted by this session. The empty-body `POST /auth/challenge` cannot
create a database row even in principle: `authRouter.post('/challenge', ...)`
validates `address`/`action`/`listingId` and returns `400` *before* ever
calling `createChallenge()` — an empty body fails that validation (were
the route to exist at all), so this probe is safe by construction, not
merely by luck. It returned `404` instead of `400`, which is exactly the
signal needed: the route isn't registered at all.

### 10.2 The A–F plan from the task, prepared and ready, not yet run

Cannot be run — there is nothing deployed yet to verify. Written here in
full so it can be executed immediately once §13's operator action
happens, with no further design work needed at that point.

```sh
BASE=https://kitcrate-indexer.onrender.com

# A. Anonymous POST /listings -> must be rejected
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/listings" \
  -H "Content-Type: application/json" \
  -d '{"id":"rollout-verify-probe","owner":"G...","title":"x","location":"x","daily_rate":1,"deposit":1}'
# Expect: 401 (missing/malformed auth headers -- see auth/middleware.ts)

# B. Anonymous PUT /listings/:id -> must be rejected
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "$BASE/listings/some-real-id" \
  -H "Content-Type: application/json" -d '{}'
# Expect: 401

# C. Anonymous DELETE /listings/:id -> must be rejected
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/listings/some-real-id"
# Expect: 401

# D. Legitimate authenticated owner creates a dedicated test listing.
# Requires a real (throwaway, freshly generated) Stellar keypair -- never
# a key with any prior role -- signing a real SEP-53 challenge, exactly
# as indexer/test/helpers.ts's signedListingHeaders() and this session's
# own Phase 2 seed scripts already do. Listing id must be clearly
# disposable, e.g. "phase3-step2-rollout-verification".

# E. A second, different throwaway keypair attempts to modify/delete
# that same listing -> must be rejected with 403 (authenticated as
# themselves, correctly, but not the stored owner).

# F. Clean up: the original (D's) authenticated owner deletes the test
# listing via the real authenticated DELETE flow -- not a raw
# unauthenticated call, proving the legitimate path works end to end,
# not just that the illegitimate path is blocked.
```

Additionally, per the task's own instructions:

- **Existing public `GET` behavior:** re-run `GET /listings` and
  `GET /agreements` after deployment; both must still return `200` (and
  still `[]`, since nothing this rollout does creates or discovers any
  new row for either — see §4's last paragraph).
- **Existing frontend reads:** load the live Vercel app and confirm the
  browse page and an agreement page still render (they read the same
  `GET` routes above).
- **Existing agreement/indexer behavior:** confirm the event listener is
  still polling (log output, or the fact that `GET /agreements` doesn't
  503) and that the 7 real on-chain agreements remain exactly as
  unrecoverable as before (§ Phase 3 Step 1's §1.1) — this rollout
  neither improves nor worsens that pre-existing, structural fact, and
  no verification step here should be misread as an attempt to recover
  them.
- **Database health:** `GET /health` returning `200` after deploy is a
  sufficient first check; the four checks above collectively exercise
  read and write paths against the real database, which is a stronger
  signal than the health check alone.

---

## 11. Rollback procedure

Lower-risk than the contract-promotion rollback in Phase 3 Step 1,
because this rollout is pure code + a purely additive, idempotent schema
change:

1. **If the new deploy fails to build or crashes on startup:** Render's
   standard behavior for a failed deploy is to leave the previous
   successful deploy serving traffic (this is Render's documented
   default, not something this project configures specially) — no
   action beyond investigating the build/start logs should be needed.
2. **If the new deploy succeeds but exhibits unexpected behavior:**
   redeploy the previous commit (whatever was running before this
   rollout, per §1 — not exactly known, but Render retains deploy
   history to pick from). The schema change is not a rollback
   obstacle: the two new tables (`auth_challenges`, `orphaned_events`)
   simply go unused by the older code again — nothing about their
   presence breaks the old code, since the old code never queries them.
3. **No data is destroyed or transformed by this rollout in either
   direction.** Rolling forward only adds tables; rolling back only
   stops using them. `listings`, `agreements`, `agreement_events`, and
   `sync_state` are never touched by either direction.
4. **If a rollback is needed after real users have already created
   listings through the new authenticated flow:** those listings remain
   exactly as valid and readable as any other row in `listings` — the
   authentication layer governs *writes*, not the shape or readability
   of already-written rows, so a rollback to the old (unauthenticated)
   code would make those same rows once again editable/deletable by
   anyone, which is the vulnerability this rollout exists to close, not
   a new risk the rollback introduces — worth being aware of, not a
   reason to avoid rolling back if genuinely needed.

---

## 12. Actual live results

No deployment was possible in this session (§13). Every result reported
above is either:

- **Confirmed, current, pre-rollout production behavior** (§2, §10.1) —
  the vulnerability is real and still live, as of this session.
- **A prepared, not-yet-executed verification plan** (§10.2) — ready to
  run the moment §13 is resolved, requiring no further design work.

No claim of a live PASS is made anywhere in this report.

---

## 13. Exact remaining blocker and required operator action

**Blocker:** this session has no Render credentials of any kind —
confirmed again this session (no `RENDER`-named environment variable
exists in this sandbox; no `render.yaml` or similar exists in the
repository to act on even with credentials; `gh secret list` remains
empty for both repositories, so there is no GitHub Actions path either).
Identical to the blocker already reported in Phase 3 Step 1, now
re-confirmed against the indexer specifically.

**Exact operator action required**, in order:

1. Sign in to the Render dashboard for the `kitcrate-indexer` service (or
   obtain a Render API token/CLI credential and provide it to whoever
   performs this rollout).
2. Trigger a deploy of `kitcrate-backend`'s `main` branch at commit
   `34069bb` (or later, once further commits land) — either via Render's
   "Manual Deploy" action, or by confirming auto-deploy is enabled and
   simply confirming the deploy that should already have triggered on
   every push actually ran (it appears not to have, §2, §7 of Phase 3
   Step 1 — this itself is worth investigating in the Render dashboard
   directly, since auto-deploy evidently is not currently working for
   this service the way it demonstrably is for the frontend's Vercel
   project).
3. Watch the build/start logs for a clean `initDb()` completion and the
   `[api] KitCrate indexer API listening on ...` line — no separate
   migration command needs to be run (§4).
4. Run §10.2's full A–F verification plan against the real
   `https://kitcrate-indexer.onrender.com`, plus the existing-behavior
   checks listed there.
5. Report the actual results back into this document (or a follow-up
   one) as genuinely observed, not assumed — the same evidentiary
   standard this report and every prior one in this engagement have
   held to.

Nothing else blocks this rollout.
