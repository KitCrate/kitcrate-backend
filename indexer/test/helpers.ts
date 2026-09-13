import { Keypair } from '@stellar/stellar-sdk';

import { pool, initDb } from '../src/db/client.js';
import { createChallenge } from '../src/auth/challenges.js';
import type { ListingAuthAction } from '../src/auth/message.js';

/// Truncates every table this test suite touches. Called before each test
/// file's suite so tests never depend on execution order or leftover
/// state from a previous run.
export async function resetDb(): Promise<void> {
  await initDb();
  await pool.query(
    'TRUNCATE listings, auth_challenges, agreements, agreement_events, orphaned_events, sync_state RESTART IDENTITY CASCADE',
  );
}

export interface TestSigner {
  address: string;
  keypair: Keypair;
}

/// A fresh, in-memory-only Stellar keypair, generated locally for this
/// test run alone. Never derived from, or written to, any real account —
/// there is no such thing as a "production private key" for an address
/// that was never funded, registered, or used outside this process.
export function generateSigner(): TestSigner {
  const keypair = Keypair.random();
  return { address: keypair.publicKey(), keypair };
}

/// Requests a real challenge from the running app and signs it with the
/// given test keypair via the same SEP-53 method the SDK's wallet.ts
/// wrapper asks Freighter to perform, producing the same header values a
/// genuine browser-signed request would carry.
export async function signedListingHeaders(
  baseUrl: string,
  signer: TestSigner,
  action: ListingAuthAction,
  listingId: string,
): Promise<Record<string, string>> {
  const challenge = await createChallenge({ address: signer.address, action, listingId });
  const signature = signer.keypair.signMessage(challenge.message);
  return {
    'X-Kitcrate-Address': signer.address,
    'X-Kitcrate-Nonce': challenge.nonce,
    'X-Kitcrate-Signature': signature.toString('base64'),
  };
}
