/**
 * Shared types and helpers for tool dispatch handlers.
 *
 * Each category handler is a thin adapter that maps an MCP tool call to a
 * Paxaver backend API request. The MCP server contains NO business logic.
 */

import type { Env, AppVariables } from '../env.js';

export type RpcId = string | number | null;

export interface DispatchContext {
  env: Env;
  var: AppVariables;
  req?: { url: string };
  url: string;
}

/**
 * Arguments passed to every category handler.
 */
export interface ToolHandlerArgs {
  env: Env;
  ctx: AppVariables;
  origin: string;
  name: string;
  args: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Validate that a path-parameter ID contains only safe characters.
 * Prevents path traversal (../) and URL injection when interpolating IDs
 * into API paths.
 */
export function validatePathId(value: unknown, paramName: string): string {
  const s = String(value ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error(`Invalid ${paramName}: contains disallowed characters`);
  }
  return s;
}
