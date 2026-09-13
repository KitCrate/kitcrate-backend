import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { buildChallengeMessage, verifySep53Signature } from '../src/auth/message.js';

// Official SEP-53 test vectors, copied verbatim from
// https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
// ("Test cases" section). These prove verifySep53Signature() implements
// the real spec's prefix + SHA-256 + ed25519 algorithm correctly, not
// merely something self-consistent with how this codebase happens to
// build messages elsewhere — an independently-known-good signature,
// produced outside this codebase, must verify.
const SEP53_SEED = 'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW';
const SEP53_ADDRESS = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';

test('verifySep53Signature accepts the official SEP-53 ASCII test vector', () => {
  const message = 'Hello, World!';
  const signatureBase64 =
    'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
  assert.equal(verifySep53Signature(SEP53_ADDRESS, message, signatureBase64), true);
});

test('verifySep53Signature accepts the official SEP-53 non-ASCII test vector', () => {
  const message = 'こんにちは、世界！';
  const signatureBase64 =
    'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==';
  assert.equal(verifySep53Signature(SEP53_ADDRESS, message, signatureBase64), true);
});

test('verifySep53Signature round-trips with the seed that produced the test vectors', () => {
  // Independent confirmation that SEP53_ADDRESS really is derived from
  // SEP53_SEED (so the two test vectors above are checking what they
  // claim to check), by signing fresh with the seed and verifying with
  // the address.
  const keypair = Keypair.fromSecret(SEP53_SEED);
  assert.equal(keypair.publicKey(), SEP53_ADDRESS);
  const signature = keypair.signMessage('a fresh message not in the spec');
  assert.equal(
    verifySep53Signature(SEP53_ADDRESS, 'a fresh message not in the spec', signature.toString('base64')),
    true,
  );
});

test('verifySep53Signature rejects a signature for a different message', () => {
  const signatureBase64 =
    'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
  assert.equal(verifySep53Signature(SEP53_ADDRESS, 'Hello, World?', signatureBase64), false);
});

test('verifySep53Signature rejects a valid signature from a different address', () => {
  const other = Keypair.random();
  const message = 'Hello, World!';
  const signatureBase64 =
    'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
  assert.equal(verifySep53Signature(other.publicKey(), message, signatureBase64), false);
});

test('verifySep53Signature rejects garbage input without throwing', () => {
  assert.equal(verifySep53Signature('not-an-address', 'hello', 'not-base64!!'), false);
  assert.equal(verifySep53Signature(SEP53_ADDRESS, 'hello', ''), false);
});

test('buildChallengeMessage embeds every field that binds the signature to one action', () => {
  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date('2026-01-01T00:05:00.000Z');
  const message = buildChallengeMessage({
    address: SEP53_ADDRESS,
    action: 'delete_listing',
    listingId: 'listing-123',
    nonce: 'test-nonce',
    issuedAt,
    expiresAt,
  });
  assert.match(message, new RegExp(`Address: ${SEP53_ADDRESS}`));
  assert.match(message, /Action: delete_listing/);
  assert.match(message, /Listing: listing-123/);
  assert.match(message, /Nonce: test-nonce/);
  assert.match(message, /Issued: 2026-01-01T00:00:00\.000Z/);
  assert.match(message, /Expires: 2026-01-01T00:05:00\.000Z/);
});

test('a real keypair can sign buildChallengeMessage output and verifySep53Signature accepts it', () => {
  const signer = Keypair.random();
  const message = buildChallengeMessage({
    address: signer.publicKey(),
    action: 'create_listing',
    listingId: 'listing-abc',
    nonce: 'n0nce',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
  });
  const signature = signer.signMessage(message);
  assert.equal(verifySep53Signature(signer.publicKey(), message, signature.toString('base64')), true);
  // A signature over the message signed by a different address must fail.
  const impostor = Keypair.random();
  assert.equal(
    verifySep53Signature(impostor.publicKey(), message, signature.toString('base64')),
    false,
  );
});
