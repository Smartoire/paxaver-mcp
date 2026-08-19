/**
 * Per-tool authorization policy. Every MCP tool has an explicit entry.
 *
 * The MCP server enforces the *interface-level* policy (authentication,
 * role gating for tools/list visibility, confirmation labeling). The
 * *data-level* authorization (school membership, student ownership,
 * entitlement) is enforced by the backend when the MCP server calls it
 * via the service binding. This is defense-in-depth: even if the MCP
 * layer's role check is bypassed, the backend re-checks.
 */

import type { ToolPolicy } from './contracts.js';

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  // --- User/account (read) ---
  get_user_info: {
    capability: 'view_account',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  update_student: {
    capability: 'view_account',
    requiresEntitlement: false,
    classifications: ['WRITE', 'PRIVACY_SENSITIVE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Wallet ---
  get_wallet_balance: {
    capability: 'view_balance',
    requiresEntitlement: false,
    classifications: ['READ', 'PRIVACY_SENSITIVE'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  get_wallet_status: {
    capability: 'view_balance',
    requiresEntitlement: false,
    classifications: ['READ', 'PRIVACY_SENSITIVE'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  add_funds: {
    capability: 'view_balance',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  top_up_balance: {
    capability: 'view_balance',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  donate_to_school: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Orders ---
  order_lunch: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  get_orders: {
    capability: 'view_orders',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  get_daily_menu: {
    capability: 'view_menu',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  get_published_menu: {
    capability: 'view_menu',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_draft_order: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  finalize_order: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  cancel_order: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  get_updates: {
    capability: 'view_orders',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },

  // --- Events ---
  get_upcoming_events: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  cancel_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  register_event: {
    capability: 'ai_write',
    requiresEntitlement: false,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  request_volunteer: {
    capability: 'ai_write',
    requiresEntitlement: false,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Admin: restaurants / menu ---
  list_school_restaurants: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['school_master', 'pac_member', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_restaurant: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  list_menu_items: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  set_menu_item_price: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN', 'FINANCIAL'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  delete_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  set_daily_menu: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  get_daily_orders: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['school_master', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  get_monthly_orders: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
};

/**
 * Check whether the authenticated context is allowed to *see* a tool in
 * tools/list. Data-level access is re-checked by the backend on call.
 */
export function canSeeTool(toolName: string, ctx: { isPlatformAdmin: boolean; permissions: string[] }): boolean {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) return false;
  if (ctx.isPlatformAdmin) return true;
  if (policy.requiredRoles.length === 0) return true;
  return policy.requiredRoles.some((r) => ctx.permissions.includes(r));
}

/**
 * Check whether the authenticated context is allowed to *call* a tool.
 * Returns null if allowed, or an error code string if denied.
 */
export function checkToolAuthorization(
  toolName: string,
  ctx: { isPlatformAdmin: boolean; permissions: string[] },
): 'ok' | 'forbidden' | 'unknown_tool' {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) return 'unknown_tool';
  if (ctx.isPlatformAdmin) return 'ok';
  if (policy.requiredRoles.length > 0 && !policy.requiredRoles.some((r) => ctx.permissions.includes(r))) {
    return 'forbidden';
  }
  return 'ok';
}

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return TOOL_POLICIES[toolName];
}
