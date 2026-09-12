/**
 * Test auth helper: mints real RS256 JWTs and stubs the JWKS fetch.
 *
 * The worker validates tokens against `${iss}/.well-known/jwks.json` via
 * global fetch; the stub serves this keypair's public JWK for the test
 * issuer. Backend calls still go through the mocked service bindings,
 * which resolve user context by the JWT `sub` claim.
 */

import { generateKeyPair, exportJWK, SignJWT, decodeJwt } from 'jose';
import { vi } from 'vitest';

export const TEST_ISSUER = 'https://paxaver.dev/auth';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key';
jwk.alg = 'RS256';
jwk.use = 'sig';

const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === `${TEST_ISSUER}/.well-known/jwks.json`) {
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
});

async function makeToken(userId: string): Promise<string> {
  return new SignJWT({ tenant_id: 'user-ca' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(userId)
    .setIssuer(TEST_ISSUER)
    .setAudience('paxaver-api')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

const BASE_CONTEXT = {
  email: 'test@paxaver.dev',
  schoolSlug: 'test-school',
  permissions: ['pac_cordinator'],
  isPlatformAdmin: false,
  studentIds: ['student-1'],
  country: 'ca' as const,
};

// userId -> AuthContext returned by the mocked /api/users/me/context.
const USER_CONTEXTS: Record<string, typeof BASE_CONTEXT & { userId: string; subscription?: unknown }> = {
  'user-1': { userId: 'user-1', ...BASE_CONTEXT },
  'user-active': {
    userId: 'user-active',
    ...BASE_CONTEXT,
    subscription: { status: 'active', toolLevel: 'parent', expiry: '2099-07-31T00:00:00Z' },
  },
  'user-full': {
    userId: 'user-full',
    ...BASE_CONTEXT,
    subscription: { status: 'active', toolLevel: 'full', expiry: '2099-07-31T00:00:00Z' },
  },
  'user-expired': {
    userId: 'user-expired',
    ...BASE_CONTEXT,
    subscription: { status: 'expired', toolLevel: 'parent', expiry: '2020-07-31T00:00:00Z' },
  },
};

export const TEST_TOKEN = await makeToken('user-1');
export const ACTIVE_TOKEN = await makeToken('user-active');
export const FULL_TOKEN = await makeToken('user-full');
export const EXPIRED_TOKEN = await makeToken('user-expired');

export const USER_CONTEXT = USER_CONTEXTS['user-1'];

const mockBackend = {
  async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof request === 'string' ? new Request(request, init) : request;
    const url = new URL(req.url);
    if (url.pathname === '/api/users/me/context') {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const sub = decodeJwt(token).sub ?? '';
      const ctx = USER_CONTEXTS[sub];
      if (!ctx) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: ctx }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

export const TEST_ENV = {
  JWT_SECRET: 'test-jwt-secret-for-vitest-only',
  ENVIRONMENT: 'test' as const,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  API_BASE_URL_CA: 'http://localhost:8787',
  API_BASE_URL_US: 'http://localhost:8787',
  PAXAVER_API_CA: mockBackend,
  PAXAVER_API_US: mockBackend,
};
