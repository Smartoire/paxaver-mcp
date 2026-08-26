/**
 * Authorization policy tests: capability table, role gating, tool visibility.
 */

import { describe, it, expect } from 'vitest';
import { canSeeTool, checkToolAuthorization, TOOL_POLICIES, getToolPolicy } from '../src/lib/policy.js';

describe('Authorization policy', () => {
  it('every tool has a policy entry', () => {
    const toolNames = [
      'get_user_info',
      'update_student',
      'get_wallet_balance',
      'get_wallet_status',
      'top_up_balance',
      'order_lunch',
      'get_orders',
      'get_daily_menu',
      'get_updates',
      'get_daily_orders',
      'get_monthly_orders',
      'get_upcoming_events',
      'create_event',
      'update_event',
      'cancel_event',
      'list_school_restaurants',
      'create_restaurant',
      'list_menu_items',
      'create_menu_item',
      'update_menu_item',
      'set_menu_item_price',
      'delete_menu_item',
      'set_daily_menu',
    ];
    for (const name of toolNames) {
      expect(TOOL_POLICIES[name], `missing policy for ${name}`).toBeDefined();
    }
  });

  it('admin tools are hidden from non-admin users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(false);
    expect(canSeeTool('delete_menu_item', ctx)).toBe(false);
    expect(canSeeTool('create_event', ctx)).toBe(false);
  });

  it('admin tools are visible to pac_cordinator', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['pac_cordinator'] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(true);
    expect(canSeeTool('delete_menu_item', ctx)).toBe(true);
  });

  it('read tools are visible to all authenticated users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('get_user_info', ctx)).toBe(true);
    expect(canSeeTool('get_wallet_balance', ctx)).toBe(true);
    expect(canSeeTool('get_daily_menu', ctx)).toBe(true);
  });

  it('platform admin sees all tools', () => {
    const ctx = { isPlatformAdmin: true, permissions: [] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(true);
    expect(canSeeTool('delete_menu_item', ctx)).toBe(true);
  });

  it('forbidden tool call returns "forbidden"', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(checkToolAuthorization('create_restaurant', ctx)).toBe('forbidden');
  });

  it('authorized tool call returns "ok"', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['pac_cordinator'] };
    expect(checkToolAuthorization('create_restaurant', ctx)).toBe('ok');
  });

  it('financial tools are marked financial + require confirmation', () => {
    expect(getToolPolicy('top_up_balance')?.financial).toBe(true);
    expect(getToolPolicy('top_up_balance')?.requiresConfirmation).toBe(true);
    expect(getToolPolicy('order_lunch')?.financial).toBe(true);
    expect(getToolPolicy('order_lunch')?.requiresConfirmation).toBe(true);
  });

  it('destructive tools are marked destructive', () => {
    expect(getToolPolicy('delete_menu_item')?.destructive).toBe(true);
    expect(getToolPolicy('cancel_event')?.destructive).toBe(true);
  });

  it('read tools are not mutating', () => {
    expect(getToolPolicy('get_user_info')?.mutates).toBe(false);
    expect(getToolPolicy('get_wallet_balance')?.mutates).toBe(false);
    expect(getToolPolicy('get_daily_menu')?.mutates).toBe(false);
  });

  it('unknown tool returns "unknown_tool"', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(checkToolAuthorization('nonexistent_tool', ctx)).toBe('unknown_tool');
  });
});
