/**
 * Anonymous discovery (#2202): with ANONYMOUS_DISCOVERY=1 in development, a
 * client without a token can run initialize and the list methods. Every
 * other method, and every other environment, still requires a token.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { TEST_ENV, TEST_TOKEN } from './jwt-auth.js';
import { ALL_TOOLS } from '../src/schemas.js';

const DEV_ANON_ENV = { ...TEST_ENV, ANONYMOUS_DISCOVERY: '1' };

function mcpPost(body: unknown, env: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(app, 'https://mcp.paxaver.test/mcp', { method: 'POST', headers, body: JSON.stringify(body) }, env);
}

describe('anonymous discovery enabled (development)', () => {
  it('initialize returns 200 with a session id', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, DEV_ANON_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('Mcp-Session-Id')).toBeTruthy();
    const json = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(json.result.serverInfo.name).toBe('paxaver-mcp');
  });

  it('notifications/initialized returns 200', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, DEV_ANON_ENV);
    expect(res.status).toBe(200);
  });

  it('tools/list returns the full tool list', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, DEV_ANON_ENV);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(json.result.tools.map((t) => t.name)).toEqual(ALL_TOOLS.map((t) => t.name));
  });

  it.each(['prompts/list', 'resources/list'])('%s returns 200 with a result', async (method) => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 3, method }, DEV_ANON_ENV);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    expect(json.error).toBeUndefined();
    expect(json.result).toBeDefined();
  });

  it.each(['tools/call', 'ping', 'resources/read', 'prompts/get', 'resources/templates/list'])(
    '%s without a token returns 401',
    async (method) => {
      const res = await mcpPost(
        { jsonrpc: '2.0', id: 4, method, params: { name: 'get_my_wallet_balance', arguments: {} } },
        DEV_ANON_ENV,
      );
      expect(res.status).toBe(401);
    },
  );

  it('a batch cannot carry tools/call past the gate', async () => {
    const res = await mcpPost(
      [
        { jsonrpc: '2.0', id: 5, method: 'tools/list' },
        { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_my_wallet_balance', arguments: {} } },
      ],
      DEV_ANON_ENV,
    );
    expect(res.status).toBe(401);
  });

  it('GET /mcp without a token returns 401', async () => {
    const res = await request(app, 'https://mcp.paxaver.test/mcp', { method: 'GET' }, DEV_ANON_ENV);
    expect(res.status).toBe(401);
  });

  it('a request with a token still authenticates (subscription gate applies)', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, DEV_ANON_ENV, TEST_TOKEN);
    const json = (await res.json()) as { error?: { message: string } };
    expect(json.error?.message).toContain('subscription');
  });
});

describe('anonymous discovery disabled', () => {
  const envs: [string, Record<string, unknown>][] = [
    ['development without the flag', TEST_ENV],
    ['development with ANONYMOUS_DISCOVERY=true', { ...TEST_ENV, ANONYMOUS_DISCOVERY: 'true' }],
    ['staging with the flag', { ...TEST_ENV, ENVIRONMENT: 'staging', ANONYMOUS_DISCOVERY: '1' }],
    ['production with the flag', { ...TEST_ENV, ENVIRONMENT: 'production', ANONYMOUS_DISCOVERY: '1' }],
  ];

  for (const [label, env] of envs) {
    it.each(['initialize', 'notifications/initialized', 'tools/list', 'prompts/list', 'resources/list', 'tools/call'])(
      `${label}: %s without a token returns 401`,
      async (method) => {
        const res = await mcpPost({ jsonrpc: '2.0', id: 1, method }, env);
        expect(res.status).toBe(401);
      },
    );
  }
});
