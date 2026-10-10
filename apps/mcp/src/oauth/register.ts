/**
 * POST /oauth/register — MCP dynamic client registration (RFC 7591).
 *
 * The user picks the region only at login, so the client must exist in
 * every region. The facade sends the registration to each regional auth
 * server of this environment and returns one composite client_id (and
 * client_secret, when issued) — see client-id.ts.
 *
 * Fail closed: when one region fails, the registration fails, so a user can
 * never pick a region where the client does not exist. A region's client
 * error (4xx) goes back to the client as it is.
 */

import type { Env, McpCountry } from '../env.js';
import { issuersFor } from '../lib/regions.js';
import { NO_STORE, oauthError } from '../lib/oauth-relay.js';
import { encodeComposite } from './client-id.js';

interface Registration {
  region: McpCountry;
  status: number;
  body: string;
  contentType: string | null;
}

export async function oauthRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const body = await request.text();
  const contentType = request.headers.get('Content-Type') ?? 'application/json';

  try {
    const results: Registration[] = await Promise.all(
      issuersFor(env).map(async ({ region, issuer }) => {
        const response = await fetch(`${issuer}/register`, {
          method: 'POST',
          headers: { 'Content-Type': contentType, Accept: 'application/json' },
          body,
          redirect: 'manual',
        });
        return {
          region,
          status: response.status,
          body: await response.text(),
          contentType: response.headers.get('Content-Type'),
        };
      }),
    );

    const failed = results.find((r) => r.status < 200 || r.status >= 300);
    if (failed) {
      if (failed.status >= 400 && failed.status < 500) {
        return new Response(failed.body, {
          status: failed.status,
          headers: { ...NO_STORE, 'Content-Type': failed.contentType ?? 'application/json' },
        });
      }
      console.error(`[oauth] registration failed in ${failed.region} (status ${failed.status})`);
      return oauthError('temporarily_unavailable', 503);
    }

    const ids: Partial<Record<McpCountry, string>> = {};
    const secrets: Partial<Record<McpCountry, string>> = {};
    let metadata: Record<string, unknown> | undefined;
    for (const result of results) {
      const json = JSON.parse(result.body) as Record<string, unknown>;
      if (typeof json.client_id !== 'string' || !json.client_id) throw new Error('registration without client_id');
      ids[result.region] = json.client_id;
      if (typeof json.client_secret === 'string' && json.client_secret) secrets[result.region] = json.client_secret;
      metadata ??= json;
    }
    if (!metadata) return oauthError('temporarily_unavailable', 503);

    // RFC 7592 management URIs point at one region only; the facade does
    // not route client management, so it does not return them.
    const { registration_access_token: _token, registration_client_uri: _uri, ...rest } = metadata;
    const merged: Record<string, unknown> = { ...rest, client_id: encodeComposite(ids) };
    if (Object.keys(secrets).length) merged.client_secret = encodeComposite(secrets);

    return Response.json(merged, { status: results[0]!.status, headers: NO_STORE });
  } catch (err) {
    console.error('[oauth] registration forward failed:', err instanceof Error ? err.message : String(err));
    return oauthError('temporarily_unavailable', 503);
  }
}
