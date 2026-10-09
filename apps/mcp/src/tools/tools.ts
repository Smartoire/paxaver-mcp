/**
 * Tool handlers.
 *
 * Maps each MCP tool name to a Paxaver backend API request via a
 * declarative spec table — one entry per tool carrying the method, path,
 * required args, and optional body/query/result mappers. The MCP server
 * contains NO business logic.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallOptions, ApiCallResult } from '../api/client.js';
import type { AppVariables } from '../env.js';
import type { ToolHandlerArgs } from './shared.js';
import { requireArgs, validatePathId } from './shared.js';

type Args = Record<string, unknown>;

/**
 * Declarative spec for a tool → backend route mapping.
 */
interface ToolSpec {
  method: ApiCallOptions['method'];
  /**
   * Backend path — a static string, a `:arg` template (each placeholder
   * validated by validatePathId), or derived from args/context.
   */
  path: string | ((args: Args, ctx: AppVariables) => string);
  /** MCP args that must be present; missing values fail with -32602. */
  required?: string[];
  /** Request body builder. */
  body?: (args: Args, ctx: AppVariables) => unknown;
  /** Query-string builder; undefined values are dropped by the client. */
  query?: (args: Args, ctx: AppVariables) => Record<string, string | undefined>;
  /** Post-process the API result in place (e.g. strip PII fields). */
  after?: (result: ApiCallResult, args: Args, ctx: AppVariables) => void;
}

// The backend prices every draft item from the daily menu and ignores a
// client-sent priceCents — never forward one (#1951). Items still need
// camelCase keys: menuItemId / menuItemName / quantity.
function mapDraftItems(items: unknown): unknown {
  if (!Array.isArray(items)) return items;
  return (items as Record<string, unknown>[]).map((i) => ({
    menuItemId: i.menu_item_id ?? i.menuItemId,
    menuItemName: i.menu_item_name ?? i.menuItemName,
    quantity: i.quantity,
  }));
}

// student_id defaults to the user's only student; with several it must be
// explicit.
function defaultStudentId(args: Args, ctx: AppVariables): unknown {
  return (args.student_id as string | undefined) ?? (ctx.studentIds?.length === 1 ? ctx.studentIds[0] : undefined);
}

// Interpolate `:arg` placeholders in a path template with validated values.
function resolvePath(template: string, args: Args): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => validatePathId(args[key], key));
}

const TOOL_SPECS: Record<string, ToolSpec> = {
  // User
  get_my_context: {
    method: 'GET',
    path: '/api/users/me',
    after: (result, _args, ctx) => {
      if (!result.ok) return;
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
    },
  },

  // Wallet
  get_my_wallet_balance: {
    method: 'GET',
    path: '/api/wallet/balance',
  },

  // Order
  // order_lunch is legacy-only: not in the canonical catalog (#921) —
  // callable via tools/call for existing integrations, same safeguards.
  // Backend orderCreateSchema takes camelCase keys.
  order_lunch: {
    method: 'POST',
    path: '/api/lunch/orders',
    required: ['menu_item_id', 'menu_date'],
    body: (args, ctx) => ({
      studentId: defaultStudentId(args, ctx),
      menuItemId: args.menu_item_id,
      menuDate: args.menu_date,
      quantity: args.quantity,
    }),
  },
  list_my_lunch_orders: {
    method: 'GET',
    path: '/api/lunch/orders',
    query: (args) => ({
      studentId: args.student_id as string | undefined,
      start: (args.menu_date as string | undefined) ?? (args.month ? `${args.month}-01` : undefined),
      end: (args.menu_date as string | undefined) ?? (args.month ? `${args.month}-31` : undefined),
    }),
  },
  get_lunch_menu: {
    method: 'GET',
    // /menu/daily only reads `date` — a month query must hit the calendar
    // endpoint (year + month params) or it silently returns one day.
    path: (args, ctx) => {
      const slug = validatePathId(ctx.schoolSlug, 'schoolSlug');
      return args.month && !args.date ? `/api/schools/${slug}/menu/daily/calendar` : `/api/schools/${slug}/menu/daily`;
    },
    query: (args) => {
      if (args.month && !args.date) {
        const [year, month] = String(args.month).split('-');
        return { year, month };
      }
      return { date: args.date as string | undefined };
    },
  },
  // Backend draftCreateSchema takes camelCase keys.
  create_lunch_order_draft: {
    method: 'POST',
    path: '/api/lunch/orders/draft',
    required: ['menu_date', 'items'],
    body: (args, ctx) => ({
      studentId: defaultStudentId(args, ctx),
      schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
      menuDate: args.menu_date,
      items: mapDraftItems(args.items),
    }),
  },
  // Backend reads tipCents — a snake_case key would silently drop the tip.
  // walletOnly: MCP must never surface a card payment link; an
  // insufficient balance rejects instead of splitting to Stripe.
  pay_lunch_order_draft: {
    method: 'POST',
    path: '/api/lunch/orders/:order_id/finalize',
    required: ['order_id'],
    body: (args) => ({ tipCents: args.tip_cents, walletOnly: true }),
  },
  update_lunch_order_draft: {
    method: 'PATCH',
    path: '/api/lunch/orders/:order_id',
    required: ['order_id'],
    body: (args) => ({ items: mapDraftItems(args.items), menuDate: args.menu_date }),
  },
  discard_lunch_order_draft: {
    method: 'DELETE',
    path: '/api/lunch/orders/:order_id',
    required: ['order_id'],
  },
  cancel_my_lunch_order: {
    method: 'POST',
    path: '/api/lunch/orders/:order_id/cancel',
    required: ['order_id'],
  },

  // Event
  list_school_events: {
    method: 'GET',
    path: '/api/events',
    after: (result, args) => {
      // GET /api/events ignores date params — the range filter promised by
      // the tool schema is applied here on the returned eventDate values.
      const start = args.start_date as string | undefined;
      const end = args.end_date as string | undefined;
      if (!result.ok || (!start && !end)) return;
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
    },
  },
  // eventCreateSchema is camelCase; schoolSlug defaults to the
  // active school and must match the authenticated school context.
  create_school_event: {
    method: 'POST',
    path: '/api/events',
    required: ['name', 'event_date'],
    body: (args, ctx) => ({
      schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
      name: args.name,
      description: args.description,
      eventDate: args.event_date,
      startsAt: args.starts_at,
      endsAt: args.ends_at,
      location: args.location,
      maxCapacity: args.max_capacity,
      ticketPriceCents: args.ticket_price_cents,
    }),
  },
  // Unlike the create route, PATCH /api/events/:id reads snake_case
  // keys via an explicit allowedFields map — pass fields through.
  update_school_event: {
    method: 'PATCH',
    path: '/api/events/:event_id',
    required: ['event_id'],
    body: (args) => args,
  },
  cancel_school_event: {
    method: 'POST',
    path: '/api/events/:event_id/cancel',
    required: ['event_id'],
  },
  // /register is the MCP-facing endpoint: it charges the wallet for paid
  // events and fails on insufficient funds. /tickets only creates a
  // 'reserved' ticket without collecting payment.
  register_for_event: {
    method: 'POST',
    path: '/api/events/:event_id/register',
    required: ['event_id'],
    body: (args) => ({ quantity: args.quantity }),
  },
  // Backend volunteerSignupSchema reads shiftId.
  sign_up_for_volunteer_shift: {
    method: 'POST',
    path: '/api/volunteers/signups',
    required: ['shift_id'],
    body: (args) => ({ shiftId: args.shift_id, notes: args.notes }),
  },
  list_my_event_registrations: {
    method: 'GET',
    path: '/api/events/tickets/mine',
  },
  cancel_my_event_registration: {
    method: 'POST',
    path: '/api/events/tickets/:ticket_id/cancel',
    required: ['ticket_id'],
  },
  list_my_volunteer_signups: {
    method: 'GET',
    path: '/api/volunteers/my-signups',
  },
  cancel_my_volunteer_signup: {
    method: 'POST',
    path: '/api/volunteers/signups/:signup_id/cancel',
    required: ['signup_id'],
  },

  // Restaurant
  list_school_restaurants: {
    method: 'GET',
    path: (args, ctx) =>
      `/api/schools/${validatePathId(args.school_slug || ctx.schoolSlug, 'school_slug')}/restaurants`,
  },
  // restaurantCreateSchema is camelCase and requires schoolSlug.
  create_school_restaurant: {
    method: 'POST',
    path: (_args, ctx) => `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/restaurants`,
    required: ['name'],
    body: (args, ctx) => ({
      schoolSlug: (args.school_slug as string | undefined) ?? ctx.schoolSlug,
      name: args.name,
      description: args.description,
      taxPercent: args.tax_percent,
    }),
  },

  // Menu
  list_restaurant_menu_items: {
    method: 'GET',
    path: '/api/restaurants/:restaurant_id/items',
  },
  // menuItemCreateSchema is camelCase; ingredients is string[].
  create_restaurant_menu_item: {
    method: 'POST',
    path: '/api/restaurants/:restaurant_id/items',
    required: ['restaurant_id', 'name'],
    body: (args) => ({
      name: args.name,
      description: args.description,
      costCents: args.cost_cents,
      priceCents: args.price_cents,
      ingredients: args.ingredients,
      calories: args.calories,
    }),
  },
  // menuItemUpdateSchema is camelCase. There is no per-item
  // "orderable" flag — availability lives on the daily-menu
  // assignment — so is_available is intentionally not forwarded.
  update_restaurant_menu_item: {
    method: 'PATCH',
    path: '/api/restaurants/:restaurant_id/items/:menu_item_id',
    required: ['restaurant_id', 'menu_item_id'],
    body: (args) => ({
      name: args.name,
      description: args.description,
      costCents: args.cost_cents,
      priceCents: args.price_cents,
      ingredients: args.ingredients,
      calories: args.calories,
      isActive: args.is_active,
    }),
  },
  archive_restaurant_menu_item: {
    method: 'DELETE',
    path: '/api/restaurants/:restaurant_id/items/:menu_item_id',
    required: ['restaurant_id', 'menu_item_id'],
  },
  // dailyMenuAssignSchema is camelCase.
  schedule_lunch_menu_item: {
    method: 'POST',
    path: (_args, ctx) => `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
    required: ['restaurant_id', 'menu_item_id', 'menu_date'],
    body: (args) => ({
      restaurantId: args.restaurant_id,
      menuItemId: args.menu_item_id,
      menuDate: args.menu_date,
      availableQty: args.available_qty,
    }),
  },
};

export async function handleTool({
  env,
  ctx,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  const spec = TOOL_SPECS[name];
  if (!spec) return undefined;
  if (spec.required) requireArgs(args, ...spec.required);
  const result = await callPaxaverApi(env, ctx, {
    method: spec.method,
    path: typeof spec.path === 'function' ? spec.path(args, ctx) : resolvePath(spec.path, args),
    body: spec.body?.(args, ctx),
    query: spec.query?.(args, ctx),
    idempotencyKey,
  });
  spec.after?.(result, args, ctx);
  return result;
}
