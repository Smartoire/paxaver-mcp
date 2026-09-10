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
import { transportApp, originFrom } from './transport/streamable-http.js';
import { wellKnownApp } from './discovery/well-known.js';

const SECURITY_TXT = `# Paxaver security.txt (RFC 9116)
# https://securitytxt.org/

Contact: mailto:security@paxaver.com
Expires: 2027-08-12T23:59:59Z
Preferred-Languages: en, fr
Canonical: https://paxaver.com/.well-known/security.txt
Policy: https://paxaver.com/privacy/security
`;

interface RequestContext {
  env: Env;
  request: Request;
  var: Partial<AppVariables>;
}

// Metadata-only methods callable without a bearer token. Everything else
// (tools/call, resources/read, prompts/get, unknown methods) requires auth.
const PUBLIC_MCP_METHODS = new Set([
  'server/discover',
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

function isAllowedOrigin(origin: string, allowed: string): boolean {
  const list = allowed.split(',').map((o) => o.trim());
  return list.some((pattern) => {
    if (pattern === origin) return true;
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      try {
        const url = new URL(origin);
        return url.hostname === base || url.hostname.endsWith('.' + base);
      } catch {
        return false;
      }
    }
    return false;
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

async function mcpAuth(request: Request, ctx: RequestContext): Promise<Response | null> {
  const url = new URL(request.url);

  // Well-known endpoints under /mcp/ are public (some clients construct
  // the metadata URL by appending /.well-known/ to the connector path).
  if (url.pathname.includes('/.well-known/')) {
    return null;
  }

  // Metadata-only RPC methods are public capability probes: they expose
  // tool/resource/prompt schemas and server info but never user data.
  // Marketplace crawlers (LobeHub, etc.) and MCP clients need these to
  // answer before authentication. Data-touching methods (tools/call,
  // resources/read, prompts/get) still require auth — enforced again in
  // the JSON-RPC layer so a spoofed header on a batch can't bypass it.
  const mcpMethod = request.headers.get('Mcp-Method')?.toLowerCase();
  if (mcpMethod && PUBLIC_MCP_METHODS.has(mcpMethod)) {
    return null;
  }

  // The SSE stream and public metadata probes do not carry user data.
  // Some clients (Glama, OpenAI) send the RPC method in the JSON body
  // without the Mcp-Method header; parse a small clone to allow them.
  if (request.method === 'GET' && url.pathname === '/mcp') {
    return null;
  }
  if (!mcpMethod && !request.headers.get('Authorization') && request.method === 'POST' && url.pathname === '/mcp') {
    try {
      const raw = (await request.clone().json()) as unknown;
      const batch = Array.isArray(raw) ? raw : [raw];
      if (
        batch.length > 0 &&
        batch.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            PUBLIC_MCP_METHODS.has(((item as { method?: string }).method ?? '').toLowerCase()),
        )
      ) {
        return null;
      }
    } catch {
      // Not valid JSON or not a public method; fall through to auth.
    }
  }

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
  const ctx: RequestContext = { env, request, var: { correlationId } };

  try {
    if (
      url.pathname === '/health' ||
      (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD'))
    ) {
      const healthBody = request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', version: '2.2.2' });
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
      const authResult = await mcpAuth(request, ctx);
      if (authResult) {
        response = authResult;
      } else {
        response = await transportApp.fetch(request, {
          env,
          var: ctx.var as AppVariables,
          request,
        });
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

async function request(
  input: string,
  init: RequestInit = {},
  env: Record<string, unknown>,
  executionCtx?: unknown,
): Promise<Response> {
  const req = new Request(input, init);
  return mcpFetch(req, env as unknown as Env, executionCtx);
}

const app = { fetch: mcpFetch, request };

export default app;
