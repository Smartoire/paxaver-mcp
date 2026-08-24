/**
 * Minimal vendored contracts for the public MCP server.
 *
 * These are deliberately tiny: only what the MCP layer needs to express
 * tool authorization. The authoritative capability/entitlement model lives
 * in the private Paxaver backend and is enforced server-side when the MCP
 * server calls the API. This file is a *local mirror* of the names so the
 * public repo has zero compile-time dependency on private code.
 *
 * If the private model changes, update the names here to match. The
 * backend is the source of truth for enforcement.
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
