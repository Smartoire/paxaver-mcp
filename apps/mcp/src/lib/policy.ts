/**
 * Per-tool authorization policy. Every MCP tool has an explicit entry.
 *
 * The MCP server enforces the *interface-level* policy (authentication,
 * role gating for tools/list visibility, confirmation labeling). The
 * *data-level* authorization (school membership, student ownership,
 * entitlement) is enforced by the backend when the MCP server calls it
 * via the service binding. This is defense-in-depth: even if the MCP
 * layer's role check is bypassed, the backend re-checks.
 *
 * The policy *definitions* live in `./policies.ts`. This module re-exports
 * the aggregated `TOOL_POLICIES` table and provides the authorization
 * helper functions.
 */

import type { ToolPolicy } from './contracts.js';
import { TOOL_POLICIES } from './policies.js';

export { TOOL_POLICIES };

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
