/**
 * Aggregated per-tool authorization policy table.
 *
 * Every MCP tool has an explicit entry. The MCP server enforces the
 * *interface-level* policy (authentication, role gating for tools/list
 * visibility, confirmation labeling). The *data-level* authorization is
 * enforced by the backend.
 */

export type CapabilityId =
  'view_account' | 'view_balance' | 'view_orders' | 'view_menu' | 'view_events' | 'ai_write';

export type ToolClassification = 'READ' | 'WRITE' | 'FINANCIAL' | 'DESTRUCTIVE' | 'ADMIN' | 'PRIVACY_SENSITIVE';

export interface ToolPolicy {
  /** Canonical capability this tool exercises (null = admin-only, gated by role). */
  capability: CapabilityId | null;
  /** Whether an active paid entitlement is required (server-side check in backend). */
  requiresEntitlement: boolean;
  /** Operation classifications for safety labeling. */
  classifications: ToolClassification[];
  /** Roles that may invoke this tool at the active school. Empty = any member. */
  requiredRoles: string[];
  /** Whether the tool mutates persistent state. */
  mutates: boolean;
  /** Whether the tool has financial impact. */
  financial: boolean;
  /** Whether the tool is irreversible / destructive. */
  destructive: boolean;
  /** Whether the AI client should prompt the user for explicit confirmation. */
  requiresConfirmation: boolean;
}

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  // --- User/account ---
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
  get_daily_orders: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
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
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  cancel_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
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
  be_volunteer: {
    capability: 'ai_write',
    requiresEntitlement: false,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Admin: restaurants ---
  list_school_restaurants: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'pac_member', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_restaurant: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Admin: menu ---
  list_menu_items: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  set_menu_item_price: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN', 'FINANCIAL'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  delete_menu_item: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  set_daily_menu: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
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
