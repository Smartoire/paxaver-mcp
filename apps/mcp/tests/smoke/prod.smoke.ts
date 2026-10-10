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
    expect(json.authorization_servers).toEqual(['https://mcp.paxaver.com']);
  });

  it('authorization server metadata is the regional facade', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { issuer: string; authorization_endpoint: string };
    expect(json.issuer).toBe('https://mcp.paxaver.com');
    expect(json.authorization_endpoint).toBe('https://mcp.paxaver.com/oauth/authorize');
  });

  it('authorize page offers every region', async () => {
    const res = await fetch(`${BASE}/oauth/authorize?response_type=code`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const issuer of ['https://paxaver.ca/auth', 'https://paxaver.com/auth', 'https://paxaver.mx/auth']) {
      expect(html).toContain(`${issuer}/authorize`);
    }
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
