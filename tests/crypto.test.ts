/**
 * Crypto helper tests: PKCE, state token, timing-safe comparison.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyPkceS256,
  createStateToken,
  verifyStateToken,
  timingSafeEqual,
  generateToken,
  generateSessionId,
} from '../src/lib/crypto.js';

describe('Crypto helpers', () => {
  it('PKCE S256 verification succeeds for correct challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // Known S256 challenge for this verifier
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('PKCE S256 verification fails for wrong challenge', async () => {
    expect(await verifyPkceS256('verifier', 'wrong-challenge')).toBe(false);
  });

  it('state token round-trips correctly', async () => {
    const secret = 'test-secret';
    const payload = 'client-state-value';
    const token = await createStateToken(secret, payload);
    expect(await verifyStateToken(secret, token)).toBe(payload);
  });

  it('state token with wrong secret fails', async () => {
    const token = await createStateToken('secret-a', 'payload');
    expect(await verifyStateToken('secret-b', token)).toBeNull();
  });

  it('tampered state token fails', async () => {
    const token = await createStateToken('secret', 'payload');
    const tampered = token.slice(0, -2) + 'xx';
    expect(await verifyStateToken('secret', tampered)).toBeNull();
  });

  it('timingSafeEqual returns true for equal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('timingSafeEqual returns false for different strings', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('generateToken produces URL-safe base64url', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('generateSessionId produces hex', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBe(32); // 16 bytes = 32 hex chars
  });
});
