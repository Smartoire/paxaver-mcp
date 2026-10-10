/**
 * Alexa routes: region picker, token routing by region tag, and skill
 * routing by token issuer. Regional backends are mocked service bindings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpCountry } from '../src/env.js';
import { request } from './request.js';

const verify = vi.hoisted(() => ({ result: true, calls: 0 }));
vi.mock('../src/alexa/verify-request.js', () => ({
  verifyAlexaRequest: async () => {
    verify.calls++;
    return verify.result;
  },
}));

const { default: app } = await import('../src/index.js');

interface Call {
  region: McpCountry;
  url: string;
  headers: Headers;
  body: string;
}

let calls: Call[] = [];
let responder: (call: Call) => Response | Promise<Response>;

function binding(region: McpCountry): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      const text =
        typeof body === 'string'
          ? body
          : body instanceof Uint8Array
            ? new TextDecoder().decode(body)
            : String(body ?? '');
      const call = { region, url: String(input), headers: new Headers(init?.headers), body: text };
      calls.push(call);
      return responder(call);
    },
  } as unknown as Fetcher;
}

const BASE_ENV = {
  ALLOWED_ORIGINS: '',
  PAXAVER_API_CA: binding('ca'),
  PAXAVER_API_US: binding('us'),
  PAXAVER_API_MX: binding('mx'),
  INTERNAL_SERVICE_SECRET: 'internal-test-secret',
  ALEXA_SKILL_ID: 'amzn1.ask.skill.test',
};
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

beforeEach(() => {
  calls = [];
  verify.result = true;
  verify.calls = 0;
  responder = () => Response.json({ ok: true });
});

describe('GET /alexa/authorize', () => {
  const query =
    '?client_id=alexa-skill&response_type=code&state=a%2Bb%3D&redirect_uri=https%3A%2F%2Fpitangui.amazon.com%2Fapi%2Fskill%2Flink%2FM2AJ8I5LFUNYQV&code_challenge=abc&code_challenge_method=S256';

  function hrefs(html: string): string[] {
    return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  }

  it.each([
    [PROD_ENV, ['https://paxaver.ca', 'https://paxaver.com', 'https://paxaver.mx']],
    [STAGING_ENV, ['https://paxaver.dev', 'https://paxaver.dev', 'https://paxaver.dev']],
  ])('links to each region with the query unchanged ($ENVIRONMENT)', async (env, bases) => {
    const res = await request(app, `/alexa/authorize${query}`, {}, env);
    expect(res.status).toBe(200);
    expect(hrefs(await res.text())).toEqual(bases.map((b) => `${b}/api/assistant/alexa/authorize${query}`));
    expect(calls).toHaveLength(0);
  });

  it('sets CSP and no-store', async () => {
    const res = await request(app, `/alexa/authorize${query}`, {}, PROD_ENV);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Location')).toBeNull();
  });

  it.each([
    ['MX', 'https://paxaver.mx'],
    ['US', 'https://paxaver.com'],
    ['CA', 'https://paxaver.ca'],
  ])('lists the visitor country %s first, and still offers all three', async (country, first) => {
    const req = new Request(`http://localhost/alexa/authorize${query}`);
    Object.defineProperty(req, 'cf', { value: { country } });
    const res = await app.fetch(req, PROD_ENV as never);
    const links = hrefs(await res.text());
    expect(links).toHaveLength(3);
    expect(links[0]!.startsWith(`${first}/`)).toBe(true);
  });

  it('escapes the query in HTML', async () => {
    const res = await request(app, `/alexa/authorize?state="><script>`, {}, PROD_ENV);
    expect(await res.text()).not.toContain('<script>');
  });

  it('rejects non-GET', async () => {
    const res = await request(app, '/alexa/authorize', { method: 'POST' }, PROD_ENV);
    expect(res.status).toBe(405);
  });
});

describe('POST /alexa/token', () => {
  const BASIC = 'Basic YWxleGEtc2tpbGw6c2VjcmV0';

  function post(body: string, env = PROD_ENV, contentType = 'application/x-www-form-urlencoded') {
    return request(
      app,
      '/alexa/token',
      { method: 'POST', headers: { 'Content-Type': contentType, Authorization: BASIC }, body },
      env,
    );
  }

  it.each(['ca', 'us', 'mx'] as const)('routes a %s code to that region only, body unchanged', async (region) => {
    responder = () =>
      Response.json({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600 });
    const body = `grant_type=authorization_code&code=${region}.abc-123&redirect_uri=https%3A%2F%2Fexample&code_verifier=v`;
    const res = await post(body);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.region).toBe(region);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/assistant/alexa/token');
    expect(calls[0]!.body).toBe(body);
    expect(calls[0]!.headers.get('Authorization')).toBe(BASIC);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.refresh_token).toBe(`${region}.rt`);
    expect(json.access_token).toBe('at');
  });

  it('rejects an untagged code without a regional call', async () => {
    const res = await post('grant_type=authorization_code&code=abc-123');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    expect(calls).toHaveLength(0);
  });

  it('strips the tag of a refresh token, routes it, and tags the new one', async () => {
    responder = () => Response.json({ access_token: 'at2', refresh_token: 'rt2' });
    const res = await post('grant_type=refresh_token&refresh_token=mx.rt1&scope=tools');

    expect(calls.map((c) => c.region)).toEqual(['mx']);
    const forwarded = new URLSearchParams(calls[0]!.body);
    expect(forwarded.get('refresh_token')).toBe('rt1');
    expect(forwarded.get('scope')).toBe('tools');
    expect(forwarded.get('grant_type')).toBe('refresh_token');
    expect(((await res.json()) as Record<string, unknown>).refresh_token).toBe('mx.rt2');
  });

  it('tries each region for a legacy refresh token and tags the match', async () => {
    responder = (call) =>
      call.region === 'us'
        ? Response.json({ access_token: 'at', refresh_token: 'new' })
        : Response.json({ error: 'invalid_grant' }, { status: 400 });
    const res = await post('grant_type=refresh_token&refresh_token=legacy');

    expect(calls.map((c) => c.region)).toEqual(['ca', 'us']);
    expect(calls.every((c) => new URLSearchParams(c.body).get('refresh_token') === 'legacy')).toBe(true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).refresh_token).toBe('us.new');
  });

  it('returns invalid_grant when no region knows a legacy refresh token', async () => {
    responder = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    const res = await post('grant_type=refresh_token&refresh_token=legacy');

    expect(calls.map((c) => c.region)).toEqual(['ca', 'us', 'mx']);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('stops the legacy fan-out at a client error', async () => {
    responder = () => Response.json({ error: 'invalid_client' }, { status: 401 });
    const res = await post('grant_type=refresh_token&refresh_token=legacy');

    expect(calls.map((c) => c.region)).toEqual(['ca']);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('passes an error from the tagged region through', async () => {
    responder = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    const res = await post('grant_type=authorization_code&code=ca.used');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects other content types', async () => {
    const res = await post('{"grant_type":"authorization_code"}', PROD_ENV, 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });

  it('rejects other grant types', async () => {
    const res = await post('grant_type=client_credentials');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_grant_type' });
    expect(calls).toHaveLength(0);
  });

  it('answers temporarily_unavailable when the region call throws', async () => {
    responder = () => {
      throw new Error('down');
    };
    const res = await post('grant_type=authorization_code&code=us.x');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'temporarily_unavailable' });
  });

  it('rejects non-POST', async () => {
    const res = await request(app, '/alexa/token', {}, PROD_ENV);
    expect(res.status).toBe(405);
  });
});

describe('POST /alexa', () => {
  function jwt(payload: Record<string, unknown>): string {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
  }

  function alexaBody(opts: { token?: string; appId?: string; type?: string } = {}): string {
    return JSON.stringify({
      version: '1.0',
      context: {
        System: {
          application: { applicationId: opts.appId ?? 'amzn1.ask.skill.test' },
          user: { userId: 'amzn1.ask.account.x', ...(opts.token ? { accessToken: opts.token } : {}) },
        },
      },
      request: { type: opts.type ?? 'LaunchRequest', timestamp: new Date().toISOString() },
    });
  }

  function post(body: string, env: Record<string, unknown> = PROD_ENV) {
    return request(
      app,
      '/alexa',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          SignatureCertChainUrl: 'https://s3.amazonaws.com/echo.api/echo-api-cert.pem',
          'Signature-256': 'sig',
        },
        body,
      },
      env,
    );
  }

  it.each([
    ['https://paxaver.ca/auth', 'ca'],
    ['https://paxaver.com/auth', 'us'],
    ['https://paxaver.mx/auth', 'mx'],
  ])('forwards a token from %s to %s with the body unchanged', async (iss, region) => {
    responder = () => Response.json({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'hi' } } });
    const token = jwt({ iss, sub: 'u1' });
    const body = alexaBody({ token });
    const res = await post(body);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.region).toBe(region);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/assistant/alexa');
    expect(calls[0]!.body).toBe(body);
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(calls[0]!.headers.get('x-internal-secret')).toBe('internal-test-secret');
    expect(calls[0]!.headers.get('Signature-256')).toBeNull();
    expect(((await res.json()) as { response: { outputSpeech: { text: string } } }).response.outputSpeech.text).toBe(
      'hi',
    );
  });

  it('routes the dev issuer in staging', async () => {
    const res = await post(alexaBody({ token: jwt({ iss: 'https://paxaver.dev/auth' }) }), STAGING_ENV);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.region)).toEqual(['ca']);
  });

  it('takes the token from session.user when context has none', async () => {
    const token = jwt({ iss: 'https://paxaver.mx/auth' });
    const body = JSON.stringify({
      session: { application: { applicationId: 'amzn1.ask.skill.test' }, user: { accessToken: token } },
      request: { type: 'IntentRequest' },
    });
    await post(body);
    expect(calls.map((c) => c.region)).toEqual(['mx']);
  });

  it('rejects a request that fails Amazon verification', async () => {
    verify.result = false;
    const res = await post(alexaBody({ token: jwt({ iss: 'https://paxaver.ca/auth' }) }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([['amzn1.ask.skill.other'], ['']])('rejects application id %j', async (appId) => {
    const body = JSON.parse(alexaBody({ token: jwt({ iss: 'https://paxaver.ca/auth' }) }));
    body.context.System.application.applicationId = appId || undefined;
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([PROD_ENV, STAGING_ENV])('fails closed when ALEXA_SKILL_ID is unset ($ENVIRONMENT)', async (env) => {
    const res = await post(alexaBody({ token: jwt({ iss: 'https://paxaver.ca/auth' }) }), {
      ...env,
      ALEXA_SKILL_ID: undefined,
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('skips Amazon verification only in development', async () => {
    verify.result = false;
    const res = await post(alexaBody({ token: jwt({ iss: 'https://paxaver.dev/auth' }) }), {
      ...STAGING_ENV,
      ENVIRONMENT: 'development',
      ALEXA_SKILL_ID: undefined,
    });
    expect(res.status).toBe(200);
    expect(verify.calls).toBe(0);
    expect(calls.map((c) => c.region)).toEqual(['ca']);
  });

  it('answers LinkAccount locally when there is no token', async () => {
    const res = await post(alexaBody());
    const json = (await res.json()) as { response: { card?: { type: string }; shouldEndSession: boolean } };
    expect(res.status).toBe(200);
    expect(json.response.card).toEqual({ type: 'LinkAccount' });
    expect(json.response.shouldEndSession).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('answers an empty response to SessionEndedRequest without a token', async () => {
    const res = await post(alexaBody({ type: 'SessionEndedRequest' }));
    expect(await res.json()).toEqual({ version: '1.0', response: {} });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['unknown issuer', jwt({ iss: 'https://evil.example/auth' })],
    ['dev issuer in production', jwt({ iss: 'https://paxaver.dev/auth' })],
    ['no issuer', jwt({ sub: 'u1' })],
    ['malformed token', 'not-a-jwt'],
  ])('asks to relink for %s', async (_label, token) => {
    const res = await post(alexaBody({ token }));
    const json = (await res.json()) as { response: { outputSpeech: { text: string }; card?: { type: string } } };
    expect(res.status).toBe(200);
    expect(json.response.outputSpeech.text).toContain('relink');
    expect(json.response.card).toEqual({ type: 'LinkAccount' });
    expect(calls).toHaveLength(0);
  });

  it('answers with speech when the region call throws', async () => {
    responder = () => {
      throw new Error('down');
    };
    const res = await post(alexaBody({ token: jwt({ iss: 'https://paxaver.com/auth' }) }));
    const json = (await res.json()) as { response: { outputSpeech: { text: string } } };
    expect(res.status).toBe(200);
    expect(json.response.outputSpeech.text).toContain('unavailable');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('rejects non-POST', async () => {
    const res = await request(app, '/alexa', {}, PROD_ENV);
    expect(res.status).toBe(405);
  });
});
