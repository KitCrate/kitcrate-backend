// SEP-53 ("Sign Message") based authentication for listing mutations.
//
// Why SEP-53 rather than a new credential system: every KitCrate user
// already controls a Stellar keypair through their connected wallet
// (Freighter), which is the same keypair that signs on-chain
// transactions. SEP-53 lets that same wallet prove control of the
// address off-chain, with no new key material, no password, and no
// server-held secret — the server only ever needs the user's public
// address, never anything private. See
// https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
//
// This module never touches escrowed funds or the contract: it only
// gates writes to the indexer's own `listings` metadata table. A forged
// or replayed signature here could, at worst, let someone falsely claim
// authorship of off-chain listing metadata — it cannot move money, since
// the contract's own `require_auth()` checks are entirely independent
// (see contracts/rental-escrow).

import { Keypair } from '@stellar/stellar-sdk';

export const LISTING_AUTH_ACTIONS = ['create_listing', 'update_listing', 'delete_listing'] as const;
export type ListingAuthAction = (typeof LISTING_AUTH_ACTIONS)[number];

export function isListingAuthAction(value: unknown): value is ListingAuthAction {
  return (
    typeof value === 'string' && (LISTING_AUTH_ACTIONS as readonly string[]).includes(value)
  );
}

/// How long an issued challenge remains valid and unused before it can no
/// longer be consumed. Short enough that a leaked/intercepted challenge
/// (before it is signed) is useless almost immediately; long enough that a
/// real signing prompt in a wallet extension is never a race against the
/// clock.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/// Builds the exact human-readable text the wallet is asked to sign. The
/// server stores this string verbatim when the challenge is issued and
/// re-uses that stored copy (not a re-derivation) when verifying, so
/// there is never a risk of the signed text and the verified text
/// silently drifting apart. Every field that matters to what is being
/// authorized is spelled out in the message itself, both so the
/// signature is meaningfully bound to this one action (not just "this
/// address exists") and so a human reviewing the wallet's signing prompt
/// can see exactly what they are approving.
export function buildChallengeMessage(params: {
  address: string;
  action: ListingAuthAction;
  listingId: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const { address, action, listingId, nonce, issuedAt, expiresAt } = params;
  return [
    'KitCrate listing authentication (v1)',
    'This signature only authorizes a listing-metadata request to the KitCrate indexer API.',
    'It does not authorize any on-chain transaction, and it never moves funds.',
    `Address: ${address}`,
    `Action: ${action}`,
    `Listing: ${listingId}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt.toISOString()}`,
    `Expires: ${expiresAt.toISOString()}`,
  ].join('\n');
}

/// Verifies a base64-encoded SEP-53 signature of `message` against the
/// claimed `address`. Returns false (never throws) for any malformed
/// input, including an address that isn't a valid Stellar public key —
/// callers should treat every false as "authentication failed", not
/// distinguish the reason, to avoid leaking which part of the input was
/// wrong.
export function verifySep53Signature(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signature.length === 0) {
    return false;
  }
  try {
    const keypair = Keypair.fromPublicKey(address);
    return keypair.verifyMessage(message, signature);
  } catch {
    return false;
  }
}
