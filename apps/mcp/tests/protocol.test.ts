/**
 * Protocol tests: initialize, ping, tools/list, tools/call, session lifecycle.
 * Uses Hono's app.request() — no network needed.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { TEST_TOKEN, ACTIVE_TOKEN, FULL_TOKEN, EXPIRED_TOKEN, TEST_ENV } from './jwt-auth.js';

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

  it('tools/list returns the canonical catalog for a PAC-capable user', async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { tools: { name: string }[] } };
    const names = json.result.tools.map((t) => t.name);
    // TEST_TOKEN's context carries pac_cordinator -> full catalog.
    expect(names.length).toBe(26);
    expect(names).toContain('get_my_context');
    expect(names).toContain('create_lunch_order_draft');
    // Retired/legacy names are never advertised.
    for (const legacy of ['order_lunch', 'get_menu', 'register_event', 'create_menu_item', 'delete_menu_item']) {
      expect(names).not.toContain(legacy);
    }
  });

  it('unauthenticated tools/list probe returns the static canonical catalog', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, undefined, 'tools/list');
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { tools: { name: string }[] } };
    expect(json.result.tools.length).toBe(26);
    // Anonymous catalog carries schemas only - no account data.
    expect(JSON.stringify(json.result)).not.toContain('test-school');
  });

  it('spoofed Mcp-Method header cannot bypass auth on tools/call', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_my_wallet_balance', arguments: {} } },
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
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_my_wallet_balance', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
    expect(json.result).toBeTruthy();
  });

  it('unsubscribed write tool is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'create_lunch_order_draft', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('subscription');
  });

  it('unsubscribed event registration is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'register_for_event', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('subscription');
  });

  it('expired subscription write is blocked with renewal message', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'create_lunch_order_draft', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('expired');
  });

  it('expired subscription read still executes', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_lunch_menu', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('active parent subscription write executes', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'create_lunch_order_draft', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('parent-level subscription is blocked from admin write tools', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'schedule_lunch_menu_item', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('PAC AI');
  });

  it('full-level subscription can use admin write tools', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'schedule_lunch_menu_item', arguments: {} } },
      FULL_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { message: string }; result?: unknown };
    expect(json.error?.message ?? '').not.toContain('subscription');
  });

  it('legacy alias resolves to the canonical tool', async () => {
    // 'get_menu' is a legacy alias for 'get_lunch_menu' - callable, unlisted.
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'get_menu', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { code: number; message: string }; result?: unknown };
    expect(json.error?.code).not.toBe(-32601);
    expect(json.result).toBeTruthy();
  });

  it('legacy order_lunch stays callable but unlisted', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: { name: 'order_lunch', arguments: { menu_item_id: 'mi-1', menu_date: '2099-01-15' } },
      },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { code: number; message: string }; result?: unknown };
    expect(json.error?.code).not.toBe(-32601);
    expect(json.result).toBeTruthy();
  });

  it('truly unknown tool names return -32601', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'definitely_not_a_tool', arguments: {} } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
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
