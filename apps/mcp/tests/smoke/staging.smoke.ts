/**
 * Read-only smoke test for staging (mcp.paxaver.dev).
 * Run with: npm run smoke:staging
 * Requires: mcp.paxaver.dev deployed and DNS configured.
 */

import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_URL || 'https://mcp.paxaver.dev';

describe('staging smoke (read-only)', () => {
  it('health endpoint returns 200', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe('ok');
    expect(json.environment).toBe('staging');
  });

  it('protected resource metadata is valid', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.resource).toContain('paxaver.dev');
    expect(json.scopes_supported).toContain('tools');
  });

  it('authorization server metadata is valid', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.code_challenge_methods_supported).toEqual(['S256']);
    expect(json.grant_types_supported).toContain('authorization_code');
  });

  it('unauthenticated MCP request returns 401 with WWW-Authenticate', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  });

  it('security headers are present', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
