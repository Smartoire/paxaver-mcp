/**
 * sign_out tool tests. The tool posts the caller's verified access token —
 * with token_type_hint=access_token and the token's own client_id — to the
 * issuing region's /revoke. A fake regional auth server models the
 * platform contract: the request's client_id must match the token claim,
 * and revoking the access token kills its whole grant family (the refresh
 * token then fails with invalid_grant).
 *
 * Also covers the get_my_context identity fields (account email, region,
 * environment) and the 401 challenge on a revoked token.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import app from '../src/index.js';
import { request } from './request.js';
import { ACTIVE_TOKEN, TEST_ENV, mockBackend, makeToken } from './jwt-auth.js';
import { ALL_TOOLS } from '../src/schemas.js';

interface AuthCall {
  url: string;
  body: URLSearchParams;
}

const authCalls: AuthCall[] = [];
// Set once the family is revoked — one user per test, so one flag is enough.
let familyRevoked = false;
let responder: (url: string, body: URLSearchParams) => Response;

function defaultResponder(url: string, body: URLSearchParams): Response {
  if (url.endsWith('/revoke')) {
    let clientId: unknown;
    try {
      clientId = decodeJwt(body.get('token') ?? '').client_id;
    } catch {
      clientId = undefined;
    }
    if (!clientId || body.get('client_id') !== clientId) {
      return Response.json({ error: 'invalid_client' }, { status: 401 });
    }
    familyRevoked = true;
    return new Response(null, { status: 200 });
  }
  if (url.endsWith('/token')) {
    if (familyRevoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'at-2', refresh_token: 'rt-2', token_type: 'Bearer' });
  }
  return new Response('not found', { status: 404 });
}

// jwt-auth.ts already stubs fetch for the JWKS endpoints; intercept the
// regional auth calls and delegate everything else to that stub.
const innerFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith('/revoke') || url.endsWith('/token')) {
    const body = new URLSearchParams(String(init?.body ?? ''));
    authCalls.push({ url, body });
    return responder(url, body);
  }
  return innerFetch(input, init);
});

beforeEach(() => {
  authCalls.length = 0;
  familyRevoked = false;
  responder = defaultResponder;
});

const CLIENT_ID = 'mcp-client-1';
// user-1 has no subscription — proves the subscription-gate exemption.
const SIGNOUT_TOKEN = await makeToken('user-1', undefined, { clientId: CLIENT_ID });
const PROD_AUDIENCE = ['paxaver-api', 'https://mcp.paxaver.com/mcp'];

function mcpPost(method: string, params: unknown, token: string, env: Record<string, unknown> = TEST_ENV) {
  return request(
    app,
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
  );
}

function callTool(name: string, token = SIGNOUT_TOKEN, env: Record<string, unknown> = TEST_ENV) {
  return mcpPost('tools/call', { name, arguments: {} }, token, env);
}

async function toolData(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as { result?: { structuredContent?: Record<string, unknown> } };
  return json.result?.structuredContent ?? {};
}

// Once the grant family is revoked, the internal verify endpoint rejects
// the access token — models the regional auth server's family revocation.
const familyAwareBackend = {
  async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof request === 'string' ? new Request(request, init) : request;
    if (new URL(req.url).pathname === '/internal/auth/verify' && familyRevoked) {
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }
    return mockBackend.fetch(req);
  },
};
const SECRET_ENV = {
  ...TEST_ENV,
  INTERNAL_SERVICE_SECRET: 'test-internal-secret',
  PAXAVER_API_CA: familyAwareBackend,
  PAXAVER_API_US: familyAwareBackend,
  PAXAVER_API_MX: familyAwareBackend,
};

describe('sign_out', () => {
  it('has no input, the required annotations, and a user-directed description', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'sign_out');
    expect(tool?.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tool?.description).toMatch(/only when the user explicitly asks/i);
  });

  it('posts the access token with its client_id to the token region /revoke and reports the account', async () => {
    const res = await callTool('sign_out');
    expect(res.status).toBe(200);
    const out = await toolData(res);
    expect(out).toMatchObject({ signedOut: true, account: 'test@paxaver.dev' });
    expect(String(out.message)).toMatch(/sign in again/i);

    expect(authCalls).toHaveLength(1);
    expect(authCalls[0]!.url).toBe('https://paxaver.dev/auth/revoke');
    expect(authCalls[0]!.body.get('token')).toBe(SIGNOUT_TOKEN);
    expect(authCalls[0]!.body.get('token_type_hint')).toBe('access_token');
    expect(authCalls[0]!.body.get('client_id')).toBe(CLIENT_ID);
    // The result must never carry token material.
    expect(JSON.stringify(out)).not.toContain(SIGNOUT_TOKEN);
  });

  it.each([
    ['ca', 'https://paxaver.ca/auth'],
    ['us', 'https://paxaver.com/auth'],
    ['mx', 'https://paxaver.mx/auth'],
  ])('revokes in the token region for the %s issuer', async (region, issuer) => {
    const token = await makeToken('user-1', issuer, { audience: PROD_AUDIENCE, clientId: `id-${region}` });
    const res = await callTool('sign_out', token, { ...TEST_ENV, ENVIRONMENT: 'production' });
    expect(res.status).toBe(200);
    expect(authCalls.map((c) => c.url)).toEqual([`${issuer}/revoke`]);
    expect(authCalls[0]!.body.get('client_id')).toBe(`id-${region}`);
  });

  it('is listed and callable without an active subscription', async () => {
    const list = await mcpPost('tools/list', {}, SIGNOUT_TOKEN);
    const json = (await list.json()) as { result?: { tools: { name: string }[] } };
    expect(json.result?.tools.map((t) => t.name)).toEqual(['sign_out']);

    const res = await callTool('sign_out');
    expect(res.status).toBe(200);
    expect((await toolData(res)).signedOut).toBe(true);
  });

  it('after sign_out the old access token gets 401 with the re-login challenge', async () => {
    const res = await callTool('sign_out', SIGNOUT_TOKEN, SECRET_ENV);
    expect(res.status).toBe(200);
    expect((await toolData(res)).signedOut).toBe(true);

    const next = await mcpPost('ping', {}, SIGNOUT_TOKEN, SECRET_ENV);
    expect(next.status).toBe(401);
    expect(next.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  });

  it('after sign_out the old refresh token cannot mint a new access token', async () => {
    const res = await callTool('sign_out');
    expect((await toolData(res)).signedOut).toBe(true);

    // A client refresh goes through the facade to the tagged region.
    const refresh = await request(
      app,
      '/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=ca.rt-1&client_id=${CLIENT_ID}`,
      },
      TEST_ENV,
    );
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toEqual({ error: 'invalid_grant' });
  });

  it('a confidential client gets guidance instead of a success claim', async () => {
    responder = () => Response.json({ error: 'invalid_client' }, { status: 401 });
    const res = await callTool('sign_out');
    expect(res.status).toBe(200);
    const out = await toolData(res);
    expect(out.signedOut).toBe(false);
    expect(String(out.message)).toContain('Disconnect Paxaver');
  });

  it('a regional failure is a sanitized error, never a success claim', async () => {
    responder = () => new Response('upstream down', { status: 502 });
    const res = await callTool('sign_out');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { error?: { code: number; message: string }; result?: unknown };
    expect(json.result).toBeUndefined();
    expect(json.error?.code).toBe(-32603);
    expect(json.error?.message).not.toContain('signed out');
  });

  it('fails without a token client_id claim instead of guessing one', async () => {
    const token = await makeToken('user-1');
    const res = await callTool('sign_out', token);
    const json = (await res.json()) as { error?: { code: number } };
    expect(json.error?.code).toBe(-32603);
    expect(authCalls).toHaveLength(0);
  });
});

describe('get_my_context identity fields', () => {
  it.each([
    ['development', 'dev'],
    ['staging', 'dev'],
    ['production', 'production'],
  ])('returns account, region and environment for ENVIRONMENT=%s', async (environment, expected) => {
    const token =
      environment === 'production'
        ? await makeToken('user-active', 'https://paxaver.com/auth', { audience: PROD_AUDIENCE })
        : ACTIVE_TOKEN;
    const res = await callTool('get_my_context', token, { ...TEST_ENV, ENVIRONMENT: environment });
    const out = await toolData(res);
    expect(out.email).toBe('test@paxaver.dev');
    expect(out.region).toBe('CA');
    expect(out.environment).toBe(expected);
    // Never token material or internal hosts.
    expect(JSON.stringify(out)).not.toContain(token);
    expect(JSON.stringify(out)).not.toContain('localhost');
  });

  it('keeps the existing PII allowlist — no contact fields beyond the sign-in email', async () => {
    const res = await callTool('get_my_context', ACTIVE_TOKEN);
    const out = await toolData(res);
    for (const key of Object.keys(out)) {
      expect([
        'firstName',
        'schoolSlug',
        'schoolName',
        'students',
        'roles',
        'email',
        'region',
        'environment',
        'subscription',
      ]).toContain(key);
    }
    expect(JSON.stringify(out)).not.toContain('phone');
    expect(JSON.stringify(out)).not.toContain('address');
  });
});
