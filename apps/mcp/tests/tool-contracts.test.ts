/**
 * Tool → backend contract tests (#916/#921): asserts the exact path AND the
 * JSON body/query keys each tool sends to the Paxaver backend. The
 * backend mounts menu/daily and restaurant-item routes under /api —
 * not /api/lunch — and its validators take camelCase fields; passing
 * snake_case args through verbatim 400s or silently drops fields.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { FULL_TOKEN, TEST_ENV, mockBackend } from './jwt-auth.js';

interface BackendCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
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
    calls.push({ method: req.method, path: url.pathname, query: url.searchParams, body });
    return mockBackend.fetch(req);
  },
};

const ENV = { ...TEST_ENV, PAXAVER_API_CA: recordingBackend, PAXAVER_API_US: recordingBackend };

async function callTool(name: string, args: Record<string, unknown>) {
  calls.length = 0;
  const res = await app.request(
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    },
    ENV,
  );
  expect(res.status).toBe(200);
  return calls.filter((c) => c.path !== '/api/users/me/context').at(-1);
}

const draftItem = { menu_item_id: 'item-1', menu_item_name: 'Pizza', price_cents: 550, quantity: 2 };
const draftItemCamel = { menuItemId: 'item-1', menuItemName: 'Pizza', priceCents: 550, quantity: 2 };

describe('tool → backend contract', () => {
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

  it('schedule_lunch_menu_item posts camelCase to /api/schools/:slug/menu/daily', async () => {
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

  it('pay_lunch_order_draft sends tipCents', async () => {
    const c = await callTool('pay_lunch_order_draft', { order_id: 'o1', tip_cents: 100 });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/lunch/orders/o1/finalize');
    expect(c?.body).toEqual({ tipCents: 100 });
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

  it('update_school_event passes snake_case args through (backend allowedFields)', async () => {
    const c = await callTool('update_school_event', { event_id: 'e1', ticket_price_cents: 750 });
    expect(`${c?.method} ${c?.path}`).toBe('PATCH /api/events/e1');
    expect(c?.body).toMatchObject({ ticket_price_cents: 750 });
  });

  it('sign_up_for_volunteer_shift sends shiftId', async () => {
    const c = await callTool('sign_up_for_volunteer_shift', { shift_id: 's1' });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/volunteers/signups');
    expect(c?.body).toMatchObject({ shiftId: 's1' });
  });

  it('create_school_restaurant sends schoolSlug and taxPercent', async () => {
    const c = await callTool('create_school_restaurant', { name: 'Cafe', tax_percent: 5 });
    expect(`${c?.method} ${c?.path}`).toBe('POST /api/schools/test-school/restaurants');
    expect(c?.body).toMatchObject({ schoolSlug: 'test-school', name: 'Cafe', taxPercent: 5 });
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
});
