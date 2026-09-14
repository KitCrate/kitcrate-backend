# KitCrate — Submission Text

The permanent, citable record of the text drafted for KitCrate's Stellar
Drips Wave submission. Written directly with the maintainer; recorded here
rather than left as something that only existed in a chat. Verified against
the actual repositories before being committed (issue counts, repo names,
and deployment platforms below reflect the state at time of writing, not
assumption).

## Repo relationship

KitCrate is split into two repositories. `kitcrate-backend` holds the
`RentalEscrow` Soroban contract and the indexer, a Node.js/TypeScript
service that polls the contract's on-chain events, persists them to
Postgres, and serves them over a REST API. `kitcrate-frontend` holds the
Next.js web app and a typed SDK package that talks to both the contract
(via a connected Freighter wallet) and the backend's indexer API. The
frontend never touches the chain or the database directly: every contract
write goes through the SDK and a signed wallet transaction, and every read
goes through the indexer's REST API. The two repos are independently
deployable (indexer on Render, frontend on Vercel) but only function
together as one product.

## Planned issues

Two items are tracked and genuinely still open: linking the project's
audit-trail documentation into the docs site's navigation
([kitcrate-backend#5](https://github.com/KitCrate/kitcrate-backend/issues/5),
currently written but not yet surfaced in the nav), and adding automated
test coverage for the frontend app itself
([kitcrate-frontend#2](https://github.com/KitCrate/kitcrate-frontend/issues/2)
— the SDK has real unit tests; the Next.js app currently relies on
typecheck, lint, and a production build in CI, with no component or
end-to-end tests yet). A third, lower-priority item is unbounded requests
to the listing-authentication challenge endpoint, which is safe today
(challenges are single-use and never authorize a contract call on their
own) but has no rate limiting yet; this one is documented in
`kitcrate-backend`'s README under Known Limitations rather than tracked as
its own issue.

## Project description

KitCrate is a peer-to-peer marketplace for renting physical equipment,
tools, cameras, construction gear, and similar items, where the security
deposit is held in a non-custodial Soroban smart contract instead of cash
with the platform or the other party. Renters and owners agree on a rental
period and deposit amount; funds move automatically according to fixed
on-chain rules rather than a company's discretion, including built-in
recovery paths if either side goes silent: an unconfirmed handover lets the
renter recover everything they paid after a fixed timeout, and an
unresolved dispute defaults to the same clean split a normal, undisputed
rental gets, rather than locking funds indefinitely on an unresponsive
arbiter. The project is live on Stellar Testnet, with a working end-to-end
flow (list, book, fund, start rental) verified against real wallet
transactions on the live deployment; dispute resolution is covered by the
contract's own automated test suite.
