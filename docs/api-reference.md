---
layout: page
title: API Reference
---

# API Reference

Every public HTTP endpoint the `kitcrate-backend` indexer serves, pulled
directly from `indexer/src/app.ts` and the route files it mounts
(`indexer/src/api/agreements.ts`, `indexer/src/api/auth.ts`,
`indexer/src/api/diagnostics.ts`, `indexer/src/api/listings.ts`). Request
and response shapes below match what those files actually read and
write, not an idealized schema; examples are adapted from the route
tests in `indexer/test/listings-auth.test.ts` and
`indexer/test/helpers.ts`.

**Base URL:** the live indexer's root, for example
`https://kitcrate-indexer.onrender.com`. Locally, whatever `PORT` you
set (`http://localhost:3000` by default; see the
[Developer Guide](developer-guide.html)).

All responses are JSON. All error responses share one shape:

```json
{ "error": "a short, human-readable message" }
```

## Authentication

Two endpoint groups exist:

- **Public, no authentication:** `GET /health`, `GET /listings`,
  `GET /listings/:id`, `GET /agreements`, `GET /agreements/:id`,
  `GET /agreements/:id/events`, `GET /diagnostics/orphaned-events`,
  `POST /auth/challenge`.
- **SEP-53 signed-message authentication required:** `POST /listings`,
  `PUT /listings/:id`, `DELETE /listings/:id`. This never touches the
  chain and never moves funds; it only proves control of a Stellar
  address well enough to accept an off-chain write to KitCrate's own
  `listings` metadata table. See `indexer/src/auth/message.ts` and
  [Protocol Mechanics](protocol-mechanics.html) for why this is
  deliberately separate from on-chain contract authorization.

The flow, exactly as `packages/sdk`'s `IndexerClient` implements it:

1. `POST /auth/challenge` with the address, the action
   (`create_listing`, `update_listing`, or `delete_listing`), and the
   target `listingId`. Get back a `nonce`, a `message` to sign, and an
   `expiresAt`.
2. Sign `message` with the wallet that controls that address (SEP-53,
   via Freighter in the app).
3. Send the mutating request with three headers:

| Header | Value |
| --- | --- |
| `X-Kitcrate-Address` | the Stellar address the challenge was issued to |
| `X-Kitcrate-Nonce` | the `nonce` from step 1 |
| `X-Kitcrate-Signature` | the base64-encoded signature from step 2 |

A challenge is single-use (consumed the moment it is looked up,
`indexer/src/auth/challenges.ts`), bound to one exact
`(address, action, listingId)` triple, and expires 5 minutes after
issue (`CHALLENGE_TTL_MS`, `indexer/src/auth/message.ts`). Every
authentication failure, whatever the specific reason (missing header,
unknown or expired or already-used challenge, wrong address/action/
listing bound to it, or a signature that does not verify), returns the
same `401` with a generic message, deliberately, so a caller cannot
probe which part of a forged request was wrong.

## `GET /health`

Liveness check. No parameters, no authentication.

**Response 200:**

```json
{ "status": "ok" }
```

## `GET /listings`

Lists listings, optionally filtered by owner.

**Query parameters:**

| Parameter | Required | Description |
| --- | --- | --- |
| `owner` | no | Filter to listings with this exact `owner` address. |

**Response 200:** an array of listing rows, newest first:

```json
[
  {
    "id": "listing-a1",
    "owner": "GABC...XYZ",
    "title": "Cordless Drill",
    "description": "Good condition",
    "photo_urls": [],
    "location": "Portland, OR",
    "daily_rate": "12.5",
    "deposit": "40",
    "currently_booked": false,
    "created_at": "2026-09-01T12:00:00.000Z",
    "updated_at": "2026-09-01T12:00:00.000Z"
  }
]
```

`currently_booked` is computed on every request, not a stored column:
`true` when an agreement whose `item_ref` equals this listing's `id`
currently has status `Funded`, `Active`, `Disputed`, or `Resolved`
(`indexer/src/api/listings.ts`'s `CURRENTLY_BOOKED_SQL`). `daily_rate`
and `deposit` are Postgres `NUMERIC` columns, so they arrive as JSON
strings, not numbers.

## `GET /listings/:id`

One listing by id.

**Response 200:** a single listing row, same shape as above.

**Response 404:**

```json
{ "error": "listing not found" }
```

## `POST /listings`

Creates a listing. Requires `create_listing` authentication (see
Authentication above), bound to the exact `id` in the request body.

**Request body:**

```json
{
  "id": "listing-a1",
  "owner": "GABC...XYZ",
  "title": "Cordless Drill",
  "description": "Good condition",
  "photo_urls": [],
  "location": "Portland, OR",
  "daily_rate": 12.5,
  "deposit": 40
}
```

`id`, `owner`, `title`, and `location` are required non-empty strings;
`daily_rate` and `deposit` are required non-negative numbers.
`description` defaults to `""` and `photo_urls` defaults to `[]` if
omitted (`indexer/src/api/listings.ts`'s `normalizeListing`). The
authenticated address (from the headers, not this body) must equal
`owner`, or the request is rejected even with an otherwise valid
signature: a caller can only ever create a listing that claims to be
owned by themselves.

**Response 201:** the created row, same shape as `GET /listings/:id`.

**Response 400:** missing/malformed field, for example:

```json
{ "error": "title is required and must be a non-empty string" }
```

**Response 401:** authentication failed (see Authentication above).

**Response 403:** the body's `owner` does not match the authenticated
address:

```json
{ "error": "body owner must match the authenticated address" }
```

**Response 409:** `id` already exists:

```json
{ "error": "a listing with id \"listing-a1\" already exists" }
```

## `PUT /listings/:id`

Full replace of an existing listing. Requires `update_listing`
authentication bound to the exact `:id` in the URL, and the
authenticated address must equal the listing's **stored** owner (not
whatever `owner` the request body claims), so a validly-authenticated
caller can never update someone else's listing.

**Request body:** same shape as `POST /listings`'s body, minus `id`
(taken from the URL). Because this is a full replace, `owner`, `title`,
`location`, `daily_rate`, and `deposit` must all be present; a partial
body is rejected with `400`.

**Response 200:** the updated row.

**Response 400/401/403/404:** same meanings as `POST /listings`, plus
`404` if `:id` does not exist.

## `DELETE /listings/:id`

Deletes a listing. Requires `delete_listing` authentication bound to
the exact `:id`, and the authenticated address must equal the listing's
stored owner.

**Response 204:** empty body.

**Response 401/403/404:** same meanings as above.

## `GET /agreements`

Lists on-chain agreements the indexer has derived from contract events,
scoped to whichever contract this indexer instance is configured to
watch (`CONTRACT_ID`).

**Query parameters:**

| Parameter | Required | Description |
| --- | --- | --- |
| `owner` | no | Filter to this exact owner address. |
| `renter` | no | Filter to this exact renter address. |
| `status` | no | One of `Created`, `Funded`, `Active`, `Disputed`, `Resolved`, `Completed`, `Cancelled`. |

**Response 200:** an array of agreement rows, ordered by `id`:

```json
[
  {
    "contract_id": "CBV57X2CLKX2BHG2COGJNNOHU3ZY4A45L6SCZ32IZCKBS2LFEZ7CL4FR",
    "id": "1",
    "owner": "GOWN...ER1",
    "renter": "GREN...TER1",
    "item_ref": "listing-a1",
    "rental_amount": "800000000",
    "deposit_amount": "200000000",
    "start_time": "1798761600",
    "end_time": "1799366400",
    "claim_window_secs": "259200",
    "status": "Funded",
    "created_at": "1798750000",
    "created_ledger": "1234567",
    "updated_ledger": "1234700",
    "updated_at": "2026-09-01T12:00:00.000Z"
  }
]
```

`rental_amount`, `deposit_amount`, `id`, `start_time`, `end_time`,
`claim_window_secs`, `created_at`, `created_ledger`, and
`updated_ledger` are all Postgres `NUMERIC`/`BIGINT` columns and arrive
as JSON strings. Amounts are the contract's raw `i128` values (the
token's smallest unit), not decimal-formatted.

The `?status=` filter only accepts `Created`, `Funded`, `Active`,
`Disputed`, `Resolved`, `Completed`, or `Cancelled`
(`indexer/src/api/agreements.ts`'s `VALID_STATUSES` list). The
contract's eighth status, `Expired` (reached via
`reclaim_funded_agreement`; see [Contract Reference](contract-reference.html)),
is not in that list: `?status=Expired` returns `400`. An `Expired`
agreement's row still appears in an unfiltered `GET /agreements` call
and can still be fetched directly by id; it just cannot currently be
filtered for specifically by status.

**Response 400:** invalid `status` value.

**Response 503:** `CONTRACT_ID` is not configured on this indexer
instance:

```json
{ "error": "CONTRACT_ID is not set; agreement data is unavailable" }
```

## `GET /agreements/:id`

One agreement by id, scoped to the configured contract.

**Response 200:** a single agreement row, same shape as above.

**Response 400:** `:id` is not a positive integer.

**Response 404:** no agreement with that id for the configured contract.

**Response 503:** same as `GET /agreements` above.

## `GET /agreements/:id/events`

Full raw event history for one agreement, oldest first.

**Response 200:**

```json
[
  {
    "ledger_seq": "1234567",
    "event_index": 0,
    "topic": "agreement_created",
    "data": { "id": 1, "owner": "GOWN...ER1", "renter": "GREN...TER1", "...": "..." },
    "processed_at": "2026-09-01T12:00:00.000Z"
  }
]
```

`topic` is one of the event names in
[Contract Reference](contract-reference.html) (`agreement_created`,
`agreement_funded`, `rental_started`, `claim_raised`,
`dispute_resolved`, `dispute_auto_resolved`, `funds_released`,
`funded_agreement_expired`, `agreement_cancelled`). `data` is the raw
JSON the contract emitted for that event, stored as-is; its shape
differs per topic (see Contract Reference for each event's data
layout).

**Response 400/503:** same meanings as `GET /agreements/:id`.

## `POST /auth/challenge`

Issues a one-shot SEP-53 challenge. See Authentication above for the
full flow.

**Request body:**

```json
{ "address": "GABC...XYZ", "action": "create_listing", "listingId": "listing-a1" }
```

`address` must be a valid Stellar Ed25519 public key. `action` must be
one of `create_listing`, `update_listing`, `delete_listing`.
`listingId` must be a non-empty string.

**Response 201:**

```json
{
  "nonce": "3xU9...base64url...",
  "message": "KitCrate listing authentication (v1)\nThis signature only authorizes a listing-metadata request to the KitCrate indexer API.\nIt does not authorize any on-chain transaction, and it never moves funds.\nAddress: GABC...XYZ\nAction: create_listing\nListing: listing-a1\nNonce: 3xU9...\nIssued: 2026-09-01T12:00:00.000Z\nExpires: 2026-09-01T12:05:00.000Z",
  "expiresAt": "2026-09-01T12:05:00.000Z"
}
```

**Response 400:** invalid `address`, `action`, or missing `listingId`.

## `GET /diagnostics/orphaned-events`

Public, no authentication. Lists every recorded case where a
non-creation contract event arrived for an agreement id with no
matching row in the derived `agreements` table (because that
agreement's own `agreement_created` event was never indexed), scoped to
the configured contract. This is an operational visibility endpoint,
not sensitive data: every field is already public on-chain event
history; it exists so a gap in the derived state is discoverable
instead of requiring someone to notice a missing row and go looking
through logs (`indexer/src/api/diagnostics.ts`).

**Response 200:**

```json
[
  {
    "id": "1",
    "agreement_id": "1",
    "event_id": "0001234567-0000000000",
    "topic": "agreement_funded",
    "ledger_seq": "1234567",
    "detected_at": "2026-09-01T12:00:00.000Z"
  }
]
```

`id` is a Postgres `BIGSERIAL` column, so it arrives as a JSON string
like every other `BIGINT`-backed field on this page.
