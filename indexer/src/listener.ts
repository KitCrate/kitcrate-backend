import type { PoolClient } from 'pg';
import { Address, xdr } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';

import { config } from './config.js';
import { pool } from './db/client.js';

/// The subset of the RPC event shape this listener consumes. The SDK
/// already decodes topic and value into xdr.ScVal objects.
interface ContractEvent {
  id: string;
  ledger: number;
  transactionIndex: number;
  operationIndex: number;
  inSuccessfulContractCall: boolean;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

/// A decoded RentalEscrow event, ready for persistence.
export interface ParsedEvent {
  eventId: string;
  ledger: number;
  eventIndex: number;
  topicName: string;
  agreementId: string;
  data: unknown;
}

/// The contract serializes AgreementStatus as its variant index; the
/// off-chain status names are documented in the contract types.
const STATUS_NAMES = [
  'Created',
  'Funded',
  'Active',
  'Disputed',
  'Resolved',
  'Completed',
  'Cancelled',
] as const;

/// Status each transition event moves an agreement to.
const EVENT_STATUS: Record<string, string> = {
  agreement_funded: 'Funded',
  rental_started: 'Active',
  claim_raised: 'Disputed',
  dispute_resolved: 'Resolved',
  funds_released: 'Completed',
  agreement_cancelled: 'Cancelled',
};

/// Converts an xdr.ScVal into JSON-safe data. i128/u64 amounts stay as
/// decimal strings (they can exceed JavaScript's safe integer range),
/// addresses become their strkey form and contracttype structs become
/// plain objects keyed by field name.
function scvToJson(scv: xdr.ScVal): unknown {
  switch (scv.switch()) {
    case xdr.ScValType.scvVoid():
      return null;
    case xdr.ScValType.scvBool():
      return scv.b();
    case xdr.ScValType.scvU32():
      return scv.u32();
    case xdr.ScValType.scvI32():
      return scv.i32();
    case xdr.ScValType.scvU64():
      return scv.u64().toBigInt().toString();
    case xdr.ScValType.scvI64():
      return scv.i64().toBigInt().toString();
    case xdr.ScValType.scvU128(): {
      const parts = scv.u128();
      return ((parts.hi().toBigInt() << 64n) + parts.lo().toBigInt()).toString();
    }
    case xdr.ScValType.scvI128(): {
      const parts = scv.i128();
      const hi = parts.hi().toBigInt();
      const lo = parts.lo().toBigInt();
      return ((hi << 64n) + lo).toString();
    }
    case xdr.ScValType.scvString():
      return scv.str().toString();
    case xdr.ScValType.scvSymbol():
      return scv.sym().toString();
    case xdr.ScValType.scvAddress():
      return Address.fromScVal(scv).toString();
    case xdr.ScValType.scvVec():
      return (scv.vec() ?? []).map((item) => scvToJson(item));
    case xdr.ScValType.scvMap(): {
      const out: Record<string, unknown> = {};
      for (const entry of scv.map() ?? []) {
        out[String(scvToJson(entry.key()))] = scvToJson(entry.val());
      }
      return out;
    }
    case xdr.ScValType.scvBytes():
      return scv.bytes().toString('hex');
    default:
      return null;
  }
}

/// The RPC event id ends with a zero-padded index within the ledger;
/// used only as a display/sort hint, the event id itself is the
/// authoritative uniqueness key.
function parseEventIndex(eventId: string): number {
  const parts = eventId.split('-');
  const last = parts[parts.length - 1];
  const index = Number.parseInt(last ?? '', 10);
  return Number.isNaN(index) ? 0 : index;
}

/// Decodes a contract event. Events from failed calls are filtered out
/// by the caller. Returns null for events that are not RentalEscrow
/// events (wrong topic shape).
export function parseEvent(event: ContractEvent): ParsedEvent | null {
  const nameScv = event.topic[0];
  const idScv = event.topic[1];
  if (!nameScv || !idScv) {
    return null;
  }
  if (nameScv.switch() !== xdr.ScValType.scvSymbol()) {
    return null;
  }
  if (idScv.switch() !== xdr.ScValType.scvU64()) {
    return null;
  }
  return {
    eventId: event.id,
    ledger: event.ledger,
    eventIndex: parseEventIndex(event.id),
    topicName: String(nameScv.sym()),
    agreementId: idScv.u64().toBigInt().toString(),
    data: scvToJson(event.value),
  };
}

async function readCheckpoint(): Promise<number> {
  const result = await pool.query('SELECT last_processed_ledger FROM sync_state WHERE id = 1');
  return Number(result.rows[0]?.last_processed_ledger ?? config.startLedger);
}

async function writeCheckpoint(ledger: number): Promise<void> {
  await pool.query(
    `INSERT INTO sync_state (id, last_processed_ledger) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET last_processed_ledger = EXCLUDED.last_processed_ledger`,
    [ledger],
  );
}

/// Applies a single event to the derived `agreements` current-state
/// table. `agreement_created` carries the full agreement as a named map;
/// every other event only flips the status. Every row is scoped by the
/// configured contract id so a redeployed contract (whose agreement
/// counter restarts at 1) can never collide with rows from a previous
/// deployment.
async function applyStateTransition(client: PoolClient, parsed: ParsedEvent): Promise<void> {
  const { topicName, agreementId, ledger, data } = parsed;
  switch (topicName) {
    case 'agreement_created': {
      const d = data as Record<string, unknown>;
      const statusIndex = Number(d.status ?? 0);
      await client.query(
        `INSERT INTO agreements (
           contract_id, id, owner, renter, item_ref, rental_amount,
           deposit_amount, start_time, end_time, claim_window_secs, status,
           created_at, created_ledger, updated_ledger
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          config.contractId,
          agreementId,
          d.owner,
          d.renter,
          d.item_ref,
          d.rental_amount,
          d.deposit_amount,
          d.start_time,
          d.end_time,
          d.claim_window_secs,
          STATUS_NAMES[statusIndex] ?? 'Created',
          d.created_at,
          ledger,
          ledger,
        ],
      );
      return;
    }
    default: {
      const status = EVENT_STATUS[topicName];
      if (!status) {
        return;
      }
      await client.query(
        'UPDATE agreements SET status = $1, updated_ledger = $2 WHERE contract_id = $3 AND id = $4',
        [status, ledger, config.contractId, agreementId],
      );
    }
  }
}

/// Outcome of persisting one event.
type PersistOutcome = 'inserted' | 'duplicate' | 'changed';

/// Persists one event and, when it is new, applies its state transition.
/// Both writes happen in one transaction and the event insert is
/// idempotent (`ON CONFLICT DO NOTHING` keyed on the RPC event id), so
/// reprocessing the same event after a restart or a reorg never creates
/// duplicate rows or double-applies a transition.
///
/// When the event id already exists, the incoming event is compared with
/// the indexed copy. A difference means the ledger content changed under
/// us, which is evidence of a reorg that the checkpoint-vs-tip check
/// would miss (for example a same-height reorg), and `changed` is
/// returned so the poll loop can rebuild.
async function persistEvent(event: ParsedEvent): Promise<PersistOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO agreement_events (id, ledger_seq, event_index, agreement_id, topic, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.eventId,
        event.ledger,
        event.eventIndex,
        event.agreementId,
        event.topicName,
        JSON.stringify(event.data),
      ],
    );
    if (inserted.rowCount === 1) {
      await applyStateTransition(client, event);
      await client.query('COMMIT');
      return 'inserted';
    }
    await client.query('COMMIT');
    const stored = await client.query(
      'SELECT topic, data::text AS data FROM agreement_events WHERE id = $1',
      [event.eventId],
    );
    const row = stored.rows[0];
    if (row && (row.topic !== event.topicName || row.data !== JSON.stringify(event.data))) {
      return 'changed';
    }
    return 'duplicate';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface ProcessResult {
  highest: number;
  reorgDetected: boolean;
}

/// Fetches and decodes events starting at `startLedger`, following the
/// pagination cursor until caught up with `tip`. Returns the highest
/// ledger whose events were processed and whether any event content
/// conflicted with an already-indexed copy (reorg evidence).
async function processEvents(
  server: Server,
  startLedger: number,
  tip: number,
): Promise<ProcessResult> {
  let cursor: string | undefined;
  let highest = startLedger;
  let reorgDetected = false;
  for (;;) {
    const filters = [{ type: 'contract' as const, contractIds: [config.contractId] }];
    const response = await server.getEvents(
      cursor
        ? { filters, cursor, limit: 200 }
        : { filters, startLedger, limit: 200 },
    );

    for (const event of response.events) {
      if (!event.inSuccessfulContractCall) {
        continue;
      }
      const parsed = parseEvent(event);
      if (parsed) {
        const outcome = await persistEvent(parsed);
        if (outcome === 'changed') {
          reorgDetected = true;
        }
        console.log(
          `[listener] ${parsed.topicName} agreement=${parsed.agreementId} ledger=${parsed.ledger}`,
        );
      }
      if (event.ledger > highest) {
        highest = event.ledger;
      }
    }

    if (response.events.length === 0 || highest >= tip) {
      break;
    }
    if (!response.cursor) {
      break;
    }
    cursor = response.cursor;
  }
  return { highest, reorgDetected };
}

/// Starts the polling loop. Soroban RPC has no push mechanism, so events
/// are polled on a short interval. Ledger rollbacks are detected by
/// comparing the checkpoint against the RPC tip; when the chain has
/// rolled back behind the checkpoint, state is rebuilt from scratch so
/// the indexer cannot silently drift out of sync.
export function startListener(): { stop: () => void } {
  if (!config.contractId) {
    console.warn('[listener] CONTRACT_ID is not set; the event listener will not start');
    return { stop: () => undefined };
  }

  const server = new Server(config.rpcUrl, { allowHttp: true });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    try {
      // Rebuild and re-index when a reorg is detected; capped so a
      // pathological RPC cannot loop forever.
      const maxRebuilds = 5;
      let rebuilds = 0;
      for (;;) {
        const latest = await server.getLatestLedger();
        const lastProcessed = await readCheckpoint();

        if (lastProcessed > latest.sequence) {
          console.warn(
            `[listener] rollback detected: checkpoint ${lastProcessed} is ahead of tip ` +
              `${latest.sequence}; rebuilding state`,
          );
          await rebuildState();
        } else {
          const { highest, reorgDetected } = await processEvents(
            server,
            lastProcessed,
            latest.sequence,
          );
          if (reorgDetected) {
            console.warn(
              '[listener] an indexed event changed on-chain; rebuilding state',
            );
            await rebuildState();
          } else {
            await writeCheckpoint(highest);
            console.log(`[listener] caught up through ledger ${highest}`);
            break;
          }
        }

        rebuilds += 1;
        if (rebuilds >= maxRebuilds) {
          console.error(`[listener] giving up after ${maxRebuilds} rebuilds; retrying next poll`);
          break;
        }
      }
    } catch (err) {
      console.error('[listener] poll failed', err);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), config.pollIntervalMs);
      }
    }
  };

  /// Wipes both tables and resets the checkpoint so the next pass
  /// re-indexes from `START_LEDGER` on the canonical chain.
  const rebuildState = async (): Promise<void> => {
    await pool.query('DELETE FROM agreement_events');
    await pool.query('DELETE FROM agreements');
    await writeCheckpoint(config.startLedger);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}
