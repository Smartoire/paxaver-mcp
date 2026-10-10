/**
 * POST /oauth/token and POST /oauth/revoke — MCP OAuth regional routers.
 *
 * MCP clients call one token endpoint for every user. The router finds the
 * regional auth server that issued the grant and forwards the request there.
 * The regional server does every check (client auth, PKCE, redirect_uri,
 * single use). A composite client_id / client_secret (see client-id.ts)
 * becomes the client's value in that region.
 *
 * - Refresh tokens are tagged here: every refresh_token in a success
 *   response is returned as `<region>.<token>`, and a tagged token goes to
 *   its region only.
 * - Authorization codes and legacy untagged refresh tokens are tried in each
 *   region in turn. A grant lives in one region's store only, so a miss in
 *   another region is a read-only lookup.
 */

import { decodeJwt } from 'jose';
import type { Env, McpCountry } from '../env.js';
import { issuersFor, regionFromIssuer, regionFromTag } from '../lib/regions.js';
import { NO_STORE, errorCode, isInvalidGrant, oauthError, relay, type RegionResult } from '../lib/oauth-relay.js';
import { regionalAuthorization, regionalParams } from './client-id.js';

interface Target {
  region: McpCountry;
  issuer: string;
}

/**
 * Send a form request to a regional auth server. Returns null when the
 * client has no registration in the region.
 */
async function callIssuer(
  target: Target,
  path: string,
  request: Request,
  params: URLSearchParams,
): Promise<RegionResult | null> {
  const body = regionalParams(params, target.region);
  const authorization = regionalAuthorization(request.headers.get('Authorization'), target.region);
  if (!body || authorization === null) return null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (authorization) headers.Authorization = authorization;

  const response = await fetch(`${target.issuer}${path}`, {
    method: 'POST',
    headers,
    body: body.toString(),
    redirect: 'manual',
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

async function readForm(request: Request): Promise<URLSearchParams | Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return oauthError('invalid_request');
  }
  return new URLSearchParams(await request.text());
}

/** A grant the region does not know, or a client the region does not know. */
function isMiss(result: RegionResult): boolean {
  const code = errorCode(result);
  return code === 'invalid_grant' || code === 'invalid_client';
}

export async function oauthToken(request: Request, env: Env): Promise<Response> {
  const params = await readForm(request);
  if (params instanceof Response) return params;

  const grantType = params.get('grant_type');
  const grantKey = grantType === 'authorization_code' ? 'code' : grantType === 'refresh_token' ? 'refresh_token' : null;
  if (!grantKey) return oauthError('unsupported_grant_type');
  const grant = params.get(grantKey);
  if (!grant) return oauthError('invalid_request');

  let targets = issuersFor(env);
  const tagged = regionFromTag(grant);
  if (tagged) {
    targets = targets.filter((t) => t.region === tagged.region);
    // The facade tags refresh tokens, so it strips the tag. A code tag comes
    // from the issuing server and is part of the stored code.
    if (grantKey === 'refresh_token') params.set(grantKey, tagged.rest);
  }

  try {
    // Stop at the first answer that is not a miss (a success, or a client
    // error). When every region misses, prefer invalid_grant.
    let best: { result: RegionResult; region: McpCountry } | undefined;
    for (const target of targets) {
      const result = await callIssuer(target, '/token', request, params);
      if (!result) continue;
      const current = { result, region: target.region };
      if (!isMiss(result)) {
        best = current;
        break;
      }
      if (!best || (isInvalidGrant(result) && !isInvalidGrant(best.result))) best = current;
    }
    // No region to ask: the tag names no region of this environment, or the
    // client has no registration in the regions.
    if (!best) return targets.length ? oauthError('invalid_client', 401) : oauthError('invalid_grant');
    return relay(best.result, best.region);
  } catch (err) {
    console.error('[oauth] token forward failed:', err instanceof Error ? err.message : String(err));
    return oauthError('temporarily_unavailable', 503);
  }
}

/** Region of a token: its tag, or the issuer of a JWT access token. */
function tokenRegion(env: Env, token: string): { region: McpCountry; token: string } | null {
  const tagged = regionFromTag(token);
  if (tagged) return { region: tagged.region, token: tagged.rest };
  try {
    const region = regionFromIssuer(env, decodeJwt(token).iss);
    return region ? { region, token } : null;
  } catch {
    return null;
  }
}

/**
 * RFC 7009 revocation. A region answers 200 for a token it does not know,
 * so a token of unknown region goes to every region at once, and any 200
 * is the answer.
 */
export async function oauthRevoke(request: Request, env: Env): Promise<Response> {
  const params = await readForm(request);
  if (params instanceof Response) return params;

  const token = params.get('token');
  if (!token) return oauthError('invalid_request');

  let targets = issuersFor(env);
  const known = tokenRegion(env, token);
  if (known) {
    targets = targets.filter((t) => t.region === known.region);
    params.set('token', known.token);
  }

  try {
    const results = (await Promise.all(targets.map((t) => callIssuer(t, '/revoke', request, params)))).filter(
      (r): r is RegionResult => r !== null,
    );
    const result = results.find((r) => r.status === 200) ?? results[0];
    if (!result) return oauthError('invalid_client', 401);
    const headers = new Headers(NO_STORE);
    const contentType = result.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    return new Response(result.body, { status: result.status, headers });
  } catch (err) {
    console.error('[oauth] revoke forward failed:', err instanceof Error ? err.message : String(err));
    return oauthError('temporarily_unavailable', 503);
  }
}
