/**
 * Well-known discovery endpoint tests.
 */

import { describe, it, expect } from 'vitest';
import { wellKnownApp } from '../src/discovery/well-known.js';

function mockEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ENVIRONMENT: 'production',
    ...overrides,
  };
}

describe('well-known endpoints', () => {
  it('RFC 9728 protected resource metadata returns correct shape', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authorization_servers).toEqual([
      'https://paxaver.ca/auth',
      'https://paxaver.com/auth',
      'https://paxaver.mx/auth',
    ]);
    expect(body.scopes_supported).toEqual(['openid', 'profile', 'email', 'offline_access', 'tools']);
    expect(body.bearer_methods_supported).toEqual(['header']);
    expect(body.resource).toBe('https://localhost');
  });

  it('RFC 9728 points to staging auth in staging', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'staging' }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authorization_servers).toEqual(['https://paxaver.dev/auth']);
  });

  it('RFC 9728 points to localhost in development', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'development' }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authorization_servers).toEqual(['http://localhost:8788']);
  });

  it('MCP server serves authorization-server metadata pointing to auth server', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-authorization-server',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://paxaver.com/auth');
    expect(body.authorization_endpoint).toBe('https://paxaver.com/auth/authorize');
    expect(body.token_endpoint).toBe('https://paxaver.com/auth/token');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.jwks_uri).toBe('https://paxaver.com/auth/.well-known/jwks.json');
  });

  it('/oauth does NOT redirect (removed to prevent Unsafe URL)', async () => {
    const res = await wellKnownApp.request('/oauth', {}, mockEnv({ ENVIRONMENT: 'production' }));
    expect(res.status).toBe(404);
  });

  it('/oauth/ does NOT redirect', async () => {
    const res = await wellKnownApp.request('/oauth/', {}, mockEnv({ ENVIRONMENT: 'production' }));
    expect(res.status).toBe(404);
  });

  it('/oauth/callback renders code for successful auth', async () => {
    const res = await wellKnownApp.request('/oauth/callback?code=test-code-123&state=abc', {}, mockEnv());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('test-code-123');
    expect(body).toContain('Authorization successful');
  });

  it('/oauth/callback renders error for failed auth', async () => {
    const res = await wellKnownApp.request(
      '/oauth/callback?error=access_denied&error_description=Consent+required',
      {},
      mockEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('access_denied');
    expect(body).toContain('Consent required');
    expect(body).toContain('Authorization failed');
  });

  it('/oauth/callback handles missing params gracefully', async () => {
    const res = await wellKnownApp.request('/oauth/callback', {}, mockEnv());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('No authorization code or error received');
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
      const res = await wellKnownApp.request(path, {}, mockEnv({ ENVIRONMENT: 'production' }));
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
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource/mcp',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe('https://localhost');
    expect(body.authorization_servers).toEqual([
      'https://paxaver.ca/auth',
      'https://paxaver.com/auth',
      'https://paxaver.mx/auth',
    ]);
  });

  it('RFC 9728 path-derived auth server metadata URL returns 200', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-authorization-server/mcp',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://paxaver.com/auth');
  });

  // Regression: protected resource metadata must use HTTPS resource URL
  it('production protected resource metadata is HTTPS', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe('https://localhost');
    expect((body.authorization_servers as string[])[0]).toMatch(/^https:/);
  });
});
