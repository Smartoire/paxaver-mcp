/**
 * Tool → backend contract tests (#916/#921): asserts the exact path AND the
 * JSON body/query keys each tool sends to the Paxaver backend. The
 * backend mounts menu/daily and restaurant-item routes under /api —
 * not /api/lunch — and its validators take camelCase fields; passing
 * snake_case args through verbatim 400s or silently drops fields.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { FULL_TOKEN, TEST_ENV, mockBackend } from './jwt-auth.js';
import { ALL_TOOLS } from '../src/schemas.js';

interface BackendCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
  idempotencyKey: string | null;
}

const calls: BackendCall[] = [];
const recordingBackend = {
  async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof request === 'string' ? new Request(request, init) : request;
    const url = new URL(req.url);
    let body: BackendCall['body'];
    try {
      body = (await req.clone().json()) as Record<string, unknown>;
    } catch {
      body = undefined;
    }
    calls.push({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      body,
      idempotencyKey: req.headers.get('Idempotency-Key'),
    });
    return mockBackend.fetch(req);
  },
};

const ENV = { ...TEST_ENV, PAXAVER_API_CA: recordingBackend, PAXAVER_API_US: recordingBackend };

function contextOverrideBackend(overrides: Record<string, unknown>) {
  return {
    async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
      const req = typeof request === 'string' ? new Request(request, init) : request;
      const response = await recordingBackend.fetch(req);
      if (new URL(req.url).pathname !== '/api/users/me/context') return response;
      const payload = (await response.json()) as { data: Record<string, unknown> };
      return Response.json({ ...payload, data: { ...payload.data, ...overrides } });
    },
  };
}

async function postTool(name: string, args: Record<string, unknown>, env = ENV, { id = 1, sessionId = '' } = {}) {
  calls.length = 0;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await request(
    app,
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return res;
}

async function callTool(name: string, args: Record<string, unknown>, options = {}, env = ENV) {
  await postTool(name, args, env, options);
  return calls.filter((c) => c.path !== '/api/users/me/context').at(-1);
}

const draftItem = { menu_item_id: 'item-1', menu_item_name: 'Pizza', price_cents: 550, quantity: 2 };
// The backend prices draft items from the menu — a client-sent
// price_cents must never be forwarded (#1951).
const draftItemCamel = { menuItemId: 'item-1', menuItemName: 'Pizza', quantity: 2 };

describe('tool → backend contract', () => {
  it('pins idempotentHint for every advertised tool', () => {
    const expected: Record<string, boolean | undefined> = {
      get_my_context: undefined,
      get_my_wallet_balance: undefined,
      list_my_lunch_orders: undefined,
      get_lunch_menu: undefined,
      create_lunch_order_draft: false,
      pay_lunch_order_draft: false,
      update_lunch_order_draft: true,
      discard_lunch_order_draft: true,
      cancel_my_lunch_order: false,
      list_school_events: undefined,
      get_school_event: true,
      create_school_event: false,
      update_school_event: true,
      cancel_school_event: false,
      register_for_event: false,
      list_my_event_registrations: true,
      cancel_my_event_registration: false,
      list_my_volunteer_signups: true,
      cancel_my_volunteer_signup: true,
      sign_up_for_volunteer_shift: false,
      list_school_restaurants: undefined,
      create_school_restaurant: false,
      list_restaurant_menu_items: undefined,
      create_restaurant_menu_item: false,
      update_restaurant_menu_item: true,
      archive_restaurant_menu_item: true,
      schedule_lunch_menu_item: false,
    };
    expect(Object.fromEntries(ALL_TOOLS.map((tool) => [tool.name, tool.annotations?.idempotentHint]))).toEqual(
      expected,
    );
  });

  it.each([
    ['student_id is not permitted for this user', 'list_school_restaurants', { student_id: 'other-student' }, ENV],
    ['school_slug does not match the user school', 'list_school_restaurants', { school_slug: 'other-school' }, ENV],
    ['school_slug does not match the user school', 'schedule_lunch_menu_item', { school_slug: 'other-school' }, ENV],
    [
      'school_slug does not match the user school',
      'get_school_event',
      { event_id: 'e1', school_slug: 'other-school' },
      ENV,
    ],
    [
      'school_slug cannot be verified for this user',
      'list_school_restaurants',
      { school_slug: 'other-school' },
      {
        ...TEST_ENV,
        PAXAVER_API_CA: contextOverrideBackend({ schoolSlug: '' }),
        PAXAVER_API_US: contextOverrideBackend({ schoolSlug: '' }),
      },
    ],
  ])(
    'ownership rejection %s returns invalid params without calling the tool endpoint',
    async (message, name, args, env) => {
      const res = await postTool(name, args, env);
      const json = (await res.json()) as { error: { code: number; message: string } };
      expect(json.error).toEqual({ code: -32602, message });
      expect(calls.filter((call) => call.path !== '/api/users/me/context')).toEqual([]);
    },
  );
  it('get_lunch_menu hits /api/schools/:slug/menu/daily', async () => {
    const c = await callTool('get_lunch_menu', {});
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/schools/test-school/menu/daily');
  });

  it('get_lunch_menu month queries route to the calendar endpoint', async () => {
    const c = await callTool('get_lunch_menu', { month: '2026-10' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/schools/test-school/menu/daily/calendar');
    expect(c?.query.get('year')).toBe('2026');
    expect(c?.query.get('month')).toBe('10');
  });

  it('schedule_lunch_menu_item posts camelCase to the active school by default', async () => {
    const c = await callTool('schedule_lunch_menu_item', {
      restaurant_id: 'r1',
      menu_item_id: 'm1',
      menu_date: '2026-10-01',
      available_qty: 20,
    });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/schools/test-school/menu/daily');
    expect(c?.body).toEqual({ restaurantId: 'r1', menuItemId: 'm1', menuDate: '2026-10-01', availableQty: 20 });
  });

  it('list_restaurant_menu_items hits /api/restaurants/:id/items', async () => {
    const c = await callTool('list_restaurant_menu_items', { restaurant_id: 'r1' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/restaurants/r1/items');
  });

  it('create_restaurant_menu_item posts camelCase with ingredients as an array', async () => {
    const c = await callTool('create_restaurant_menu_item', {
      restaurant_id: 'r1',
      name: 'Pizza',
      price_cents: 550,
      cost_cents: 300,
      ingredients: ['flour', 'cheese'],
      calories: 700,
    });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/restaurants/r1/items');
    expect(c?.body).toMatchObject({ name: 'Pizza', priceCents: 550, costCents: 300, calories: 700 });
    expect(c?.body?.ingredients).toEqual(['flour', 'cheese']);
  });

  it('update_restaurant_menu_item maps is_active to isActive and drops is_available', async () => {
    const c = await callTool('update_restaurant_menu_item', {
      restaurant_id: 'r1',
      menu_item_id: 'm1',
      price_cents: 600,
      is_active: false,
      is_available: false,
    });
    expect(`${c?.method} ${c?.path}`).toBe('PATCH /api/restaurants/r1/items/m1');
    expect(c?.body).toMatchObject({ priceCents: 600, isActive: false });
    expect(c?.body).not.toHaveProperty('is_available');
    expect(c?.body).not.toHaveProperty('isAvailable');
  });

  it('archive_restaurant_menu_item hits /api/restaurants/:id/items/:item', async () => {
    const c = await callTool('archive_restaurant_menu_item', { restaurant_id: 'r1', menu_item_id: 'm1' });
    expect(`${c?.method} ${c?.path}`).toBe('DELETE /api/restaurants/r1/items/m1');
  });

  it('create_lunch_order_draft posts camelCase body and item fields', async () => {
    const c = await callTool('create_lunch_order_draft', { menu_date: '2026-10-01', items: [draftItem] });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/lunch/orders/draft');
    expect(c?.body).toMatchObject({ studentId: 'student-1', schoolSlug: 'test-school', menuDate: '2026-10-01' });
    expect(c?.body?.items).toEqual([draftItemCamel]);
  });

  it('update_lunch_order_draft maps item fields to camelCase', async () => {
    const c = await callTool('update_lunch_order_draft', { order_id: 'o1', items: [draftItem] });
    expect(`${c?.method} ${c?.path}`).toBe('PATCH /api/lunch/orders/o1');
    expect(c?.body?.items).toEqual([draftItemCamel]);
  });

  it('draft tools never forward a client-supplied price, even a negative one (#1951)', async () => {
    const c = await callTool('create_lunch_order_draft', {
      menu_date: '2026-10-01',
      items: [{ menu_item_id: 'item-1', menu_item_name: 'Pizza', price_cents: -5000, quantity: 1 }],
    });
    expect(c?.body?.items).toEqual([{ menuItemId: 'item-1', menuItemName: 'Pizza', quantity: 1 }]);
    expect(JSON.stringify(c?.body)).not.toContain('priceCents');
  });

  it('pay_lunch_order_draft sends tipCents', async () => {
    const c = await callTool('pay_lunch_order_draft', { order_id: 'o1', tip_cents: 100 });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/lunch/orders/o1/finalize');
    expect(c?.body).toEqual({ tipCents: 100, walletOnly: true });
  });

  it('create_school_event posts camelCase to /api/events', async () => {
    const c = await callTool('create_school_event', {
      name: 'Fun Fair',
      event_date: '2026-10-15',
      ticket_price_cents: 500,
      max_capacity: 100,
    });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/events');
    expect(c?.body).toMatchObject({
      schoolSlug: 'test-school',
      name: 'Fun Fair',
      eventDate: '2026-10-15',
      ticketPriceCents: 500,
      maxCapacity: 100,
    });
  });

  it('update_school_event sends only schema fields, snake_case (backend allowedFields)', async () => {
    const c = await callTool('update_school_event', {
      event_id: 'e1',
      ticket_price_cents: 750,
      status: 'completed',
      school_slug: 'test-school',
      created_by: 'someone-else',
    });
    expect(`${c?.method} ${c?.path}`).toBe('PATCH /api/events/e1');
    expect(c?.body).toEqual({ ticket_price_cents: 750, status: 'completed' });
  });

  it('get_school_event hits /api/events/:id/detail with the active school query', async () => {
    const c = await callTool('get_school_event', { event_id: 'e1' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/events/e1/detail');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
  });

  it('get_school_event forwards the selected school for platform admins', async () => {
    const backend = contextOverrideBackend({ isPlatformAdmin: true });
    const env = { ...TEST_ENV, PAXAVER_API_CA: backend, PAXAVER_API_US: backend };
    const c = await callTool('get_school_event', { event_id: 'e1', school_slug: 'other-school' }, {}, env);
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/events/e1/detail');
    expect(c?.query.get('schoolSlug')).toBe('other-school');
  });

  it('get_school_event declares the shift contract sign_up_for_volunteer_shift consumes', () => {
    const event = ALL_TOOLS.find((t) => t.name === 'get_school_event');
    const props = event?.outputSchema?.properties as Record<
      string,
      { items?: { properties?: Record<string, { type?: unknown }> } }
    >;
    expect(props?.shifts?.items?.properties?.id).toMatchObject({ type: 'string' });
    expect(props?.mySignups?.items?.properties?.signupId).toMatchObject({ type: 'string' });
    const signup = ALL_TOOLS.find((t) => t.name === 'sign_up_for_volunteer_shift');
    expect(signup?.description).toContain('get_school_event');
    expect(JSON.stringify(signup?.inputSchema)).not.toContain('notes');
  });

  it('a shift id returned by get_school_event feeds sign_up_for_volunteer_shift', async () => {
    const detail = {
      id: 'e1',
      schoolSlug: 'test-school',
      name: 'Fun Fair',
      eventDate: '2026-10-15',
      shifts: [
        {
          id: 'shift-7',
          title: 'Setup crew',
          description: null,
          shiftDate: '2026-10-15',
          startTime: '17:00',
          endTime: '19:00',
          slots: 4,
          filled: 1,
          status: 'open',
        },
      ],
      mySignups: [],
    };
    const detailBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/api/events/e1/detail') {
          return Response.json({ data: detail });
        }
        return recordingBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: detailBackend, PAXAVER_API_US: detailBackend };

    const res = await postTool('get_school_event', { event_id: 'e1' }, env);
    const json = (await res.json()) as { result: { structuredContent: { shifts: { id: string }[] } } };
    const shiftId = json.result.structuredContent.shifts[0]?.id;
    expect(shiftId).toBe('shift-7');

    const c = await callTool('sign_up_for_volunteer_shift', { shift_id: shiftId }, {}, env);
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/volunteers/signups');
    expect(c?.body).toEqual({ shiftId: 'shift-7' });
  });

  it('sign_up_for_volunteer_shift sends shiftId', async () => {
    const c = await callTool('sign_up_for_volunteer_shift', { shift_id: 's1', notes: 'not a declared input' });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/volunteers/signups');
    expect(c?.body).toEqual({ shiftId: 's1' });
  });

  it('create_school_restaurant uses the active school in path and body by default', async () => {
    const c = await callTool('create_school_restaurant', { name: 'Cafe', tax_percent: 5 });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/schools/test-school/restaurants');
    expect(c?.body).toMatchObject({ schoolSlug: 'test-school', name: 'Cafe', taxPercent: 5 });
  });

  it('platform admins use the selected school consistently for restaurant creation and menu scheduling', async () => {
    expect(
      ALL_TOOLS.find((tool) => tool.name === 'schedule_lunch_menu_item')?.inputSchema.properties.school_slug,
    ).toEqual({
      type: 'string',
      description: 'School slug (defaults to active school)',
    });
    const backend = contextOverrideBackend({ isPlatformAdmin: true });
    const env = { ...TEST_ENV, PAXAVER_API_CA: backend, PAXAVER_API_US: backend };

    const restaurant = await callTool(
      'create_school_restaurant',
      { school_slug: 'other-school', name: 'Cafe' },
      {},
      env,
    );
    expect(restaurant?.path).toBe('/api/schools/other-school/restaurants');
    expect(restaurant?.body?.schoolSlug).toBe('other-school');

    const menu = await callTool(
      'schedule_lunch_menu_item',
      { school_slug: 'other-school', restaurant_id: 'r1', menu_item_id: 'm1', menu_date: '2026-10-01' },
      {},
      env,
    );
    expect(menu?.path).toBe('/api/schools/other-school/menu/daily');
    expect(menu?.body).toEqual({ restaurantId: 'r1', menuItemId: 'm1', menuDate: '2026-10-01' });
  });

  it('list_my_lunch_orders sends studentId and date range', async () => {
    const c = await callTool('list_my_lunch_orders', { student_id: 'student-1', menu_date: '2026-10-01' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/lunch/orders');
    expect(c?.query.get('studentId')).toBe('student-1');
    expect(c?.query.get('start')).toBe('2026-10-01');
    expect(c?.query.get('end')).toBe('2026-10-01');
  });

  it('order tools stay under /api/lunch/orders', async () => {
    const c = await callTool('list_my_lunch_orders', {});
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/lunch/orders');
  });

  it('pay_lunch_order_draft requests wallet-only finalize and never advertises paymentUrl (#988)', async () => {
    const c = await callTool('pay_lunch_order_draft', { order_id: 'o1', tip_cents: 100 });
    expect(c?.body).toEqual({ tipCents: 100, walletOnly: true });

    const { ALL_TOOLS } = await import('../src/schemas.js');
    const tool = ALL_TOOLS.find((t) => t.name === 'pay_lunch_order_draft');
    const props = tool?.outputSchema?.properties as Record<string, unknown>;
    expect(props.orderId).toBeDefined();
    expect(props.paymentUrl).toBeUndefined();
    expect(JSON.stringify(tool)).not.toContain('paymentUrl');
  });

  it('insufficient wallet balance returns top-up guidance, not a payment link (#988)', async () => {
    const insufficientBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        const url = new URL(req.url);
        if (url.pathname === '/api/lunch/orders/o1/finalize') {
          return new Response(JSON.stringify({ error: '0XEC9798CDD8: Insufficient balance' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'pay_lunch_order_draft', arguments: { order_id: 'o1' } },
        }),
      },
      { ...TEST_ENV, PAXAVER_API_CA: insufficientBackend, PAXAVER_API_US: insufficientBackend },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { error: { code: number; message: string } };
    expect(json.error.message).toContain('top up');
    expect(json.error.message).not.toContain('paymentUrl');
  });

  it('a 200 awaiting_payment split response never relays paymentUrl (#988)', async () => {
    const splitBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        const url = new URL(req.url);
        if (url.pathname === '/api/lunch/orders/o1/finalize') {
          return new Response(
            JSON.stringify({
              data: {
                orderId: 'o1',
                status: 'awaiting_payment',
                itemTotalCents: 1200,
                tipCents: 0,
                paymentUrl: 'https://checkout.stripe.com/c/pay/test-session',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'pay_lunch_order_draft', arguments: { order_id: 'o1' } },
        }),
      },
      { ...TEST_ENV, PAXAVER_API_CA: splitBackend, PAXAVER_API_US: splitBackend },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect((json as { error?: { message: string } }).error?.message).toContain('top up');
    expect(JSON.stringify(json)).not.toContain('checkout.stripe.com');
  });
});

describe('idempotency key (#2241)', () => {
  const args = { order_id: 'o1', tip_cents: 100 };

  it('a resent call in the same session gets the same key', async () => {
    const a = await callTool('pay_lunch_order_draft', args, { id: 7, sessionId: 's-1' });
    const b = await callTool('pay_lunch_order_draft', { tip_cents: 100, order_id: 'o1' }, { id: 7, sessionId: 's-1' });
    expect(a?.idempotencyKey).toMatch(/^mcp-pay_lunch_order_draft-[0-9a-f]{64}$/);
    expect(b?.idempotencyKey).toBe(a?.idempotencyKey);
  });

  it('a new JSON-RPC id, session or argument gives a new key', async () => {
    const base = (await callTool('pay_lunch_order_draft', args, { id: 7, sessionId: 's-1' }))?.idempotencyKey;
    const otherId = (await callTool('pay_lunch_order_draft', args, { id: 8, sessionId: 's-1' }))?.idempotencyKey;
    const otherSession = (await callTool('pay_lunch_order_draft', args, { id: 7, sessionId: 's-2' }))?.idempotencyKey;
    const otherArgs = (
      await callTool('pay_lunch_order_draft', { ...args, tip_cents: 101 }, { id: 7, sessionId: 's-1' })
    )?.idempotencyKey;
    expect(new Set([base, otherId, otherSession, otherArgs]).size).toBe(4);
  });

  it('without a session id, two requests never share a key', async () => {
    const a = (await callTool('pay_lunch_order_draft', args))?.idempotencyKey;
    const b = (await callTool('pay_lunch_order_draft', args))?.idempotencyKey;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('non-Latin-1 arguments give a valid header value', async () => {
    const c = await callTool(
      'create_school_event',
      { name: 'Fête 🎉 '.repeat(40), event_date: '2026-10-15' },
      { sessionId: 's-1' },
    );
    expect(c?.path).toBe('/api/events');
    expect(c?.idempotencyKey).toMatch(/^mcp-create_school_event-[0-9a-f]{64}$/);
  });

  it('read-only tools send no key', async () => {
    const c = await callTool('get_my_wallet_balance', {}, { sessionId: 's-1' });
    expect(c?.idempotencyKey).toBeNull();
  });
});
