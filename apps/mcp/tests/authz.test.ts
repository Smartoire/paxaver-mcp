/**
 * Authorization policy tests: capability table, role gating, tool visibility.
 */

import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from '../src/schemas.js';
import { canSeeTool, checkToolAuthorization, TOOL_POLICIES, getToolPolicy } from '../src/lib/policies.js';

const RETIRED_TOOLS = [
  'order_lunch',
  'cancel_order',
  'create_draft_order',
  'finalize_order',
  'update_draft_order',
  'discard_draft_order',
  'create_event',
  'update_event',
  'cancel_event',
  'register_event',
  'cancel_event_registration',
  'sign_up_to_volunteer',
  'cancel_volunteer_signup',
  'create_menu_item',
  'update_menu_item',
  'delete_menu_item',
];

describe('Authorization policy', () => {
  it('every tool in the registry has a policy entry', () => {
    for (const tool of ALL_TOOLS) {
      expect(TOOL_POLICIES[tool.name], `missing policy for ${tool.name}`).toBeDefined();
    }
  });

  it('every policy entry corresponds to a registered tool', () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    for (const name of Object.keys(TOOL_POLICIES)) {
      expect(names.has(name), `stale policy for ${name}`).toBe(true);
    }
  });

  it('retired tool names are gone from registry and policies', () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    for (const name of RETIRED_TOOLS) {
      expect(names.has(name), `${name} still registered`).toBe(false);
      expect(TOOL_POLICIES[name], `${name} still has a policy`).toBeUndefined();
    }
  });

  it('admin tools are hidden from non-admin users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(false);
    expect(canSeeTool('manage_menu_item', ctx)).toBe(false);
    expect(canSeeTool('manage_event', ctx)).toBe(false);
  });

  it('admin tools are visible to pac_cordinator', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['pac_cordinator'] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(true);
    expect(canSeeTool('manage_menu_item', ctx)).toBe(true);
    expect(canSeeTool('manage_event', ctx)).toBe(true);
  });

  it('menu admin tools are visible to lunch_cordinator but not events', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['lunch_cordinator'] };
    expect(canSeeTool('manage_menu_item', ctx)).toBe(true);
    expect(canSeeTool('set_daily_menu', ctx)).toBe(true);
    expect(canSeeTool('manage_event', ctx)).toBe(false);
  });

  it('read tools are visible to all authenticated users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('get_user_info', ctx)).toBe(true);
    expect(canSeeTool('get_wallet_balance', ctx)).toBe(true);
    expect(canSeeTool('get_menu', ctx)).toBe(true);
  });

  it('platform admin sees all tools', () => {
    const ctx = { isPlatformAdmin: true, permissions: [] };
    expect(canSeeTool('create_restaurant', ctx)).toBe(true);
    expect(canSeeTool('manage_menu_item', ctx)).toBe(true);
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
    expect(getToolPolicy('order')?.financial).toBe(true);
    expect(getToolPolicy('order')?.requiresConfirmation).toBe(true);
    expect(getToolPolicy('draft_order')?.financial).toBe(true);
    expect(getToolPolicy('event_registration')?.financial).toBe(true);
  });

  it('merged lifecycle tools are marked destructive', () => {
    expect(getToolPolicy('manage_menu_item')?.destructive).toBe(true);
    expect(getToolPolicy('manage_event')?.destructive).toBe(true);
    expect(getToolPolicy('draft_order')?.destructive).toBe(true);
    expect(getToolPolicy('order')?.destructive).toBe(true);
    expect(getToolPolicy('volunteer_signup')?.destructive).toBe(true);
  });

  it('read tools are not mutating', () => {
    expect(getToolPolicy('get_user_info')?.mutates).toBe(false);
    expect(getToolPolicy('get_wallet_balance')?.mutates).toBe(false);
    expect(getToolPolicy('get_menu')?.mutates).toBe(false);
  });

  it('unknown tool returns "unknown_tool"', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(checkToolAuthorization('nonexistent_tool', ctx)).toBe('unknown_tool');
  });
});
