/**
 * Per-tool authorization policies for wallet tools.
 */

import type { ToolPolicy } from '../contracts.js';

export const WALLET_POLICIES: Record<string, ToolPolicy> = {
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
};
