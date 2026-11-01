/**
 * Output-schema contract: every tool advertised by tools/list that declares an
 * outputSchema must return a structuredContent object that validates against
 * that schema. MCP requires structuredContent to be an object, so a bare array
 * (for example a list route that forwards `data` unwrapped) fails here.
 *
 * Each tool is called over JSON-RPC with generated arguments. The mocked
 * backend answers list routes with the bare-array or envelope shapes the real
 * backend returns; every other route uses the default mock body.
 */

import { describe, it, expect, vi } from 'vitest';
import Ajv from 'ajv';
import app from '../src/index.js';
import { request } from './request.js';
import { FULL_TOKEN, TEST_ENV, makeToken, mockBackend } from './jwt-auth.js';

type Json = Record<string, unknown>;

interface ToolEntry {
  name: string;
  inputSchema: { properties: Record<string, Json>; required?: string[] };
  outputSchema?: Json;
}

// Backend GET routes that return a list. Shapes follow the backend: a bare
// `data` array, or an object envelope where the MCP adapter reads a field.
// Flags are SQLite integers (0/1), nullable columns are null, and JSON
// columns are parsed (ingredients is an array), as the live backend returns.
const LIST_FIXTURES: Array<[RegExp, unknown]> = [
  [
    /^\/api\/lunch\/orders$/,
    [{ id: 'order-1', status: 'paid', menuDate: '2026-11-02', itemTotalCents: 550, studentId: 'student-1' }],
  ],
  [
    /^\/api\/events$/,
    [
      {
        id: 'event-1',
        name: 'Fixture event',
        eventDate: '2026-11-05',
        startsAt: null,
        endsAt: null,
        location: null,
        isClosed: 0,
        status: 'open',
      },
    ],
  ],
  [
    /^\/api\/events\/tickets\/mine$/,
    [{ id: 'ticket-1', eventId: 'event-1', quantity: 1, status: 'paid', checkedInAt: null }],
  ],
  [
    /^\/api\/volunteers\/my-signups$/,
    [{ id: 'signup-1', shiftId: 'shift-1', status: 'confirmed', title: 'Fixture shift' }],
  ],
  [
    /^\/api\/events\/[^/]+\/tickets$/,
    [
      {
        id: 'ticket-1',
        eventId: 'event-1',
        firstName: 'Ada',
        lastName: 'Fixture',
        quantity: 1,
        status: 'paid',
        checkedInAt: null,
        email: 'hidden@example.com',
      },
    ],
  ],
  [/^\/api\/programs$/, [{ id: 'program-1', name: 'Fixture program', type: 'club' }]],
  [
    /^\/api\/programs\/registrations$/,
    [
      {
        id: 'reg-1',
        programId: 'program-1',
        programName: 'Fixture program',
        studentId: 'student-1',
        studentName: 'Ada Fixture',
        status: 'registered',
        amountCents: 0,
        notes: null,
        createdAt: '2026-11-01T10:00:00Z',
      },
      {
        id: 'reg-2',
        programId: 'program-1',
        programName: 'Fixture program',
        studentId: null,
        studentName: null,
        status: 'registered',
        amountCents: 0,
        notes: null,
        createdAt: '2026-11-01T11:00:00Z',
      },
    ],
  ],
  [
    /^\/api\/schools\/[^/]+\/restaurants$/,
    [{ id: 'restaurant-1', name: 'Fixture kitchen', description: null, isActive: 1, logoUrl: null }],
  ],
  [
    /^\/api\/restaurants\/[^/]+\/items$/,
    [
      {
        id: 'item-1',
        name: 'Fixture pizza',
        description: null,
        priceCents: 550,
        costCents: null,
        isActive: 1,
        isAvailable: 1,
        calories: null,
        ingredients: [],
      },
    ],
  ],
];

// Wallet history is an envelope: the adapter reads `data.transactions`.
const WALLET_TRANSACTIONS = {
  transactions: [
    {
      id: 'tx-1',
      type: 'debit',
      amountCents: -550,
      balanceBeforeCents: 1000,
      balanceAfterCents: 450,
      status: 'completed',
      createdAt: '2026-11-01T10:00:00Z',
    },
  ],
  pagination: { perPage: 20, nextCursor: null, hasMore: false },
};

const fixtureBackend = {
  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/api/wallet/transactions') {
      return Response.json({ data: WALLET_TRANSACTIONS });
    }
    if (req.method === 'GET') {
      const match = LIST_FIXTURES.find(([pattern]) => pattern.test(url.pathname));
      if (match) return Response.json({ data: match[1] });
    }
    return mockBackend.fetch(req);
  },
};

const ENV = {
  ...TEST_ENV,
  PAXAVER_API_CA: fixtureBackend,
  PAXAVER_API_US: fixtureBackend,
  PAXAVER_API_MX: fixtureBackend,
};

// sign_out posts to the regional /revoke endpoint; accept it so the tool runs.
const innerFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
  return innerFetch(input, init);
});

async function rpc(method: string, params: Json | undefined, id: number, token = FULL_TOKEN): Promise<Json> {
  const res = await request(
    app,
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    },
    ENV,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Json;
}

// Values for each required argument, typed from its input schema.
function sampleArgs(tool: ToolEntry): Json {
  const args: Json = {};
  for (const name of tool.inputSchema.required ?? []) {
    if (name === 'student_id') args[name] = 'student-1';
    else if (name === 'school_slug') args[name] = 'test-school';
    else args[name] = sampleValue(tool.inputSchema.properties[name] ?? {});
  }
  return args;
}

function sampleValue(schema: Json): unknown {
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues) return enumValues.find((v) => v !== null) ?? null;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return 'fixture-1';
  }
}

// sign_out only runs for a token that carries the client_id it revokes for.
const SIGNOUT_TOKEN = await makeToken('user-full', undefined, { clientId: 'mcp-client-1' });

const listed = await rpc('tools/list', {}, 1);
const tools = (listed.result as { tools: ToolEntry[] }).tools;
const ajv = new Ajv({ allErrors: true });

describe('tool outputSchema contract', () => {
  it('tools/list advertises tools with output schemas', () => {
    expect(tools.filter((t) => t.outputSchema).length).toBeGreaterThan(0);
  });

  const withOutput = tools.filter((t): t is ToolEntry & { outputSchema: Json } => t.outputSchema !== undefined);

  it.each(withOutput.map((t) => [t.name, t] as const))(
    '%s returns structuredContent that is an object matching its outputSchema',
    async (name, tool) => {
      const validate = ajv.compile(tool.outputSchema);
      // The validator itself must reject a bare array, or the check proves nothing.
      expect(validate([])).toBe(false);

      const token = name === 'sign_out' ? SIGNOUT_TOKEN : FULL_TOKEN;
      const json = await rpc('tools/call', { name, arguments: sampleArgs(tool) }, 2, token);
      expect(json.error, JSON.stringify(json.error)).toBeUndefined();
      const result = json.result as { structuredContent?: unknown; content?: unknown[] };
      expect(result.content?.length).toBeGreaterThan(0);
      const structured = result.structuredContent;
      expect(Array.isArray(structured)).toBe(false);
      expect(structured !== null && typeof structured === 'object').toBe(true);
      expect(validate(structured), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it('list tools wrap their rows under the array property their schema declares', async () => {
    const cases: Array<[string, Json, string]> = [
      ['list_my_lunch_orders', {}, 'orders'],
      ['list_school_events', {}, 'events'],
      ['list_my_event_registrations', {}, 'tickets'],
      ['list_my_volunteer_signups', {}, 'signups'],
      ['list_school_restaurants', { school_slug: 'test-school' }, 'restaurants'],
      ['list_restaurant_menu_items', { restaurant_id: 'restaurant-1' }, 'items'],
    ];
    for (const [name, args, key] of cases) {
      const json = await rpc('tools/call', { name, arguments: args }, 3);
      const structured = (json.result as { structuredContent: Json }).structuredContent;
      expect(Array.isArray(structured[key]), `${name}.${key}`).toBe(true);
    }
  });
});
