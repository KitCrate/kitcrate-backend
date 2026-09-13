import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { pool } from '../src/db/client.js';
import { persistEvent, type ParsedEvent } from '../src/listener.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
});

let nextEventOrdinal = 1;
/// Builds a syntactically valid, strictly-increasing eventId, matching
/// the Soroban RPC's own "ledger-ordinal-index" shape closely enough for
/// this suite's purposes (only uniqueness and the parseEventIndex helper
/// elsewhere care about its exact format, not persistEvent itself, which
/// treats eventId as an opaque primary key).
function eventId(): string {
  const n = nextEventOrdinal++;
  return `0000000${n}-0000000000-${String(n).padStart(10, '0')}`;
}

function createdEvent(agreementId: string, ledger: number): ParsedEvent {
  return {
    eventId: eventId(),
    ledger,
    eventIndex: 0,
    topicName: 'agreement_created',
    agreementId,
    data: {
      // Real shape confirmed against live Testnet events: Soroban encodes
      // a fieldless enum variant as a one-element vec holding the
      // variant's name, not a bare numeric index. applyStateTransition
      // doesn't actually read this field (create_agreement's status is
      // always Created), but the mock matches real data anyway rather
      // than a shape that was never actually correct.
      status: ['Created'],
      owner: 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L',
      renter: 'GDPSNPO45LKBBUL2LTBR7P2ZUU4KEV3C3F5OO2DHYCGCCDLORNZGH5LL',
      item_ref: 'listing-1',
      rental_amount: '1000',
      deposit_amount: '500',
      start_time: '1700000000',
      end_time: '1700086400',
      claim_window_secs: '86400',
      created_at: '1700000000',
    },
  };
}

function transitionEvent(topicName: string, agreementId: string, ledger: number): ParsedEvent {
  return { eventId: eventId(), ledger, eventIndex: 0, topicName, agreementId, data: agreementId };
}

async function agreementRow(agreementId: string): Promise<{ status: string } | undefined> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM agreements WHERE id = $1',
    [agreementId],
  );
  return result.rows[0];
}

async function orphanCount(agreementId: string): Promise<number> {
  const result = await pool.query('SELECT count(*)::int AS n FROM orphaned_events WHERE agreement_id = $1', [
    agreementId,
  ]);
  return (result.rows[0] as { n: number }).n;
}

describe('the normal (non-orphaned) path', () => {
  test('agreement_created inserts a row and a later transition updates it, recording no orphan', async () => {
    await persistEvent(createdEvent('1', 100));
    let row = await agreementRow('1');
    assert.equal(row?.status, 'Created');

    const outcome = await persistEvent(transitionEvent('rental_started', '1', 101));
    assert.equal(outcome, 'inserted');
    row = await agreementRow('1');
    assert.equal(row?.status, 'Active');
    assert.equal(await orphanCount('1'), 0);
  });
});

describe('the orphan case (P1-3): a transition event with no matching agreements row', () => {
  test('does not create a phantom agreements row', async () => {
    await persistEvent(transitionEvent('rental_started', '999', 100));
    const row = await agreementRow('999');
    assert.equal(row, undefined);
  });

  test('is recorded, not silently discarded', async () => {
    const event = transitionEvent('rental_started', '999', 100);
    await persistEvent(event);
    const result = await pool.query(
      'SELECT agreement_id, event_id, topic, ledger_seq FROM orphaned_events WHERE agreement_id = $1',
      ['999'],
    );
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      agreement_id: '999', // BIGINT columns come back from pg as strings
      event_id: event.eventId,
      topic: 'rental_started',
      ledger_seq: '100',
    });
  });

  test('is discoverable via GET /diagnostics/orphaned-events', async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      await persistEvent(transitionEvent('rental_started', '999', 100));
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/diagnostics/orphaned-events`);
      assert.equal(res.status, 200);
      const rows = (await res.json()) as { agreement_id: string; topic: string }[];
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0]?.agreement_id), '999');
      assert.equal(rows[0]?.topic, 'rental_started');
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });

  test('multiple distinct orphaned events for the same still-missing agreement are each recorded independently', async () => {
    await persistEvent(transitionEvent('rental_started', '999', 100));
    await persistEvent(transitionEvent('funds_released', '999', 200));
    assert.equal(await orphanCount('999'), 2);
    const row = await agreementRow('999');
    assert.equal(row, undefined);
  });

  test('once the creation event does arrive, subsequent transitions apply normally (no new orphans)', async () => {
    await persistEvent(transitionEvent('rental_started', '5', 100));
    assert.equal(await orphanCount('5'), 1);

    // The creation event shows up late (e.g. after a corrected
    // START_LEDGER and a manual rebuild) -- current behavior is that it
    // is simply inserted as any agreement_created event would be; this
    // does not retroactively resolve the earlier orphan record (that gap
    // in ordering already happened and is not silently erased), but
    // every event from here on applies normally.
    await persistEvent(createdEvent('5', 50));
    await persistEvent(transitionEvent('funds_released', '5', 300));
    assert.equal(await orphanCount('5'), 1);
    const row = await agreementRow('5');
    assert.equal(row?.status, 'Completed');
  });
});

describe('idempotent replay (restart safety)', () => {
  test('persisting the exact same event twice is a no-op the second time', async () => {
    await persistEvent(createdEvent('1', 100));
    const event = transitionEvent('rental_started', '1', 101);

    const first = await persistEvent(event);
    assert.equal(first, 'inserted');
    const second = await persistEvent(event);
    assert.equal(second, 'duplicate');

    const row = await agreementRow('1');
    assert.equal(row?.status, 'Active');

    const events = await pool.query('SELECT count(*)::int AS n FROM agreement_events WHERE agreement_id = 1', []);
    assert.equal((events.rows[0] as { n: number }).n, 2); // created + rental_started, each once
  });

  test('replaying a full event batch twice (simulating a restart before the checkpoint was saved) reaches identical final state', async () => {
    const batch = [
      createdEvent('7', 100),
      transitionEvent('agreement_funded', '7', 101),
      transitionEvent('rental_started', '7', 102),
    ];
    for (const event of batch) await persistEvent(event);
    for (const event of batch) await persistEvent(event); // restart replay

    const row = await agreementRow('7');
    assert.equal(row?.status, 'Active');
    const events = await pool.query('SELECT count(*)::int AS n FROM agreement_events WHERE agreement_id = 7', []);
    assert.equal((events.rows[0] as { n: number }).n, 3);
    assert.equal(await orphanCount('7'), 0);
  });

  test('replaying an orphan-producing batch twice does not double-record the orphan', async () => {
    const event = transitionEvent('rental_started', '999', 100);
    await persistEvent(event);
    await persistEvent(event); // restart replay of the same never-applied event

    assert.equal(await orphanCount('999'), 1);
  });
});

describe('an unrecognized event topic', () => {
  test('is stored in agreement_events but does not touch agreements or orphaned_events', async () => {
    await persistEvent(createdEvent('1', 100));
    await persistEvent(transitionEvent('some_future_event_type', '1', 101));

    const row = await agreementRow('1');
    assert.equal(row?.status, 'Created'); // unchanged
    assert.equal(await orphanCount('1'), 0);
    const events = await pool.query('SELECT count(*)::int AS n FROM agreement_events WHERE agreement_id = 1', []);
    assert.equal((events.rows[0] as { n: number }).n, 2);
  });
});
