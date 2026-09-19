/**
 * Consolidated lifecycle tools (#921): every `action` must dispatch to the
 * correct backend route with an explicitly mapped (camelCase) body, and
 * missing/invalid action inputs must return JSON-RPC -32602.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index.js';
import { FULL_TOKEN, TEST_ENV, backendCalls } from './jwt-auth.js';

let nextId = 100;
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await app.request(
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
    },
    TEST_ENV,
  );
  return (await res.json()) as unknown as {
    result?: { structuredContent: unknown };
    error?: { code: number; message: string };
  };
}

/** Last backend call, excluding auth-context lookups. */
function lastBackendCall() {
  const api = backendCalls.filter((c) => c.path !== '/api/users/me/context');
  const call = api[api.length - 1];
  if (!call) throw new Error('expected a backend call, none recorded');
  return call;
}

beforeEach(() => {
  backendCalls.length = 0;
});

describe('draft_order', () => {
  it('create maps items to camelCase and defaults student/school', async () => {
    const res = await callTool('draft_order', {
      action: 'create',
      menu_date: '2099-01-15',
      items: [{ menu_item_id: 'mi-1', menu_item_name: 'Pizza', price_cents: 450, quantity: 2 }],
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/lunch/orders/draft');
    expect(call.body).toEqual({
      studentId: 'student-1',
      schoolSlug: 'test-school',
      menuDate: '2099-01-15',
      items: [{ menuItemId: 'mi-1', menuItemName: 'Pizza', priceCents: 450, quantity: 2 }],
    });
  });

  it('update sends mapped items to PATCH /api/lunch/orders/:id', async () => {
    const res = await callTool('draft_order', {
      action: 'update',
      order_id: 'ord-1',
      items: [{ menu_item_id: 'mi-2', menu_item_name: 'Soup', price_cents: 300, quantity: 1 }],
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/api/lunch/orders/ord-1');
    expect((call.body as Record<string, unknown>).items).toEqual([
      { menuItemId: 'mi-2', menuItemName: 'Soup', priceCents: 300, quantity: 1 },
    ]);
  });

  it('discard sends DELETE /api/lunch/orders/:id', async () => {
    const res = await callTool('draft_order', { action: 'discard', order_id: 'ord-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/api/lunch/orders/ord-1');
  });

  it('finalize sends tipCents, not tip_cents', async () => {
    const res = await callTool('draft_order', { action: 'finalize', order_id: 'ord-1', tip_cents: 200 });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/lunch/orders/ord-1/finalize');
    expect(call.body).toEqual({ tipCents: 200 });
  });

  it('create without items returns -32602', async () => {
    const res = await callTool('draft_order', { action: 'create', menu_date: '2099-01-15' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('items');
  });

  it('finalize without order_id returns -32602', async () => {
    const res = await callTool('draft_order', { action: 'finalize' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('order_id');
  });

  it('unknown action returns -32602', async () => {
    const res = await callTool('draft_order', { action: 'explode', order_id: 'ord-1' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('action');
  });
});

describe('order', () => {
  it('place maps to POST /api/lunch/orders with camelCase body', async () => {
    const res = await callTool('order', {
      action: 'place',
      menu_item_id: 'mi-1',
      menu_date: '2099-01-15',
      quantity: 2,
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/lunch/orders');
    expect(call.body).toEqual({ studentId: 'student-1', menuItemId: 'mi-1', menuDate: '2099-01-15', quantity: 2 });
  });

  it('cancel maps to POST /api/lunch/orders/:id/cancel', async () => {
    const res = await callTool('order', { action: 'cancel', order_id: 'ord-9' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/lunch/orders/ord-9/cancel');
  });

  it('place without menu_item_id returns -32602', async () => {
    const res = await callTool('order', { action: 'place', menu_date: '2099-01-15' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('menu_item_id');
  });

  it('unknown action returns -32602', async () => {
    const res = await callTool('order', { action: 'refund', order_id: 'ord-9' });
    expect(res.error?.code).toBe(-32602);
  });
});

describe('manage_event', () => {
  it('create maps snake_case args to camelCase body', async () => {
    const res = await callTool('manage_event', {
      action: 'create',
      name: 'Fun Fair',
      event_date: '2099-03-01',
      starts_at: '10:00',
      ends_at: '14:00',
      max_capacity: 100,
      ticket_price_cents: 500,
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/events');
    expect(call.body).toMatchObject({
      schoolSlug: 'test-school',
      name: 'Fun Fair',
      eventDate: '2099-03-01',
      startsAt: '10:00',
      endsAt: '14:00',
      maxCapacity: 100,
      ticketPriceCents: 500,
    });
  });

  it('update passes snake_case fields through (backend reads snake_case)', async () => {
    const res = await callTool('manage_event', {
      action: 'update',
      event_id: 'ev-1',
      name: 'Renamed',
      max_capacity: 50,
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/api/events/ev-1');
    expect(call.body).toEqual({ name: 'Renamed', max_capacity: 50 });
  });

  it('cancel maps to POST /api/events/:id/cancel', async () => {
    const res = await callTool('manage_event', { action: 'cancel', event_id: 'ev-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/events/ev-1/cancel');
  });

  it('create without event_date returns -32602', async () => {
    const res = await callTool('manage_event', { action: 'create', name: 'Fun Fair' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('event_date');
  });

  it('update without event_id returns -32602', async () => {
    const res = await callTool('manage_event', { action: 'update', name: 'x' });
    expect(res.error?.code).toBe(-32602);
  });
});

describe('event_registration', () => {
  it('register maps to POST /api/events/:id/register', async () => {
    const res = await callTool('event_registration', { action: 'register', event_id: 'ev-1', quantity: 2 });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/events/ev-1/register');
    expect(call.body).toEqual({ quantity: 2 });
  });

  it('cancel maps to POST /api/events/tickets/:id/cancel', async () => {
    const res = await callTool('event_registration', { action: 'cancel', ticket_id: 't-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/events/tickets/t-1/cancel');
  });

  it('cancel without ticket_id returns -32602', async () => {
    const res = await callTool('event_registration', { action: 'cancel' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('ticket_id');
  });
});

describe('volunteer_signup', () => {
  it('signup sends shiftId, not shift_id', async () => {
    const res = await callTool('volunteer_signup', { action: 'signup', shift_id: 'sh-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/volunteers/signups');
    expect(call.body).toMatchObject({ shiftId: 'sh-1' });
  });

  it('cancel maps to POST /api/volunteers/signups/:id/cancel', async () => {
    const res = await callTool('volunteer_signup', { action: 'cancel', signup_id: 'su-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/volunteers/signups/su-1/cancel');
  });

  it('signup without shift_id returns -32602', async () => {
    const res = await callTool('volunteer_signup', { action: 'signup' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('shift_id');
  });
});

describe('manage_menu_item', () => {
  it('create maps camelCase body to /api/restaurants/:id/items', async () => {
    const res = await callTool('manage_menu_item', {
      action: 'create',
      restaurant_id: 'r-1',
      name: 'Taco',
      price_cents: 600,
      ingredients: ['tortilla', 'beans'],
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/restaurants/r-1/items');
    expect(call.body).toMatchObject({ name: 'Taco', priceCents: 600, ingredients: ['tortilla', 'beans'] });
    expect(call.body).not.toHaveProperty('price_cents');
  });

  it('update maps to PATCH /api/restaurants/:r/items/:i and drops is_available', async () => {
    const res = await callTool('manage_menu_item', {
      action: 'update',
      restaurant_id: 'r-1',
      menu_item_id: 'i-1',
      price_cents: 700,
      is_active: false,
    });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/api/restaurants/r-1/items/i-1');
    expect(call.body).toMatchObject({ priceCents: 700, isActive: false });
    expect(call.body).not.toHaveProperty('is_available');
  });

  it('delete maps to DELETE /api/restaurants/:r/items/:i', async () => {
    const res = await callTool('manage_menu_item', { action: 'delete', restaurant_id: 'r-1', menu_item_id: 'i-1' });
    expect(res.error).toBeUndefined();
    const call = lastBackendCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/api/restaurants/r-1/items/i-1');
  });

  it('delete without menu_item_id returns -32602', async () => {
    const res = await callTool('manage_menu_item', { action: 'delete', restaurant_id: 'r-1' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('menu_item_id');
  });

  it('path injection in menu_item_id returns -32602', async () => {
    const res = await callTool('manage_menu_item', { action: 'delete', restaurant_id: 'r-1', menu_item_id: '../x' });
    expect(res.error?.code).toBe(-32602);
  });
});
