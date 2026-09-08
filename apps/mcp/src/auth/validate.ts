/**
 * OAuth access-token validation for incoming MCP requests.
 *
 * Validates RS256 JWTs from regional auth workers via JWKS.
 * Each region has its own auth worker (paxaver.ca/auth, paxaver.com/auth,
 * paxaver.mx/auth) with its own JWKS endpoint. The issuer is extracted
 * from the JWT `iss` claim to select the correct JWKS.
 *
 * Also supports legacy static MCP client tokens via the backend /whoami.
 *
 * User context (permissions, schoolSlug, studentIds, country) is loaded
 * from the backend via the service-binding API client. The user's region
 * is determined from the JWT tenant_id claim and used to route to the
 * correct regional backend.
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import type { Env, AuthContext, McpCountry } from '../env.js';
import { callPaxaverApi } from '../api/client.js';

export interface AuthResult {
  ok: boolean;
  status: number;
  context?: AuthContext;
  error?: { code: string; message: string };
  wwwAuthenticate?: string;
}

/** Known regional auth issuer URLs. */
const AUTH_ISSUERS: Record<string, string> = {
  'https://paxaver.ca/auth': 'ca',
  'https://paxaver.com/auth': 'us',
  'https://paxaver.mx/auth': 'mx',
  // Staging/dev
  'https://paxaver.dev/auth': 'ca',
  'http://localhost:8788': 'ca',
};

/** Get the auth issuer URL for the environment. Used for OAuth metadata endpoints. */
export function authUrl(env: Env): string {
  if (env.ENVIRONMENT === 'development') return 'http://localhost:8788';
  if (env.ENVIRONMENT === 'staging') return 'https://paxaver.dev/auth';
  return 'https://paxaver.com/auth';
}

/** All supported authorization servers for the current environment. */
export function authServers(env: Env): string[] {
  if (env.ENVIRONMENT === 'development') return ['http://localhost:8788'];
  if (env.ENVIRONMENT === 'staging') return ['https://paxaver.dev/auth'];
  return ['https://paxaver.ca/auth', 'https://paxaver.com/auth', 'https://paxaver.mx/auth'];
}

// ponytail: one JWKS per issuer, cached in a Map. Enough for 3 regional issuers.
// Upgrade path: use a KV-backed JWKS cache for long-lived isolates.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

function countryFromTenantId(tenantId: string | undefined | null): McpCountry {
  if (tenantId?.endsWith('-us')) return 'us';
  if (tenantId?.endsWith('-mx')) return 'mx';
  return 'ca';
}

export async function authenticateRequest(
  env: Env,
  authHeader: string | undefined,
  origin: string,
): Promise<AuthResult> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'Authorization required' },
      wwwAuthenticate: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    };
  }

  // --- RS256 path (regional auth worker JWT via JWKS) ---
  // Peek at the unverified payload to get the issuer, then verify with the
  // correct regional JWKS. This supports JWTs from any regional auth worker.
  let issuer: string | undefined;
  try {
    const unverified = decodeJwt(token);
    issuer = typeof unverified.iss === 'string' ? unverified.iss : undefined;
  } catch {
    // Malformed JWT — fall through to legacy token check.
  }

  if (issuer && AUTH_ISSUERS[issuer]) {
    const jwks = getJwks(issuer);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['RS256'],
        issuer,
        audience: ['paxaver-api', 'mcp', origin],
      });

      if (payload.sub) {
        const country = countryFromTenantId(payload.tenant_id as string | undefined);

        const result = await callPaxaverApi(
          env,
          {
            userId: payload.sub,
            email: '',
            schoolSlug: '',
            permissions: [],
            isPlatformAdmin: false,
            studentIds: [],
            country,
            userToken: token,
          },
          origin,
          { method: 'GET', path: '/api/users/me/context' },
        );

        if (!result.ok || !result.data) {
          return {
            ok: false,
            status: 401,
            error: { code: 'INVALID_TOKEN', message: 'Token has been revoked or user no longer exists' },
          };
        }

        const ctx = (result.data as { data?: AuthContext })?.data ?? (result.data as AuthContext);
        if (!ctx.userId) {
          return {
            ok: false,
            status: 401,
            error: { code: 'INVALID_TOKEN', message: 'Token has been revoked or user no longer exists' },
          };
        }
        if (!ctx.country) ctx.country = country;
        ctx.userToken = token;
        return { ok: true, status: 200, context: ctx };
      }
    } catch {
      // Fall through to legacy static token check.
    }
  }

  // --- Legacy static MCP client token ---
  // Deprecated: static tokens are replaced by OAuth JWT authentication.
  // REMOVAL DATE: 2026-11-30. After this date, delete this entire legacy
  // block and reject any non-JWT bearer token. Track usage via the
  // `legacy_static_token` log field below; when it stops appearing in
  // production logs for 30 consecutive days, remove early.
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'legacy static MCP token used',
      legacy_static_token: 1,
      action: 'migrate to OAuth JWT authentication',
    }),
  );
  // Without a JWT we do not know the user's region, so try each region.
  for (const country of ['ca', 'us', 'mx'] as const) {
    const baseUrl =
      country === 'us' ? env.API_BASE_URL_US : country === 'mx' ? env.API_BASE_URL_MX : env.API_BASE_URL_CA;
    const fetcher = country === 'us' ? env.PAXAVER_API_US : country === 'mx' ? env.PAXAVER_API_MX : env.PAXAVER_API_CA;
    if (!baseUrl) continue;
    const whoamiUrl = new URL('/api/mcp/whoami', baseUrl);
    let whoamiResp: Response;
    if (fetcher) {
      whoamiResp = await fetcher.fetch(whoamiUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-MCP-Region': country,
        },
      });
    } else {
      whoamiResp = await fetch(whoamiUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-MCP-Region': country,
        },
      });
    }

    if (whoamiResp.ok) {
      const data = await whoamiResp.json().catch(() => null);
      const ctx = (data as { data?: AuthContext })?.data ?? (data as AuthContext);
      if (!ctx.userId) continue;
      if (!ctx.country) ctx.country = country;
      return { ok: true, status: 200, context: ctx };
    }
  }

  return {
    ok: false,
    status: 401,
    error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    wwwAuthenticate: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  };
}
