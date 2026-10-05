/**
 * CORS origin allowlist tests (#1808).
 *
 * Regression: ALLOWED_ORIGINS wildcard entries are written in
 * 'https://*.domain' form, but the matcher only expanded patterns that
 * began with '*.' — every wildcard entry silently matched nothing.
 */

import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/index.js';

const ALLOWED =
  'https://paxaver.com,https://*.paxaver.com,https://vscode.dev,https://insiders.vscode.dev,https://*.teams.microsoft.com,https://*.cloud.microsoft';

describe('isAllowedOrigin', () => {
  it('matches exact origins', () => {
    expect(isAllowedOrigin('https://paxaver.com', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://vscode.dev', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://insiders.vscode.dev', ALLOWED)).toBe(true);
  });

  it('matches scheme-prefixed wildcard patterns', () => {
    expect(isAllowedOrigin('https://app.paxaver.com', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://teams.microsoft.com', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://prod.teams.microsoft.com', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://m365.cloud.microsoft', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('https://teams.cloud.microsoft', ALLOWED)).toBe(true);
  });

  it('rejects unlisted and lookalike origins', () => {
    expect(isAllowedOrigin('https://evil.com', ALLOWED)).toBe(false);
    expect(isAllowedOrigin('https://paxaver.com.evil.com', ALLOWED)).toBe(false);
    expect(isAllowedOrigin('https://noteams.microsoft.com', ALLOWED)).toBe(false);
    expect(isAllowedOrigin('', ALLOWED)).toBe(false);
  });
});
