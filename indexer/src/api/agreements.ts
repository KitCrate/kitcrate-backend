import { Router, type Response } from 'express';

import { config } from '../config.js';
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

/// The indexer only ever watches the contract named by CONTRACT_ID, so
/// every agreement query is scoped to it: a lookup for agreement 1 must
/// only ever return the row for the currently configured contract, never
/// agreement 1 from a previous deployment. Returns the configured id, or
/// responds 503 and returns null when CONTRACT_ID is unset (no agreement
/// rows can exist without it, and silently returning an empty list would
/// hide the misconfiguration).
function requireContractId(res: Response): string | null {
  if (config.contractId) {
    return config.contractId;
  }
  res.status(503).json({ error: 'CONTRACT_ID is not set; agreement data is unavailable' });
  return null;
}

/// GET /agreements?owner=&renter=&status=
/// Lists agreements for the configured contract, optionally filtered by
/// owner, renter and/or status.
agreementsRouter.get('/', async (req, res) => {
  const contractId = requireContractId(res);
  if (contractId === null) {
    return;
  }
  const where: string[] = ['contract_id = $1'];
  const params: unknown[] = [contractId];

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
/// Returns one agreement for the configured contract; agreement ids are
/// only unique within a contract deployment, so the lookup is always
/// scoped by contract_id.
agreementsRouter.get('/:id', async (req, res) => {
  const contractId = requireContractId(res);
  if (contractId === null) {
    return;
  }
  const id = parseId(req.params.id ?? '');
  if (id === null) {
    res.status(400).json({ error: 'invalid agreement id' });
    return;
  }
  const result = await pool.query('SELECT * FROM agreements WHERE contract_id = $1 AND id = $2', [
    contractId,
    id,
  ]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'agreement not found' });
    return;
  }
  res.json(result.rows[0]);
});

/// GET /agreements/:id/events
/// Full event history for one agreement of the configured contract,
/// oldest first.
agreementsRouter.get('/:id/events', async (req, res) => {
  const contractId = requireContractId(res);
  if (contractId === null) {
    return;
  }
  const id = parseId(req.params.id ?? '');
  if (id === null) {
    res.status(400).json({ error: 'invalid agreement id' });
    return;
  }
  const result = await pool.query(
    `SELECT ledger_seq, event_index, topic, data, processed_at
     FROM agreement_events
     WHERE contract_id = $1 AND agreement_id = $2
     ORDER BY ledger_seq ASC, event_index ASC`,
    [contractId, id],
  );
  res.json(result.rows);
});
