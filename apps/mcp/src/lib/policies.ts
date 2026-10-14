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
    requiresConfirmation: false,
  },
  // --- Wallet ---
  get_my_wallet_balance: {
    capability: 'view_balance',
    requiresEntitlement: false,
    classifications: ['READ', 'PRIVACY_SENSITIVE'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  list_my_wallet_transactions: {
    capability: 'view_balance',
    requiresEntitlement: false,
    classifications: ['READ', 'PRIVACY_SENSITIVE'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },

  // --- Orders ---
  list_my_lunch_orders: {
    capability: 'view_orders',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  get_lunch_menu: {
    capability: 'view_menu',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  create_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  pay_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  update_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  discard_lunch_order_draft: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  cancel_my_lunch_order: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },

  // --- Events ---
  list_school_events: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  get_school_event: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  create_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  update_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  list_event_attendees: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN', 'PRIVACY_SENSITIVE'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: false,
    requiresConfirmation: false,
  },
  cancel_school_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  check_in_event_ticket: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'event_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  register_for_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['FINANCIAL', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  sign_up_for_volunteer_shift: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  list_my_event_registrations: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  cancel_my_event_registration: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  list_my_volunteer_signups: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  cancel_my_volunteer_signup: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  create_volunteer_shift: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'pac_member'],
    mutates: true,
    requiresConfirmation: true,
  },

  // --- Programs ---
  list_school_programs: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    requiresConfirmation: false,
  },
  register_for_program: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  list_program_registrations: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator'],
    mutates: false,
    requiresConfirmation: false,
  },
  cancel_program_registration: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'WRITE'],
    requiredRoles: [],
    mutates: true,
    requiresConfirmation: true,
  },
  admit_program_registration: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },

  // --- Admin: restaurants ---
  list_school_restaurants: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'pac_member', 'lunch_cordinator'],
    mutates: false,
    requiresConfirmation: false,
  },
  create_school_restaurant: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },

  // --- Admin: menu ---
  list_restaurant_menu_items: {
    capability: null,
    requiresEntitlement: false,
    classifications: ['READ', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: false,
    requiresConfirmation: false,
  },
  create_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  update_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN', 'FINANCIAL'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  archive_restaurant_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
  schedule_lunch_menu_item: {
    capability: null,
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['pac_cordinator', 'lunch_cordinator'],
    mutates: true,
    requiresConfirmation: true,
  },
};

/**
 * Bounded legacy-compatibility map: pre-rename tool names that remain
 * callable via tools/call but are never advertised in tools/list. Aliases
 * resolve to the canonical handler with identical arguments and semantics —
 * they reuse the canonical policy, so authorization and entitlement checks
 * are unchanged. The retired `order_lunch` tool is not an alias: it skipped
 * the draft → review → pay flow, so it was removed and now returns
 * `Unknown tool`.
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
 * The caller rejects unknown tools first; a tool without a policy is
 * 'forbidden' (fail closed).
 */
export function checkToolAuthorization(
  toolName: string,
  ctx: { isPlatformAdmin: boolean; permissions: string[] },
): 'ok' | 'forbidden' {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) return 'forbidden';
  if (ctx.isPlatformAdmin) return 'ok';
  if (policy.requiredRoles.length > 0 && !policy.requiredRoles.some((r) => ctx.permissions.includes(r))) {
    return 'forbidden';
  }
  return 'ok';
}

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return TOOL_POLICIES[toolName];
}
