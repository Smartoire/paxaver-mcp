/**
 * Authorization policy tests: capability table, role gating, tool visibility.
 */

import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from '../src/schemas.js';
import {
  canSeeTool,
  checkToolAuthorization,
  resolveToolName,
  TOOL_ALIASES,
  TOOL_POLICIES,
  getToolPolicy,
} from '../src/lib/policies.js';

describe('Authorization policy', () => {
  it('canonical catalog exposes exactly 26 tools, 16 parent-visible', () => {
    expect(ALL_TOOLS.length).toBe(26);
    const parent = { isPlatformAdmin: false, permissions: [] };
    const parentVisible = ALL_TOOLS.filter((t) => canSeeTool(t.name, parent));
    expect(parentVisible.length).toBe(16);
  });

  it('every canonical tool has a policy entry', () => {
    for (const tool of ALL_TOOLS) {
      expect(TOOL_POLICIES[tool.name], `missing policy for ${tool.name}`).toBeDefined();
    }
  });

  it('legacy names are aliases, never catalog entries', () => {
    const catalog = new Set(ALL_TOOLS.map((t) => t.name));
    for (const legacy of Object.keys(TOOL_ALIASES)) {
      expect(catalog.has(legacy), `${legacy} is in the canonical catalog`).toBe(false);
      const canonical = TOOL_ALIASES[legacy];
      expect(canonical, `alias ${legacy} has no target`).toBeDefined();
      expect(TOOL_POLICIES[canonical!], `alias ${legacy} targets a tool without a policy`).toBeDefined();
    }
    // order_lunch is retired from discovery but stays callable (hidden
    // handler + policy) because nothing canonical preserves its
    // immediate-purchase semantics.
    expect(catalog.has('order_lunch')).toBe(false);
    expect(TOOL_ALIASES['order_lunch']).toBeUndefined();
    expect(TOOL_POLICIES['order_lunch']).toBeDefined();
  });

  it('aliases resolve to canonical names', () => {
    expect(resolveToolName('get_menu')).toBe('get_lunch_menu');
    expect(resolveToolName('finalize_order')).toBe('pay_lunch_order_draft');
    expect(resolveToolName('get_lunch_menu')).toBe('get_lunch_menu');
  });

  it('admin tools are hidden from non-admin users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('create_school_restaurant', ctx)).toBe(false);
    expect(canSeeTool('archive_restaurant_menu_item', ctx)).toBe(false);
    expect(canSeeTool('create_school_event', ctx)).toBe(false);
  });

  it('admin tools are visible to pac_cordinator', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['pac_cordinator'] };
    expect(canSeeTool('create_school_restaurant', ctx)).toBe(true);
    expect(canSeeTool('archive_restaurant_menu_item', ctx)).toBe(true);
  });

  it('read tools are visible to all authenticated users', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(canSeeTool('get_my_context', ctx)).toBe(true);
    expect(canSeeTool('get_my_wallet_balance', ctx)).toBe(true);
    expect(canSeeTool('get_lunch_menu', ctx)).toBe(true);
  });

  it('platform admin sees all tools', () => {
    const ctx = { isPlatformAdmin: true, permissions: [] };
    expect(canSeeTool('create_school_restaurant', ctx)).toBe(true);
    expect(canSeeTool('archive_restaurant_menu_item', ctx)).toBe(true);
  });

  it('forbidden tool call returns "forbidden"', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(checkToolAuthorization('create_school_restaurant', ctx)).toBe('forbidden');
  });

  it('authorized tool call returns "ok"', () => {
    const ctx = { isPlatformAdmin: false, permissions: ['pac_cordinator'] };
    expect(checkToolAuthorization('create_school_restaurant', ctx)).toBe('ok');
  });

  it('financial tools are marked financial + require confirmation', () => {
    expect(getToolPolicy('order_lunch')?.financial).toBe(true);
    expect(getToolPolicy('order_lunch')?.requiresConfirmation).toBe(true);
  });

  it('destructive tools are marked destructive', () => {
    expect(getToolPolicy('archive_restaurant_menu_item')?.destructive).toBe(true);
    expect(getToolPolicy('cancel_school_event')?.destructive).toBe(true);
  });

  it('read tools are not mutating', () => {
    expect(getToolPolicy('get_my_context')?.mutates).toBe(false);
    expect(getToolPolicy('get_my_wallet_balance')?.mutates).toBe(false);
    expect(getToolPolicy('get_lunch_menu')?.mutates).toBe(false);
  });

  it('unknown tool returns "unknown_tool"', () => {
    const ctx = { isPlatformAdmin: false, permissions: [] };
    expect(checkToolAuthorization('nonexistent_tool', ctx)).toBe('unknown_tool');
  });
});
