/**
 * Protocol tests: initialize, ping, tools/list, tools/call, session lifecycle.
 * Uses Hono's app.request() — no network needed.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';

// ponytail: Tests use a legacy static token. The mock PAXAVER_API handles
// /api/mcp/whoami to return user context. RS256 JWKS validation fails
// (no auth worker in test env), falling through to the legacy path.
const TEST_TOKEN = 'test-static-mcp-token-for-vitest';
const ACTIVE_TOKEN = 'test-static-mcp-token-active-sub';
const FULL_TOKEN = 'test-static-mcp-token-full-sub';
const EXPIRED_TOKEN = 'test-static-mcp-token-expired-sub';

const USER_CONTEXT = {
  userId: 'user-1',
  email: 'test@paxaver.com',
  schoolSlug: 'test-school',
  permissions: ['pac_cordinator'],
  isPlatformAdmin: false,
  studentIds: ['student-1'],
  country: 'ca' as const,
};

const TOKEN_CONTEXTS: Record<string, typeof USER_CONTEXT & { subscription?: unknown }> = {
  [TEST_TOKEN]: USER_CONTEXT,
  [ACTIVE_TOKEN]: {
    ...USER_CONTEXT,
    subscription: { status: 'active', toolLevel: 'parent', expiry: '2099-07-31T00:00:00Z' },
  },
  [FULL_TOKEN]: {
    ...USER_CONTEXT,
    subscription: { status: 'active', toolLevel: 'full', expiry: '2099-07-31T00:00:00Z' },
  },
  [EXPIRED_TOKEN]: {
    ...USER_CONTEXT,
    subscription: { status: 'expired', toolLevel: 'parent', expiry: '2020-07-31T00:00:00Z' },
  },
};

const TEST_ENV = {
  JWT_SECRET: 'test-jwt-secret-for-vitest-only',
  ENVIRONMENT: 'test' as const,

  ALLOWED_ORIGINS: 'http://localhost:5173',
  API_BASE_URL_CA: 'http://localhost:8787',
  API_BASE_URL_US: 'http://localhost:8787',
  PAXAVER_API_CA: {
    async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
      const req = typeof request === 'string' ? new Request(request, init) : request;
      const url = new URL(req.url);
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (url.pathname === '/api/mcp/whoami') {
        if (!TOKEN_CONTEXTS[token]) {
          return new Response(JSON.stringify({ error: 'Invalid token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: TOKEN_CONTEXTS[token] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/api/users/me/context') {
        return new Response(JSON.stringify({ data: TOKEN_CONTEXTS[token] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
  PAXAVER_API_US: {
    async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
      const req = typeof request === 'string' ? new Request(request, init) : request;
      const url = new URL(req.url);
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (url.pathname === '/api/mcp/whoami') {
        if (!TOKEN_CONTEXTS[token]) {
          return new Response(JSON.stringify({ error: 'Invalid token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: TOKEN_CONTEXTS[token] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/api/users/me/context') {
        return new Response(JSON.stringify({ data: TOKEN_CONTEXTS[token] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
};

async function mcpPost(body: unknown, token?: string, mcpMethod?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (mcpMethod) headers['Mcp-Method'] = mcpMethod;
  return app.request(
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    TEST_ENV,
  );
}

describe('MCP protocol', () => {
  it('initialize returns protocol version and server info', async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(json.result.protocolVersion).toBe('2025-06-18');
    expect(json.result.serverInfo.name).toBe('paxaver-mcp');
    expect(res.headers.get('Mcp-Session-Id')).toBeTruthy();
  });

  it('ping returns empty result', async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'ping' }, token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: unknown };
    expect(json.result).toEqual({});
  });

  it('tools/list returns all tools', async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { tools: { name: string }[] } };
    expect(json.result.tools.length).toBeGreaterThan(10);
    expect(json.result.tools.some((t: { name: string }) => t.name === 'get_user_info')).toBe(true);
  });

  it('unauthenticated tools/list probe returns full catalog', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, undefined, 'tools/list');
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { tools: { name: string }[] } };
    expect(json.result.tools.length).toBeGreaterThan(10);
  });

  it('spoofed Mcp-Method header cannot bypass auth on tools/call', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_wallet_balance', arguments: {} } },
      undefined,
      'tools/list',
    );
    expect(res.status).toBe(401);
  });

  it('unauthenticated request returns 401 with WWW-Authenticate', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 4, method: 'tools/call' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  });

  it('invalid token returns 401', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 5, method: 'tools/call' }, 'invalid-token');
    expect(res.status).toBe(401);
  });

  it('unknown method returns -32601', async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: '2.0', id: 6, method: 'nonexistent/method' }, token);
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it('unsubscribed read tool executes (reads are free)', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_wallet_balance', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
    expect(json.result).toBeTruthy();
  });

  it('unsubscribed write tool is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'order_lunch', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('subscription');
  });

  it('unsubscribed event registration is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'register_event', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('subscription');
  });

  it('expired subscription write is blocked with renewal message', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'order_lunch', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('expired');
  });

  it('expired subscription read still executes', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_daily_menu', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('active parent subscription write executes', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'order_lunch', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('parent-level subscription is blocked from admin write tools', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'set_daily_menu', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('PAC AI');
  });

  it('full-level subscription can use admin write tools', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'set_daily_menu', arguments: {} } },
      FULL_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('parse error on invalid JSON', async () => {
    const token = TEST_TOKEN;
    const res = await app.request(
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: 'not json',
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32700);
  });
});
