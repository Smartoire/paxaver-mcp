/**
 * OAuth access-token validation for incoming MCP requests.
 *
 * Validates RS256 JWTs from the centralized auth worker via JWKS.
 * Also supports legacy static MCP client tokens via the backend /whoami.
 *
 * User context (permissions, schoolSlug, studentIds, country) is loaded
 * from the backend via the service-binding API client. The user's region
 * is determined from the JWT tenant_id claim and used to route to the
 * correct regional backend.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env, AuthContext } from '../env.js';
import { callPaxaverApi } from '../api/client.js';

export interface AuthResult {
  ok: boolean;
  status: number;
  context?: AuthContext;
  error?: { code: string; message: string };
  wwwAuthenticate?: string;
}

function authIssuer(env: Env): string {
  if (env.ENVIRONMENT === 'development') return 'http://localhost:8788';
  if (env.ENVIRONMENT === 'staging') return 'https://auth.paxaver.dev';
  return 'https://auth.paxaver.com';
}

// ponytail: JWKS cache is per-isolate. Workers isolates are short-lived,
// so this cache is effectively per-request. No TTL needed.
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

function countryFromTenantId(tenantId: string | undefined | null): 'ca' | 'us' {
  return tenantId && tenantId.endsWith('-us') ? 'us' : 'ca';
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
      wwwAuthenticate: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    };
  }

  // --- RS256 path (auth worker JWT via JWKS) ---
  const issuer = authIssuer(env);
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
    // Fall through to legacy static token check
  }

  // --- Legacy static MCP client token ---
  // Deprecated: static tokens are replaced by OAuth JWT authentication.
  // REMOVAL DATE: 2026-11-30. After this date, delete this entire legacy
  // block (lines ~119-154) and reject any non-JWT bearer token. Track usage
  // via the `legacy_static_token` log field below; when it stops appearing
  // in production logs for 30 consecutive days, remove early.
  // Structured log so legacy usage is observable/alertable in Cloudflare.
  // Search logs with: level=warn legacy_static_token=1
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'legacy static MCP token used',
    legacy_static_token: 1,
    action: 'migrate to OAuth JWT authentication',
  }));
  // Without a JWT we do not know the user's region, so try CA first, then US.
  for (const country of ['ca', 'us'] as const) {
    const baseUrl = country === 'us' ? env.API_BASE_URL_US : env.API_BASE_URL_CA;
    const fetcher = country === 'us' ? env.PAXAVER_API_US : env.PAXAVER_API_CA;
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
    wwwAuthenticate: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  };
}
