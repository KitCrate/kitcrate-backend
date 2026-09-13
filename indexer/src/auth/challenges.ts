import { randomBytes } from 'node:crypto';

import { pool } from '../db/client.js';
import { buildChallengeMessage, CHALLENGE_TTL_MS, type ListingAuthAction } from './message.js';

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

/// Issues a new one-shot challenge for `address` to perform `action` on
/// `listingId`. The nonce is 256 bits of CSPRNG output, base64url-encoded
/// — collision-proof in practice, so no uniqueness retry loop is needed
/// even though the column is a primary key.
export async function createChallenge(params: {
  address: string;
  action: ListingAuthAction;
  listingId: string;
}): Promise<Challenge> {
  const nonce = randomBytes(32).toString('base64url');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildChallengeMessage({
    address: params.address,
    action: params.action,
    listingId: params.listingId,
    nonce,
    issuedAt,
    expiresAt,
  });
  await pool.query(
    `INSERT INTO auth_challenges (nonce, address, action, listing_id, message, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [nonce, params.address, params.action, params.listingId, message, expiresAt.toISOString()],
  );
  // Opportunistic, not required for correctness — see pruneExpiredChallenges.
  await pruneExpiredChallenges();
  return { nonce, message, expiresAt: expiresAt.toISOString() };
}

/// Atomically consumes (deletes) a matching, unexpired challenge and
/// returns the exact message text it was issued with, or `null` if no
/// such challenge exists — covering "never existed", "wrong
/// address/action/listing", "expired", and "already used" as a single
/// outcome, deliberately, so a caller cannot distinguish those reasons
/// from the response (see auth/middleware.ts).
///
/// The row is deleted in the same statement that reads it (`DELETE ...
/// RETURNING`), so two concurrent requests racing on the same nonce can
/// never both succeed: Postgres row-level locking guarantees exactly one
/// of them deletes the row and gets a result back, and this happens
/// *before* the caller has verified anything about the signature — a
/// challenge is single-use the moment it is looked up, regardless of
/// whether the signature attached to this particular request turns out
/// to be valid. That is deliberate: it prevents a nonce from being
/// usable as a repeatable oracle for signature-guessing attempts.
export async function consumeChallenge(params: {
  nonce: string;
  address: string;
  action: ListingAuthAction;
  listingId: string;
}): Promise<{ message: string } | null> {
  const result = await pool.query<{ message: string }>(
    `DELETE FROM auth_challenges
     WHERE nonce = $1 AND address = $2 AND action = $3 AND listing_id = $4
       AND expires_at > now()
     RETURNING message`,
    [params.nonce, params.address, params.action, params.listingId],
  );
  return result.rows[0] ?? null;
}

/// Best-effort cleanup of expired, never-consumed challenges. Not required
/// for correctness (consumeChallenge's own `expires_at > now()` guard
/// already refuses expired rows), only for keeping the table small; called
/// opportunistically from createChallenge so no separate scheduled job is
/// needed.
export async function pruneExpiredChallenges(): Promise<void> {
  await pool.query('DELETE FROM auth_challenges WHERE expires_at <= now()');
}
