# KitCrate

**Peer-to-peer equipment rental, secured by a non-custodial Soroban escrow.**

![Network: Testnet](https://img.shields.io/badge/network-testnet-3d5afe)
[![CI](https://github.com/KitCrate/kitcrate-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/KitCrate/kitcrate-backend/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

## What this is

KitCrate is a peer-to-peer marketplace for renting physical equipment: tools, cameras, construction gear, and event equipment. Renters and owners agree on a rental period and a security deposit. This repository holds the two pieces that make the deposit trustworthy without a platform holding the money: the `RentalEscrow` Soroban smart contract, which locks the rental fee and deposit on-chain and releases them by fixed rules instead of a company's discretion, and the indexer, a Node.js service that reads the contract's events, keeps a queryable copy of agreement and listing state in Postgres, and serves it over a REST API.

## Links

- **Docs:** [kitcrate.github.io/kitcrate-backend](https://kitcrate.github.io/kitcrate-backend/)
- **Frontend repo:** [github.com/KitCrate/kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend)
- **Live indexer API:** [kitcrate-indexer.onrender.com](https://kitcrate-indexer.onrender.com)
- **Deployed testnet contract:** `CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5` ([view on stellar.expert](https://stellar.expert/explorer/testnet/contract/CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5))

## Maintainer

GitHub: [@Hollujay](https://github.com/Hollujay)
Telegram: [@Hollujay21](https://t.me/Hollujay21)

## Architecture

Two pieces, connected only by on-chain events:

- **`contracts/rental-escrow`**: a `no_std` Rust crate built with `soroban-sdk 27.0.5`. Every state transition (create, fund, start, dispute, resolve, release, cancel) emits an event. The contract never moves funds except through the escrow token's own `transfer` function.
- **`indexer/`**: a TypeScript service that polls the Soroban RPC for those events, persists them idempotently to Postgres, derives a current-state `agreements` table from them, and exposes it (plus listing CRUD) over a REST API. The frontend reads through this API rather than the chain directly.

For the full agreement state machine, every function's auth and effect, and a worked numeric example, see [Protocol Mechanics](https://kitcrate.github.io/kitcrate-backend/protocol-mechanics.html) on the docs site. For every function signature and error code, see [Contract Reference](https://kitcrate.github.io/kitcrate-backend/contract-reference.html).

## Quick start

Prerequisites: Rust (rustc >= 1.91), the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools#cli), Node.js >= 20, Docker.

**Build the contract:**

```sh
stellar contract build --package rental-escrow
```

Tested against this repo: produces `target/wasm32v1-none/release/rental_escrow.wasm` and reports 8 exported functions. `make wasm` runs the equivalent `cargo build` directly, if you'd rather not use the Stellar CLI.

**Run the contract tests:**

```sh
cargo test
```

**Run the indexer locally:**

```sh
make db-up                 # starts local Postgres, indexer/docker-compose.yml
cd indexer
cp .env.example .env       # then set CONTRACT_ID to a deployed contract id
npm install
npm run dev
```

Real variables from `indexer/.env.example`: `RPC_URL`, `CONTRACT_ID`, `DATABASE_URL`, `PORT`, `POLL_INTERVAL_MS`, `START_LEDGER`.

**Indexer tests:** there currently is no test script. `indexer/package.json` defines `build`, `typecheck`, `dev`, and `start` only, and there are no `*.test.ts` files in the repo. This is a real gap, not an oversight to paper over.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): this project isn't currently accepting outside contributions.

## Known limitations

- **Render free-tier hosting.** The live indexer sleeps after a period of inactivity; the first request afterward can take up to about 50 seconds. The free Postgres database expires 30 days after creation and has to be recreated.
- **Multisig accounts need enough signature weight.** A Soroban invocation from an account requires total signer weight meeting that account's medium threshold. A single Freighter-connected key on a multisig account can fall short of it, in which case the network rejects an otherwise correctly built and signed transaction with `txBadAuth`. The frontend SDK detects this ahead of signing and surfaces a clear message; the contract itself has no awareness of it; it's a property of how Stellar account auth works against any `require_auth()` call.

## License

[MIT](./LICENSE).
