/**
 * Issue #3682: child assistant credentials, the wallet-spend consent
 * error, guided-flow elicitation, and the get_my_context assistant
 * fields.
 *
 * - A child token sees only the three read tools and every other
 *   tools/call — canonical name or legacy alias — is refused before it
 *   reaches the backend.
 * - ASSISTANT_PAYMENTS_DISABLED maps to a readable -32602 that names the
 *   draft the user can pay in the Paxaver app.
 * - get_my_context reports assistantMode and assistantWalletSpend.
 * - A call missing required args returns an MCP InputRequiredResult when
 *   the client declared form elicitation, and the usual -32602 otherwise.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { CHILD_TOKEN, FULL_TOKEN, TEST_ENV, backendCalls, mockBackend } from './jwt-auth.js';

const ELICIT_META = {
  'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
};

function mcpPost(method: string, params: unknown, token: string, env: Record<string, unknown> = TEST_ENV) {
  return request(
    app,
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
  );
}

function callTool(
  name: string,
  args: Record<string, unknown>,
  token = FULL_TOKEN,
  extra: Record<string, unknown> = {},
  env: Record<string, unknown> = TEST_ENV,
) {
  return mcpPost('tools/call', { name, arguments: args, ...extra }, token, env);
}

async function toolData(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as { result?: { structuredContent?: Record<string, unknown> } };
  return json.result?.structuredContent ?? {};
}

async function rpcError(res: Response): Promise<{ code: number; message: string }> {
  const json = (await res.json()) as { error?: { code: number; message: string } };
  return json.error ?? { code: 0, message: '' };
}

beforeEach(() => {
  backendCalls.length = 0;
});

describe('child assistant credential', () => {
  it('tools/list exposes only the three read tools', async () => {
    const res = await mcpPost('tools/list', {}, CHILD_TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { tools: { name: string }[] } };
    expect(json.result?.tools.map((t) => t.name)).toEqual(['get_my_context', 'list_my_lunch_orders', 'get_lunch_menu']);
  });

  it('refuses a write tool call before it reaches the backend', async () => {
    const res = await callTool(
      'create_lunch_order_draft',
      { menu_date: '2026-03-10', items: [{ menu_item_id: 'item-1', quantity: 1 }] },
      CHILD_TOKEN,
    );
    const err = await rpcError(res);
    expect(err.code).toBe(-32603);
    expect(err.message).toMatch(/read-only child assistant/i);
    expect(backendCalls.some((c) => c.includes('/api/lunch/orders/draft'))).toBe(false);
  });

  it('refuses a write tool reached through a legacy alias', async () => {
    const res = await callTool('finalize_order', { order_id: 'draft-1' }, CHILD_TOKEN);
    const err = await rpcError(res);
    expect(err.code).toBe(-32603);
    expect(err.message).toMatch(/read-only child assistant/i);
    expect(backendCalls.some((c) => c.includes('/finalize'))).toBe(false);
  });

  it('still serves the read tools', async () => {
    const res = await callTool('list_my_lunch_orders', {}, CHILD_TOKEN);
    expect(res.status).toBe(200);
    expect(backendCalls).toContain('GET /api/lunch/orders');
  });

  it('get_my_context reports child mode and the narrowed student set', async () => {
    const res = await callTool('get_my_context', {}, CHILD_TOKEN);
    const out = await toolData(res);
    expect(out.assistantMode).toBe('child');
    expect(out.assistantWalletSpend).toBe(false);
    expect(out.email).toBeNull();
    expect(out.roles).toEqual([]);
    expect(out.students).toEqual([{ id: 'student-2', firstName: null, schoolSlug: 'test-school' }]);
    // The child path reads the narrowed context endpoint, never /api/users/me.
    expect(backendCalls.filter((c) => c === 'GET /api/users/me/context').length).toBeGreaterThanOrEqual(2);
    expect(backendCalls).not.toContain('GET /api/users/me');
  });
});

describe('get_my_context assistant fields', () => {
  it('reports parent mode and wallet spend on for a normal account', async () => {
    const res = await callTool('get_my_context', {}, FULL_TOKEN);
    const out = await toolData(res);
    expect(out.assistantMode).toBe('parent');
    // The mock /api/users/me carries no assistantWalletSpend — the shipped
    // default is ON.
    expect(out.assistantWalletSpend).toBe(true);
  });

  it('reports assistantWalletSpend false when the account turns it off', async () => {
    const meBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/api/users/me') {
          return Response.json({
            data: { firstName: 'Pat', assistantWalletSpend: false, students: [], roles: [] },
          });
        }
        return mockBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: meBackend, PAXAVER_API_US: meBackend };
    const res = await callTool('get_my_context', {}, FULL_TOKEN, {}, env);
    const out = await toolData(res);
    expect(out.assistantMode).toBe('parent');
    expect(out.assistantWalletSpend).toBe(false);
  });
});

describe('ASSISTANT_PAYMENTS_DISABLED', () => {
  it('maps the consent error to a readable -32602 naming the draft', async () => {
    const consentBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        const url = new URL(req.url);
        if (url.pathname === '/api/lunch/orders/draft-9/finalize') {
          return Response.json(
            {
              success: false,
              error: {
                code: 'ASSISTANT_PAYMENTS_DISABLED',
                message:
                  'Assistant wallet payments are turned off for this account. Finish the payment in the Paxaver app, or turn on assistant payments in the account AI page.',
                details: { orderId: 'draft-9' },
              },
            },
            { status: 403 },
          );
        }
        return mockBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: consentBackend, PAXAVER_API_US: consentBackend };
    const res = await callTool('pay_lunch_order_draft', { order_id: 'draft-9' }, FULL_TOKEN, {}, env);
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('draft-9');
    expect(err.message).toMatch(/Paxaver app/i);
    expect(err.message).toMatch(/assistant payments/i);
  });

  it('falls back to the order_id argument when details carry no id', async () => {
    const consentBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname.endsWith('/finalize')) {
          return Response.json(
            {
              success: false,
              error: { code: 'ASSISTANT_PAYMENTS_DISABLED', message: 'Assistant payments are off.' },
            },
            { status: 403 },
          );
        }
        return mockBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: consentBackend, PAXAVER_API_US: consentBackend };
    const res = await callTool('pay_lunch_order_draft', { order_id: 'draft-7' }, FULL_TOKEN, {}, env);
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('draft-7');
  });
});

describe('guided-flow elicitation', () => {
  it('returns -32602 for a missing required arg without elicitation support', async () => {
    const res = await callTool('pay_lunch_order_draft', {});
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('order_id');
  });

  it('returns input_required when the client declares form elicitation', async () => {
    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, { _meta: ELICIT_META });
    const json = (await res.json()) as {
      result?: {
        resultType?: string;
        requestState?: string;
        inputRequests?: Record<string, { method: string; params: { mode: string; requestedSchema: unknown } }>;
      };
    };
    expect(json.result?.resultType).toBe('input_required');
    expect(json.result?.requestState).toBeTruthy();
    const req = json.result?.inputRequests?.tool_args;
    expect(req?.method).toBe('elicitation/create');
    expect(req?.params.mode).toBe('form');
    expect(req?.params.requestedSchema).toMatchObject({
      type: 'object',
      properties: { order_id: expect.anything() },
      required: ['order_id'],
    });
    // Nothing reached the backend.
    expect(backendCalls.some((c) => c.includes('/finalize'))).toBe(false);
  });

  it('an empty elicitation capability object also counts as form support', async () => {
    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, {
      _meta: { 'io.modelcontextprotocol/clientCapabilities': { elicitation: {} } },
    });
    const json = (await res.json()) as { result?: { resultType?: string } };
    expect(json.result?.resultType).toBe('input_required');
  });

  it('url-mode-only elicitation does not trigger input_required', async () => {
    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, {
      _meta: { 'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } } },
    });
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
  });

  it('a retry with accepted inputResponses completes the call', async () => {
    const first = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, { _meta: ELICIT_META });
    const firstJson = (await first.json()) as { result?: { requestState?: string } };
    const requestState = firstJson.result?.requestState;
    expect(requestState).toBeTruthy();

    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, {
      _meta: ELICIT_META,
      requestState,
      inputResponses: { tool_args: { action: 'accept', content: { order_id: 'draft-9' } } },
    });
    expect(res.status).toBe(200);
    expect(backendCalls).toContain('POST /api/lunch/orders/draft-9/finalize');
  });

  it('a forged requestState is ignored — the elicited values are not merged', async () => {
    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, {
      requestState: 'forged.payload.signature',
      inputResponses: { tool_args: { action: 'accept', content: { order_id: 'draft-9' } } },
    });
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('order_id');
    expect(backendCalls.some((c) => c.includes('/finalize'))).toBe(false);
  });

  it('a declined elicitation falls back to -32602', async () => {
    const first = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, { _meta: ELICIT_META });
    const firstJson = (await first.json()) as { result?: { requestState?: string } };
    const res = await callTool('pay_lunch_order_draft', {}, FULL_TOKEN, {
      _meta: ELICIT_META,
      requestState: firstJson.result?.requestState,
      inputResponses: { tool_args: { action: 'decline' } },
    });
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('order_id');
  });

  it('non-primitive missing args (arrays) cannot be elicited — -32602', async () => {
    const res = await callTool('create_lunch_order_draft', { menu_date: '2026-03-10' }, FULL_TOKEN, {
      _meta: ELICIT_META,
    });
    const err = await rpcError(res);
    expect(err.code).toBe(-32602);
    expect(err.message).toContain('items');
  });
});
