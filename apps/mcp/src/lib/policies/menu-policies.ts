/**
 * Per-tool authorization policies for admin menu tools.
 */

import type { ToolPolicy } from '../contracts.js';

export const MENU_POLICIES: Record<string, ToolPolicy> = {
  // --- Admin: menu ---
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
};
