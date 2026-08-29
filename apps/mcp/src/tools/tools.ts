/**
 * Tool handlers.
 *
 * Maps each MCP tool name to a Paxaver backend API request.
 * The MCP server contains NO business logic.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleTool({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    // User
    case 'get_user_info': {
      const result = await callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/users/me',
      });
      if (result.ok) {
        const userData = (result.data as { data?: Record<string, unknown> })?.data ?? result.data;
        if (ctx.subscription && userData && typeof userData === 'object') {
          (userData as Record<string, unknown>).subscription = ctx.subscription;
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

    // Wallet
    case 'get_wallet_balance':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/wallet/balance',
      });
    case 'get_wallet_status':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/wallet/transactions',
      });
    case 'top_up_balance':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/wallet/deposit',
        body: args,
        idempotencyKey,
      });
    case 'donate_to_school':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/donations',
        body: args,
        idempotencyKey,
      });

    // Order
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

    // Event
    case 'get_upcoming_events':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/events',
        query: {
          start_date: args.start_date as string | undefined,
          end_date: args.end_date as string | undefined,
        },
      });
    case 'create_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/events',
        body: args,
        idempotencyKey,
      });
    case 'update_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}`,
        body: args,
        idempotencyKey,
      });
    case 'cancel_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}/cancel`,
        idempotencyKey,
      });
    case 'register_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}/tickets`,
        body: args,
        idempotencyKey,
      });
    case 'request_volunteer':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/volunteers/signups',
        body: args,
        idempotencyKey,
      });

    // Restaurant
    case 'list_school_restaurants':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/schools/${validatePathId(args.school_slug || ctx.schoolSlug, 'school_slug')}/restaurants`,
      });
    case 'create_restaurant':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/restaurants`,
        body: args,
        idempotencyKey,
      });

    // Menu
    case 'list_menu_items':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
      });
    case 'create_menu_item':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
        body: args,
        idempotencyKey,
      });
    case 'update_menu_item':
    case 'set_menu_item_price':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        body: args,
        idempotencyKey,
      });
    case 'delete_menu_item':
      return callPaxaverApi(env, ctx, origin, {
        method: 'DELETE',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        idempotencyKey,
      });
    case 'set_daily_menu':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
        body: args,
        idempotencyKey,
      });

    default:
      return undefined;
  }
}
