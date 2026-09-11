---
layout: page
title: Contributing
---

# Contributing

Neither `kitcrate-backend` nor `kitcrate-frontend` has a `CONTRIBUTING.md`
yet. A formal one is coming as part of repo hygiene work. Until it lands,
this page describes what's actually true of the two repos today: not a
process that's been written down and agreed on, just what you can verify by
looking.

## What's in place today

- Both repos are on GitHub under the `KitCrate` organization: the contract
  and indexer in
  [kitcrate-backend](https://github.com/KitCrate/kitcrate-backend), the web
  app and SDK in
  [kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend).
- The default branch on both is `main`.
- Neither repo currently has a `LICENSE` file, a pull request template, an
  issue template, or a `CODEOWNERS` file.
- Neither repo has CI configured yet. Running the test and typecheck
  commands locally, described in the [Developer Guide](developer-guide.html),
  is the only verification that currently happens before a change lands.

## Commit message convention

There's no written rule for this, but the commit history on both repos
consistently follows the same pattern:

```
type(scope): short, direct summary of the change
```

Types seen in the history: `feat`, `fix`, `chore`, `docs`. Scopes are
whatever part of the codebase changed: `contract`, `indexer`, `sdk`, `web`,
`build`, `repo`. Matching this pattern keeps `git log` readable; it isn't
enforced by any tooling.

## Before opening a pull request

Until a formal process exists, the practical minimum is:

1. **Contract changes:** run `make contract-test` from the
   `kitcrate-backend` root, and make sure `make wasm` still builds cleanly.
2. **Indexer changes:** run `npm run typecheck` in `indexer/`, and update
   `indexer/src/db/schema.ts` plus a new numbered file in
   `indexer/migrations/` if the change touches the database schema (see
   the migration note in the [Developer Guide](developer-guide.html)).
3. **Frontend or SDK changes:** run `npm run typecheck` and `npm run lint`
   from the `kitcrate-frontend` root.

Fork the repository, branch off `main`, and open a pull request against
`main` when the change is ready. Since there's no PR template yet, a plain
description of what changed and why is enough.
