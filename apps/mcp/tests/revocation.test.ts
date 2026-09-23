/**
 * Token revocation enforcement (#1156): bearer validation must consult the
 * backend's internal /internal/auth/verify endpoint in parallel with the
 * context load, and fail closed — revoked tokens, inactive clients, and
 * verify-endpoint outages all reject with 401.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { TEST_TOKEN, REVOKED_TOKEN, TEST_ENV, mockBackend, backendCalls } from './jwt-auth.js';

function mcpCall(token: string) {
  return app.request(
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
    { ...TEST_ENV, INTERNAL_SERVICE_SECRET: 'test-internal-secret' },
  );
}

describe('token revocation check', () => {
  it('issues GET /internal/auth/verify with x-internal-secret alongside the context call', async () => {
    const seen: { secret: string | null }[] = [];
    const observingBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify') {
          seen.push({ secret: req.headers.get('x-internal-secret') });
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await app.request(
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_wallet_balance', arguments: {} },
        }),
      },
      {
        ...TEST_ENV,
        INTERNAL_SERVICE_SECRET: 'test-internal-secret',
        PAXAVER_API_CA: observingBackend,
        PAXAVER_API_US: observingBackend,
      },
    );
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.secret).toBe('test-internal-secret');
    expect(backendCalls).toContain('GET /internal/auth/verify');
    expect(backendCalls).toContain('GET /api/users/me/context');
  });

  it('rejects a token the internal verify endpoint has revoked', async () => {
    const res = await mcpCall(REVOKED_TOKEN);
    expect(res.status).toBe(401);
  });

  it('fails closed when the verify endpoint errors (5xx)', async () => {
    const downBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify') {
          return new Response('auth worker unavailable', { status: 503 });
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await app.request(
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_wallet_balance', arguments: {} },
        }),
      },
      { ...TEST_ENV, PAXAVER_API_CA: downBackend, PAXAVER_API_US: downBackend },
    );
    expect(res.status).toBe(401);
  });
});
