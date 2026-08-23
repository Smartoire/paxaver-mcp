/**
 * User/account tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleUserTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'get_user_info': {
      const result = await callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/users/me',
      });
      if (result.ok) {
        const userData = (result.data as { data?: Record<string, unknown> })?.data ?? result.data;
        if (ctx.subscription) {
          if (userData && typeof userData === 'object') {
            (userData as Record<string, unknown>).subscription = ctx.subscription;
          }
        }
      }
      return result;
    }
    case 'update_student':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/users/me/students/${validatePathId(args.student_id, 'student_id')}`,
        body: args,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
