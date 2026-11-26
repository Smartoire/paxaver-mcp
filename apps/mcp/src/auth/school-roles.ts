/**
 * School-scoped role lookup for role-gated tools (#4128).
 *
 * The auth context is loaded once, without a school, so its `permissions`
 * describe the active school only. A tool that acts on another school
 * (its `school_slug` argument) must be checked against that school's
 * permissions, which /me/context returns when given the school.
 */

import { callPaxaverApi } from '../api/client.js';
import type { AppVariables, Env } from '../env.js';

export type SchoolPermissions = { ok: true; permissions: string[] } | { ok: false };

/** The school a tool call acts on: its school_slug argument, else the active school. */
export function targetSchoolFor(args: Record<string, unknown>, ctx: Pick<AppVariables, 'schoolSlug'>): string {
  const explicit = args.school_slug;
  return typeof explicit === 'string' && explicit ? explicit : ctx.schoolSlug || '';
}

/**
 * Permissions the caller holds at `schoolSlug`. A 4xx means no membership
 * there, so the result is an empty list. A 5xx or 429 is a backend outage
 * and returns `ok: false`, so the caller can fail with a retry message.
 */
export async function permissionsForSchool(
  env: Env,
  ctx: AppVariables,
  schoolSlug: string,
): Promise<SchoolPermissions> {
  const result = await callPaxaverApi(env, ctx, {
    method: 'GET',
    path: '/api/users/me/context',
    query: { schoolSlug },
  });
  if (!result.ok) {
    if (result.status >= 500 || result.status === 429) return { ok: false };
    return { ok: true, permissions: [] };
  }
  const body = result.data as { data?: { permissions?: unknown }; permissions?: unknown } | null;
  const permissions = body?.data?.permissions ?? body?.permissions;
  return {
    ok: true,
    permissions: Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === 'string') : [],
  };
}
