/**
 * Protocol version constant test.
 */

import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION } from '../src/lib/protocol-version.js';

describe('PROTOCOL_VERSION', () => {
  it('is a valid date-based version string', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the 2025-06-18 version', () => {
    expect(PROTOCOL_VERSION).toBe('2025-06-18');
  });
});
