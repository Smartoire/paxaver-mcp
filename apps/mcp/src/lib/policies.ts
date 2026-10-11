/**
 * Aggregated per-tool authorization policy table.
 *
 * Every MCP tool has an explicit entry. The MCP server enforces the
 * *interface-level* policy (authentication, role gating for tools/list
 * visibility, confirmation labeling). The *data-level* authorization is
 * enforced by the backend.
 */

export type CapabilityId = 'view_account' | 'view_balance' | 'view_orders' | 'view_menu' | 'view_events' | 'ai_write';

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
  get_my_context: {
    capability: 'view_account',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  // --- Wallet ---
  get_my_wallet_balance: {
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
  // Legacy-only: retired from the canonical catalog (#921) but still
  // callable via tools/call for existing integrations.
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
  list_my_lunch_orders: {
    capability: 'view_orders',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  get_lunch_menu: {
    capability: 'view_menu',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  pay_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  update_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  discard_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  cancel_my_lunch_order: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },

  // --- Events ---
  list_school_events: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  cancel_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  register_for_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  sign_up_for_volunteer_shift: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  list_my_event_registrations: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  cancel_my_event_registration: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  list_my_volunteer_signups: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  cancel_my_volunteer_signup: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: true,
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
  create_school_restaurant: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },

  // --- Admin: menu ---
  list_restaurant_menu_items: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN', 'FINANCIAL'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: true,
    destructive: false,
    requiresConfirmation: true,
  },
  archive_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  schedule_lunch_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
};

/**
 * Bounded legacy-compatibility map (#921): pre-rename tool names that remain
 * callable via tools/call but are never advertised in tools/list. Aliases
 * resolve to the canonical handler with identical arguments and semantics —
 * they reuse the canonical policy, so authorization and entitlement checks
 * are unchanged. `order_lunch` is deliberately not an alias: its
 * immediate-purchase semantics have no canonical equivalent (the catalog is
 * draft → review → pay); it keeps its own hidden handler + policy entry.
 *
 * Removal criteria: delete entries once directory catalogs and saved
 * integrations have migrated; disable the whole path by emptying this map.
 */
export const TOOL_ALIASES: Record<string, string> = {
  get_user_info: 'get_my_context',
  get_wallet_balance: 'get_my_wallet_balance',
  get_orders: 'list_my_lunch_orders',
  get_menu: 'get_lunch_menu',
  create_draft_order: 'create_lunch_order_draft',
  finalize_order: 'pay_lunch_order_draft',
  update_draft_order: 'update_lunch_order_draft',
  discard_draft_order: 'discard_lunch_order_draft',
  cancel_order: 'cancel_my_lunch_order',
  get_upcoming_events: 'list_school_events',
  create_event: 'create_school_event',
  update_event: 'update_school_event',
  cancel_event: 'cancel_school_event',
  register_event: 'register_for_event',
  get_my_event_registrations: 'list_my_event_registrations',
  cancel_event_registration: 'cancel_my_event_registration',
  sign_up_to_volunteer: 'sign_up_for_volunteer_shift',
  get_my_volunteer_signups: 'list_my_volunteer_signups',
  cancel_volunteer_signup: 'cancel_my_volunteer_signup',
  create_restaurant: 'create_school_restaurant',
  list_menu_items: 'list_restaurant_menu_items',
  create_menu_item: 'create_restaurant_menu_item',
  update_menu_item: 'update_restaurant_menu_item',
  delete_menu_item: 'archive_restaurant_menu_item',
  set_daily_menu: 'schedule_lunch_menu_item',
};

/** Resolve a caller-supplied tool name to its canonical name. */
export function resolveToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

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
