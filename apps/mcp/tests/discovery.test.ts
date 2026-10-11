/**
 * Well-known discovery endpoint tests.
 */

import { describe, it, expect } from 'vitest';
import { wellKnownApp } from '../src/discovery/well-known.js';
import { request } from './request.js';

function mockEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ENVIRONMENT: 'production',
    ...overrides,
  };
}

describe('well-known endpoints', () => {
  it('RFC 9728 protected resource metadata returns correct shape', async () => {
    const res = await request(
      wellKnownApp,
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authorization_servers).toEqual(['https://localhost']);
    expect(body.scopes_supported).toEqual(['openid', 'profile', 'email', 'offline_access', 'tools']);
    expect(body.bearer_methods_supported).toEqual(['header']);
    expect(body.resource).toBe('https://localhost/mcp');
  });

  it.each(['production', 'staging', 'development'])(
    'RFC 9728 points to the facade on the MCP origin (%s)',
    async (ENVIRONMENT) => {
      const res = await request(
        wellKnownApp,
        'https://mcp.example.test/.well-known/oauth-protected-resource',
        {},
        mockEnv({ ENVIRONMENT }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.authorization_servers).toEqual(['https://mcp.example.test']);
    },
  );

  it.each([
    ['production', 'https://paxaver.ca/auth'],
    ['staging', 'https://paxaver.dev/auth'],
    ['development', 'https://paxaver.dev/auth'],
  ])('authorization-server metadata is the facade (%s)', async (ENVIRONMENT, jwksIssuer) => {
    const res = await request(wellKnownApp, '/.well-known/oauth-authorization-server', {}, mockEnv({ ENVIRONMENT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://localhost');
    expect(body.authorization_endpoint).toBe('https://localhost/oauth/authorize');
    expect(body.token_endpoint).toBe('https://localhost/oauth/token');
    expect(body.registration_endpoint).toBe('https://localhost/oauth/register');
    expect(body.revocation_endpoint).toBe('https://localhost/oauth/revoke');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.jwks_uri).toBe(`${jwksIssuer}/.well-known/jwks.json`);
  });

  it('OIDC fallback matches the facade and omits routes it does not serve', async () => {
    const res = await request(wellKnownApp, '/.well-known/openid-configuration', {}, mockEnv());
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://localhost');
    expect(body.token_endpoint).toBe('https://localhost/oauth/token');
    expect(body.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(body.userinfo_endpoint).toBeUndefined();
    expect(body.end_session_endpoint).toBeUndefined();
  });

  it('/oauth does NOT redirect (removed to prevent Unsafe URL)', async () => {
    const res = await request(wellKnownApp, '/oauth', {}, mockEnv({ ENVIRONMENT: 'production' }));
    expect(res.status).toBe(404);
  });

  it('/oauth/ does NOT redirect', async () => {
    const res = await request(wellKnownApp, '/oauth/', {}, mockEnv({ ENVIRONMENT: 'production' }));
    expect(res.status).toBe(404);
  });

  // Regression (#1972): the /oauth/callback helper page embedded query values
  // in an inline <script> via JSON.stringify, which does not escape '<' — a
  // crafted </script> value produced reflected XSS on the MCP origin. The page
  // was a convenience for MCP Inspector and has been removed.
  it('/oauth/callback returns 404 (helper page removed)', async () => {
    const res = await request(wellKnownApp, '/oauth/callback?code=test-code-123&state=abc', {}, mockEnv());
    expect(res.status).toBe(404);
  });

  it('/oauth/callback does not reflect </script><script> (XSS)', async () => {
    const res = await request(
      wellKnownApp,
      '/oauth/callback?error=%3C%2Fscript%3E%3Cscript%3Ex()%3C%2Fscript%3E',
      {},
      mockEnv(),
    );
    const body = await res.text();
    expect(body).not.toContain('</script><script>');
    expect(body).not.toContain('<script');
  });

  it('every well-known response sets Cache-Control: no-store', async () => {
    const paths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
      '/.well-known/mcp/server-card.json',
      '/oauth/callback',
      '/nonexistent',
    ];
    for (const path of paths) {
      const res = await request(wellKnownApp, path, {}, mockEnv({ ENVIRONMENT: 'production' }));
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    }
  });

  // Regression: ChatGPT "Unsafe URL" error. No endpoint on the MCP server
  // must return a redirect to a different domain. The /oauth redirect was
  // the root cause.
  it('no well-known endpoint returns a redirect', async () => {
    const paths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/mcp/.well-known/oauth-protected-resource',
      '/mcp/.well-known/oauth-authorization-server',
      '/oauth',
      '/oauth/',
    ];
    for (const path of paths) {
      const res = await request(wellKnownApp, path, {}, mockEnv({ ENVIRONMENT: 'production' }));
      const location = res.headers.get('location');
      if (location) {
        // Any redirect must stay on the same origin (localhost in test)
        expect(location).not.toContain('auth.paxaver');
      }
    }
  });

  // Compatibility: the metadata is also served at the legacy path-derived
  // URL that ChatGPT and older clients may construct.
  it('RFC 9728 path-derived metadata URL returns 200', async () => {
    const res = await request(
      wellKnownApp,
      '/.well-known/oauth-protected-resource/mcp',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe('https://localhost/mcp');
    expect(body.authorization_servers).toEqual(['https://localhost']);
  });

  it('RFC 9728 path-derived auth server metadata URL returns 200', async () => {
    const res = await request(
      wellKnownApp,
      '/.well-known/oauth-authorization-server/mcp',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://localhost');
  });

  // Regression: protected resource metadata must use HTTPS resource URL
  it('production protected resource metadata is HTTPS', async () => {
    const res = await request(
      wellKnownApp,
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe('https://localhost/mcp');
    expect((body.authorization_servers as string[])[0]).toMatch(/^https:/);
  });
});
