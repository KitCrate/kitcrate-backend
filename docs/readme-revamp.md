# README Professional Presentation Revamp

This is a public documentation report on rewriting both `kitcrate-backend/README.md` and `kitcrate-frontend/README.md` as polished project landing pages. It documents a presentation/documentation change only — no contract, indexer, SDK, or frontend source was modified. This is **not** the private security audit; it contains no vulnerability detail beyond what the already-public [`docs/phase3-step1-contract-promotion-audit.md`](phase3-step1-contract-promotion-audit.md) states. (`docs/phase3-step2-production-indexer-rollout.md` was briefly committed alongside this file and has since been made private and untracked; see that report's own revision history for why.)

## 1. Banner assets

Both requested SVGs were located directly in `~/Downloads/` under their exact requested names, no filename variation needed:

| Source | Size | Destination |
| --- | --- | --- |
| `~/Downloads/kitcrate-backend.svg` | 225,605 bytes | `kitcrate-backend/assets/kitcrate-backend.svg` |
| `~/Downloads/kitcrate-frontend.svg` | 1,412,340 bytes | `kitcrate-frontend/assets/kitcrate-frontend.svg` |

Both were verified before copying:

- Well-formed XML (`xml.etree.ElementTree.parse` succeeds on each).
- No external references of any kind — no `href`/`xlink:href` to other files, no `url(...)` references, no `@font-face`, no `file://` or local filesystem paths, no embedded raster (`data:image/...;base64`) content. Each file is a fully self-contained vector image (both are `VTracer`-generated path traces, which is why the frontend file in particular is large relative to a hand-authored SVG — its size comes from the volume of path data, not from anything external or unsafe).
- Both copied byte-for-byte with `cp`, preserving the SVG format exactly — no PNG conversion, no regeneration, no substitution.

The frontend asset (1.4 MB) is noticeably heavier than the backend asset (220 KB). No smaller or pre-compressed variant of the frontend banner existed anywhere in `~/Downloads/`, so the file as provided was used as-is per the instruction not to substitute a different banner if the requested one is found. This is noted here as the one open item from the "lightweight assets" guidance — worth an optimization pass (e.g. running it back through an SVG minifier) in a future documentation-only change if repo weight becomes a concern.

Both READMEs reference their banner by relative path only (`./assets/kitcrate-backend.svg`, `./assets/kitcrate-frontend.svg`) — no absolute local filesystem path appears in either file.

## 2. Structure changes

### Before (both repos, prior structure)

Title/tagline → badge row (Network, CI, License) → "What this is" → (backend only: screenshots) → "Links" → "Maintainer" → "Architecture" (one diagram) → "Quick start" → "Contributing" → "Known limitations" → "License".

### After (both repos, new structure)

Banner → title/positioning → badge row (expanded) → one-paragraph description with explicit Testnet framing → **Project Links** table → "What this repo/app does" → **Architecture** (with a second, new diagram — see below) → **Quick start** / **Setup** → **Development and testing** → a new **Testnet status** / **Deployment** section → **Documentation** (backend: a dedicated links list; frontend: folded into Project Links, since it has no distinct docs of its own) → **Known limitations** → **Contributing** (kept — see §4) → **Maintainer** → **License**.

The "Maintainer" section moved from directly under the badge row down to just above "License", so a first-time reader meets what the project does and how it's built before who's behind it, per the requested ordering.

## 3. New diagrams

- **Backend**: kept the existing client/chain/indexer sequence flowchart, and added a second diagram — a `stateDiagram-v2` of the on-chain agreement lifecycle (`Created → Funded → Active → Completed`, with `Cancelled`, `Expired`, and `Disputed → Resolved` branches). Every transition and its triggering function was cross-checked directly against `contracts/rental-escrow/src/{agreement,dispute}.rs` rather than assumed from prior docs, since this is exactly the kind of enum-shape claim that was previously discovered to be wrong once (see `docs/phase2-step1-funded-liveness-fix.md` §3.9's correction).
- **Frontend**: added a new architecture flowchart (the repo previously had none) showing `apps/web` routes going through `packages/sdk`'s two clients (`RentalEscrowClient`, `IndexerClient`) to the wallet/contract and the backend API respectively — the "never call the chain or backend directly" claim in prose is now also shown structurally.

## 4. Badge system

| Repo | Badges | Notes |
| --- | --- | --- |
| Backend | CI, Testnet, MIT, Rust 1.91+, Soroban/Stellar | CI badge points at the real workflow (`ci.yml`); Rust badge reflects the pinned `rust-version = "1.91.0"` in `Cargo.toml`. |
| Frontend | CI, Testnet, MIT, TypeScript, Next.js, Soroban/Stellar | Reflects `next@^16.3.0` / `typescript@^7.0.2` from `apps/web/package.json`. |

No coverage, download-count, or version badges were added — none of those are tracked or meaningful for either repo currently. Every badge URL was fetched directly and returned `200` before being kept.

## 5. Link organization

Every link in both new READMEs was checked live during this pass (`curl -o /dev/null -w '%{http_code}'`), not carried over from memory:

- `kitcrate.github.io/kitcrate-backend/` and every specific doc page it links to (`protocol-mechanics.html`, `contract-reference.html`, `developer-guide.html`, `for-owners.html`, `for-renters.html`) — all `200`.
- `kitcrate-frontend-web.vercel.app` (live app) — `200`.
- `kitcrate-indexer.onrender.com` — root path returns `404` (no root route defined, expected), but `/listings` and `/health` both return `200`, confirming the service is actually up; the READMEs link to the root domain as the general API entry point, consistent with prior documentation.
- `stellar.expert`'s explorer page for the deployed contract — `200`.

All links were consolidated into a single **Project Links** table near the top of each README (previously a bulleted list under "Links"), rather than being scattered through prose further down the page.

## 6. Maintainer section

Both READMEs now use the exact requested format:

```md
## Maintainer

**Hollujay**
- GitHub: [@Hollujay](https://github.com/Hollujay)
- Telegram: [@Hollujay21](https://t.me/Hollujay21)
```

It appears exactly once per README, positioned just above "License", and nowhere inside the architecture sections.

## 7. Cross-repository consistency

Both READMEs now share: the same badge visual style and ordering convention (CI, Testnet, License, then stack-specific badges), the same "Project Links" table format, identical Testnet framing language ("Currently deployed to/against Stellar Testnet only"), the same Maintainer block verbatim, and matching section-heading vocabulary ("Known limitations", "Development and testing" / "Development" + "Testing", "Contributing").

They remain deliberately distinct in emphasis: the backend README leads with the escrow contract and indexer/API and includes the contract state-machine diagram and function-level Testnet-deployment detail; the frontend README leads with the marketplace UI and SDK and includes the owner/renter user-journey breakdown and the frontend-specific architecture diagram. Neither repeats the other's diagram.

## 8. A materially important finding surfaced during this pass: repo vs. deployed status

While writing the backend's Testnet section, source was checked against the previously-recorded live facts from `docs/phase3-step1-contract-promotion-audit.md` (an already-committed, public document — not the private audit) rather than assumed current:

- This repo's `HEAD` contract source exports 10 functions and includes two liveness-recovery paths not present in the deployed build.
- The Testnet contract address published in both READMEs (`CABLLUB5PU6...ZVTZGIP5`) is still running an earlier, 8-function build without those recovery paths, per that audit's live wasm-hash comparison.
- The live indexer is likewise still running a build that predates the SEP-53 listing-auth layer described in this repo's current source, per `docs/phase3-step2-production-indexer-rollout.md`.

Both new READMEs state this explicitly (backend: a dedicated "Testnet status" section; frontend: a line in "Known limitations" pointing back to it) rather than presenting the linked Testnet address as if it already matched this repo's hardened source. No vulnerability mechanics are described in either README — only the fact that a source/deployment gap currently exists and where the deployment-audit trail lives.

## 9. Validation performed

**Backend** (no source changed, so this reflects pre-existing state, run to confirm the revamp introduced no drift):

```
cargo fmt --check   →  clean
cargo test          →  34 tests, 0 failed (14 + 15 + 5 across the crate's test binaries)
```

Markdown/link/asset checks: every link fetched live (§5); both `LICENSE` and `CONTRIBUTING.md` confirmed present at the paths the README links to; `CONTRIBUTING.md`'s own back-reference to `README.md#contributing` confirmed still resolvable (the "Contributing" section was kept in the new structure specifically so this cross-link doesn't break).

**Frontend:**

```
npm run typecheck               →  clean (@kitcrate/web, @kitcrate/sdk)
npm test --workspace=@kitcrate/sdk  →  11/11 passed (run under Node 22, per this
                                        repo's existing native-TS-execution requirement)
npm run build                   →  succeeded (Next.js 16.3.0, Turbopack, 6 routes)
```

Markdown/link/asset checks: same live-link verification as backend (§5); `LICENSE` and `CONTRIBUTING.md` confirmed present; the new `#known-limitations` and cross-repo `kitcrate-backend#testnet-status` anchor links checked against actual heading text.

## 10. Assets that could not be located

None. Both requested SVGs (`kitcrate backend.svg` / `kitcrate frontend.svg`, found under their exact hyphenated filenames, no variation needed) were present in `~/Downloads/` and used as-is.

## 11. Git scope

Backend: `README.md`, `assets/kitcrate-backend.svg`, this file (`docs/readme-revamp.md`). Frontend: `README.md`, `assets/kitcrate-frontend.svg`. No contract, indexer, SDK, or frontend application source was touched; no CI or deployment configuration was touched. `docs/phase1-full-audit.md` remains untracked in the backend repo and was not added, read from for content, or referenced.
