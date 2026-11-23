/**
 * Auth availability tests: a backend outage during token validation must
 * not look like a revoked token. A 5xx or 429 from /api/users/me/context,
 * a thrown fetch, or a JWKS failure answers 503 AUTH_UNAVAILABLE with no
 * WWW-Authenticate challenge, so MCP clients retry instead of signing the
 * user out. Only a definitive answer — an invalid or revoked token —
 * still answers 401.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import app from '../src/index.js';
import { request } from './request.js';
import { TEST_TOKEN, REVOKED_TOKEN, TEST_ENV, mockBackend, makeToken } from './jwt-auth.js';

// A production token from the mx issuer: no other test in this file
// authenticates it, so its JWKS cache entry is still cold.
const MX_PRODUCTION_TOKEN = await makeToken('user-1', 'https://paxaver.mx/auth', {
  audience: ['paxaver-api', 'https://mcp.paxaver.com/mcp'],
});

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

// A backend binding that answers /api/users/me/context with `respond` and
// delegates every other call (the revocation verify, tool routes) to the
// shared mock.
function contextOverride(respond: () => Response): Record<string, unknown> {
  const backend = {
    async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
      const req = typeof request === 'string' ? new Request(request, init) : request;
      if (new URL(req.url).pathname === '/api/users/me/context') return respond();
      return mockBackend.fetch(req);
    },
  };
  return { PAXAVER_API_CA: backend, PAXAVER_API_US: backend, PAXAVER_API_MX: backend };
}

async function expectAuthUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
  expect(res.headers.get('WWW-Authenticate')).toBeNull();
}

describe('auth backend outage', () => {
  it.each([500, 502, 503])('answers 503 when /api/users/me/context returns %i', async (status) => {
    const res = await mcpCall(
      TEST_TOKEN,
      contextOverride(() => new Response('backend error', { status })),
    );
    await expectAuthUnavailable(res);
  });

  it('answers 503 when /api/users/me/context is rate limited (429)', async () => {
    const res = await mcpCall(
      TEST_TOKEN,
      contextOverride(() => new Response('slow down', { status: 429 })),
    );
    await expectAuthUnavailable(res);
  });

  it('answers 503 when the /api/users/me/context fetch throws', async () => {
    const res = await mcpCall(
      TEST_TOKEN,
      contextOverride(() => {
        throw new Error('connection reset');
      }),
    );
    await expectAuthUnavailable(res);
  });

  it('answers 503 when the issuer JWKS fetch fails', async () => {
    const innerFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://paxaver.mx/auth/.well-known/jwks.json') throw new TypeError('fetch failed');
      return innerFetch(input, init);
    });
    try {
      const res = await mcpCall(MX_PRODUCTION_TOKEN, { ENVIRONMENT: 'production' });
      await expectAuthUnavailable(res);
    } finally {
      vi.stubGlobal('fetch', innerFetch);
    }
  });

  it('still answers 401 for a token that fails claim validation', async () => {
    const noExp = await makeToken('user-1', undefined, { withExp: false });
    const res = await mcpCall(noExp);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('still answers 401 for a token with a bad signature', async () => {
    // Change every signature character: flipping only the last one can touch
    // padding bits alone and leave a valid signature.
    const dot = TEST_TOKEN.lastIndexOf('.');
    const bad = TEST_TOKEN.slice(0, dot + 1) + TEST_TOKEN.slice(dot + 1).replace(/./g, (c) => (c === 'A' ? 'B' : 'A'));
    const res = await mcpCall(bad);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('still answers 401 for a token whose kid the issuer does not publish', async () => {
    // Signed by a key the mock JWKS never serves (kid "rotated-away").
    const { privateKey } = await generateKeyPair('RS256');
    const unknownKid = await new SignJWT({ tenant_id: 'user-ca', scope: 'openid tools' })
      .setProtectedHeader({ alg: 'RS256', kid: 'rotated-away' })
      .setSubject('user-1')
      .setIssuer('https://paxaver.dev/auth')
      .setAudience(['paxaver-api', 'https://mcp.paxaver.dev/mcp'])
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const res = await mcpCall(unknownKid);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('still answers 401 for a revoked token', async () => {
    const res = await mcpCall(REVOKED_TOKEN);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });
});
