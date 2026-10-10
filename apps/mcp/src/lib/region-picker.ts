/**
 * Region picker page, shared by the MCP and Alexa authorize endpoints.
 *
 * The user's region is not known before login, and login and consent use a
 * host-scoped session cookie on the regional host. The page shows one link
 * per region. It stores nothing and never redirects by itself (a traveller
 * would land in the wrong region, and a cross-origin redirect trips the
 * ChatGPT "Unsafe URL" check).
 */

import type { McpCountry } from '../env.js';

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

export function regionPickerPage(
  request: Request,
  title: string,
  links: { region: McpCountry; href: string }[],
): Response {
  const country = String((request as { cf?: { country?: unknown } }).cf?.country ?? '').toLowerCase();
  // Show the visitor's likely region first, but always offer every region.
  const ordered = [...links].sort((a, b) => Number(b.region === country) - Number(a.region === country));

  const items = ordered
    .map(({ region, href }) => `<li><a href="${escapeHtml(href)}">${LABELS[region]}</a></li>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
ul{list-style:none;padding:0}
li{margin:.75rem 0}
a{display:block;padding:1rem;border:1px solid #ccc;border-radius:.5rem;text-decoration:none;color:inherit;font-size:1.1rem}
a:hover,a:focus{border-color:#555}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>Select the country of your Paxaver account.</p>
<ul>
${items}
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
