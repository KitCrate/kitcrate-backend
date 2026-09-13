---
layout: page
title: Contributing
---

# Contributing

Neither `kitcrate-backend` nor `kitcrate-frontend` is currently open to outside contributions. Both are maintained solo (a small team, for now), and that's the real, current policy — each repo states it directly in its own `CONTRIBUTING.md`. This page doesn't restate that policy inline, since a copy here would drift out of sync with the source; read it directly instead:

- [kitcrate-backend/CONTRIBUTING.md](https://github.com/KitCrate/kitcrate-backend/blob/main/CONTRIBUTING.md)
- [kitcrate-frontend/CONTRIBUTING.md](https://github.com/KitCrate/kitcrate-frontend/blob/main/CONTRIBUTING.md)

## What's in place today

- Both repos are on GitHub under the `KitCrate` organization: the contract
  and indexer in
  [kitcrate-backend](https://github.com/KitCrate/kitcrate-backend), the web
  app and SDK in
  [kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend).
- The default branch on both is `main`, and `main` is branch-protected on
  both repos: a pull request is required, real CI checks must pass before
  merging, conversations must be resolved, and force-pushes and branch
  deletion are both blocked.
- Both repos have an MIT `LICENSE`.
- Both repos run CI on every push and pull request (see Testing
  requirements below). Passing CI is a required status check on `main`,
  not only a local convention.

## Development expectations

- Match the existing code style in whichever file you're editing; neither
  repo has a separate style guide beyond `cargo fmt`/`clippy` (backend)
  and ESLint/`tsc` (frontend), enforced in CI.
- Keep changes scoped: one logical change per commit, matching the commit
  message convention below.
- Don't add a new environment variable, dependency, or config file
  without also updating the relevant `.env.example` and the
  [Developer Guide](developer-guide.html), so setup instructions stay
  accurate.

## Testing requirements

Every pull request must pass the same checks CI runs. From
`kitcrate-backend/.github/workflows/ci.yml`:

- **Contract fmt, clippy, test, and wasm build:** `cargo fmt --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test`,
  then `stellar contract build --package rental-escrow`.
- **Indexer typecheck and tests:** `npm run typecheck` and `npm test`
  (route-level integration tests against a real Postgres service
  container, not a mock).

From `kitcrate-frontend/.github/workflows/ci.yml`, one job,
**Typecheck, lint, SDK tests, and production build:** `npm run
typecheck`, `npm run lint`, `npm test --workspace=@kitcrate/sdk`, then
`npm run build`.

See the [Developer Guide](developer-guide.html) for how to run each of
these locally before opening a PR.

## PR workflow

Both repos require a pull request into `main`, with the CI checks above
passing, before a merge is allowed by branch protection; direct pushes
to `main` are blocked by GitHub, not only discouraged by convention.
Conversation resolution is required before merging. There is currently
no minimum reviewer-approval count configured, reflecting the
single-maintainer reality described at the top of this page rather than
a lowered bar for outside contributions, which still are not being
accepted.

## Security disclosure

Do not open a public GitHub issue for a suspected security
vulnerability in the contract, the indexer/API, or the frontend/SDK.
Both repos have a `SECURITY.md`
([backend](https://github.com/KitCrate/kitcrate-backend/blob/main/SECURITY.md),
[frontend](https://github.com/KitCrate/kitcrate-frontend/blob/main/SECURITY.md))
describing how to report one privately and what current audit status
to expect. This page does not repeat that content, since it would drift
out of sync with the source, the same reasoning as the contribution
policy above.

## Commit message convention

This is the maintainer's own working convention, not a rule for outside
contributors, since none are currently being accepted. There's no written
rule enforcing it, but the commit history on both repos consistently
follows the same pattern:

```
type(scope): short, direct summary of the change
```

Types seen in the history: `feat`, `fix`, `chore`, `docs`. Scopes are
whatever part of the codebase changed: `contract`, `indexer`, `sdk`, `web`,
`build`, `repo`. Matching this pattern keeps `git log` readable; it isn't
enforced by any tooling.
