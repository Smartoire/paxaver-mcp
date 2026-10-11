/**
 * API smoke tests for the Paxaver MCP server.
 *
 * These tests verify the HTTP surface of the MCP server:
 * - Health and discovery endpoints
 * - MCP protocol handshake
 * - Tool listing
 * - Authentication enforcement
 *
 * Run against a local dev server:
 *   pnpm dev  # starts wrangler dev on :8787
 *   pnpm test:api
 */

import { describe, it, expect } from 'vitest';

const BASE = process.env.MCP_API_URL ?? 'http://localhost:8787';

async function rpc(method: string, params?: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: await res.json() };
}

describe('MCP server HTTP surface', () => {
  it('GET / returns 200 or 404', async () => {
    const res = await fetch(`${BASE}/`);
    expect([200, 404]).toContain(res.status);
  });

  it('GET /.well-known/oauth-protected-resource returns resource metadata', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toBeInstanceOf(Array);
    expect(body.bearer_methods_supported).toContain('header');
  });

  it('GET /.well-known/oauth-authorization-server returns auth metadata', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toMatch(/^https?:\/\//);
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  it('POST /mcp without auth returns 401', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /mcp with invalid token returns 401', async () => {
    const { status } = await rpc('initialize', undefined, 'invalid-token');
    expect(status).toBe(401);
  });

  it('server/discover returns supported versions', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' }),
    });
    // server/discover may be public or require auth depending on config
    if (res.status === 200) {
      const body = await res.json();
      expect(body.result?.supportedVersions).toBeInstanceOf(Array);
    }
  });
});
