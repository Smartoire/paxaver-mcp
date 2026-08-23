/**
 * Per-tool authorization policies for user/account tools.
 *
 * The MCP server enforces the *interface-level* policy (authentication,
 * role gating for tools/list visibility, confirmation labeling). The
 * *data-level* authorization is enforced by the backend.
 */

import type { ToolPolicy } from '../contracts.js';

export const USER_POLICIES: Record<string, ToolPolicy> = {
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
};
