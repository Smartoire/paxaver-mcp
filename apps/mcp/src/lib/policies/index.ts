/**
 * Aggregated per-tool authorization policy table.
 *
 * Every MCP tool has an explicit entry. Category-specific definitions live
 * in sibling files and are merged here into the canonical `TOOL_POLICIES`
 * map consumed by `../policy.ts`.
 */

import type { ToolPolicy } from '../contracts.js';
import { USER_POLICIES } from './user-policies.js';
import { WALLET_POLICIES } from './wallet-policies.js';
import { ORDER_POLICIES } from './order-policies.js';
import { EVENT_POLICIES } from './event-policies.js';
import { RESTAURANT_POLICIES } from './restaurant-policies.js';
import { MENU_POLICIES } from './menu-policies.js';

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  ...USER_POLICIES,
  ...WALLET_POLICIES,
  ...ORDER_POLICIES,
  ...EVENT_POLICIES,
  ...RESTAURANT_POLICIES,
  ...MENU_POLICIES,
};
