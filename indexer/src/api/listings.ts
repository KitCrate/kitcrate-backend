import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/client.js';
import { authenticatedAddress, requireListingAuth } from '../auth/middleware.js';

export const listingsRouter = Router();

interface ListingInput {
  id?: unknown;
  owner?: unknown;
  title?: unknown;
  description?: unknown;
  photo_urls?: unknown;
  location?: unknown;
  daily_rate?: unknown;
  deposit?: unknown;
}

// Agreement statuses that occupy a listing: the renter has funded the
// agreement (money has moved) and the item is not yet free again. A
// `Created` agreement is unfunded and does not block the listing;
// `Completed` and `Cancelled` release it. Correlation is on
// `agreements.item_ref = listings.id` — the frontend passes `listing.id`
// as `itemRef` when building create_agreement (see BookingPanel), so the
// opaque on-chain item_ref string is exactly the listing id.
const CURRENTLY_BOOKED_SQL = `EXISTS (
    SELECT 1 FROM agreements a
    WHERE a.item_ref = l.id
      AND a.status IN ('Funded', 'Active', 'Disputed', 'Resolved')
  ) AS currently_booked`;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/// Validates a listing body and maps it to the row shape, or returns an
/// error message.
function normalizeListing(body: ListingInput):
  | { ok: true; values: (string | number | string[])[] }
  | { ok: false; error: string } {
  const { id, owner, title, description, photo_urls, location, daily_rate, deposit } = body;
  if (!isNonEmptyString(id)) {
    return { ok: false, error: 'id is required and must be a non-empty string' };
  }
  if (!isNonEmptyString(owner)) {
    return { ok: false, error: 'owner is required and must be a non-empty string' };
  }
  if (!isNonEmptyString(title)) {
    return { ok: false, error: 'title is required and must be a non-empty string' };
  }
  if (!isNonEmptyString(location)) {
    return { ok: false, error: 'location is required and must be a non-empty string' };
  }
  if (!isFiniteNumber(daily_rate) || daily_rate < 0) {
    return { ok: false, error: 'daily_rate is required and must be a non-negative number' };
  }
  if (!isFiniteNumber(deposit) || deposit < 0) {
    return { ok: false, error: 'deposit is required and must be a non-negative number' };
  }
  const desc = typeof description === 'string' ? description : '';
  const photos = Array.isArray(photo_urls)
    ? photo_urls.filter((url): url is string => typeof url === 'string')
    : [];
  return {
    ok: true,
    values: [id, owner, title, desc, photos, location, daily_rate, deposit],
  };
}

/// GET /listings?owner=
listingsRouter.get('/', async (req, res) => {
  const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const sql = owner
    ? `SELECT l.*, ${CURRENTLY_BOOKED_SQL} FROM listings l WHERE l.owner = $1 ORDER BY l.created_at DESC`
    : `SELECT l.*, ${CURRENTLY_BOOKED_SQL} FROM listings l ORDER BY l.created_at DESC`;
  const result = await pool.query(sql, owner ? [owner] : []);
  res.json(result.rows);
});

/// GET /listings/:id
listingsRouter.get('/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT l.*, ${CURRENTLY_BOOKED_SQL} FROM listings l WHERE l.id = $1`,
    [req.params.id],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'listing not found' });
    return;
  }
  res.json(result.rows[0]);
});

/// Rejects a malformed request body before any authentication work: a
/// caller cannot even obtain a matching challenge for POST /listings
/// without already knowing the target id (createChallenge requires a
/// listingId), so an id-shaped body is a precondition for auth to be
/// meaningful here, not an authorization concern itself. Kept separate
/// from requireListingAuth so "malformed request" (400) and
/// "unauthenticated" (401) stay distinguishable to callers and tests.
function requireBodyId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.body as ListingInput | undefined)?.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    res.status(400).json({ error: 'id is required and must be a non-empty string' });
    return;
  }
  next();
}

/// POST /listings
/// Auth: the caller must present a valid, unexpired, single-use
/// create_listing challenge for the exact `id` in the body (see
/// auth/middleware.ts), and the authenticated address must equal the
/// body's own `owner` field — a signed-in caller can only ever create a
/// listing that claims to be owned by themselves, never by anyone else.
listingsRouter.post(
  '/',
  requireBodyId,
  requireListingAuth('create_listing', (req) => (req.body as ListingInput).id as string),
  async (req, res) => {
    const normalized = normalizeListing((req.body ?? {}) as ListingInput);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    if (normalized.values[1] !== authenticatedAddress(res)) {
      res.status(403).json({ error: 'body owner must match the authenticated address' });
      return;
    }
    const values = normalized.values;
    try {
      const result = await pool.query(
        `INSERT INTO listings (id, owner, title, description, photo_urls, location, daily_rate, deposit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        values,
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: `a listing with id "${values[0]}" already exists` });
        return;
      }
      throw err;
    }
  },
);

/// PUT /listings/:id
/// Auth: the caller must present a valid, unexpired, single-use
/// update_listing challenge for this exact `:id`, and the authenticated
/// address must equal the *stored* owner of that listing — not the
/// owner field in the request body, which the caller could set to
/// anything. A non-owner (even one who is validly authenticated as
/// themselves) can never update someone else's listing.
listingsRouter.put(
  '/:id',
  requireListingAuth('update_listing', (req) => (typeof req.params.id === 'string' ? req.params.id : undefined)),
  async (req, res) => {
    const existing = await pool.query<{ owner: string }>('SELECT owner FROM listings WHERE id = $1', [
      req.params.id,
    ]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }
    if (existing.rows[0]?.owner !== authenticatedAddress(res)) {
      res.status(403).json({ error: 'only the listing owner may update this listing' });
      return;
    }

    const normalized = normalizeListing({ ...(req.body ?? {}), id: req.params.id } as ListingInput);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    const values = normalized.values;
    const result = await pool.query(
      `UPDATE listings
       SET owner = $2, title = $3, description = $4, photo_urls = $5,
           location = $6, daily_rate = $7, deposit = $8, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      values,
    );
    res.json(result.rows[0]);
  },
);

/// DELETE /listings/:id
/// Auth: the caller must present a valid, unexpired, single-use
/// delete_listing challenge for this exact `:id`, and the authenticated
/// address must equal the *stored* owner of that listing.
listingsRouter.delete(
  '/:id',
  requireListingAuth('delete_listing', (req) => (typeof req.params.id === 'string' ? req.params.id : undefined)),
  async (req, res) => {
    const existing = await pool.query<{ owner: string }>('SELECT owner FROM listings WHERE id = $1', [
      req.params.id,
    ]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }
    if (existing.rows[0]?.owner !== authenticatedAddress(res)) {
      res.status(403).json({ error: 'only the listing owner may delete this listing' });
      return;
    }

    await pool.query('DELETE FROM listings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  },
);
