import { Router } from 'express';

import { pool } from '../db/client.js';
import { config } from '../config.js';

export const diagnosticsRouter = Router();

/// GET /diagnostics/orphaned-events
/// Lists every recorded orphan for this indexer's configured contract: a
/// non-creation event that arrived with no matching `agreements` row
/// because its agreement_created event was never indexed (see
/// listener.ts's applyStateTransition). Each row here means the derived
/// `agreements` table is missing that agreement entirely, even though
/// the raw event itself is still in `agreement_events` — this endpoint
/// exists so that gap is discoverable rather than requiring someone to
/// notice a missing row and go looking through server logs.
diagnosticsRouter.get('/orphaned-events', async (_req, res) => {
  const result = await pool.query(
    `SELECT id, agreement_id, event_id, topic, ledger_seq, detected_at
     FROM orphaned_events
     WHERE contract_id = $1
     ORDER BY detected_at DESC`,
    [config.contractId],
  );
  res.json(result.rows);
});
