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
   down from the rental's end date.
5. **Resolve normally, or via dispute.** If nobody raises a claim before the
   claim window closes, anyone can trigger the final settlement: the deposit
   goes back to the renter and the rental fee goes to the owner. If the owner
   raises a claim over damage before the window closes, a designated arbiter
   reviews the evidence off-chain and splits the deposit between the two
   parties on-chain.

The full state machine, the exact function that drives each step, and a
worked numeric example are in [Protocol Mechanics](protocol-mechanics.html).

## Who this is for

- New to the app and just want to use it? Start with
  [For Owners](for-owners.html) or [For Renters](for-renters.html).
- Reviewing the contract or building against it? Start with
  [Protocol Mechanics](protocol-mechanics.html) and
  [Contract Reference](contract-reference.html).
- Setting up the code locally? Go to
  [Developer Guide](developer-guide.html).

## Links

- Live app: [kitcrate-frontend-web.vercel.app](https://kitcrate-frontend-web.vercel.app)
- Contract and indexer source: [github.com/KitCrate/kitcrate-backend](https://github.com/KitCrate/kitcrate-backend)
- Web app and SDK source: [github.com/KitCrate/kitcrate-frontend](https://github.com/KitCrate/kitcrate-frontend)
- Deployed testnet contract: `CABLLUB5PU6GR6OE66457W5L7SRSVSUEZ73OYV7W2P47A3L4ZVTZGIP5`
