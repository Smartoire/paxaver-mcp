/**
 * Token revocation enforcement (#1156): bearer validation must consult the
 * backend's internal /internal/auth/verify endpoint in parallel with the
 * context load, and fail closed — revoked tokens and inactive clients reject
 * with 401; verify-endpoint outages and a missing INTERNAL_SERVICE_SECRET
 * outside development reject with 503 (#2134).
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { TEST_TOKEN, REVOKED_TOKEN, TEST_ENV, mockBackend, backendCalls } from './jwt-auth.js';

function mcpCall(token: string, envOverrides: Record<string, unknown> = {}) {
  return request(
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
    { ...TEST_ENV, INTERNAL_SERVICE_SECRET: 'test-internal-secret', ...envOverrides },
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
    const res = await request(
      app,
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

  it('fails closed with 503 when the verify endpoint errors (5xx), after one retry', async () => {
    let verifyCalls = 0;
    const downBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify') {
          verifyCalls++;
          return new Response('auth worker unavailable', { status: 503 });
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await mcpCall(TEST_TOKEN, { PAXAVER_API_CA: downBackend, PAXAVER_API_US: downBackend });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    expect(verifyCalls).toBe(2);
  });

  it('fails closed with 503 when the verify endpoint is unreachable', async () => {
    const unreachableBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify') throw new Error('connection refused');
        return mockBackend.fetch(req);
      },
    };
    const res = await mcpCall(TEST_TOKEN, { PAXAVER_API_CA: unreachableBackend, PAXAVER_API_US: unreachableBackend });
    expect(res.status).toBe(503);
  });

  it('accepts the token when the retry after a transient verify error succeeds', async () => {
    let verifyCalls = 0;
    const flakyBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify' && verifyCalls++ === 0) {
          return new Response('bad gateway', { status: 502 });
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await mcpCall(TEST_TOKEN, { PAXAVER_API_CA: flakyBackend, PAXAVER_API_US: flakyBackend });
    expect(res.status).toBe(200);
    expect(verifyCalls).toBe(2);
  });

  it('rejects with 503 when INTERNAL_SERVICE_SECRET is unset in staging', async () => {
    backendCalls.length = 0;
    const res = await mcpCall(TEST_TOKEN, { INTERNAL_SERVICE_SECRET: undefined, ENVIRONMENT: 'staging' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE', message: 'Auth verification unavailable' });
    expect(backendCalls).not.toContain('GET /internal/auth/verify');
  });

  it('still rejects an invalid token with 401 when the secret is unset in staging', async () => {
    const res = await mcpCall('not-a-jwt', { INTERNAL_SERVICE_SECRET: undefined, ENVIRONMENT: 'staging' });
    expect(res.status).toBe(401);
  });

  it('skips the verify call in development when INTERNAL_SERVICE_SECRET is unset', async () => {
    let verifyCalled = false;
    const observingBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/internal/auth/verify') verifyCalled = true;
        return mockBackend.fetch(req);
      },
    };
    const res = await mcpCall(TEST_TOKEN, {
      INTERNAL_SERVICE_SECRET: undefined,
      PAXAVER_API_CA: observingBackend,
      PAXAVER_API_US: observingBackend,
    });
    expect(res.status).toBe(200);
    expect(verifyCalled).toBe(false);
  });
});

describe('health self-check (#2134)', () => {
  it('reports degraded with 503 when INTERNAL_SERVICE_SECRET is unset in production', async () => {
    const res = await request(app, 'https://mcp.paxaver.test/health', {}, { ...TEST_ENV, ENVIRONMENT: 'production' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded' });
  });

  it('reports ok when the secret is set in production', async () => {
    const res = await request(
      app,
      'https://mcp.paxaver.test/health',
      {},
      { ...TEST_ENV, ENVIRONMENT: 'production', INTERNAL_SERVICE_SECRET: 'test-internal-secret' },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});
