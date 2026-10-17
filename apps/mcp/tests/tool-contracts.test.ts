/**
 * Tool → backend contract tests: asserts the exact path AND the
 * JSON body/query keys each tool sends to the Paxaver backend. The
 * backend mounts menu/daily and restaurant-item routes under /api —
 * not /api/lunch — and its validators take camelCase fields; passing
 * snake_case args through verbatim 400s or silently drops fields.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { request } from './request.js';
import { FULL_TOKEN, EVENT_COORDINATOR_TOKEN, TEST_ENV, mockBackend } from './jwt-auth.js';
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

async function postTool(
  name: string,
  args: Record<string, unknown>,
  env = ENV,
  { id = 1, sessionId = '', token = FULL_TOKEN } = {},
) {
  calls.length = 0;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
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
// price_cents must never be forwarded.
const draftItemCamel = { menuItemId: 'item-1', menuItemName: 'Pizza', quantity: 2 };

describe('tool → backend contract', () => {
  it('caps register_for_event quantity at 20 in its input schema', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'register_for_event');
    expect(tool?.inputSchema.properties.quantity).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 20,
    });
  });

  it('pins idempotentHint for every advertised tool', () => {
    const expected: Record<string, boolean | undefined> = {
      get_my_context: undefined,
      sign_out: true,
      get_my_wallet_balance: undefined,
      list_my_wallet_transactions: true,
      list_my_lunch_orders: undefined,
      get_lunch_menu: undefined,
      create_lunch_order_draft: false,
      pay_lunch_order_draft: false,
      update_lunch_order_draft: true,
      discard_lunch_order_draft: true,
      cancel_my_lunch_order: false,
      list_school_events: undefined,
      get_school_event: true,
      list_event_attendees: true,
      create_school_event: false,
      update_school_event: true,
      cancel_school_event: false,
      check_in_event_ticket: false,
      register_for_event: false,
      list_my_event_registrations: true,
      cancel_my_event_registration: false,
      list_my_volunteer_signups: true,
      cancel_my_volunteer_signup: true,
      sign_up_for_volunteer_shift: false,
      create_volunteer_shift: false,
      list_school_programs: true,
      register_for_program: false,
      list_program_registrations: true,
      cancel_program_registration: false,
      admit_program_registration: false,
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

  it('draft tools never forward a client-supplied price, even a negative one', async () => {
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

  it('pay_lunch_order_draft requests wallet-only finalize and never advertises paymentUrl', async () => {
    const c = await callTool('pay_lunch_order_draft', { order_id: 'o1', tip_cents: 100 });
    expect(c?.body).toEqual({ tipCents: 100, walletOnly: true });

    const { ALL_TOOLS } = await import('../src/schemas.js');
    const tool = ALL_TOOLS.find((t) => t.name === 'pay_lunch_order_draft');
    const props = tool?.outputSchema?.properties as Record<string, unknown>;
    expect(props.orderId).toBeDefined();
    expect(props.paymentUrl).toBeUndefined();
    expect(JSON.stringify(tool)).not.toContain('paymentUrl');
  });

  it('insufficient wallet balance returns top-up guidance, not a payment link', async () => {
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
    expect(json.error.message).toContain('/wallet/top-up');
    expect(json.error.message).not.toContain('paymentUrl');
  });

  it('a 200 awaiting_payment split response never relays paymentUrl', async () => {
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
    expect((json as { error?: { message: string } }).error?.message).toContain('/wallet/top-up');
    expect(JSON.stringify(json)).not.toContain('checkout.stripe.com');
  });

  it('list_my_wallet_transactions hits /api/wallet/transactions with safe filters only', async () => {
    const c = await callTool('list_my_wallet_transactions', {
      student_id: 'student-1',
      type: 'payment',
      status: 'completed',
      start: '2026-09-01',
      end: '2026-09-30',
      per_page: 25,
      cursor: 'cur-1',
    });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/wallet/transactions');
    expect(c?.query.get('studentId')).toBe('student-1');
    expect(c?.query.get('type')).toBe('payment');
    expect(c?.query.get('status')).toBe('completed');
    expect(c?.query.get('start')).toBe('2026-09-01');
    expect(c?.query.get('end')).toBe('2026-09-30');
    expect(c?.query.get('perPage')).toBe('25');
    expect(c?.query.get('cursor')).toBe('cur-1');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.query.get('all')).toBeNull();
    expect(c?.body).toBeUndefined();
  });

  it('all_schools suppresses the school pin — the backend treats schoolSlug as an explicit scope', async () => {
    const c = await callTool('list_my_wallet_transactions', { all_schools: true });
    expect(c?.query.get('all')).toBe('1');
    expect(c?.query.get('schoolSlug')).toBeNull();
  });

  it('list_my_wallet_transactions allowlists fields, folds pagination, and adds the regional top-up URL', async () => {
    const txBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/api/wallet/transactions') {
          return Response.json({
            data: {
              transactions: [
                {
                  id: 'tx-1',
                  type: 'payment',
                  amountCents: -550,
                  balanceBeforeCents: 2000,
                  balanceAfterCents: 1450,
                  description: 'Lunch order',
                  paymentMethod: 'wallet',
                  status: 'completed',
                  createdAt: '2026-09-10T12:00:00Z',
                  updatedAt: '2026-09-10T12:00:00Z',
                  schoolSlug: 'test-school',
                  schoolName: 'Test School',
                  currency: 'CAD',
                  walletId: 'wallet-internal-1',
                  referenceId: 'cs_test_stripe_session',
                  cardFingerprint: 'fp_123',
                },
              ],
            },
            pagination: { perPage: 50, nextCursor: 'nc-2', hasMore: true },
          });
        }
        return recordingBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: txBackend, PAXAVER_API_US: txBackend };
    const res = await postTool('list_my_wallet_transactions', {}, env);
    const json = (await res.json()) as {
      result: { structuredContent: Record<string, unknown> };
    };
    const out = json.result.structuredContent;
    const rows = out.transactions as Record<string, unknown>[];
    expect(rows[0]).toEqual({
      id: 'tx-1',
      type: 'payment',
      amountCents: -550,
      balanceBeforeCents: 2000,
      balanceAfterCents: 1450,
      description: 'Lunch order',
      paymentMethod: 'wallet',
      status: 'completed',
      createdAt: '2026-09-10T12:00:00Z',
      updatedAt: '2026-09-10T12:00:00Z',
      schoolSlug: 'test-school',
      schoolName: 'Test School',
      currency: 'CAD',
    });
    expect(JSON.stringify(rows)).not.toContain('wallet-internal-1');
    expect(JSON.stringify(rows)).not.toContain('cs_test_');
    expect(JSON.stringify(rows)).not.toContain('fp_123');
    expect(out.nextCursor).toBe('nc-2');
    expect(out.hasMore).toBe(true);
    expect(out.topUpUrl).toBe('http://localhost:8787/wallet/top-up');
  });

  it('get_my_wallet_balance returns the regional static top-up page', async () => {
    const res = await postTool('get_my_wallet_balance', {});
    const json = (await res.json()) as {
      result: { structuredContent: { topUpUrl?: string } };
    };
    expect(json.result.structuredContent.topUpUrl).toBe('http://localhost:8787/wallet/top-up');
  });

  it('register_for_event maps to the paid /register route with an idempotency key', async () => {
    const c = await callTool('register_for_event', { event_id: 'e1', quantity: 2 });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/events/e1/register');
    expect(c?.body).toEqual({ quantity: 2, school_slug: 'test-school' });
    expect(c?.idempotencyKey).toMatch(/^mcp-register_for_event-[0-9a-f]{64}$/);
    const policy = ALL_TOOLS.find((t) => t.name === 'register_for_event');
    expect(policy).toBeDefined();
  });

  it('register_for_event insufficient funds returns the top-up URL, never a payment link', async () => {
    const insufficientBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        if (new URL(req.url).pathname === '/api/events/e1/register') {
          return new Response(
            JSON.stringify({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient balance' } }),
            {
              status: 422,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return mockBackend.fetch(req);
      },
    };
    const res = await postTool(
      'register_for_event',
      { event_id: 'e1' },
      { ...TEST_ENV, PAXAVER_API_CA: insufficientBackend, PAXAVER_API_US: insufficientBackend },
    );
    const json = (await res.json()) as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32602);
    expect(json.error.message).toContain('http://localhost:8787/wallet/top-up');
    expect(json.error.message).not.toContain('checkout.stripe.com');
  });

  it('list_event_attendees hits /api/events/:id/tickets and strips contact and payment fields', async () => {
    const attendeeBackend = {
      async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
        const req = typeof request === 'string' ? new Request(request, init) : request;
        const url = new URL(req.url);
        if (url.pathname === '/api/events/e1/tickets') {
          calls.push({
            method: req.method,
            path: url.pathname,
            query: url.searchParams,
            body: undefined,
            idempotencyKey: req.headers.get('Idempotency-Key'),
          });
          return Response.json({
            data: [
              {
                id: 't1',
                eventId: 'e1',
                userId: 'user-other',
                email: 'parent@example.com',
                firstName: 'Ana',
                lastName: 'Lee',
                quantity: 2,
                totalCents: 1000,
                status: 'paid',
                checkedInAt: null,
                createdAt: '2026-09-01T10:00:00Z',
              },
            ],
            pagination: { perPage: 50, nextCursor: null, hasMore: false },
          });
        }
        return recordingBackend.fetch(req);
      },
    };
    const env = { ...TEST_ENV, PAXAVER_API_CA: attendeeBackend, PAXAVER_API_US: attendeeBackend };
    const res = await postTool('list_event_attendees', { event_id: 'e1', per_page: 10, offset: 5 }, env, {
      token: EVENT_COORDINATOR_TOKEN,
    });
    const call = calls.filter((c) => c.path !== '/api/users/me/context').at(-1);
    expect(`${call?.method} ${call?.path}`).toBe('GET /api/events/e1/tickets');
    expect(call?.query.get('schoolSlug')).toBe('test-school');
    expect(call?.query.get('perPage')).toBe('10');
    expect(call?.query.get('offset')).toBe('5');
    const json = (await res.json()) as {
      result: { structuredContent: { attendees: Record<string, unknown>[]; hasMore: boolean } };
    };
    expect(json.result.structuredContent.attendees[0]).toEqual({
      id: 't1',
      eventId: 'e1',
      firstName: 'Ana',
      lastName: 'Lee',
      quantity: 2,
      status: 'paid',
      checkedInAt: null,
    });
    expect(JSON.stringify(json.result.structuredContent)).not.toContain('parent@example.com');
    expect(JSON.stringify(json.result.structuredContent)).not.toContain('user-other');
    expect(JSON.stringify(json.result.structuredContent)).not.toContain('totalCents');
  });

  it('check_in_event_ticket posts to the ticket check-in route with an idempotency key', async () => {
    const c = await callTool('check_in_event_ticket', { ticket_id: 't1' });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/events/tickets/t1/check-in');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.body).toBeUndefined();
    expect(c?.idempotencyKey).toMatch(/^mcp-check_in_event_ticket-[0-9a-f]{64}$/);
  });

  it('create_volunteer_shift posts the camelCase volunteerShiftCreateSchema body', async () => {
    const c = await callTool('create_volunteer_shift', {
      title: 'Setup crew',
      shift_date: '2026-10-15',
      start_time: '17:00',
      end_time: '19:00',
      event_id: 'e1',
      slots: 4,
      description: 'Set up tables',
    });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/volunteers/shifts');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.body).toEqual({
      schoolSlug: 'test-school',
      eventId: 'e1',
      title: 'Setup crew',
      description: 'Set up tables',
      shiftDate: '2026-10-15',
      startTime: '17:00',
      endTime: '19:00',
      slots: 4,
    });
    expect(c?.idempotencyKey).toMatch(/^mcp-create_volunteer_shift-[0-9a-f]{64}$/);
  });

  it('list_school_programs hits /api/programs with the school query', async () => {
    const c = await callTool('list_school_programs', { program_type: 'after_school' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/programs');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.query.get('type')).toBe('after_school');
  });

  it('register_for_program posts camelCase programId/studentId', async () => {
    const c = await callTool('register_for_program', {
      program_id: 'p1',
      student_id: 'student-1',
      notes: 'Peanut allergy',
    });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/programs/registrations');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.body).toEqual({ programId: 'p1', studentId: 'student-1', notes: 'Peanut allergy' });
    expect(c?.idempotencyKey).toMatch(/^mcp-register_for_program-[0-9a-f]{64}$/);
  });

  it('register_for_program rejects a student the caller does not own', async () => {
    const res = await postTool('register_for_program', { program_id: 'p1', student_id: 'other-student' });
    const json = (await res.json()) as { error: { code: number; message: string } };
    expect(json.error).toEqual({ code: -32602, message: 'student_id is not permitted for this user' });
    expect(calls.filter((call) => call.path !== '/api/users/me/context')).toEqual([]);
  });

  it('register_for_program rejects a student when the caller has no linked students', async () => {
    const env = {
      ...TEST_ENV,
      PAXAVER_API_CA: contextOverrideBackend({ studentIds: [] }),
      PAXAVER_API_US: contextOverrideBackend({ studentIds: [] }),
    };
    const res = await postTool('register_for_program', { program_id: 'p1', student_id: 'other-student' }, env);
    const json = (await res.json()) as { error: { code: number; message: string } };
    expect(json.error).toEqual({ code: -32602, message: 'student_id is not permitted for this user' });
    expect(calls.filter((call) => call.path !== '/api/users/me/context')).toEqual([]);
  });

  it('list_program_registrations hits /api/programs/registrations with the optional program filter', async () => {
    const c = await callTool('list_program_registrations', { program_id: 'p1' });
    expect(`${c?.method} ${c?.path}`).toBe('GET /api/programs/registrations');
    expect(c?.query.get('schoolSlug')).toBe('test-school');
    expect(c?.query.get('programId')).toBe('p1');
  });

  it('cancel_program_registration and admit_program_registration post to the registration routes', async () => {
    const cancel = await callTool('cancel_program_registration', { registration_id: 'reg-1' });
    expect(`${cancel?.method} ${cancel?.path}`).toBe('POST /api/programs/registrations/reg-1/cancel');
    expect(cancel?.idempotencyKey).toMatch(/^mcp-cancel_program_registration-[0-9a-f]{64}$/);

    const admit = await callTool('admit_program_registration', { registration_id: 'reg-2' });
    expect(`${admit?.method} ${admit?.path}`).toBe('POST /api/programs/registrations/reg-2/admit');
    expect(admit?.query.get('schoolSlug')).toBe('test-school');
    expect(admit?.idempotencyKey).toMatch(/^mcp-admit_program_registration-[0-9a-f]{64}$/);
  });

  it('pac_cordinator-only program tools are forbidden for an event coordinator', async () => {
    for (const name of ['list_program_registrations', 'admit_program_registration', 'create_volunteer_shift']) {
      const res = await postTool(
        name,
        { registration_id: 'reg-1', title: 'x', shift_date: '2026-10-01', start_time: '09:00', end_time: '10:00' },
        ENV,
        { token: EVENT_COORDINATOR_TOKEN },
      );
      const json = (await res.json()) as { error: { code: number; message: string } };
      expect(json.error.code).toBe(-32603);
      expect(calls.filter((call) => call.path !== '/api/users/me/context')).toEqual([]);
    }
  });

  it('event staff tools are reachable for an event coordinator', async () => {
    const res = await postTool('list_event_attendees', { event_id: 'e1' }, ENV, { token: EVENT_COORDINATOR_TOKEN });
    expect(res.status).toBe(200);
    const call = calls.filter((c) => c.path !== '/api/users/me/context').at(-1);
    expect(call?.path).toBe('/api/events/e1/tickets');
  });
});

describe('idempotency key', () => {
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
