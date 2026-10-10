/**
 * POST /alexa/token — Alexa account-linking token endpoint.
 *
 * Amazon calls one token URI for every user. The router finds the region
 * that issued the grant and forwards the request there unchanged. The
 * regional backend does every check (client auth, PKCE, redirect_uri,
 * single use). This worker never sees the client secret: it forwards the
 * Authorization header as it is.
 *
 * - Authorization codes carry a region tag (`ca.…`), set by the issuing
 *   backend. Untagged codes are rejected.
 * - Refresh tokens are tagged here: every refresh_token in a success
 *   response is returned as `<region>.<token>`. Untagged (legacy) refresh
 *   tokens are tried in each region in turn. A miss is a read-only lookup.
 */

import type { Env, McpCountry } from '../env.js';
import { forwardToRegion } from '../api/client.js';
import { REGIONS, regionFromTag } from '../lib/regions.js';
import { isInvalidGrant, oauthError, relay, type RegionResult } from '../lib/oauth-relay.js';

const TOKEN_PATH = '/api/assistant/alexa/token';

async function callRegion(env: Env, region: McpCountry, request: Request, body: string): Promise<RegionResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const authorization = request.headers.get('Authorization');
  if (authorization) headers.Authorization = authorization;

  const response = await forwardToRegion(env, region, TOKEN_PATH, { method: 'POST', headers, body });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

export async function alexaToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return oauthError('invalid_request');
  }

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const grantType = params.get('grant_type');

  try {
    if (grantType === 'authorization_code') {
      const tagged = regionFromTag(params.get('code') ?? '');
      if (!tagged) return oauthError('invalid_grant');
      // The stored code includes the tag, so the body goes through unchanged.
      return relay(await callRegion(env, tagged.region, request, raw), tagged.region);
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token');
      if (!refreshToken) return oauthError('invalid_request');

      const tagged = regionFromTag(refreshToken);
      if (tagged) {
        params.set('refresh_token', tagged.rest);
        return relay(await callRegion(env, tagged.region, request, params.toString()), tagged.region);
      }

      // Legacy untagged refresh token: try each region. Stop at the first
      // answer that is not invalid_grant (a success, or a client error).
      let last: { result: RegionResult; region: McpCountry } | undefined;
      for (const region of REGIONS) {
        const result = await callRegion(env, region, request, raw);
        last = { result, region };
        if (!isInvalidGrant(result)) break;
      }
      return relay(last!.result, last!.region);
    }
  } catch (err) {
    console.error('[alexa] token forward failed:', err instanceof Error ? err.message : String(err));
    return oauthError('temporarily_unavailable', 503);
  }

  return oauthError('unsupported_grant_type');
}
