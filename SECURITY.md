# Security Policy

## Supported versions

This project is under active development on Stellar Testnet only, with
no versioned releases yet (see the repository's release status). The
only supported line is the current `main` branch.

## Current audit status

This project has had one internal security review. Public write-ups of
the hardening and rollout work that followed it live in this repo's
`docs/` folder (`final-readiness-audit.md`, `phase3-step1-contract-
promotion-audit.md`, `phase3-step2-production-indexer-rollout.md`).
There has been no independent third-party audit. Do not treat this
project as production-hardened for funds beyond Stellar Testnet.

A known, publicly disclosed gap: the contract and indexer currently
deployed at the documented Testnet address predate this repository's
`main` branch. See the [README's "Testnet status" section](./README.md#testnet-status)
for the current, accurate state of that gap.

## Reporting a vulnerability

Please report security issues privately rather than opening a public
GitHub issue:

- Telegram: [@Hollujay21](https://t.me/Hollujay21)
- GitHub: [@Hollujay](https://github.com/Hollujay) (direct message, not
  a public issue or PR)

Include: which repository and component (contract, indexer/API,
frontend/SDK), the specific function/endpoint/route affected, a
description of the issue and its impact, and reproduction steps if you
have them.

## What not to include in public issues

Please don't post any of the following in a public GitHub issue or PR:

- Details of an unpatched vulnerability before the maintainer has had a
  chance to address it
- Private keys, seed phrases, or credentials — even Testnet ones tied
  to accounts you use elsewhere
- Exploit payloads targeting the live deployed contract or indexer

Non-security bug reports (crashes, incorrect behavior, documentation
errors) are welcome as normal public issues.
