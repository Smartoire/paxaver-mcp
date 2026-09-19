/**
 * Tool → backend path mapping. Asserts the exact backend route each tool
 * proxies to — the /api/lunch prefix bug (#912) sent menu tools to routes
 * that do not exist (backend 404 → JSON-RPC dispatch-error), and only a
 * path-level check catches that class of regression.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { FULL_TOKEN, TEST_ENV, backendCalls } from './jwt-auth.js';

async function callTool(name: string, args: Record<string, unknown>) {
  backendCalls.length = 0;
  const res = await app.request(
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FULL_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    },
    TEST_ENV,
  );
  expect(res.status).toBe(200);
  return backendCalls.filter((c) => !c.includes('/api/users/me/context')).at(-1);
}

describe('tool → backend path mapping', () => {
  it('get_menu hits /api/schools/:slug/menu/daily', async () => {
    expect(await callTool('get_menu', {})).toBe('GET /api/schools/test-school/menu/daily');
  });

  it('get_menu month queries route to the calendar endpoint', async () => {
    expect(await callTool('get_menu', { month: '2026-10' })).toBe('GET /api/schools/test-school/menu/daily/calendar');
  });

  it('set_daily_menu hits /api/schools/:slug/menu/daily', async () => {
    expect(await callTool('set_daily_menu', { restaurant_id: 'r1', menu_item_id: 'm1', menu_date: '2026-10-01' })).toBe(
      'POST /api/schools/test-school/menu/daily',
    );
  });

  it('list_menu_items hits /api/restaurants/:id/items', async () => {
    expect(await callTool('list_menu_items', { restaurant_id: 'r1' })).toBe('GET /api/restaurants/r1/items');
  });

  it('create_menu_item hits /api/restaurants/:id/items', async () => {
    expect(await callTool('create_menu_item', { restaurant_id: 'r1', name: 'Pizza' })).toBe(
      'POST /api/restaurants/r1/items',
    );
  });

  it('update_menu_item hits /api/restaurants/:id/items/:item', async () => {
    expect(await callTool('update_menu_item', { restaurant_id: 'r1', menu_item_id: 'm1' })).toBe(
      'PATCH /api/restaurants/r1/items/m1',
    );
  });

  it('delete_menu_item hits /api/restaurants/:id/items/:item', async () => {
    expect(await callTool('delete_menu_item', { restaurant_id: 'r1', menu_item_id: 'm1' })).toBe(
      'DELETE /api/restaurants/r1/items/m1',
    );
  });

  it('order tools stay under /api/lunch/orders', async () => {
    expect(await callTool('get_orders', {})).toBe('GET /api/lunch/orders');
  });
});
