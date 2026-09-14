---
layout: page
title: Introduction
---

# KitCrate

KitCrate is a peer-to-peer marketplace for renting physical equipment: tools,
cameras, construction gear, and event equipment. Owners list what they have,
renters book it for a period, and the security deposit is held in a
non-custodial [Soroban](https://developers.stellar.org/docs/build/smart-contracts/overview)
smart contract instead of cash changing hands or sitting in a company's bank
account.

## The problem it solves

Renting equipment between two people who don't know each other has a trust
problem. Someone has to hold the security deposit, and whoever holds it is a
point of failure:

- If the **owner** holds it, the renter has to trust the owner to actually
  give it back.
- If the **renter** just pays it to the owner up front, the owner has no real
  incentive to return it once the item is back.
- If a **platform** holds it, the platform can freeze it, mishandle it, take
  a cut of it, or go out of business with renters' and owners' money still
  sitting in its account.

KitCrate removes the need for any of those three to be trusted with the
money. The deposit goes into a smart contract on Stellar, not into an
account either party or KitCrate itself controls. The contract, not a
company, decides where the funds go, based on rules that are fixed on
deployment: return the deposit if nothing goes wrong, or split it according
to an arbiter's ruling if a claim is raised.

## How it works, step by step

1. **List an item.** An owner posts a listing (title, description, photos,
   daily rate, deposit amount) through the app. This is off-chain data;
   nothing about the listing itself touches the blockchain yet.
2. **Book it.** A renter picks dates and creates a rental agreement on-chain,
   naming the owner, the item, the rental fee, the deposit, and the rental
   window. No money moves at this step.
3. **Fund escrow.** The renter sends the rental fee plus the deposit into the
   contract in a single transaction. The funds now sit in the contract, not
   with the owner or the renter.
4. **Start the rental.** The owner confirms handover of the item. The
   agreement moves to an active state and the claim window starts counting
   down from the rental's end date. If the owner never does this, the
   renter isn't stuck: anyone can trigger a refund of everything the
   renter paid in, seven days after funding.
5. **Resolve normally, or via dispute.** If nobody raises a claim before the
   claim window closes, anyone can trigger the final settlement: the deposit
   goes back to the renter and the rental fee goes to the owner. If the owner
   raises a claim over damage before the window closes, a designated arbiter
   reviews the evidence off-chain and splits the deposit between the two
   parties on-chain — and if the arbiter never rules, anyone can trigger a
   fallback settlement, fourteen days after the claim, that defaults to no
   award rather than leaving the deposit locked up.

The full state machine, the exact function that drives each step, and a
worked numeric example are in [Protocol Mechanics](protocol-mechanics.html).

## High-level architecture

Two repositories, connected only by on-chain events and one REST API:

```
  kitcrate-frontend                    Stellar Testnet
+--------------------+    sign      +--------------------+
|  Next.js app       | <----------> |  Freighter wallet   |
+--------------------+              +--------------------+
        |  submit                            |
        v                                    v
  +----------------------------------------------------+
  |          RentalEscrow contract (Testnet)            |
  +----------------------------------------------------+
        |  events
        v
  kitcrate-backend
+--------------------+   polled   +--------------------+
|   Soroban RPC       | <-------- |  Indexer + REST API  |
+--------------------+            +--------------------+
                                          |  idempotent writes
                                          v
                                   +-------------+
                                   |  Postgres   |
                                   +-------------+

  kitcrate-frontend reads and writes listings/agreements only through
  the indexer's REST API above, never directly against Postgres.
```

The frontend never talks to the chain or the database directly:
contract writes go through a connected wallet, and every read goes
through the indexer's REST API. Funds only ever move through the
contract itself, directly between a renter or owner wallet and the
contract's own balance; the indexer and its Postgres database are a
read-side cache and a listings-metadata store, never custodians of
anything.

## Repository relationships

- **[kitcrate-backend](https://github.com/KitCrate/kitcrate-backend)**
  owns the `RentalEscrow` Soroban contract and the indexer/REST API. This
  documentation site is built from and published by this repository.
- **[kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend)**
  owns the Next.js web app and the `@kitcrate/sdk` package that talks to
  both the contract (via a connected wallet) and the backend's REST API
  on the app's behalf.

Neither repository vendors or duplicates the other's source. They agree
on a contract address, a REST API shape, and a token, configured
independently in each repository's own environment variables (see the
[Developer Guide](developer-guide.html)).

## Testnet and production status

This project runs on **Stellar Testnet only**. There is no mainnet
deployment.

The contract source and indexer source in these two repositories'
current `main` branches are hardened: every function documented in
[Protocol Mechanics](protocol-mechanics.html) and
[Contract Reference](contract-reference.html) exists and is tested in
source today. The Testnet contract address has since been promoted to
this hardened source (redeployed and reinitialized from current `main`);
the live indexer's promotion is confirmed for its hardened routes but
has one specific, not-yet-independently-reverified detail remaining.
See the backend README's "Testnet status" section for the current,
specific state. This site describes the source, and says so explicitly
wherever the two could otherwise be confused.

## Who this is for

- New to the app and just want to use it? Start with
  [For Owners](for-owners.html) or [For Renters](for-renters.html).
- Reviewing the contract or building against it? Start with
  [Protocol Mechanics](protocol-mechanics.html) and
  [Contract Reference](contract-reference.html).
- Integrating with the REST API directly? See the
  [API Reference](api-reference.html).
- Setting up the code locally? Go to
  [Developer Guide](developer-guide.html).
- Contributing, or reporting a security issue? See
  [Contributing](contributing.html).

## Links

- Live app: [kitcrate-frontend-web.vercel.app](https://kitcrate-frontend-web.vercel.app)
- Live indexer API: [kitcrate-indexer.onrender.com](https://kitcrate-indexer.onrender.com)
- Contract and indexer source: [github.com/KitCrate/kitcrate-backend](https://github.com/KitCrate/kitcrate-backend)
- Web app and SDK source: [github.com/KitCrate/kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend)
- Deployed testnet contract: `CBV57X2CLKX2BHG2COGJNNOHU3ZY4A45L6SCZ32IZCKBS2LFEZ7CL4FR`
  (see [Testnet and production status](#testnet-and-production-status)
  above for the current, specific state of the indexer's own promotion)
