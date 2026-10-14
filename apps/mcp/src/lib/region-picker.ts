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

// Simplified inline-SVG flags, decorative only — the visible country name is
// the label. Inline because the CSP blocks <img>, and SVG because Windows
// renders flag emoji as letter pairs.
const FLAGS: Record<McpCountry, string> = {
  ca: `<svg class="flag" width="32" height="24" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><clipPath id="flag-ca"><rect width="32" height="24" rx="3"/></clipPath><g clip-path="url(#flag-ca)"><rect width="32" height="24" fill="#fff"/><rect width="8" height="24" fill="#D52B1E"/><rect x="24" width="8" height="24" fill="#D52B1E"/><path d="M16 5l1.4 2.9 2.2-1.5-.6 3 3.4 1-2.1 2.5 1.4 2.4-3.7-.8-1.4 1.1v3.8h-1.2v-3.8l-1.4-1.1-3.7.8 1.4-2.4-2.1-2.5 3.4-1-.6-3 2.2 1.5z" fill="#D52B1E"/></g></svg>`,
  us: `<svg class="flag" width="32" height="24" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><clipPath id="flag-us"><rect width="32" height="24" rx="3"/></clipPath><g clip-path="url(#flag-us)"><rect width="32" height="24" fill="#fff"/><g fill="#B22234"><rect width="32" height="1.85"/><rect y="3.69" width="32" height="1.85"/><rect y="7.38" width="32" height="1.85"/><rect y="11.08" width="32" height="1.85"/><rect y="14.77" width="32" height="1.85"/><rect y="18.46" width="32" height="1.85"/><rect y="22.15" width="32" height="1.85"/></g><rect width="13" height="12.93" fill="#3C3B6E"/><g fill="#fff"><circle cx="2.2" cy="2.4" r=".8"/><circle cx="5.4" cy="2.4" r=".8"/><circle cx="8.6" cy="2.4" r=".8"/><circle cx="11.8" cy="2.4" r=".8"/><circle cx="2.2" cy="5.5" r=".8"/><circle cx="5.4" cy="5.5" r=".8"/><circle cx="8.6" cy="5.5" r=".8"/><circle cx="11.8" cy="5.5" r=".8"/><circle cx="2.2" cy="8.6" r=".8"/><circle cx="5.4" cy="8.6" r=".8"/><circle cx="8.6" cy="8.6" r=".8"/><circle cx="11.8" cy="8.6" r=".8"/><circle cx="2.2" cy="11.7" r=".8"/><circle cx="5.4" cy="11.7" r=".8"/><circle cx="8.6" cy="11.7" r=".8"/><circle cx="11.8" cy="11.7" r=".8"/></g></g></svg>`,
  mx: `<svg class="flag" width="32" height="24" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><clipPath id="flag-mx"><rect width="32" height="24" rx="3"/></clipPath><g clip-path="url(#flag-mx)"><rect width="10.7" height="24" fill="#006847"/><rect x="10.7" width="10.6" height="24" fill="#fff"/><rect x="21.3" width="10.7" height="24" fill="#CE1126"/><circle cx="16" cy="12" r="3" fill="#8C6D3B"/><path d="M14.8 11.6c.5-1.2 1.9-1.6 2.7-.9l.8-.5c.4.8-.1 1.9-1.1 2.4-1.2.6-2.6.3-2.4-1z" fill="#4A3319"/><path d="M13.7 14.1q2.3 1.3 4.6 0" fill="none" stroke="#4A3319" stroke-width=".6"/></g></svg>`,
};

const CHEVRON = `<svg class="chev" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M6.8 3.8 11 8l-4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
    .map(
      ({ region, href }, i) =>
        `<li><a href="${escapeHtml(href)}">${FLAGS[region]}<span class="name">${LABELS[region]}</span>${
          i === 0 && region === country ? '<span class="tag">Suggested</span>' : ''
        }${CHEVRON}</a></li>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--accent:#0051CC;--ink:#191B24;--page:#F2F3FF;--card:#FFFFFF;--line:#C2C6D8;--muted:#565B72;--accent-soft:rgba(0,81,204,.07)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--page);color:var(--ink)}
.card{width:100%;max-width:26rem;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 8px 24px rgba(25,27,36,.08)}
.brand{margin:0 0 14px;color:var(--accent);font-weight:700;font-size:1rem}
h1{margin:0 0 8px;font-size:1.35rem;line-height:1.25}
.lede{margin:0 0 20px;color:var(--muted);font-size:.95rem;line-height:1.5}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
a{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);text-decoration:none;font-size:1rem}
a:hover{border-color:var(--accent);background:var(--accent-soft)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-color:var(--accent)}
.flag{flex:none;border-radius:4px;box-shadow:0 0 0 1px var(--line)}
.name{flex:1;font-weight:500}
.tag{flex:none;padding:3px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.chev{flex:none;color:var(--muted)}
.note{margin:16px 0 0;color:var(--muted);font-size:.82rem;line-height:1.5}
@media (prefers-color-scheme:dark){:root{--accent:#0167FF;--ink:#E1E2EE;--page:#191B24;--card:#21232F;--line:#424655;--muted:#A9ADC2;--accent-soft:rgba(1,103,255,.16)}.tag{color:var(--ink)}}
</style>
</head>
<body>
<main class="card">
<p class="brand">Paxaver</p>
<h1>${escapeHtml(title)}</h1>
<p class="lede">Choose the country where you created your Paxaver account.</p>
<ul>
${items}
</ul>
<p class="note">Not sure? Pick the country of the school your children attend.</p>
</main>
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
