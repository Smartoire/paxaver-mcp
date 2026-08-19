/**
 * Well-known discovery endpoint tests.
 */

import { describe, it, expect } from 'vitest';
import { wellKnownApp } from '../src/discovery/well-known.js';

function mockEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ENVIRONMENT: 'production',
    CHATGPT_VERIFY_TOKEN: 'test-verify-token',
    ...overrides,
  };
}

describe('well-known endpoints', () => {
  it('ChatGPT domain verification returns token when configured', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/openai-apps-challenge',
      {},
      mockEnv({ CHATGPT_VERIFY_TOKEN: 'my-token-123' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('my-token-123');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });

  it('ChatGPT domain verification returns 404 when not configured', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/openai-apps-challenge',
      {},
      mockEnv({ CHATGPT_VERIFY_TOKEN: '' }),
    );
    expect(res.status).toBe(404);
  });

  it('RFC 9728 protected resource metadata returns correct shape', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toEqual(['https://auth.paxaver.com']);
    expect(body.scopes_supported).toEqual(['tools']);
    expect(body.bearer_methods_supported).toEqual(['header']);
    expect(body.resource).toMatch(/^https:/);
  });

  it('RFC 9728 points to staging auth in staging', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'staging' }),
    );
    const body = await res.json();
    expect(body.authorization_servers).toEqual(['https://auth.paxaver.dev']);
  });

  it('RFC 9728 points to localhost in development', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-protected-resource',
      {},
      mockEnv({ ENVIRONMENT: 'development' }),
    );
    const body = await res.json();
    expect(body.authorization_servers).toEqual(['http://localhost:8788']);
  });

  it('RFC 8414 authorization server metadata returns correct endpoints', async () => {
    const res = await wellKnownApp.request(
      '/.well-known/oauth-authorization-server',
      {},
      mockEnv({ ENVIRONMENT: 'production' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe('https://auth.paxaver.com');
    expect(body.authorization_endpoint).toBe('https://auth.paxaver.com/authorize');
    expect(body.token_endpoint).toBe('https://auth.paxaver.com/token');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.jwks_uri).toBe('https://auth.paxaver.com/.well-known/jwks.json');
  });

  it('/oauth redirects to authorization server metadata', async () => {
    const res = await wellKnownApp.request('/oauth', {}, mockEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/.well-known/oauth-authorization-server');
  });

  it('/oauth/ redirects to authorization server metadata', async () => {
    const res = await wellKnownApp.request('/oauth/', {}, mockEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/.well-known/oauth-authorization-server');
  });
});
