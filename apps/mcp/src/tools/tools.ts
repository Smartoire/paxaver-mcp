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

// Backend draft-order routes store items verbatim and recompute the total
// from priceCents * quantity — every item must carry camelCase keys or the
// total silently becomes NaN.
function mapDraftItem(i: Record<string, unknown>) {
  return {
    menuItemId: i.menu_item_id ?? i.menuItemId,
    menuItemName: i.menu_item_name ?? i.menuItemName,
    priceCents: i.price_cents ?? i.priceCents,
    quantity: i.quantity,
  };
}

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
        (args.student_id as string | undefined) ?? (ctx.studentIds?.length === 1 ? ctx.studentIds[0] : undefined);
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
          studentId: args.student_id as string | undefined,
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
          path: `/api/schools/${slug}/menu/daily/calendar`,
          query: { year, month },
        });
      }
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/schools/${slug}/menu/daily`,
        query: { date: args.date as string | undefined },
      });
    }
    case 'create_draft_order': {
      // Backend needs { studentId, schoolSlug, menuDate, items[] } in
      // camelCase; student_id defaults to the user's only student.
      const studentId =
        (args.student_id as string | undefined) ?? (ctx.studentIds?.length === 1 ? ctx.studentIds[0] : undefined);
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/lunch/orders/draft',
        body: {
          studentId,
          schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
          menuDate: args.menu_date,
          items: Array.isArray(args.items) ? (args.items as Record<string, unknown>[]).map(mapDraftItem) : args.items,
        },
        idempotencyKey,
      });
    }
    case 'finalize_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}/finalize`,
        body: { tipCents: args.tip_cents },
        idempotencyKey,
      });
    case 'update_draft_order':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/lunch/orders/${validatePathId(args.order_id, 'order_id')}`,
        body: {
          items: Array.isArray(args.items) ? (args.items as Record<string, unknown>[]).map(mapDraftItem) : undefined,
          menuDate: args.menu_date,
        },
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
    case 'get_upcoming_events': {
      // GET /api/events ignores date params — the range filter promised by
      // the tool schema is applied here on the returned eventDate values.
      const start = args.start_date as string | undefined;
      const end = args.end_date as string | undefined;
      const result = await callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/events',
      });
      if (result.ok && (start || end)) {
        const data = result.data as Record<string, unknown> | unknown[] | undefined;
        const list = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.data as unknown[]);
        if (Array.isArray(list)) {
          const filtered = list.filter((e) => {
            const d = (e as Record<string, unknown>).eventDate as string | undefined;
            return d !== undefined && (!start || d >= start) && (!end || d <= end);
          });
          if (Array.isArray(data)) result.data = filtered;
          else if (data && typeof data === 'object') (data as Record<string, unknown>).data = filtered;
        }
      }
      return result;
    }
    case 'create_event':
      // eventCreateSchema is camelCase; schoolSlug defaults to the active
      // school and must match the authenticated school context.
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/events',
        body: {
          schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
          name: args.name,
          description: args.description,
          eventDate: args.event_date,
          startsAt: args.starts_at,
          endsAt: args.ends_at,
          location: args.location,
          maxCapacity: args.max_capacity,
          ticketPriceCents: args.ticket_price_cents,
        },
        idempotencyKey,
      });
    case 'update_event':
      // Unlike the create route, PATCH /api/events/:id reads snake_case
      // keys via an explicit allowedFields map — pass args through.
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
        body: { shiftId: args.shift_id, notes: args.notes },
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
      // restaurantCreateSchema is camelCase and requires schoolSlug.
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/restaurants`,
        body: {
          schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
          name: args.name,
          description: args.description,
          taxPercent: args.tax_percent,
        },
        idempotencyKey,
      });

    // Menu
    case 'list_menu_items':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
      });
    case 'create_menu_item':
      // menuItemCreateSchema is camelCase; ingredients is string[].
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
        body: {
          name: args.name,
          description: args.description,
          costCents: args.cost_cents,
          priceCents: args.price_cents,
          ingredients: args.ingredients,
          calories: args.calories,
        },
        idempotencyKey,
      });
    case 'update_menu_item':
      // menuItemUpdateSchema is camelCase. There is no per-item
      // "orderable" flag — availability lives on the daily-menu
      // assignment — so is_available is intentionally not forwarded.
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        body: {
          name: args.name,
          description: args.description,
          costCents: args.cost_cents,
          priceCents: args.price_cents,
          ingredients: args.ingredients,
          calories: args.calories,
          isActive: args.is_active,
        },
        idempotencyKey,
      });
    case 'delete_menu_item':
      return callPaxaverApi(env, ctx, origin, {
        method: 'DELETE',
        path: `/api/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        idempotencyKey,
      });
    case 'set_daily_menu':
      // dailyMenuAssignSchema is camelCase.
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
        body: {
          restaurantId: args.restaurant_id,
          menuItemId: args.menu_item_id,
          menuDate: args.menu_date,
          availableQty: args.available_qty,
        },
        idempotencyKey,
      });

    default:
      return undefined;
  }
}
