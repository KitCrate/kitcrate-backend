---
layout: page
title: Contributing
---

# Contributing

Neither `kitcrate-backend` nor `kitcrate-frontend` is currently open to outside contributions. Both are maintained solo (a small team, for now), and that's the real, current policy — each repo states it directly in its own `CONTRIBUTING.md`. This page doesn't restate that policy inline, since a copy here would drift out of sync with the source; read it directly instead:

- [kitcrate-backend/CONTRIBUTING.md](https://github.com/KitCrate/kitcrate-backend/blob/main/CONTRIBUTING.md)
- [kitcrate-frontend/CONTRIBUTING.md](https://github.com/KitCrate/kitcrate-frontend/blob/main/CONTRIBUTING.md) — added as part of the same repo-hygiene pass as this page; check the file directly for its current status.

## What's in place today

- Both repos are on GitHub under the `KitCrate` organization: the contract
  and indexer in
  [kitcrate-backend](https://github.com/KitCrate/kitcrate-backend), the web
  app and SDK in
  [kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend).
- The default branch on both is `main`.
- `kitcrate-backend` has an MIT `LICENSE`. `kitcrate-frontend`'s is being
  added as part of the same repo-hygiene pass.
- Neither repo has CI configured yet. Running the test and typecheck
  commands locally, described in the [Developer Guide](developer-guide.html),
  is the only verification that currently happens before a change lands.

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
