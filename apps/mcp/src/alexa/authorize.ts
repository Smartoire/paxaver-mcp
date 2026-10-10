/**
 * GET /alexa/authorize — Alexa account-linking region picker.
 *
 * The user's region is not known before login, and login and consent use a
 * host-scoped session cookie on the regional host. This page shows one link
 * per region. Each link goes to that region's own authorize endpoint with the
 * query unchanged; the regional backend does every OAuth check. The page
 * stores nothing and never redirects by itself (a traveller would land in
 * the wrong region).
 */

import type { Env, McpCountry } from '../env.js';
import { REGIONS, regionBaseUrl } from './regions.js';

const LABELS: Record<McpCountry, string> = { ca: 'Canada', us: 'United States', mx: 'México' };

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function alexaAuthorize(request: Request, env: Env): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const search = new URL(request.url).search;
  const country = String((request as { cf?: { country?: unknown } }).cf?.country ?? '').toLowerCase();
  // Show the visitor's likely region first, but always offer all three.
  const ordered = [...REGIONS].sort((a, b) => Number(b === country) - Number(a === country));

  const links = ordered
    .map((region) => {
      const href = `${regionBaseUrl(env, region)}/api/assistant/alexa/authorize${search}`;
      return `<li><a href="${escapeHtml(href)}">${LABELS[region]}</a></li>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Link Paxaver to Alexa</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
ul{list-style:none;padding:0}
li{margin:.75rem 0}
a{display:block;padding:1rem;border:1px solid #ccc;border-radius:.5rem;text-decoration:none;color:inherit;font-size:1.1rem}
a:hover,a:focus{border-color:#555}
</style>
</head>
<body>
<h1>Link Paxaver to Alexa</h1>
<p>Select the country of your Paxaver account.</p>
<ul>
${links}
</ul>
</body>
</html>
`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-store',
    },
  });
}
