/**
 * Order tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleOrderTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'order_lunch':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/lunch/orders',
        body: args,
        idempotencyKey,
      });
    case 'get_orders':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/lunch/orders',
        query: { student_id: args.student_id as string | undefined },
      });
    case 'get_daily_menu':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
        query: {
          date: args.date as string | undefined,
          month: args.month as string | undefined,
        },
      });
    case 'get_updates':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/notifications',
      });
    case 'get_daily_orders':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/lunch/orders',
        query: {
          start: args.menu_date as string | undefined,
          end: args.menu_date as string | undefined,
        },
      });
    case 'get_monthly_orders':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/lunch/orders',
        query: {
          start: args.month ? `${args.month}-01` : undefined,
          end: args.month ? `${args.month}-31` : undefined,
          studentId: args.student_id as string | undefined,
        },
      });
    case 'get_published_menu':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
        query: {
          date: args.date as string | undefined,
          month: args.month as string | undefined,
        },
      });
    case 'create_draft_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/lunch/orders/draft',
        body: args,
        idempotencyKey,
      });
    case 'finalize_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}/finalize`,
        body: { tip_cents: args.tip_cents },
        idempotencyKey,
      });
    case 'cancel_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}/cancel`,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
