/**
 * Paxaver MCP server entry point.
 *
 * Architecture: AI clients → MCP server (this worker) → Paxaver API worker
 * (via Cloudflare service binding, same region) → D1.
 *
 * The MCP server never touches D1, Stripe, or SES directly. It is a thin
 * AI-facing adapter over the existing Paxaver platform.
 */

import type { Env, AppVariables } from './env.js';
import { authenticateRequest, authUrl } from './auth/validate.js';
import { transportApp } from './transport/streamable-http.js';
import { originFrom } from './lib/url.js';
import { wellKnownApp } from './discovery/well-known.js';
import { SERVER_VERSION } from './lib/version.js';

const ROBOTS_TXT = `User-agent: *
Allow: /mcp
Allow: /.well-known/
Allow: /health
Disallow: /
`;

const SECURITY_TXT = `# Paxaver security.txt (RFC 9116)
# https://securitytxt.org/

Contact: mailto:security@paxaver.com
Expires: 2027-08-12T23:59:59Z
Preferred-Languages: en, fr
Canonical: https://paxaver.com/.well-known/security.txt
Policy: https://paxaver.com/privacy/security
`;

export function isAllowedOrigin(origin: string, allowed: string): boolean {
  const list = allowed.split(',').map((o) => o.trim());
  return list.some((pattern) => {
    if (pattern === origin) return true;
    const wildcard = pattern.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?\*\.([^/]+)$/);
    if (!wildcard) return false;
    const [, scheme, base] = wildcard;
    if (!base) return false;
    try {
      const url = new URL(origin);
      if (scheme && `${url.protocol}//` !== scheme) return false;
      return url.hostname === base || url.hostname.endsWith('.' + base);
    } catch {
      return false;
    }
  });
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (origin && isAllowedOrigin(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name';
    headers['Access-Control-Expose-Headers'] = 'MCP-Session-Id';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function mergeHeaders(response: Response, extra: Record<string, string>): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers([...response.headers, ...Object.entries(extra)]),
  });
}

async function isPublicDiscoveryRequest(request: Request): Promise<boolean> {
  if (request.method !== 'POST') return false;
  try {
    const body: unknown = await request.clone().json();
    return (
      !Array.isArray(body) &&
      body !== null &&
      typeof body === 'object' &&
      'method' in body &&
      body.method === 'server/discover'
    );
  } catch {
    return false;
  }
}

async function mcpAuth(request: Request, ctx: { env: Env; var: Partial<AppVariables> }): Promise<Response | null> {
  const origin = originFrom(request.url);
  const result = await authenticateRequest(ctx.env, request.headers.get('Authorization') || undefined, origin);

  if (!result.ok) {
    const headers: Record<string, string> = {};
    if (result.wwwAuthenticate) headers['WWW-Authenticate'] = result.wwwAuthenticate;
    return Response.json(result.error, { status: result.status, headers });
  }

  if (result.context) {
    ctx.var = {
      ...ctx.var,
      ...(result.context as Partial<AppVariables>),
      subscription: result.context.subscription ?? null,
    };
  }

  return null;
}

async function mcpFetch(request: Request, env: Env, _executionCtx?: unknown): Promise<Response> {
  const origin = request.headers.get('Origin') || '';
  const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const correlationId = request.headers.get('X-Correlation-Id') || crypto.randomUUID();
  const securityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Correlation-Id': correlationId,
  };

  // Some MCP clients (for example Glama) register the server by its bare
  // origin and POST JSON-RPC to /. Treat POST / as /mcp. GET / and HEAD /
  // remain the health check below.
  if (request.method === 'POST' && new URL(request.url).pathname === '/') {
    const mcpUrl = new URL(request.url);
    mcpUrl.pathname = '/mcp';
    request = new Request(mcpUrl, request);
  }

  const url = new URL(request.url);
  let response: Response;
  const ctx: { env: Env; var: Partial<AppVariables> } = { env, var: { correlationId } };

  try {
    if (url.pathname === '/robots.txt') {
      response = new Response(ROBOTS_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } else if (
      url.pathname === '/health' ||
      (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD'))
    ) {
      const healthBody =
        request.method === 'HEAD'
          ? null
          : JSON.stringify({ status: 'ok', version: SERVER_VERSION, commit: env.COMMIT_SHA ?? 'unknown' });
      response = new Response(healthBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else if (url.pathname === '/.well-known/security.txt' || url.pathname === '/security.txt') {
      response = new Response(SECURITY_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } else if (url.pathname === '/oauth/authorize') {
      // Per AGENTS.md: external systems (MCP) use paxaver.com/auth as the
      // single trusted auth server. No region detection for OAuth.
      const authServer = authUrl(env);
      response = new Response(null, {
        status: 302,
        headers: { Location: `${authServer}/authorize${url.search}` },
      });
    } else if (url.pathname === '/register' || url.pathname === '/oauth/register') {
      if (request.method !== 'POST') {
        response = new Response('Method not allowed', { status: 405 });
      } else {
        const authServer = authUrl(env);
        const proxied = new Request(`${authServer}/register`, request);
        proxied.headers.delete('Host');
        response = await fetch(proxied);
      }
    } else if (
      url.pathname.startsWith('/.well-known') ||
      url.pathname.startsWith('/mcp/.well-known') ||
      url.pathname === '/oauth/callback' ||
      url.pathname === '/oauth' ||
      url.pathname === '/oauth/'
    ) {
      response = await wellKnownApp.fetch(request, env);
    } else if (url.pathname === '/token' || url.pathname === '/oauth/token' || url.pathname === '/oauth2/v1/token') {
      if (request.method !== 'POST') {
        response = new Response('Method not allowed', { status: 405 });
      } else {
        const authServer = authUrl(env);
        const proxied = new Request(`${authServer}/token`, request);
        proxied.headers.delete('Host');
        response = await fetch(proxied);
      }
    } else if (url.pathname === '/mcp') {
      const authResult = (await isPublicDiscoveryRequest(request)) ? null : await mcpAuth(request, ctx);
      if (authResult) {
        response = authResult;
      } else if (request.method === 'GET' && !ctx.var.isPlatformAdmin && ctx.var.subscription?.status !== 'active') {
        response = Response.json(
          {
            error:
              'An active Parent AI or PAC AI subscription is required to use Paxaver MCP. Please visit your Paxaver portal to subscribe.',
          },
          { status: 403 },
        );
      } else {
        response = await transportApp.fetch(request, { env, var: ctx.var as AppVariables });
      }
    } else {
      response = Response.json({ error: 'Not found' }, { status: 404 });
    }
  } catch (err) {
    console.error(`[unhandled] ${request.method} ${url.pathname}:`, err instanceof Error ? err.message : String(err));
    response = Response.json({ error: 'Internal error' }, { status: 500 });
  }

  return mergeHeaders(response, { ...cors, ...securityHeaders });
}

const app = { fetch: mcpFetch };

export default app;
