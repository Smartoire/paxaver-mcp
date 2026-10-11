/**
 * Shared helpers for the regional OAuth routers (MCP and Alexa). A router
 * sends a request to one region, reads the answer, and relays it to the
 * client. Every refresh_token in a success answer gets its region tag
 * (`<region>.<token>`), so the next refresh goes to the same region.
 */

import type { McpCountry } from '../env.js';

export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export function oauthError(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export interface RegionResult {
  status: number;
  body: string;
  headers: Headers;
}

/** The OAuth `error` code of a 4xx answer, or null. */
export function errorCode(result: RegionResult): string | null {
  if (result.status < 400 || result.status >= 500) return null;
  try {
    const error = (JSON.parse(result.body) as { error?: unknown }).error;
    return typeof error === 'string' ? error : null;
  } catch {
    return null;
  }
}

export function isInvalidGrant(result: RegionResult): boolean {
  return result.status === 400 && errorCode(result) === 'invalid_grant';
}

/** Relay a regional answer. Tag a refresh_token in a success response with its region. */
export function relay(result: RegionResult, region: McpCountry): Response {
  const headers = new Headers(NO_STORE);
  headers.set('Content-Type', result.headers.get('Content-Type') ?? 'application/json');
  const wwwAuthenticate = result.headers.get('WWW-Authenticate');
  if (wwwAuthenticate) headers.set('WWW-Authenticate', wwwAuthenticate);

  let body = result.body;
  if (result.status === 200) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      if (typeof json.refresh_token === 'string' && json.refresh_token) {
        json.refresh_token = `${region}.${json.refresh_token}`;
        body = JSON.stringify(json);
        headers.set('Content-Type', 'application/json');
      }
    } catch {
      // Not JSON: pass it through unchanged.
    }
  }
  return new Response(body, { status: result.status, headers });
}
