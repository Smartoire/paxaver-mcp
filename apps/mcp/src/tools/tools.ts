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
        const raw = (result.data as { data?: Record<string, unknown> })?.data ?? result.data;
        const u = (raw ?? {}) as Record<string, unknown>;
        // ponytail: filter PII — only return fields declared in the outputSchema.
        // The backend returns email, phone, address, nationality, totp_secret, etc.
        // These must never reach the AI client. Upgrade path: generate the filter
        // from the outputSchema definition automatically.
        const filtered: Record<string, unknown> = {
          firstName: u.firstName,
          lastName: u.lastName,
          schoolSlug: u.schoolSlug,
          schoolName: u.schoolName,
          students: Array.isArray(u.students)
            ? (u.students as Record<string, unknown>[]).map((s) => ({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                schoolSlug: s.schoolSlug,
              }))
            : u.students,
          roles: u.roles,
        };
        if (ctx.subscription) {
          filtered.subscription = ctx.subscription;
        }
        // Replace the data envelope so the dispatcher sends only filtered fields.
        if (result.data && typeof result.data === 'object' && 'data' in (result.data as Record<string, unknown>)) {
          (result.data as Record<string, unknown>).data = filtered;
        } else {
          result.data = filtered;
        }
      }
      return result;
    }
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
    case 'be_volunteer':
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
