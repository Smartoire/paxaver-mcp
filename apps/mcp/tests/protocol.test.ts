/**
 * Protocol tests: initialize, ping, tools/list, tools/call, session lifecycle.
 * Calls app.fetch() directly — no network needed.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { TEST_TOKEN, ACTIVE_TOKEN, FULL_TOKEN, EXPIRED_TOKEN, TEST_ENV } from './jwt-auth.js';

async function mcpPost(body: unknown, token?: string, mcpMethod?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (mcpMethod) headers['Mcp-Method'] = mcpMethod;
  return request(
    app,
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
  it('initialize explains portal subscription requirements to free users', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, TEST_TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as {
      result: { protocolVersion: string; serverInfo: { name: string }; instructions: string };
    };
    expect(json.result.protocolVersion).toBe('2025-06-18');
    expect(json.result.serverInfo.name).toBe('paxaver-mcp');
    expect(json.result.instructions).toContain('subscription');
    expect(json.result.instructions).toContain('portal');
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
    const res = await mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, FULL_TOKEN);
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

  it.each(['initialize', 'tools/list', 'ping'])(
    'unauthenticated %s request returns 401 with OAuth challenge',
    async (method) => {
      const res = await mcpPost({ jsonrpc: '2.0', id: 7, method });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
    },
  );

  it('unauthenticated SSE connection returns 401 with OAuth challenge', async () => {
    const res = await request(app, 'https://mcp.paxaver.test/mcp', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
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
    const res = await mcpPost({ jsonrpc: '2.0', id: 6, method: 'nonexistent/method' }, ACTIVE_TOKEN);
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it('unsubscribed read tool is blocked with portal guidance and no payment link', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_my_wallet_balance', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { message: string } };
    expect(json.error.message).toContain('subscription');
    expect(json.error.message).toContain('portal');
    expect(json.error.message).not.toContain('https://');
  });

  it('tools/list is blocked for users without an active MCP subscription', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, TEST_TOKEN);
    const json = (await res.json()) as unknown as { error: { message: string } };
    expect(json.error.message).toContain('subscription');
    expect(json.error.message).toContain('portal');
    expect(json.error.message).not.toContain('https://');
  });

  it('resources/list is blocked for users without an active MCP subscription', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 9, method: 'resources/list' }, TEST_TOKEN);
    const json = (await res.json()) as unknown as { error: { message: string } };
    expect(json.error.message).toContain('subscription');
  });

  it('unsubscribed write tool is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'create_lunch_order_draft', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32002);
    expect(json.error.message).toContain('subscription');
  });

  it('unsubscribed event registration is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'register_for_event', arguments: {} } },
      TEST_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32002);
    expect(json.error.message).toContain('subscription');
  });

  it('expired subscription is blocked with portal guidance', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'create_lunch_order_draft', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32002);
    expect(json.error.message).toContain('portal');
  });

  it('expired subscription read is blocked', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_lunch_menu', arguments: {} } },
      EXPIRED_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { message: string } };
    expect(json.error.message).toContain('subscription');
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
    const res = await request(
      app,
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

  it('GET /mcp denies free users before opening an SSE stream', async () => {
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      { method: 'GET', headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
      TEST_ENV,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as unknown as { error: string };
    expect(json.error).toContain('subscription');
    expect(json.error).toContain('portal');
    expect(json.error).not.toContain('https://');
  });

  it('GET /mcp opens an SSE stream with an endpoint event', async () => {
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      { method: 'GET', headers: { Authorization: `Bearer ${ACTIVE_TOKEN}` } },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
    expect(text).toContain('event: endpoint');
    expect(text).toContain('data: https://mcp.paxaver.test/mcp');
    await reader.cancel();
  });
});
