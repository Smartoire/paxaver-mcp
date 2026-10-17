/**
 * sign_out tool handler: end the caller's MCP session.
 *
 * Sends the caller's verified access token to the issuing region's /revoke
 * endpoint — the same request a public OAuth client posts to
 * /oauth/revoke. The regional auth server revokes the whole grant family
 * (the access token and its refresh token), so the next request with the
 * old credentials gets the 401 challenge that makes the client ask the
 * user to sign in again.
 *
 * client_id comes from the verified token claim, never from caller input.
 * A confidential client fails the regional client check (its secret is
 * required), so its session stays — the tool then returns guidance
 * instead of claiming success.
 */

import { decodeJwt } from 'jose';
import type { AppVariables, Env } from '../env.js';
import type { ApiCallResult } from '../api/client.js';
import { errorCode } from '../lib/oauth-relay.js';
import { oauthRevoke } from '../oauth/token.js';

// client_id of the verified caller token. The regional /revoke requires it
// to match the token's own claim. Never logged or returned.
function tokenClientId(token: string): string | undefined {
  try {
    const clientId = decodeJwt(token).client_id;
    return typeof clientId === 'string' && clientId ? clientId : undefined;
  } catch {
    return undefined;
  }
}

function result(data: Record<string, unknown>): ApiCallResult {
  return { ok: true, status: 200, data };
}

export async function signOut(env: Env, ctx: AppVariables): Promise<ApiCallResult> {
  const token = ctx.userToken;
  const clientId = token ? tokenClientId(token) : undefined;
  if (!token || !clientId) {
    return { ok: false, status: 503, data: { error: 'session_unavailable' } };
  }

  // The request a public client sends to POST /oauth/revoke; the router
  // forwards it to the token's issuing region. The URL is never fetched —
  // oauthRevoke only reads the method, headers and form body.
  const response = await oauthRevoke(
    new Request('https://mcp.paxaver.com/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: 'access_token', client_id: clientId }),
    }),
    env,
  );

  if (response.status === 200) {
    return result({
      signedOut: true,
      account: ctx.email || null,
      message: 'Signed out. The next request will ask your client to sign in again.',
    });
  }

  if (
    errorCode({ status: response.status, body: await response.text(), headers: response.headers }) === 'invalid_client'
  ) {
    return result({
      signedOut: false,
      account: ctx.email || null,
      message:
        'This app holds its own Paxaver credentials and cannot be signed out here. Disconnect Paxaver in the app, or in your Paxaver account settings under Connected apps.',
    });
  }

  // Never claim success without a 200 from /revoke.
  console.error(`[sign_out] regional revoke failed (status ${response.status})`);
  return { ok: false, status: 503, data: { error: 'sign_out_failed' } };
}
