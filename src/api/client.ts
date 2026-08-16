/**
 * Paxaver API client. Calls the same-region backend via Cloudflare
 * service binding when available, otherwise authenticated HTTPS.
 *
 * The MCP server NEVER touches D1, Stripe, or SES directly. All business
 * logic lives in the backend. This client is the only data path.
 */

import { SignJWT } from 'jose';
import type { Env, AuthContext } from '../env.js';

const SERVICE_AUDIENCE = 'paxaver-internal';
const SERVICE_TTL_SECONDS = 120;
const JWT_ALG = 'HS256';

/**
 * Sign a short-lived service-binding JWT that the backend's
 * `authenticate` middleware accepts as a trusted internal call.
 * The token carries the authenticated Paxaver user id in `sub`
 * and the resolved school slug in `schoolSlug`.
 */
export async function signServiceToken(env: Env, ctx: AuthContext, origin: string): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: ctx.userId, type: 'mcp_service', schoolSlug: ctx.schoolSlug })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuer(origin)
    .setAudience(SERVICE_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SERVICE_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(secret);
}

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
 * Call the Paxaver backend API on behalf of the authenticated user.
 * Uses the service binding when configured; falls back to HTTPS.
 */
export async function callPaxaverApi(
  env: Env,
  ctx: AuthContext,
  origin: string,
  opts: ApiCallOptions,
): Promise<ApiCallResult> {
  const token = await signServiceToken(env, ctx, origin);

  const url = new URL(opts.path, env.API_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-MCP-Region': env.REGION,
  };
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  let response: Response;
  if (env.PAXAVER_API) {
    // Service binding: same-region, no public-network hop.
    response = await env.PAXAVER_API.fetch(url.toString(), {
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
