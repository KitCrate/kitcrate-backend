import { Router } from 'express';

import { pool } from '../db/client.js';

export const agreementsRouter = Router();

const VALID_STATUSES = [
  'Created',
  'Funded',
  'Active',
  'Disputed',
  'Resolved',
  'Completed',
  'Cancelled',
];

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/// GET /agreements?owner=&renter=&status=
/// Lists agreements, optionally filtered by owner, renter and/or status.
agreementsRouter.get('/', async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];

  const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  if (owner) {
    params.push(owner);
    where.push(`owner = $${params.length}`);
  }
  const renter = typeof req.query.renter === 'string' ? req.query.renter : undefined;
  if (renter) {
    params.push(renter);
    where.push(`renter = $${params.length}`);
  }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      res
        .status(400)
        .json({ error: `invalid status; expected one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const sql = `SELECT * FROM agreements ${
    where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY id ASC`;
  const result = await pool.query(sql, params);
  res.json(result.rows);
});

/// GET /agreements/:id
agreementsRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id ?? '');
  if (id === null) {
    res.status(400).json({ error: 'invalid agreement id' });
    return;
  }
  const result = await pool.query('SELECT * FROM agreements WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'agreement not found' });
    return;
  }
  res.json(result.rows[0]);
});

/// GET /agreements/:id/events
/// Full event history for one agreement, oldest first.
agreementsRouter.get('/:id/events', async (req, res) => {
  const id = parseId(req.params.id ?? '');
  if (id === null) {
    res.status(400).json({ error: 'invalid agreement id' });
    return;
  }
  const result = await pool.query(
    `SELECT ledger_seq, event_index, topic, data, processed_at
     FROM agreement_events
     WHERE agreement_id = $1
     ORDER BY ledger_seq ASC, event_index ASC`,
    [id],
  );
  res.json(result.rows);
});
