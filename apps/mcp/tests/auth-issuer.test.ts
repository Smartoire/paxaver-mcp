/**
 * Issuer policy tests: each environment accepts only its regional issuers
 * (lib/regions.ts). The verified issuer picks the regional backend.
 */

import { describe, expect, it } from 'vitest';
import { authenticateRequest } from '../src/auth/validate.js';
import type { Env, McpCountry } from '../src/env.js';
import { backendCalls, makeToken, mockBackend, TEST_ENV } from './jwt-auth.js';

// One recording binding per region, so a test can see which backend a
// token reaches.
const regionCalls: string[] = [];
function binding(region: McpCountry) {
  return {
    fetch(request: Request | string, init?: RequestInit) {
      const req = typeof request === 'string' ? new Request(request, init) : request;
      regionCalls.push(`${region} ${new URL(req.url).pathname}`);
      return mockBackend.fetch(req);
    },
  };
}

const productionEnv = {
  ...TEST_ENV,
  ENVIRONMENT: 'production',
  INTERNAL_SERVICE_SECRET: 'internal-test-secret',
  PAXAVER_API_CA: binding('ca'),
  PAXAVER_API_US: binding('us'),
  PAXAVER_API_MX: binding('mx'),
} as unknown as Env;
const developmentEnv = { ...TEST_ENV, ENVIRONMENT: 'development' } as unknown as Env;
const origin = 'https://mcp.paxaver.com';

describe('OAuth issuer policy', () => {
  it.each([
    ['https://paxaver.ca/auth', 'ca'],
    ['https://paxaver.com/auth', 'us'],
    ['https://paxaver.mx/auth', 'mx'],
  ])('accepts %s in production and routes to the %s backend', async (issuer, region) => {
    const token = await makeToken('user-1', issuer);
    regionCalls.length = 0;
    const result = await authenticateRequest(productionEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(true);
    expect(regionCalls.sort()).toEqual([`${region} /api/users/me/context`, `${region} /internal/auth/verify`]);
  });

  it.each(['https://paxaver.dev/auth', 'https://evil.example/auth', 'https://paxaver.com/auth/'])(
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

  it.each(['https://paxaver.ca/auth', 'https://paxaver.com/auth'])('rejects %s in development', async (issuer) => {
    const token = await makeToken('user-1', issuer);
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(false);
  });
});
