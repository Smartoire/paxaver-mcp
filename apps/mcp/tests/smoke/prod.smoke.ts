/**
 * Read-only smoke test for production (mcp.paxaver.com).
 * Run with: npm run smoke:prod
 * Override endpoint with: SMOKE_URL=https://mcp.paxaver.com npm run smoke:prod
 */

import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_URL || 'https://mcp.paxaver.com';

describe('Production smoke (read-only)', () => {
  it('health endpoint returns 200', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; version: string };
    expect(json.status).toBe('ok');
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('protected resource metadata is valid', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(json.resource).toBe('https://mcp.paxaver.com/mcp');
    expect(json.authorization_servers).toContain('https://auth.paxaver.com');
  });

  it('authorization server metadata points to auth server', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.issuer).toBe('https://auth.paxaver.com');
    expect(json.authorization_endpoint).toContain('auth.paxaver.com');
  });

  it('unauthenticated MCP request returns 401', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(401);
  });
});
