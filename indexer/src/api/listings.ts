import { Router } from 'express';

import { pool } from '../db/client.js';

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
    ? 'SELECT * FROM listings WHERE owner = $1 ORDER BY created_at DESC'
    : 'SELECT * FROM listings ORDER BY created_at DESC';
  const result = await pool.query(sql, owner ? [owner] : []);
  res.json(result.rows);
});

/// GET /listings/:id
listingsRouter.get('/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'listing not found' });
    return;
  }
  res.json(result.rows[0]);
});

/// POST /listings
listingsRouter.post('/', async (req, res) => {
  const normalized = normalizeListing((req.body ?? {}) as ListingInput);
  if (!normalized.ok) {
    res.status(400).json({ error: normalized.error });
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
});

/// PUT /listings/:id
listingsRouter.put('/:id', async (req, res) => {
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
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'listing not found' });
    return;
  }
  res.json(result.rows[0]);
});

/// DELETE /listings/:id
listingsRouter.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM listings WHERE id = $1 RETURNING id', [
    req.params.id,
  ]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'listing not found' });
    return;
  }
  res.status(204).end();
});
