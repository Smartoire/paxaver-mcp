/**
 * Composite client credentials.
 *
 * Each regional auth server mints its own client_id at registration. The
 * MCP facade registers a client in every region and gives the client one
 * composite value: `mreg.<base64url JSON {"ca": "...", "us": "...", ...}>`.
 * The client treats it as opaque. The facade swaps it for the regional value
 * before it forwards a request to a region. The same format holds a composite
 * client_secret.
 *
 * The composite is not a credential: it only holds the regional values,
 * which a client could send directly. Each region still authenticates the
 * client.
 */

import type { McpCountry } from '../env.js';
import { REGIONS } from '../lib/regions.js';

const PREFIX = 'mreg.';
const MAX_LENGTH = 4096;

export function encodeComposite(values: Partial<Record<McpCountry, string>>): string {
  const b64 = btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PREFIX}${b64}`;
}

function decodeComposite(value: string): Partial<Record<McpCountry, string>> | null {
  if (!value.startsWith(PREFIX) || value.length > MAX_LENGTH) return null;
  try {
    const b64 = value.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const json: unknown = JSON.parse(atob(b64));
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const out: Partial<Record<McpCountry, string>> = {};
    for (const [key, v] of Object.entries(json)) {
      if (!REGIONS.includes(key as McpCountry) || typeof v !== 'string' || !v) return null;
      out[key as McpCountry] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The value to send to a region. A plain value goes unchanged. A composite
 * value gives its regional entry, or null when it has none for the region
 * (or is malformed).
 */
export function forRegion(value: string, region: McpCountry): string | null {
  if (!value.startsWith(PREFIX)) return value;
  return decodeComposite(value)?.[region] ?? null;
}

/**
 * Swap composite client_id / client_secret in a form body for a region.
 * Returns null when the client has no registration in the region.
 */
export function regionalParams(params: URLSearchParams, region: McpCountry): URLSearchParams | null {
  const out = new URLSearchParams(params);
  for (const key of ['client_id', 'client_secret']) {
    const value = params.get(key);
    if (value === null) continue;
    const regional = forRegion(value, region);
    if (regional === null) return null;
    out.set(key, regional);
  }
  return out;
}

/**
 * Swap a composite client in an `Authorization: Basic` header for a region
 * (RFC 6749 §2.3.1). Other headers go unchanged; no header gives undefined.
 * Returns null when the client has no registration in the region.
 */
export function regionalAuthorization(header: string | null, region: McpCountry): string | null | undefined {
  if (!header || !/^basic /i.test(header)) return header ?? undefined;
  let id: string;
  let secret: string;
  try {
    const decoded = atob(header.slice(6).trim());
    const colon = decoded.indexOf(':');
    if (colon < 0) return header;
    id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '));
    secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '));
  } catch {
    return header;
  }
  if (!id.startsWith(PREFIX) && !secret.startsWith(PREFIX)) return header;
  const regionalId = forRegion(id, region);
  const regionalSecret = forRegion(secret, region);
  if (regionalId === null || regionalSecret === null) return null;
  return `Basic ${btoa(`${encodeURIComponent(regionalId)}:${encodeURIComponent(regionalSecret)}`)}`;
}
