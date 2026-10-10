/**
 * MCP OAuth facade routes: region picker, client registration in every
 * region, token routing, and revocation routing. The regional auth servers
 * are a stubbed global fetch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './request.js';
import app from '../src/index.js';
import { encodeComposite } from '../src/oauth/client-id.js';

interface Call {
  url: string;
  headers: Headers;
  body: string;
}

let calls: Call[] = [];
let responder: (call: Call) => Response | Promise<Response>;

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const call = { url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? '') };
  calls.push(call);
  return responder(call);
});

const BASE_ENV = { ALLOWED_ORIGINS: '' };
const PROD_ENV = {
  ...BASE_ENV,
  ENVIRONMENT: 'production',
  API_BASE_URL_CA: 'https://paxaver.ca',
  API_BASE_URL_US: 'https://paxaver.com',
  API_BASE_URL_MX: 'https://paxaver.mx',
};
const STAGING_ENV = {
  ...BASE_ENV,
  ENVIRONMENT: 'staging',
  API_BASE_URL_CA: 'https://paxaver.dev',
  API_BASE_URL_US: 'https://paxaver.dev',
  API_BASE_URL_MX: 'https://paxaver.dev',
};

const ISSUER = { ca: 'https://paxaver.ca/auth', us: 'https://paxaver.com/auth', mx: 'https://paxaver.mx/auth' };
const COMPOSITE = encodeComposite({ ca: 'id-ca', us: 'id-us', mx: 'id-mx' });

function regionOf(call: Call): string {
  return Object.entries(ISSUER).find(([, issuer]) => call.url.startsWith(`${issuer}/`))?.[0] ?? 'dev';
}

beforeEach(() => {
  calls = [];
  responder = () => Response.json({ ok: true });
});

describe('GET /oauth/authorize', () => {
  function hrefs(html: string): string[] {
    return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  }

  const query =
    '?client_id=plain-client&response_type=code&state=a%2Bb%3D&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_challenge=abc&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.paxaver.com%2Fmcp';

  it('links to each regional issuer with the query unchanged (production)', async () => {
    const res = await request(app, `/oauth/authorize${query}`, {}, PROD_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
    expect(hrefs(await res.text())).toEqual([
      `${ISSUER.ca}/authorize${query}`,
      `${ISSUER.us}/authorize${query}`,
      `${ISSUER.mx}/authorize${query}`,
    ]);
    expect(calls).toHaveLength(0);
  });

  it('links to the one dev issuer in staging', async () => {
    const res = await request(app, `/oauth/authorize${query}`, {}, STAGING_ENV);
    expect(hrefs(await res.text())).toEqual([`https://paxaver.dev/auth/authorize${query}`]);
  });

  it('swaps a composite client_id for the regional id in each link', async () => {
    const res = await request(
      app,
      `/oauth/authorize?client_id=${encodeURIComponent(COMPOSITE)}&response_type=code&state=s`,
      {},
      PROD_ENV,
    );
    const links = hrefs(await res.text()).map((h) => new URL(h));
    expect(links.map((l) => l.searchParams.get('client_id'))).toEqual(['id-ca', 'id-us', 'id-mx']);
    expect(links.every((l) => l.searchParams.get('state') === 's')).toBe(true);
  });

  it('omits a region where the composite client has no registration', async () => {
    const partial = encodeComposite({ us: 'id-us' });
    const res = await request(app, `/oauth/authorize?client_id=${partial}`, {}, PROD_ENV);
    expect(hrefs(await res.text())).toEqual([`${ISSUER.us}/authorize?client_id=id-us`]);
  });

  it('lists the visitor country first', async () => {
    const req = new Request(`http://localhost/oauth/authorize${query}`);
    Object.defineProperty(req, 'cf', { value: { country: 'MX' } });
    const res = await app.fetch(req, PROD_ENV as never);
    const links = hrefs(await res.text());
    expect(links).toHaveLength(3);
    expect(links[0]!.startsWith(`${ISSUER.mx}/`)).toBe(true);
  });

  it('sets CSP and no-store, and escapes the query', async () => {
    const res = await request(app, `/oauth/authorize?state="><script>`, {}, PROD_ENV);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).not.toContain('<script>');
  });

  it('rejects non-GET', async () => {
    const res = await request(app, '/oauth/authorize', { method: 'POST' }, PROD_ENV);
    expect(res.status).toBe(405);
  });
});

describe('POST /oauth/register', () => {
  const metadata = {
    redirect_uris: ['https://client.example/cb'],
    client_name: 'Test',
    token_endpoint_auth_method: 'none',
  };

  function post(path = '/oauth/register', env: Record<string, unknown> = PROD_ENV) {
    return request(
      app,
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) },
      env,
    );
  }

  it.each(['/oauth/register', '/register'])('%s registers in every region and returns a composite id', async (path) => {
    responder = (call) =>
      Response.json(
        {
          ...JSON.parse(call.body),
          client_id: `id-${regionOf(call)}`,
          client_id_issued_at: 1,
          registration_access_token: 'rat',
          registration_client_uri: `${call.url}/x`,
        },
        { status: 201 },
      );
    const res = await post(path);

    expect(calls.map((c) => c.url).sort()).toEqual(
      [`${ISSUER.ca}/register`, `${ISSUER.mx}/register`, `${ISSUER.us}/register`].sort(),
    );
    expect(calls.every((c) => c.body === JSON.stringify(metadata))).toBe(true);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.client_id).toBe(COMPOSITE);
    expect(json.client_secret).toBeUndefined();
    expect(json.redirect_uris).toEqual(metadata.redirect_uris);
    expect(json.registration_access_token).toBeUndefined();
    expect(json.registration_client_uri).toBeUndefined();
  });

  it('returns a composite client_secret when the regions issue secrets', async () => {
    responder = (call) =>
      Response.json({ client_id: `id-${regionOf(call)}`, client_secret: `s-${regionOf(call)}` }, { status: 201 });
    const json = (await (await post()).json()) as Record<string, unknown>;
    expect(json.client_secret).toBe(encodeComposite({ ca: 's-ca', us: 's-us', mx: 's-mx' }));
  });

  it('registers once in staging', async () => {
    responder = () => Response.json({ client_id: 'dev-id' }, { status: 201 });
    const json = (await (await post('/oauth/register', STAGING_ENV)).json()) as Record<string, unknown>;
    expect(calls.map((c) => c.url)).toEqual(['https://paxaver.dev/auth/register']);
    expect(json.client_id).toBe(encodeComposite({ ca: 'dev-id' }));
  });

  it('passes a regional client error through', async () => {
    responder = () => Response.json({ error: 'invalid_redirect_uri' }, { status: 400 });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_redirect_uri' });
  });

  it('fails closed when one region is down', async () => {
    responder = (call) =>
      regionOf(call) === 'mx'
        ? new Response('down', { status: 502 })
        : Response.json({ client_id: 'x' }, { status: 201 });
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'temporarily_unavailable' });
  });

  it('fails closed when one region throws', async () => {
    responder = (call) => {
      if (regionOf(call) === 'ca') throw new Error('down');
      return Response.json({ client_id: 'x' }, { status: 201 });
    };
    expect((await post()).status).toBe(503);
  });

  it('rejects non-POST', async () => {
    const res = await request(app, '/oauth/register', {}, PROD_ENV);
    expect(res.status).toBe(405);
  });
});

describe('POST /oauth/token', () => {
  function post(body: string, headers: Record<string, string> = {}, path = '/oauth/token', env = PROD_ENV) {
    return request(
      app,
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body },
      env,
    );
  }

  const tokens = () => Response.json({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' });
  const invalidGrant = () => Response.json({ error: 'invalid_grant' }, { status: 400 });

  it.each(['/oauth/token', '/token', '/oauth2/v1/token'])(
    '%s tries each region for a code, stops at the match, swaps the composite id, and tags the refresh token',
    async (path) => {
      responder = (call) => (regionOf(call) === 'us' ? tokens() : invalidGrant());
      const res = await post(
        `grant_type=authorization_code&code=abc&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_verifier=v&client_id=${COMPOSITE}`,
        {},
        path,
      );

      expect(calls.map((c) => c.url)).toEqual([`${ISSUER.ca}/token`, `${ISSUER.us}/token`]);
      expect(calls.map((c) => new URLSearchParams(c.body).get('client_id'))).toEqual(['id-ca', 'id-us']);
      expect(new URLSearchParams(calls[1]!.body).get('code')).toBe('abc');
      expect(new URLSearchParams(calls[1]!.body).get('code_verifier')).toBe('v');
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({ access_token: 'at', refresh_token: 'us.rt', token_type: 'Bearer' });
    },
  );

  it('sends a tagged code to its region only, with the tag kept', async () => {
    responder = tokens;
    await post('grant_type=authorization_code&code=mx.abc&client_id=plain');
    expect(calls.map((c) => c.url)).toEqual([`${ISSUER.mx}/token`]);
    expect(new URLSearchParams(calls[0]!.body).get('code')).toBe('mx.abc');
  });

  it('strips the tag of a refresh token and routes it', async () => {
    responder = () => Response.json({ access_token: 'at2', refresh_token: 'rt2' });
    const res = await post(`grant_type=refresh_token&refresh_token=ca.rt1&client_id=${COMPOSITE}`);

    expect(calls.map((c) => c.url)).toEqual([`${ISSUER.ca}/token`]);
    const forwarded = new URLSearchParams(calls[0]!.body);
    expect(forwarded.get('refresh_token')).toBe('rt1');
    expect(forwarded.get('client_id')).toBe('id-ca');
    expect(((await res.json()) as Record<string, unknown>).refresh_token).toBe('ca.rt2');
  });

  it('tries each region for a legacy refresh token of a plain client', async () => {
    responder = (call) =>
      regionOf(call) === 'us' ? tokens() : Response.json({ error: 'invalid_client' }, { status: 401 });
    const res = await post('grant_type=refresh_token&refresh_token=legacy&client_id=old-us-client');

    expect(calls.map((c) => regionOf(c))).toEqual(['ca', 'us']);
    expect(calls.every((c) => new URLSearchParams(c.body).get('client_id') === 'old-us-client')).toBe(true);
    expect(((await res.json()) as Record<string, unknown>).refresh_token).toBe('us.rt');
  });

  it('prefers invalid_grant when every region misses', async () => {
    responder = (call) =>
      regionOf(call) === 'mx' ? invalidGrant() : Response.json({ error: 'invalid_client' }, { status: 401 });
    const res = await post('grant_type=authorization_code&code=gone&client_id=x');

    expect(calls).toHaveLength(3);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('stops at another client error', async () => {
    responder = () => Response.json({ error: 'invalid_request' }, { status: 400 });
    const res = await post('grant_type=authorization_code&code=abc&client_id=x');
    expect(calls).toHaveLength(1);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('swaps a composite client in a Basic header', async () => {
    responder = tokens;
    const secret = encodeComposite({ ca: 's-ca', us: 's-us', mx: 's-mx' });
    await post('grant_type=refresh_token&refresh_token=mx.rt', {
      Authorization: `Basic ${btoa(`${COMPOSITE}:${secret}`)}`,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe(`Basic ${btoa('id-mx:s-mx')}`);
  });

  it('swaps a composite client_secret in the body', async () => {
    responder = tokens;
    const secret = encodeComposite({ ca: 's-ca', us: 's-us', mx: 's-mx' });
    await post(`grant_type=refresh_token&refresh_token=us.rt&client_id=${COMPOSITE}&client_secret=${secret}`);
    const forwarded = new URLSearchParams(calls[0]!.body);
    expect(forwarded.get('client_id')).toBe('id-us');
    expect(forwarded.get('client_secret')).toBe('s-us');
  });

  it('skips a region where the composite client has no registration', async () => {
    responder = tokens;
    await post(`grant_type=authorization_code&code=abc&client_id=${encodeComposite({ mx: 'id-mx' })}`);
    expect(calls.map((c) => c.url)).toEqual([`${ISSUER.mx}/token`]);
  });

  it('rejects a malformed composite client_id without a regional call', async () => {
    const res = await post('grant_type=authorization_code&code=abc&client_id=mreg.not-json');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
    expect(calls).toHaveLength(0);
  });

  it('routes to the dev issuer in staging', async () => {
    responder = tokens;
    const res = await post('grant_type=authorization_code&code=abc&client_id=x', {}, '/oauth/token', STAGING_ENV);
    expect(calls.map((c) => c.url)).toEqual(['https://paxaver.dev/auth/token']);
    expect(((await res.json()) as Record<string, unknown>).refresh_token).toBe('ca.rt');
  });

  it('rejects other grant types, content types and methods', async () => {
    expect(await (await post('grant_type=client_credentials')).json()).toEqual({ error: 'unsupported_grant_type' });
    expect(await (await post('grant_type=authorization_code')).json()).toEqual({ error: 'invalid_request' });
    const json = await post('{}', { 'Content-Type': 'application/json' });
    expect(await json.json()).toEqual({ error: 'invalid_request' });
    expect((await request(app, '/oauth/token', {}, PROD_ENV)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('answers temporarily_unavailable when the region call throws', async () => {
    responder = () => {
      throw new Error('down');
    };
    const res = await post('grant_type=refresh_token&refresh_token=us.x');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'temporarily_unavailable' });
  });
});

describe('POST /oauth/revoke', () => {
  function jwt(payload: Record<string, unknown>): string {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
  }

  function post(body: string) {
    return request(
      app,
      '/oauth/revoke',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      PROD_ENV,
    );
  }

  it('routes an access token by its issuer', async () => {
    responder = () => new Response(null, { status: 200 });
    const token = jwt({ iss: ISSUER.mx, sub: 'u1' });
    const res = await post(`token=${token}&client_id=${COMPOSITE}`);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([`${ISSUER.mx}/revoke`]);
    expect(new URLSearchParams(calls[0]!.body).get('token')).toBe(token);
    expect(new URLSearchParams(calls[0]!.body).get('client_id')).toBe('id-mx');
  });

  it('routes a tagged refresh token and strips the tag', async () => {
    responder = () => new Response(null, { status: 200 });
    await post('token=ca.rt&token_type_hint=refresh_token');
    expect(calls.map((c) => c.url)).toEqual([`${ISSUER.ca}/revoke`]);
    expect(new URLSearchParams(calls[0]!.body).get('token')).toBe('rt');
  });

  it('sends an unknown token to every region', async () => {
    responder = () => new Response(null, { status: 200 });
    const res = await post('token=opaque');
    expect(calls).toHaveLength(3);
    expect(res.status).toBe(200);
  });

  it('rejects a request without a token', async () => {
    const res = await post('client_id=x');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
