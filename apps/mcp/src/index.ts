/**
 * Paxaver MCP server entry point.
 *
 * Architecture: AI clients → MCP server (this worker) → Paxaver API worker
 * (via Cloudflare service binding, same region) → D1.
 *
 * The MCP server never touches D1, Stripe, or SES directly. It is a thin
 * AI-facing adapter over the existing Paxaver platform.
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from './env.js';
import { authenticateRequest } from './auth/validate.js';
import { transportApp, originFrom } from './transport/streamable-http.js';
import { wellKnownApp } from './discovery/well-known.js';

type AppContext = { Bindings: Env; Variables: AppVariables };

const app = new Hono<AppContext>();

// --- CORS (allowlist, not reflect-any-origin) ---
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

  // Check exact match and wildcard subdomain match (*.domain)
  const isAllowed = allowed.some((pattern) => {
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

  if (origin && isAllowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name',
    );
    c.header('Access-Control-Expose-Headers', 'MCP-Session-Id');
    c.header('Access-Control-Max-Age', '86400');
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// --- Security headers ---
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});

// --- Correlation ID ---
app.use('*', async (c, next) => {
  const correlationId = c.req.header('X-Correlation-Id') || crypto.randomUUID();
  c.set('correlationId', correlationId);
  c.header('X-Correlation-Id', correlationId);
  await next();
});

// --- Auth middleware for MCP endpoints ---
// Applied only to /mcp (transport). OAuth discovery and
// well-known endpoints are public.
app.use('/mcp', mcpAuthMiddleware);
app.use('/mcp/*', mcpAuthMiddleware);

async function mcpAuthMiddleware(c: any, next: any): Promise<Response | void> {
  // The 2026-07-28 `server/discover` RPC is a public capability probe.
  // It carries no user data and must answer before authentication.
  if (c.req.header('Mcp-Method')?.toLowerCase() === 'server/discover') {
    await next();
    return;
  }

  const origin = originFrom(c.req.url);
  const result = await authenticateRequest(c.env, c.req.header('Authorization'), origin);

  if (!result.ok) {
    const headers: Record<string, string> = {};
    if (result.wwwAuthenticate) headers['WWW-Authenticate'] = result.wwwAuthenticate;
    return c.json(result.error, result.status as 401 | 403 | 500, headers);
  }

  if (result.context) {
    c.set('userId', result.context.userId);
    c.set('email', result.context.email);
    c.set('schoolSlug', result.context.schoolSlug);
    c.set('permissions', result.context.permissions);
    c.set('isPlatformAdmin', result.context.isPlatformAdmin);
    c.set('studentIds', result.context.studentIds);
    c.set('userToken', result.context.userToken ?? '');
    c.set('subscription', result.context.subscription ?? null);
  }

  // Block tool calls for users without an active subscription.
  // tools/list is allowed so the user can see what is available.
  const mcpMethod = c.req.header('Mcp-Method')?.toLowerCase();
  const isPlatformAdmin = result.context?.isPlatformAdmin ?? false;
  const subStatus = result.context?.subscription?.status ?? 'none';
  if (!isPlatformAdmin && subStatus !== 'active' && mcpMethod === 'tools/call') {
    const message =
      subStatus === 'expired'
        ? 'Your Paxaver AI subscription has expired. Please renew your subscription at https://paxaver.com/settings/mcp to continue using Paxaver MCP tools.'
        : 'An active Paxaver AI subscription is required to use Paxaver MCP tools. Please buy a subscription or activate a trial at https://paxaver.com/settings/mcp.';
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message,
        },
      },
      200,
    );
  }

  await next();
}

// --- Mount routes ---
app.route('/', wellKnownApp);
app.route('/', transportApp);

// --- Health ---
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: '2.1.1',
  }),
);

// --- 404 ---
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// --- Error handler (never leak stack traces) ---
app.onError((err, c) => {
  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err instanceof Error ? err.message : String(err));
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
