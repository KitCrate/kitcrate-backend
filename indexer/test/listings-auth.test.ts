import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { pool } from '../src/db/client.js';
import { createChallenge } from '../src/auth/challenges.js';
import { generateSigner, resetDb, signedListingHeaders, type TestSigner } from './helpers.js';

let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  await resetDb();
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

function listingBody(overrides: Partial<Record<string, unknown>> = {}, owner: string, id: string) {
  return {
    id,
    owner,
    title: 'Cordless Drill',
    description: 'Good condition',
    photo_urls: [],
    location: 'Portland, OR',
    daily_rate: 12.5,
    deposit: 40,
    ...overrides,
  };
}

async function createListingDirectly(owner: string, id = 'listing-seed'): Promise<void> {
  await pool.query(
    `INSERT INTO listings (id, owner, title, description, photo_urls, location, daily_rate, deposit)
     VALUES ($1, $2, 'Seed listing', '', '{}', 'Portland, OR', 10, 20)`,
    [id, owner],
  );
}

describe('GET /listings remains public', () => {
  test('GET /listings and GET /listings/:id require no authentication headers at all', async () => {
    const owner = generateSigner();
    await createListingDirectly(owner.address, 'public-1');

    const list = await fetch(`${baseUrl}/listings`);
    assert.equal(list.status, 200);
    const rows = (await list.json()) as unknown[];
    assert.equal(rows.length, 1);

    const one = await fetch(`${baseUrl}/listings/public-1`);
    assert.equal(one.status, 200);
  });
});

describe('POST /listings (create_listing)', () => {
  test('missing auth headers entirely is rejected with 401', async () => {
    const owner = generateSigner();
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(listingBody({}, owner.address, 'create-1')),
    });
    assert.equal(res.status, 401);
  });

  test('a malformed request (no id in the body) is rejected with 400 before any auth work', async () => {
    const owner = generateSigner();
    const body = listingBody({}, owner.address, 'ignored');
    delete (body as Record<string, unknown>).id;
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  });

  test('a malformed request (missing title) with otherwise valid auth is rejected with 400', async () => {
    const owner = generateSigner();
    const id = 'create-malformed';
    const body = listingBody({}, owner.address, id);
    delete (body as Record<string, unknown>).title;
    const headers = await signedListingHeaders(baseUrl, owner, 'create_listing', id);
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  });

  test('an invalid signature is rejected with 401', async () => {
    const owner = generateSigner();
    const id = 'create-badsig';
    const challenge = await createChallenge({ address: owner.address, action: 'create_listing', listingId: id });
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kitcrate-Address': owner.address,
        'X-Kitcrate-Nonce': challenge.nonce,
        'X-Kitcrate-Signature': Buffer.from('not a real signature over anything').toString('base64'),
      },
      body: JSON.stringify(listingBody({}, owner.address, id)),
    });
    assert.equal(res.status, 401);
  });

  test('an expired challenge is rejected with 401', async () => {
    const owner = generateSigner();
    const id = 'create-expired';
    // Insert an already-expired challenge directly (waiting out the real
    // TTL is not practical in a test), signed correctly for its message.
    const message = [
      'KitCrate listing authentication (v1)',
      'This signature only authorizes a listing-metadata request to the KitCrate indexer API.',
      'It does not authorize any on-chain transaction, and it never moves funds.',
      `Address: ${owner.address}`,
      'Action: create_listing',
      `Listing: ${id}`,
      'Nonce: expired-nonce',
      `Issued: ${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`,
      `Expires: ${new Date(Date.now() - 5 * 60 * 1000).toISOString()}`,
    ].join('\n');
    await pool.query(
      `INSERT INTO auth_challenges (nonce, address, action, listing_id, message, expires_at)
       VALUES ($1, $2, 'create_listing', $3, $4, $5)`,
      [
        'expired-nonce',
        owner.address,
        id,
        message,
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ],
    );
    const signature = owner.keypair.signMessage(message);
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kitcrate-Address': owner.address,
        'X-Kitcrate-Nonce': 'expired-nonce',
        'X-Kitcrate-Signature': signature.toString('base64'),
      },
      body: JSON.stringify(listingBody({}, owner.address, id)),
    });
    assert.equal(res.status, 401);
  });

  test('body owner mismatch (authenticated as A, body claims owner B) is rejected with 403', async () => {
    const authenticatedAs = generateSigner();
    const claimedOwner = generateSigner();
    const id = 'create-mismatch';
    const headers = await signedListingHeaders(baseUrl, authenticatedAs, 'create_listing', id);
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({}, claimedOwner.address, id)),
    });
    assert.equal(res.status, 403);
  });

  test('a valid, correctly-owned create succeeds end-to-end through the real HTTP challenge endpoint', async () => {
    const owner = generateSigner();
    const id = 'create-valid';

    // Full real client flow: request a challenge over HTTP (not the
    // internal helper), sign it, then submit — proving the actual wire
    // protocol works, not just the underlying functions.
    const challengeRes = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: owner.address, action: 'create_listing', listingId: id }),
    });
    assert.equal(challengeRes.status, 201);
    const challenge = (await challengeRes.json()) as { nonce: string; message: string };
    const signature = owner.keypair.signMessage(challenge.message);

    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kitcrate-Address': owner.address,
        'X-Kitcrate-Nonce': challenge.nonce,
        'X-Kitcrate-Signature': signature.toString('base64'),
      },
      body: JSON.stringify(listingBody({}, owner.address, id)),
    });
    assert.equal(res.status, 201);
    const row = (await res.json()) as { id: string; owner: string };
    assert.equal(row.id, id);
    assert.equal(row.owner, owner.address);
  });

  test('replaying the exact same signed challenge a second time is rejected with 401', async () => {
    const owner = generateSigner();
    const id = 'create-replay';
    const challenge = await createChallenge({ address: owner.address, action: 'create_listing', listingId: id });
    const signature = owner.keypair.signMessage(challenge.message);
    const headers = {
      'Content-Type': 'application/json',
      'X-Kitcrate-Address': owner.address,
      'X-Kitcrate-Nonce': challenge.nonce,
      'X-Kitcrate-Signature': signature.toString('base64'),
    };

    const first = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(listingBody({}, owner.address, id)),
    });
    assert.equal(first.status, 201);

    const replay = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(listingBody({}, owner.address, `${id}-again`)),
    });
    assert.equal(replay.status, 401);
  });

  test('a challenge issued for a different listing id cannot authorize this one', async () => {
    const owner = generateSigner();
    const headers = await signedListingHeaders(baseUrl, owner, 'create_listing', 'listing-a');
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({}, owner.address, 'listing-b')),
    });
    assert.equal(res.status, 401);
  });

  test('a challenge issued for a different action cannot authorize this one', async () => {
    const owner = generateSigner();
    const id = 'create-wrong-action';
    // Issued for update_listing, attempted against POST (create_listing).
    const headers = await signedListingHeaders(baseUrl, owner, 'update_listing', id);
    const res = await fetch(`${baseUrl}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({}, owner.address, id)),
    });
    assert.equal(res.status, 401);
  });
});

describe('PUT /listings/:id (update_listing)', () => {
  let owner: TestSigner;
  let stranger: TestSigner;
  const id = 'update-target';

  beforeEach(async () => {
    owner = generateSigner();
    stranger = generateSigner();
    await createListingDirectly(owner.address, id);
  });

  test('missing auth headers is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/listings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(listingBody({ title: 'New title' }, owner.address, id)),
    });
    assert.equal(res.status, 401);
  });

  test('wrong owner (authenticated as a different, validly-signed address) is rejected with 403', async () => {
    const headers = await signedListingHeaders(baseUrl, stranger, 'update_listing', id);
    const res = await fetch(`${baseUrl}/listings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({ title: 'Hijacked' }, owner.address, id)),
    });
    assert.equal(res.status, 403);
    const check = await fetch(`${baseUrl}/listings/${id}`);
    const row = (await check.json()) as { title: string };
    assert.equal(row.title, 'Seed listing');
  });

  test('unknown listing id is rejected with 404 even with a validly-signed challenge for that id', async () => {
    const headers = await signedListingHeaders(baseUrl, owner, 'update_listing', 'does-not-exist');
    const res = await fetch(`${baseUrl}/listings/does-not-exist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({}, owner.address, 'does-not-exist')),
    });
    assert.equal(res.status, 404);
  });

  test('the real stored owner succeeds', async () => {
    const headers = await signedListingHeaders(baseUrl, owner, 'update_listing', id);
    const res = await fetch(`${baseUrl}/listings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(listingBody({ title: 'Updated title' }, owner.address, id)),
    });
    assert.equal(res.status, 200);
    const row = (await res.json()) as { title: string };
    assert.equal(row.title, 'Updated title');
  });
});

describe('DELETE /listings/:id (delete_listing)', () => {
  let owner: TestSigner;
  let stranger: TestSigner;
  const id = 'delete-target';

  beforeEach(async () => {
    owner = generateSigner();
    stranger = generateSigner();
    await createListingDirectly(owner.address, id);
  });

  test('missing auth headers is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/listings/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });

  test('wrong owner is rejected with 403 and the listing survives', async () => {
    const headers = await signedListingHeaders(baseUrl, stranger, 'delete_listing', id);
    const res = await fetch(`${baseUrl}/listings/${id}`, { method: 'DELETE', headers });
    assert.equal(res.status, 403);
    const check = await fetch(`${baseUrl}/listings/${id}`);
    assert.equal(check.status, 200);
  });

  test('unknown listing id is rejected with 404', async () => {
    const headers = await signedListingHeaders(baseUrl, owner, 'delete_listing', 'does-not-exist');
    const res = await fetch(`${baseUrl}/listings/does-not-exist`, { method: 'DELETE', headers });
    assert.equal(res.status, 404);
  });

  test('the real stored owner succeeds and the listing is actually gone', async () => {
    const headers = await signedListingHeaders(baseUrl, owner, 'delete_listing', id);
    const res = await fetch(`${baseUrl}/listings/${id}`, { method: 'DELETE', headers });
    assert.equal(res.status, 204);
    const check = await fetch(`${baseUrl}/listings/${id}`);
    assert.equal(check.status, 404);
  });

  test('deleting twice: the second attempt has no challenge left to replay and fails with 401', async () => {
    const headers = await signedListingHeaders(baseUrl, owner, 'delete_listing', id);
    const first = await fetch(`${baseUrl}/listings/${id}`, { method: 'DELETE', headers });
    assert.equal(first.status, 204);
    const second = await fetch(`${baseUrl}/listings/${id}`, { method: 'DELETE', headers });
    assert.equal(second.status, 401);
  });
});

describe('POST /auth/challenge malformed requests', () => {
  test('an invalid address is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'not-an-address', action: 'create_listing', listingId: 'x' }),
    });
    assert.equal(res.status, 400);
  });

  test('an unknown action is rejected with 400', async () => {
    const owner = generateSigner();
    const res = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: owner.address, action: 'withdraw_funds', listingId: 'x' }),
    });
    assert.equal(res.status, 400);
  });

  test('a missing listingId is rejected with 400', async () => {
    const owner = generateSigner();
    const res = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: owner.address, action: 'create_listing' }),
    });
    assert.equal(res.status, 400);
  });
});
