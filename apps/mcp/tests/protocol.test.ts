/**
 * Protocol tests: initialize, ping, tools/list, tools/call, session lifecycle.
 * Calls app.fetch() directly — no network needed.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import {
  TEST_TOKEN,
  ACTIVE_TOKEN,
  FULL_TOKEN,
  EVENT_COORDINATOR_TOKEN,
  EXPIRED_TOKEN,
  TEST_ENV,
  backendCalls,
  makeToken,
} from './jwt-auth.js';
import { ALL_TOOLS } from '../src/schemas.js';
import { canSeeTool } from '../src/lib/policies.js';

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

  it('initialize lists exactly the tools visible to the caller and directs clients to tools/list', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, FULL_TOKEN);
    const json = (await res.json()) as unknown as { result: { instructions: string } };
    const visibleTools = ALL_TOOLS.filter((tool) =>
      canSeeTool(tool.name, { isPlatformAdmin: false, permissions: ['pac_cordinator'] }),
    );
    const listedTools = json.result.instructions.match(/Tools available for this account: (.*)\. Use tools\/list/)?.[1];

    expect(listedTools?.split(', ')).toEqual(visibleTools.map((tool) => tool.name));
    expect(json.result.instructions).toContain('tools/list as the authoritative source');
  });

  it('initialize lists event coordinator tools without promising restaurant tools', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, EVENT_COORDINATOR_TOKEN);
    const json = (await res.json()) as unknown as { result: { instructions: string } };
    const visibleTools = ALL_TOOLS.filter((tool) =>
      canSeeTool(tool.name, { isPlatformAdmin: false, permissions: ['event_cordinator'] }),
    );
    const listedTools = json.result.instructions.match(/Tools available for this account: (.*)\. Use tools\/list/)?.[1];

    expect(listedTools?.split(', ')).toEqual(visibleTools.map((tool) => tool.name));
    expect(listedTools).toContain('create_school_event');
    expect(listedTools).not.toContain('list_school_restaurants');
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
    expect(names.length).toBe(37);
    expect(names).toContain('get_my_context');
    expect(names).toContain('create_lunch_order_draft');
    expect(names).toContain('get_school_event');
    // Retired/legacy names are never advertised.
    for (const legacy of ['order_lunch', 'get_menu', 'register_event', 'create_menu_item', 'delete_menu_item']) {
      expect(names).not.toContain(legacy);
    }
  });

  it('unauthenticated server/discover request returns public protocol metadata', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 7, method: 'server/discover' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as {
      result: { resultType: string; supportedVersions: string[]; cacheScope: string };
    };
    expect(json.result.resultType).toBe('complete');
    expect(json.result.supportedVersions).toContain('2026-07-28');
    expect(json.result.cacheScope).toBe('public');
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

  it('tools/list shows only the exempt sign_out for users without an active MCP subscription', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, TEST_TOKEN);
    const json = (await res.json()) as unknown as { result: { tools: { name: string }[] } };
    expect(json.result.tools.map((t) => t.name)).toEqual(['sign_out']);
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

  it('removed order_lunch returns -32601 and never reaches the backend', async () => {
    backendCalls.length = 0;
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: { name: 'order_lunch', arguments: { menu_item_id: 'mi-1', menu_date: '2099-01-15' } },
      },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error?: { code: number }; result?: unknown };
    expect(json.error?.code).toBe(-32601);
    expect(json.result).toBeUndefined();
    expect(backendCalls.filter((c) => c.includes('/api/lunch/orders'))).toEqual([]);
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

  it('GET /mcp returns 405: the server opens no SSE stream', async () => {
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      { method: 'GET', headers: { Authorization: `Bearer ${ACTIVE_TOKEN}` } },
      TEST_ENV,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('a token without exp is rejected', async () => {
    const token = await makeToken('user-active', undefined, { withExp: false });
    const res = await mcpPost({ jsonrpc: '2.0', id: 30, method: 'ping' }, token);
    expect(res.status).toBe(401);
  });
});

describe('tool metadata', () => {
  it('every advertised tool annotation title matches its canonical title', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 40, method: 'tools/list' }, FULL_TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as {
      result: { tools: { name: string; title?: string; annotations?: { title?: string } }[] };
    };
    for (const tool of json.result.tools) {
      expect(tool.annotations?.title, `annotation title drift on ${tool.name}`).toBe(tool.title);
    }
  });
});

describe('resources and prompts', () => {
  it('initialize advertises prompts but no resources capability', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 41, method: 'initialize', params: {} }, ACTIVE_TOKEN);
    const json = (await res.json()) as unknown as {
      result: { capabilities: Record<string, unknown> };
    };
    expect(json.result.capabilities.prompts).toBeDefined();
    expect(json.result.capabilities.resources).toBeUndefined();
  });

  it('resources/list returns an empty list', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 42, method: 'resources/list' }, ACTIVE_TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { resources: unknown[] } };
    expect(json.result.resources).toEqual([]);
  });

  it('resources/read rejects the formerly advertised paxaver:// URIs', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 43, method: 'resources/read', params: { uri: 'paxaver://user/context' } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32602);
  });

  it('prompts/list returns the advertised prompts', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 44, method: 'prompts/list' }, ACTIVE_TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as unknown as { result: { prompts: { name: string }[] } };
    const names = json.result.prompts.map((p) => p.name);
    expect(names).toEqual(['daily_lunch_menu', 'wallet_balance', 'upcoming_events', 'lunch_order_helper']);
  });

  it.each(['daily_lunch_menu', 'wallet_balance', 'upcoming_events'])(
    'prompts/get %s returns a usable tool instruction',
    async (name) => {
      const res = await mcpPost({ jsonrpc: '2.0', id: 45, method: 'prompts/get', params: { name } }, ACTIVE_TOKEN);
      const json = (await res.json()) as unknown as {
        result: { description: string; messages: { role: string; content: { text: string } }[] };
      };
      expect(json.result.messages).toHaveLength(1);
      const text = json.result.messages[0]?.content.text ?? '';
      expect(text).toContain('Call ');
      expect(text).not.toBe(json.result.description);
    },
  );

  it('prompts/get lunch_order_helper interpolates student_name and orders the flow', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 46,
        method: 'prompts/get',
        params: { name: 'lunch_order_helper', arguments: { student_name: 'Alex' } },
      },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as {
      result: { messages: { content: { text: string } }[] };
    };
    const text = json.result.messages[0]?.content.text ?? '';
    expect(text).toContain('Alex');
    for (const tool of ['get_my_context', 'get_lunch_menu', 'create_lunch_order_draft', 'pay_lunch_order_draft']) {
      expect(text).toContain(tool);
    }
    expect(text.indexOf('create_lunch_order_draft')).toBeLessThan(text.indexOf('pay_lunch_order_draft'));
  });

  it('prompts/get lunch_order_helper works without student_name', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 47, method: 'prompts/get', params: { name: 'lunch_order_helper' } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as {
      result: { messages: { content: { text: string } }[] };
    };
    const text = json.result.messages[0]?.content.text ?? '';
    expect(text).toContain('create_lunch_order_draft');
  });

  it('prompts/get rejects an unknown prompt', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 48, method: 'prompts/get', params: { name: 'not_a_prompt' } },
      ACTIVE_TOKEN,
    );
    const json = (await res.json()) as unknown as { error: { code: number } };
    expect(json.error.code).toBe(-32602);
  });
});

describe('JSON-RPC batch', () => {
  it('returns one result per request and drops notifications', async () => {
    const res = await mcpPost(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_my_wallet_balance', arguments: {} } },
      ],
      ACTIVE_TOKEN,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: number; result?: { structuredContent?: unknown } }[];
    expect(json.map((r) => r.id)).toEqual([1, 2]);
    expect(json[0]?.result).toEqual({});
    expect(json[1]?.result?.structuredContent).toEqual({
      ok: true,
      topUpUrl: expect.stringContaining('/wallet/top-up'),
    });
  });

  it('a batch of notifications only gets 202 with no body', async () => {
    const res = await mcpPost([{ jsonrpc: '2.0', method: 'notifications/initialized' }], ACTIVE_TOKEN);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('rejects an oversized batch without running any message', async () => {
    backendCalls.length = 0;
    const batch = Array.from({ length: 21 }, (_, i) => ({
      jsonrpc: '2.0',
      id: i,
      method: 'tools/call',
      params: { name: 'get_my_wallet_balance', arguments: {} },
    }));
    const res = await mcpPost(batch, ACTIVE_TOKEN);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32600);
    expect(backendCalls.filter((c) => c.includes('/api/wallet'))).toEqual([]);
  });

  it('rejects an empty batch and invalid members', async () => {
    const empty = await mcpPost([], ACTIVE_TOKEN);
    expect(empty.status).toBe(400);
    const res = await mcpPost([42, { jsonrpc: '2.0', id: 3, method: 'ping' }], ACTIVE_TOKEN);
    const json = (await res.json()) as { id: number | null; error?: { code: number } }[];
    expect(json[0]?.error?.code).toBe(-32600);
    expect(json[1]?.id).toBe(3);
  });
});
