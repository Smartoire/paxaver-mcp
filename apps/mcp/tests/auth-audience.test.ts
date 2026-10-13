/**
 * Audience and scope policy tests: an MCP access token must carry this
 * environment's canonical MCP resource audience (`<mcp origin>/mcp`) and the
 * `tools` scope. A token without them — one minted before the auth server
 * added both — gets a 401 with a WWW-Authenticate challenge before any
 * backend call.
 */

import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import { authenticateRequest } from '../src/auth/validate.js';
import type { Env } from '../src/env.js';
import { backendCalls, makeToken, TEST_ENV } from './jwt-auth.js';
import { request } from './request.js';

const developmentEnv = { ...TEST_ENV, ENVIRONMENT: 'development' } as unknown as Env;
const productionEnv = {
  ...TEST_ENV,
  ENVIRONMENT: 'production',
  INTERNAL_SERVICE_SECRET: 'internal-test-secret',
} as unknown as Env;
const origin = 'https://mcp.paxaver.dev';

describe('OAuth audience and scope policy', () => {
  it('accepts a token with the MCP audience and the tools scope', async () => {
    const token = await makeToken('user-1');
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(true);
  });

  it('rejects a token whose only audience is paxaver-api', async () => {
    const token = await makeToken('user-1', undefined, { audience: 'paxaver-api' });
    const callsBefore = backendCalls.length;
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error?.code).toBe('INVALID_TOKEN');
    expect(result.wwwAuthenticate).toContain('resource_metadata');
    expect(backendCalls).toHaveLength(callsBefore);
  });

  it('rejects the legacy mcp and bare-origin audiences', async () => {
    const token = await makeToken('user-1', undefined, {
      audience: ['paxaver-api', 'mcp', 'https://mcp.paxaver.dev'],
    });
    const callsBefore = backendCalls.length;
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(backendCalls).toHaveLength(callsBefore);
  });

  it('rejects a development-audience token in production', async () => {
    const token = await makeToken('user-1', 'https://paxaver.com/auth');
    const callsBefore = backendCalls.length;
    const result = await authenticateRequest(productionEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(backendCalls).toHaveLength(callsBefore);
  });

  it.each(['openid', null])('rejects a token whose scope is %s (no tools)', async (scope) => {
    const token = await makeToken('user-1', undefined, { scope });
    const callsBefore = backendCalls.length;
    const result = await authenticateRequest(developmentEnv, `Bearer ${token}`, origin);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error?.code).toBe('INSUFFICIENT_SCOPE');
    expect(result.wwwAuthenticate).toContain('resource_metadata');
    expect(result.wwwAuthenticate).toContain('insufficient_scope');
    expect(backendCalls).toHaveLength(callsBefore);
  });

  it('rejects a paxaver-api-only token at POST /mcp before tool dispatch', async () => {
    const token = await makeToken('user-1', undefined, { audience: 'paxaver-api' });
    backendCalls.length = 0;
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_wallet_balance', arguments: {} },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
    expect(backendCalls).toHaveLength(0);
  });
});
