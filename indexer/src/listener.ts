import { Address, xdr } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';

import { config } from './config.js';

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

/// Fetches and decodes events starting at `startLedger`, following the
/// pagination cursor until caught up with `tip`. Returns the highest
/// ledger whose events were processed.
async function processEvents(server: Server, startLedger: number, tip: number): Promise<number> {
  let cursor: string | undefined;
  let highest = startLedger;
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
        // Persistence is wired in a later step; for now the decoded event
        // is logged so the pipeline can be observed.
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
  return highest;
}

/// Starts the polling loop. Soroban RPC has no push mechanism, so events
/// are polled on a short interval.
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
      const latest = await server.getLatestLedger();
      // The resume point is the configured start ledger until the
      // checkpoint persistence lands in a later step.
      const start = config.startLedger;
      const highest = await processEvents(server, start, latest.sequence);
      console.log(`[listener] caught up through ledger ${highest} (tip ${latest.sequence})`);
    } catch (err) {
      console.error('[listener] poll failed', err);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), config.pollIntervalMs);
      }
    }
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
