/**
 * GET /alexa/authorize — Alexa account-linking region picker.
 *
 * Shows one link per region (see lib/region-picker.ts). Each link goes to
 * that region's own authorize endpoint with the query unchanged; the
 * regional backend does every OAuth check.
 */

import type { Env } from '../env.js';
import { REGIONS, regionBaseUrl } from '../lib/regions.js';
import { regionPickerPage } from '../lib/region-picker.js';

export function alexaAuthorize(request: Request, env: Env): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const search = new URL(request.url).search;
  const links = REGIONS.map((region) => ({
    region,
    href: `${regionBaseUrl(env, region)}/api/assistant/alexa/authorize${search}`,
  }));
  return regionPickerPage(request, 'Link Paxaver to Alexa', links);
}
