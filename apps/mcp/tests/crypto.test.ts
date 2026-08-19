/**
 * Crypto helper tests: session ID generation.
 */

import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../src/lib/crypto.js';

describe('Crypto helpers', () => {
  it('generateSessionId produces hex', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBe(32); // 16 bytes = 32 hex chars
  });
});
