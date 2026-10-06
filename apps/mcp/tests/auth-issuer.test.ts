/**
 * Issuer policy tests: the configured environment issuer is the only
 * accepted JWT issuer. Regional and cross-environment issuers are rejected.
 */

import { describe, expect, it } from 'vitest';
import { authenticateRequest } from '../src/auth/validate.js';
import type { Env } from '../src/env.js';
import { backendCalls, makeToken, TEST_ENV } from './jwt-auth.js';

const productionEnv = { ...TEST_ENV, ENVIRONMENT: 'production' } as unknown as Env;
const developmentEnv = { ...TEST_ENV, ENVIRONMENT: 'development' } as unknown as Env;
const origin = 'https://mcp.paxaver.com';

describe('OAuth issuer policy', () => {
  it('accepts the canonical production issuer', async () => {
    const token = await makeToken('user-1', 'https://paxaver.com/auth');
    const result = await authenticateRequest(productionEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(true);
  });

  it.each(['https://paxaver.ca/auth', 'https://paxaver.mx/auth', 'https://paxaver.dev/auth'])(
    'rejects %s in production',
    async (issuer) => {
      const token = await makeToken('user-1', issuer);
      const callsBefore = backendCalls.length;
      const result = await authenticateRequest(productionEnv, `Bearer ${token}`, origin);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('INVALID_TOKEN');
      expect(backendCalls).toHaveLength(callsBefore);
    },
  );

  it('uses the paxaver.dev issuer in development', async () => {
    const token = await makeToken('user-1', 'https://paxaver.dev/auth');
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(true);
  });
});
