import { Router } from 'express';
import { StrKey } from '@stellar/stellar-sdk';

import { createChallenge } from '../auth/challenges.js';
import { isListingAuthAction } from '../auth/message.js';

export const authRouter = Router();

interface ChallengeRequestBody {
  address?: unknown;
  action?: unknown;
  listingId?: unknown;
}

/// POST /auth/challenge
/// Issues a one-shot SEP-53 challenge for the caller to sign with the
/// wallet that controls `address`, authorizing exactly `action` on
/// exactly `listingId`. Public: possession of a challenge proves nothing
/// by itself, only a valid signature over it does (see
/// auth/middleware.ts). The listings routes that require this consume
/// the challenge they were issued.
authRouter.post('/challenge', async (req, res) => {
  const body = (req.body ?? {}) as ChallengeRequestBody;
  const { address, action, listingId } = body;

  if (typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) {
    res.status(400).json({ error: 'address must be a valid Stellar public key (G...)' });
    return;
  }
  if (!isListingAuthAction(action)) {
    res.status(400).json({
      error: 'action must be one of create_listing, update_listing, delete_listing',
    });
    return;
  }
  if (typeof listingId !== 'string' || listingId.trim().length === 0) {
    res.status(400).json({ error: 'listingId is required and must be a non-empty string' });
    return;
  }

  const challenge = await createChallenge({ address, action, listingId });
  res.status(201).json(challenge);
});
