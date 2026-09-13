---
layout: page
title: Developer Guide
---

# Developer Guide

Local setup for both repositories, plus how to use the SDK. Every
environment variable and command here is pulled from the actual
`.env.example` files, `Makefile`, and `package.json` scripts in each repo,
not invented.

## kitcrate-backend

Repository: [github.com/KitCrate/kitcrate-backend](https://github.com/KitCrate/kitcrate-backend)

Prerequisites: Rust (rustc >= 1.91), Node.js >= 20, Docker.

### Contract

```sh
git clone https://github.com/KitCrate/kitcrate-backend.git
cd kitcrate-backend
make contract-build     # cargo build
make contract-test      # cargo test, the full integration suite
make wasm                # deployable wasm, wasm32v1-none target
```

Deploy with the Stellar CLI, then call `initialize` with the admin, arbiter,
and token addresses before creating any agreements:

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rental_escrow.wasm \
  --source <deployer-account> --network testnet
```

### Indexer

Environment variables, from `indexer/.env.example`:

| Variable | Description | Default |
| --- | --- | --- |
| `RPC_URL` | Soroban RPC endpoint. | `https://soroban-testnet.stellar.org` |
| `CONTRACT_ID` | Deployed RentalEscrow contract id (`C...` address). Required for the event listener and for agreement data; the listings API works without it. | (empty) |
| `DATABASE_URL` | Postgres connection string. | `postgres://kitcrate:kitcrate@localhost:5433/kitcrate` |
| `PORT` | HTTP port for the REST API. | `3000` |
| `POLL_INTERVAL_MS` | How often the event listener polls, in milliseconds. | `5000` |
| `START_LEDGER` | First ledger to scan when no checkpoint exists. Set this to the ledger where the contract was deployed, or slightly earlier; the RPC node only retains recent history. | `1` |

Setup and run:

```sh
make db-up               # starts local Postgres, indexer/docker-compose.yml
cd indexer
cp .env.example .env      # then set CONTRACT_ID to your deployed contract id
npm install
npm run dev               # or: npm run build && npm start
```

The API listens on `PORT` and the listener polls `RPC_URL` every
`POLL_INTERVAL_MS`. On a fresh database, the schema is created automatically
on startup from `indexer/src/db/schema.ts`; the numbered files in
`indexer/migrations/` only bring an existing, already-populated database up
to date, they aren't needed for a brand-new one.

## kitcrate-frontend

Repository: [github.com/KitCrate/kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend)

An npm workspaces monorepo: `packages/sdk` (`@kitcrate/sdk`, the typed
integration layer) and `apps/web` (`@kitcrate/web`, the Next.js app).
Components never talk to the chain or the backend directly; they go
through the SDK.

Requirements: Node.js 20 or newer, npm 9 or newer (for workspaces), and the
Freighter browser extension for anything that signs a transaction.

Environment variables, from `apps/web/.env.example`, all prefixed
`NEXT_PUBLIC_` since the client reads them directly:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed RentalEscrow contract address. |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | SEP-41 token contract address, for example a USDC SAC. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint. |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Stellar network passphrase. |
| `NEXT_PUBLIC_INDEXER_API_URL` | Base URL for the kitcrate-backend indexer API. |

Without the contract and network values set, contract writes are disabled
and the interface says so. Without the indexer URL, listing and agreement
reads return empty.

Setup:

```bash
git clone https://github.com/KitCrate/kitcrate-frontend.git
cd kitcrate-frontend
npm install                                  # installs every workspace
cp apps/web/.env.example apps/web/.env.local  # then fill in the values
npm run dev
```

The app runs at `http://localhost:3001`. That port is deliberate: it keeps
the web dev server from colliding with the kitcrate-backend indexer, which
serves its REST API on port 3000 by default.

Other root-level scripts: `npm run build` (production build of the web
app), `npm run lint` (ESLint on the web workspace), `npm run typecheck`
(`tsc` across every workspace).

## Using the SDK

`@kitcrate/sdk` exports two client classes relevant to most integration
work: `RentalEscrowClient` for on-chain writes, and `IndexerClient` for
reads against the backend.

### `RentalEscrowClient`

From `packages/sdk/src/contract.ts`. Every method builds and simulates an
unsigned transaction and returns its XDR string. The client never signs or
submits on its own; that's a separate, explicit step, so nothing leaves
the SDK without a wallet signature.

```ts
export interface RentalEscrowConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}
```

Methods (all return `Promise<string>`, the unsigned transaction XDR, unless
noted):

| Method | Parameters |
| --- | --- |
| `buildCreateAgreement` | `sourceAddress: string, params: CreateAgreementParams` |
| `buildFundAgreement` | `renterAddress: string, agreementId: bigint` |
| `buildStartRental` | `ownerAddress: string, agreementId: bigint` |
| `buildRaiseClaim` | `ownerAddress: string, agreementId: bigint, claimAmount: bigint, evidenceRef: string` |
| `buildReleaseFunds` | `callerAddress: string, agreementId: bigint` (permissionless; any connected wallet works as the source) |
| `buildCancelAgreement` | `callerAddress: string, agreementId: bigint` |
| `submit` | `signedTxXdr: string` &rarr; `Promise<rpc.Api.GetTransactionResponse>`. Submits a wallet-signed envelope and polls the RPC until it finalizes. |
| `getAccountSignatureRequirement` | `address: string` &rarr; `Promise<AccountSignatureRequirement \| null>`. Predicts whether a single wallet signature can authorize an invocation from this account, so the UI can warn about a multisig threshold before prompting a signature that would fail. |

### `IndexerClient`

From `packages/sdk/src/indexerClient.ts`. Constructed with
`{ baseUrl: string }`. Translates the backend's raw Postgres rows
(snake_case, numeric amounts as strings) into the typed shapes the app
uses.

| Method | Parameters | Returns |
| --- | --- | --- |
| `getAgreement` | `id: string` | `Promise<Agreement>` |
| `listAgreements` | `filters: AgreementFilters` (`owner?`, `renter?`, `status?`) | `Promise<Agreement[]>` |
| `getAgreementEvents` | `id: string` | `Promise<AgreementEvent[]>` |
| `listListings` | `filters: ListingFilters` (`ownerAddress?`, `category?`) | `Promise<Listing[]>` |
| `getListing` | `id: string` | `Promise<Listing>` |
| `createListing` | `input: CreateListingInput` | `Promise<Listing>` |
| `updateListing` | `id: string, input: UpdateListingInput` | `Promise<Listing>` |
| `deleteListing` | `id: string` | `Promise<void>` |

### Minimal example: building and signing a transaction

This funds an already-created agreement (id `7`), start to finish: connect
the wallet, build the unsigned transaction, get it signed, submit it.

```ts
import { RentalEscrowClient, connectWallet, signXdr } from "@kitcrate/sdk";

const client = new RentalEscrowClient({
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID!,
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!,
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE!,
});

// Prompts Freighter to connect, returns { address, networkPassphrase }.
const account = await connectWallet();

// Builds and simulates the transaction; nothing is signed or sent yet.
const unsignedXdr = await client.buildFundAgreement(account.address, 7n);

// Sends the unsigned XDR to Freighter for the user's signature.
const signedXdr = await signXdr(unsignedXdr, {
  address: account.address,
  networkPassphrase: account.networkPassphrase,
});

// Submits the signed envelope and polls until it finalizes.
const result = await client.submit(signedXdr);
// result.status === "SUCCESS" once the transaction lands.
```

`connectWallet` and `signXdr` are from `packages/sdk/src/wallet.ts`, built
on `@stellar/freighter-api`. The same build-then-sign-then-submit shape
applies to every other `RentalEscrowClient` method; only the build call and
its arguments change.
