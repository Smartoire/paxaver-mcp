/**
 * Per-tool authorization policies for admin restaurant tools.
 */

import type { ToolPolicy } from '../contracts.js';

export const RESTAURANT_POLICIES: Record<string, ToolPolicy> = {
  // --- Admin: restaurants ---
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
};
