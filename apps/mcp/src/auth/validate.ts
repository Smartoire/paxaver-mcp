/**
 * OAuth access-token validation for incoming MCP requests.
 *
 * Validates RS256 JWTs from the environment's regional authorization
 * servers via JWKS. Production accepts paxaver.ca/auth, paxaver.com/auth and
 * paxaver.mx/auth; development and staging accept paxaver.dev/auth. The JWT
 * `iss` claim must be one of these issuers (see lib/regions.ts).
 *
 * User context (permissions, schoolSlug, studentIds, country) is loaded
 * from the backend via the service-binding API client. The user's region
 * is the region of the verified issuer. It routes every call to the
 * correct regional backend.
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import type { Env, AuthContext, McpCountry } from '../env.js';
import { callPaxaverApi, verifyAccessToken } from '../api/client.js';
import { regionFromIssuer } from '../lib/regions.js';

export interface AuthResult {
  ok: boolean;
  status: number;
  context?: AuthContext;
  error?: { code: string; message: string };
  wwwAuthenticate?: string;
}

// Warn once per isolate when INTERNAL_SERVICE_SECRET is missing — avoids
// per-request log spam.
let warnedNoSecret = false;
function warnNoSecret(env: Env): void {
  if (!warnedNoSecret) {
    warnedNoSecret = true;
    if (env.ENVIRONMENT === 'development') {
      console.warn('[auth] INTERNAL_SERVICE_SECRET unset — token revocation check inactive (development only)');
    } else {
      console.error('[auth] INTERNAL_SERVICE_SECRET unset — authenticated requests fail closed with 503');
    }
  }
}

/** True when the revocation check cannot run and the request must fail closed. */
export function revocationCheckUnavailable(env: Env): boolean {
  return !env.INTERNAL_SERVICE_SECRET && env.ENVIRONMENT !== 'development';
}

const AUTH_UNAVAILABLE: AuthResult = {
  ok: false,
  status: 503,
  error: { code: 'AUTH_UNAVAILABLE', message: 'Auth verification unavailable' },
};

type VerifyOutcome = 'active' | 'revoked' | 'unavailable';

// Calls /internal/auth/verify. 401/403 is a definitive "inactive" answer.
// Any other non-2xx or a transport error is retried once, then reported as
// unavailable so the caller fails closed with 503.
async function checkRevocation(env: Env, country: McpCountry, token: string): Promise<VerifyOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await verifyAccessToken(env, country, token);
      if (res.ok) return 'active';
      if (res.status === 401 || res.status === 403) {
        console.error(`[auth] token revocation check rejected (status ${res.status})`);
        return 'revoked';
      }
      console.error(`[auth] internal token verify error (status ${res.status})`);
    } catch (err) {
      console.error('[auth] internal token verify failed:', err instanceof Error ? err.message : String(err));
    }
  }
  return 'unavailable';
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

  // --- RS256 path (regional auth issuers via JWKS) ---
  // Peek at the unverified payload to get the issuer. Only an issuer of this
  // environment passes; an unknown issuer gets a 401 before any backend call.
  // All regions publish the same key, so the signed `iss` claim (not the
  // key) identifies the token's region.
  let issuer: string | undefined;
  try {
    const unverified = decodeJwt(token);
    issuer = typeof unverified.iss === 'string' ? unverified.iss : undefined;
  } catch {
    // Malformed JWT — fall through to the 401 below.
  }

  const country = regionFromIssuer(env, issuer);
  if (issuer && country) {
    const jwks = getJwks(issuer);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['RS256'],
        issuer,
        audience: ['paxaver-api', 'mcp', origin, `${origin}/mcp`],
      });

      if (payload.sub) {
        // Revocation check + context load run in parallel — the context hop
        // already exists per request, so the verify call adds ~no latency.
        // JWKS only proves signature+expiry; MCP tokens live 30 days, so a
        // revoked token (deactivated client, revoked session) must be
        // rejected here.
        //
        // Fail closed (#2134): outside development a missing
        // INTERNAL_SERVICE_SECRET or an unreachable verify endpoint gives
        // 503. Only development skips the check when the secret is unset.
        if (!env.INTERNAL_SERVICE_SECRET) {
          warnNoSecret(env);
          if (revocationCheckUnavailable(env)) return AUTH_UNAVAILABLE;
        }
        const verifyPromise: Promise<VerifyOutcome> = env.INTERNAL_SERVICE_SECRET
          ? checkRevocation(env, country, token)
          : Promise.resolve('active');
        const [verifyOutcome, result] = await Promise.all([
          verifyPromise,
          callPaxaverApi(
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
            { method: 'GET', path: '/api/users/me/context' },
          ),
        ]);

        if (verifyOutcome === 'unavailable') return AUTH_UNAVAILABLE;
        if (verifyOutcome === 'revoked') {
          return {
            ok: false,
            status: 401,
            error: { code: 'INVALID_TOKEN', message: 'Token has been revoked or user no longer exists' },
          };
        }

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
      // Fall through to the 401 below.
    }
  }

  return {
    ok: false,
    status: 401,
    error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    wwwAuthenticate: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  };
}
