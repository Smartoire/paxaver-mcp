/**
 * Paxaver API client. Routes to the correct regional backend based on the
 * authenticated user's tenant country.
 *
 * Uses Cloudflare service bindings when available (PAXAVER_API_CA /
 * PAXAVER_API_US), otherwise falls back to authenticated HTTPS.
 *
 * The MCP server NEVER touches D1, Stripe, or SES directly. All business
 * logic lives in the backend. This client is the only data path.
 *
 * The backend's `authenticate` middleware only accepts RS256 JWTs issued by
 * the auth worker (audience `paxaver-api`). The MCP server forwards the
 * user's OAuth access token directly — it does not mint its own service
 * token.
 */

import type { Env, AuthContext, McpCountry } from '../env.js';

export interface ApiCallOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Idempotency key for mutating operations (passed to backend). */
  idempotencyKey?: string;
}

export interface ApiCallResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Resolve the service binding and API base URL for the user's region.
 */
function resolveBackend(env: Env, country: McpCountry): { fetcher: Fetcher | undefined; baseUrl: string } {
  if (country === 'us') return { fetcher: env.PAXAVER_API_US, baseUrl: env.API_BASE_URL_US };
  if (country === 'mx') return { fetcher: env.PAXAVER_API_MX, baseUrl: env.API_BASE_URL_MX };
  return { fetcher: env.PAXAVER_API_CA, baseUrl: env.API_BASE_URL_CA };
}

/**
 * Call the Paxaver backend API on behalf of the authenticated user.
 * Routes to the correct regional backend based on ctx.country.
 * Uses the service binding when configured; falls back to HTTPS.
 * Forwards the user's OAuth access token to the backend.
 */
export async function callPaxaverApi(
  env: Env,
  ctx: AuthContext,
  _origin: string,
  opts: ApiCallOptions,
): Promise<ApiCallResult> {
  if (!ctx.userToken) {
    return { ok: false, status: 401, data: { error: 'No user token available' } };
  }
  const { fetcher, baseUrl } = resolveBackend(env, ctx.country);

  const url = new URL(opts.path, baseUrl);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.userToken}`,
    'Content-Type': 'application/json',
    'X-MCP-Region': ctx.country,
  };
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  let response: Response;
  if (fetcher) {
    response = await fetcher.fetch(url.toString(), {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } else {
    response = await fetch(url.toString(), {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

/**
 * Ask the backend's internal auth endpoint whether an access token is still
 * valid — not revoked and issued by an active OAuth client. Unlike the user
 * API, this route is guarded by x-internal-secret rather than user auth.
 * Fails closed: callers must treat any non-2xx (or a thrown error) as
 * "token rejected".
 */
export async function verifyAccessToken(env: Env, country: McpCountry, token: string): Promise<ApiCallResult> {
  const { fetcher, baseUrl } = resolveBackend(env, country);
  const url = new URL('/internal/auth/verify', baseUrl);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (env.INTERNAL_SERVICE_SECRET) {
    headers['x-internal-secret'] = env.INTERNAL_SERVICE_SECRET;
  }

  const response = fetcher
    ? await fetcher.fetch(url.toString(), { method: 'GET', headers })
    : await fetch(url.toString(), { method: 'GET', headers });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}
