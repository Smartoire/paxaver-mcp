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
          schoolSlug: u.schoolSlug,
          schoolName: u.schoolName,
          students: Array.isArray(u.students)
            ? (u.students as Record<string, unknown>[]).map((s) => ({
                id: s.id,
                firstName: s.firstName,
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

    // Order
    case 'order_lunch': {
      // Backend orderCreateSchema takes camelCase keys. student_id defaults
      // to the user's only student; with several it must be explicit.
      const studentId =
        (args.student_id as string | undefined) ??
        (ctx.studentIds?.length === 1 ? ctx.studentIds[0] : undefined);
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/lunch/orders',
        body: {
          studentId,
          menuItemId: args.menu_item_id,
          menuDate: args.menu_date,
          quantity: args.quantity,
        },
        idempotencyKey,
      });
    }
    case 'get_orders':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/lunch/orders',
        query: {
          student_id: args.student_id as string | undefined,
          start: (args.menu_date as string | undefined) ?? (args.month ? `${args.month}-01` : undefined),
          end: (args.menu_date as string | undefined) ?? (args.month ? `${args.month}-31` : undefined),
        },
      });
    case 'get_menu': {
      const slug = validatePathId(ctx.schoolSlug, 'schoolSlug');
      // /menu/daily only reads `date` — a month query must hit the calendar
      // endpoint (year + month params) or it silently returns one day.
      if (args.month && !args.date) {
        const [year, month] = String(args.month).split('-');
        return callPaxaverApi(env, ctx, origin, {
          method: 'GET',
          path: `/api/lunch/schools/${slug}/menu/daily/calendar`,
          query: { year, month },
        });
      }
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/lunch/schools/${slug}/menu/daily`,
        query: { date: args.date as string | undefined },
      });
    }
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
    case 'update_draft_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}`,
        body: { items: args.items, menuDate: args.menu_date },
        idempotencyKey,
      });
    case 'discard_draft_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'DELETE',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}`,
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
      // /register is the MCP-facing endpoint: it charges the wallet for paid
      // events and fails on insufficient funds. /tickets only creates a
      // 'reserved' ticket without collecting payment.
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}/register`,
        body: { quantity: args.quantity },
        idempotencyKey,
      });
    case 'sign_up_to_volunteer':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/volunteers/signups',
        body: args,
        idempotencyKey,
      });
    case 'get_my_event_registrations':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/events/tickets/mine',
      });
    case 'cancel_event_registration':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/tickets/${validatePathId(args.ticket_id, 'ticket_id')}/cancel`,
        idempotencyKey,
      });
    case 'get_my_volunteer_signups':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/volunteers/my-signups',
      });
    case 'cancel_volunteer_signup':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/volunteers/signups/${validatePathId(args.signup_id, 'signup_id')}/cancel`,
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
