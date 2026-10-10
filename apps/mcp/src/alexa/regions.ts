/**
 * Alexa region map. One skill serves CA, US and MX users. Each region has
 * its own auth issuer and user database, so the router picks the region
 * from the token issuer (skill calls) or from a region tag (token calls).
 */

import type { Env, McpCountry } from '../env.js';

export const REGIONS: readonly McpCountry[] = ['ca', 'us', 'mx'];

const ISSUERS: Record<Env['ENVIRONMENT'], Record<string, McpCountry>> = {
  production: {
    'https://paxaver.ca/auth': 'ca',
    'https://paxaver.com/auth': 'us',
    'https://paxaver.mx/auth': 'mx',
  },
  // One dev backend serves every region.
  staging: { 'https://paxaver.dev/auth': 'ca' },
  development: { 'https://paxaver.dev/auth': 'ca' },
};

/** Region of a token issuer in this environment, or null when unknown. */
export function regionFromIssuer(env: Env, issuer: string | undefined): McpCountry | null {
  if (!issuer) return null;
  return ISSUERS[env.ENVIRONMENT]?.[issuer] ?? null;
}

/** Split a `<region>.<value>` tag. Returns null when the value has no region tag. */
export function regionFromTag(value: string): { region: McpCountry; rest: string } | null {
  const match = /^(ca|us|mx)\.(.+)$/s.exec(value);
  if (!match) return null;
  return { region: match[1] as McpCountry, rest: match[2]! };
}

/** Public base URL of a region (login and consent run there). */
export function regionBaseUrl(env: Env, region: McpCountry): string {
  if (region === 'us') return env.API_BASE_URL_US;
  if (region === 'mx') return env.API_BASE_URL_MX;
  return env.API_BASE_URL_CA;
}
