import type { NextFunction, Request, Response } from 'express';

import { consumeChallenge } from './challenges.js';
import { isListingAuthAction, verifySep53Signature, type ListingAuthAction } from './message.js';

const ADDRESS_HEADER = 'x-kitcrate-address';
const NONCE_HEADER = 'x-kitcrate-nonce';
const SIGNATURE_HEADER = 'x-kitcrate-signature';

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/// The address a request authenticated as. Set by requireListingAuth once
/// the SEP-53 signature has been verified against a matching, unexpired,
/// single-use challenge; read by the route handler afterward to compare
/// against a stored or requested `owner`. Deliberately carried on
/// `res.locals` (request-scoped, no global type augmentation needed)
/// rather than trusted from any client-supplied field.
export function authenticatedAddress(res: Response): string {
  const address = res.locals.authenticatedAddress;
  if (typeof address !== 'string') {
    // Only reachable if a route uses this without requireListingAuth first.
    throw new Error('authenticatedAddress read before requireListingAuth ran');
  }
  return address;
}

/// Express middleware factory: authenticates that the caller controls
/// `listingId(req)` for the given `action`, via a SEP-53-signed,
/// single-use challenge obtained beforehand from POST /auth/challenge.
///
/// Every failure mode (missing header, unknown/expired/already-used
/// challenge, wrong address/action/listing bound to the challenge, or a
/// signature that doesn't verify) responds identically: 401 with a
/// generic message. This is deliberate — distinguishing them in the
/// response would let a caller probe which part of a forged request was
/// wrong, with no benefit to a legitimate caller (who always has the
/// full, correct tuple already, from the challenge they just requested).
export function requireListingAuth(
  action: ListingAuthAction,
  listingId: (req: Request) => string | undefined,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const address = headerValue(req, ADDRESS_HEADER);
    const nonce = headerValue(req, NONCE_HEADER);
    const signature = headerValue(req, SIGNATURE_HEADER);
    const id = listingId(req);

    if (!address || !nonce || !signature || !id || !isListingAuthAction(action)) {
      res.status(401).json({ error: 'missing or malformed authentication headers' });
      return;
    }

    const consumed = await consumeChallenge({ nonce, address, action, listingId: id });
    if (!consumed) {
      res.status(401).json({ error: 'invalid, expired, or already-used authentication challenge' });
      return;
    }

    if (!verifySep53Signature(address, consumed.message, signature)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    res.locals.authenticatedAddress = address;
    next();
  };
}
