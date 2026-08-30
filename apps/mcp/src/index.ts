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
import { authenticateRequest } from './auth/validate.js';
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
    headers[
      'Access-Control-Allow-Headers'
    ] = 'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name';
    headers['Access-Control-Expose-Headers'] = 'MCP-Session-Id';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function mergeHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function mcpAuth(request: Request, ctx: RequestContext): Promise<Response | null> {
  const url = new URL(request.url);

  // Well-known endpoints under /mcp/ are public (some clients construct
  // the metadata URL by appending /.well-known/ to the connector path).
  if (url.pathname.includes('/.well-known/')) {
    return null;
  }

  // The 2026-07-28 `server/discover` RPC is a public capability probe.
  // It carries no user data and must answer before authentication.
  if (request.headers.get('Mcp-Method')?.toLowerCase() === 'server/discover') {
    return null;
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
      ...(result.context as any),
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

  const url = new URL(request.url);
  let response: Response;
  const ctx: RequestContext = { env, request, var: { correlationId } };

  try {
    if (url.pathname === '/health') {
      response = Response.json({ status: 'ok', version: '2.1.1' });
    } else if (url.pathname === '/.well-known/security.txt' || url.pathname === '/security.txt') {
      response = new Response(SECURITY_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } else if (
      url.pathname.startsWith('/.well-known') ||
      url.pathname.startsWith('/mcp/.well-known') ||
      url.pathname === '/oauth/callback' ||
      url.pathname === '/oauth' ||
      url.pathname === '/oauth/'
    ) {
      response = await wellKnownApp.fetch(request, env);
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

async function request(input: string, init: RequestInit = {}, env: Record<string, unknown>, executionCtx?: unknown): Promise<Response> {
  const req = new Request(input, init);
  return mcpFetch(req, env as unknown as Env, executionCtx);
}

const app = { fetch: mcpFetch, request };

export default app;
