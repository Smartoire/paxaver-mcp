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
import type { Env, AuthContext } from '../env.js';
import { callPaxaverApi, verifyAccessToken } from '../api/client.js';
import { regionFromIssuer } from '../lib/regions.js';

export interface AuthResult {
  ok: boolean;
  status: number;
  context?: AuthContext;
  error?: { code: string; message: string };
  wwwAuthenticate?: string;
}

// Warn once per isolate when the revocation check is inactive due to a
// missing INTERNAL_SERVICE_SECRET — avoids per-request log spam.
let warnedNoSecret = false;
function warnNoSecret(): void {
  if (!warnedNoSecret) {
    warnedNoSecret = true;
    console.warn('[auth] INTERNAL_SERVICE_SECRET unset — token revocation check inactive');
  }
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
        // rejected here. Fail closed: any verify failure rejects.
        //
        // The check only runs when INTERNAL_SERVICE_SECRET is provisioned —
        // the backend's internalServiceGuard fails closed on non-dev
        // environments, so an unprovisioned worker would reject every
        // request. Skipping preserves the JWKS + context posture until ops
        // provisions the secret; enforcement then activates automatically.
        const verifyResultPromise = env.INTERNAL_SERVICE_SECRET
          ? verifyAccessToken(env, country, token).catch((err) => {
              console.error('[auth] internal token verify failed:', err instanceof Error ? err.message : String(err));
              return { ok: false, status: 0, data: null };
            })
          : (warnNoSecret(), Promise.resolve({ ok: true, status: 0, data: null }));
        const [verifyResult, result] = await Promise.all([
          verifyResultPromise,
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

        if (!verifyResult.ok) {
          console.error(`[auth] token revocation check rejected (status ${verifyResult.status})`);
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
