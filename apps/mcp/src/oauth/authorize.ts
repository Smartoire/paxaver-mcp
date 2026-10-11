/**
 * GET /oauth/authorize — MCP OAuth region picker.
 *
 * Shows one link per regional auth server of this environment (see
 * lib/region-picker.ts). Each link goes to that region's authorize endpoint
 * with the query unchanged, except a composite client_id, which becomes the
 * client's id in that region. The regional auth server does every OAuth check.
 */

import type { Env } from '../env.js';
import { issuersFor } from '../lib/regions.js';
import { regionPickerPage } from '../lib/region-picker.js';
import { regionalParams } from './client-id.js';

export function oauthAuthorize(request: Request, env: Env): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const search = new URL(request.url).search;
  const params = new URLSearchParams(search);
  const links = issuersFor(env).flatMap(({ region, issuer }) => {
    const regional = regionalParams(params, region);
    if (!regional) return [];
    // Keep the query byte for byte when nothing changes.
    const query = regional.toString() === params.toString() ? search : `?${regional.toString()}`;
    return [{ region, href: `${issuer}/authorize${query}` }];
  });
  return regionPickerPage(request, 'Sign in to Paxaver', links);
}
