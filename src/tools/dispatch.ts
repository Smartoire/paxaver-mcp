/**
 * Tool dispatcher. Routes each MCP tool call to the corresponding backend
 * API endpoint via the service-binding client. The MCP server contains NO
 * business logic — it is a thin adapter.
 *
 * Idempotency: mutating tools receive an idempotency key derived from the
 * tool name + key arguments + a per-request nonce. The backend is expected
 * to honor the Idempotency-Key header for duplicate suppression.
 */

import type { Env, AppVariables } from "../env.js";
import { callPaxaverApi } from "../api/client.js";
import { mcpError, apiErrorToMcp } from "../lib/errors.js";
import { getToolPolicy } from "../lib/policy.js";
import { originFrom } from "../transport/streamable-http.js";

type RpcId = string | number | null;

interface DispatchContext {
  env: Env;
  var: AppVariables;
  req?: { url: string };
  url: string;
}

function toolResult(data: unknown): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: null,
    result: {
      resultType: "complete",
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data as Record<string, unknown>,
    },
  });
}

function toolError(id: RpcId, code: number, message: string): Response {
  return Response.json(mcpError(id, code, message));
}

function makeIdempotencyKey(
  toolName: string,
  args: Record<string, unknown>,
  correlationId: string,
): string {
  // Derive a stable key from tool + critical args + correlation id.
  // The correlation id is unique per MCP request, so retries of the SAME
  // request (same correlation id) are idempotent, but distinct user
  // intents are not.
  const criticalArgs = JSON.stringify(args);
  return `mcp-${toolName}-${correlationId}-${criticalArgs}`.slice(0, 200);
}

/**
 * Validate that user-supplied student_id and school_slug arguments are
 * owned by the authenticated user. Prevents cross-tenant access when the
 * MCP client sends an ID that does not belong to the user context.
 */
function validateOwnership(
  args: Record<string, unknown>,
  ctx: AppVariables,
): void {
  // If the context has a non-empty studentIds list, the supplied
  // student_id must be in that list.
  if (args.student_id !== undefined && ctx.studentIds?.length) {
    const sid = String(args.student_id);
    if (!ctx.studentIds.includes(sid)) {
      throw new Error("student_id is not permitted for this user");
    }
  }
  // If the context has a schoolSlug and the caller supplies a school_slug
  // that differs from it, reject the request.
  if (args.school_slug !== undefined && ctx.schoolSlug) {
    const slug = String(args.school_slug);
    if (slug !== ctx.schoolSlug) {
      throw new Error("school_slug does not match the user school");
    }
  }
}

/**
 * Validate that a path-parameter ID contains only safe characters.
 * Prevents path traversal (../) and URL injection when interpolating IDs
 * into API paths.
 */
function validatePathId(value: unknown, paramName: string): string {
  const s = String(value ?? "");
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error(`Invalid ${paramName}: contains disallowed characters`);
  }
  return s;
}

export async function dispatchTool(
  c: DispatchContext,
  name: string,
  args: Record<string, unknown>,
  id: RpcId,
): Promise<Response> {
  const env = c.env;
  const ctx = c.var;
  const origin = originFrom(c.req ? c.req.url : c.url);
  const policy = getToolPolicy(name);

  try {
    let result;
    const idempotencyKey = policy?.mutates
      ? makeIdempotencyKey(name, args, ctx.correlationId)
      : undefined;

    // Verify that user-supplied student_id and school_slug arguments are
    // owned by the authenticated user before dispatching to the backend.
    validateOwnership(args, ctx);

    switch (name) {
      // --- User ---
      case "get_user_info": {
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/users/me",
        });
        if (result.ok) {
          const userData = (result.data as { data?: Record<string, unknown> })?.data ?? result.data;
          if (ctx.subscription) {
            if (userData && typeof userData === "object") {
              (userData as Record<string, unknown>).subscription = ctx.subscription;
            }
          }
        }
        break;
      }
      case "update_student":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "PATCH",
          path: `/api/users/me/students/${validatePathId(args.student_id, "student_id")}`,
          body: args,
          idempotencyKey,
        });
        break;

      // --- Wallet ---
      case "get_wallet_balance":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/wallet/balance",
        });
        break;
      case "get_wallet_status":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/wallet/transactions",
        });
        break;
      case "add_funds":
      case "top-up-balance":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/wallet/deposit",
          body: args,
          idempotencyKey,
        });
        break;
      case "donate-to-school":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/donations",
          body: args,
          idempotencyKey,
        });
        break;

      // --- Orders ---
      case "order_lunch":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/lunch/orders",
          body: args,
          idempotencyKey,
        });
        break;
      case "get_orders":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/lunch/orders",
          query: { student_id: args.student_id as string | undefined },
        });
        break;
      case "get_daily_menu":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, "schoolSlug")}/menu/daily`,
          query: {
            date: args.date as string | undefined,
            month: args.month as string | undefined,
          },
        });
        break;
      case "get_updates":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/notifications",
        });
        break;
      case "get_daily_orders":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/lunch/orders",
          query: {
            start: args.menu_date as string | undefined,
            end: args.menu_date as string | undefined,
          },
        });
        break;
      case "get_monthly_orders":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/lunch/orders",
          query: {
            start: args.month ? `${args.month}-01` : undefined,
            end: args.month ? `${args.month}-31` : undefined,
            studentId: args.student_id as string | undefined,
          },
        });
        break;
      case "get-published-menu":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, "schoolSlug")}/menu/daily`,
          query: {
            date: args.date as string | undefined,
            month: args.month as string | undefined,
          },
        });
        break;
      case "create-draft-order":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/lunch/orders/draft",
          body: args,
          idempotencyKey,
        });
        break;
      case "finalize-order":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/lunch/orders/${validatePathId(args.order_id, "order_id")}/finalize`,
          body: { tip_cents: args.tip_cents },
          idempotencyKey,
        });
        break;
      case "cancel-order":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/lunch/orders/${validatePathId(args.order_id, "order_id")}/cancel`,
          idempotencyKey,
        });
        break;

      // --- Events ---
      case "get_upcoming_events":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: "/api/events",
          query: {
            start_date: args.start_date as string | undefined,
            end_date: args.end_date as string | undefined,
          },
        });
        break;
      case "create_event":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/events",
          body: args,
          idempotencyKey,
        });
        break;
      case "update_event":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "PATCH",
          path: `/api/events/${validatePathId(args.event_id, "event_id")}`,
          body: args,
          idempotencyKey,
        });
        break;
      case "cancel_event":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/events/${validatePathId(args.event_id, "event_id")}/cancel`,
          idempotencyKey,
        });
        break;
      case "register-event":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/events/${validatePathId(args.event_id, "event_id")}/tickets`,
          body: args,
          idempotencyKey,
        });
        break;
      case "request-volunteer":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: "/api/volunteers/signups",
          body: args,
          idempotencyKey,
        });
        break;

      // --- Admin: restaurants / menu ---
      case "list_school_restaurants":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: `/api/schools/${validatePathId(args.school_slug || ctx.schoolSlug, "school_slug")}/restaurants`,
        });
        break;
      case "create_restaurant":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/schools/${validatePathId(ctx.schoolSlug, "schoolSlug")}/restaurants`,
          body: args,
          idempotencyKey,
        });
        break;
      case "list_menu_items":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "GET",
          path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, "restaurant_id")}/items`,
        });
        break;
      case "create_menu_item":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, "restaurant_id")}/items`,
          body: args,
          idempotencyKey,
        });
        break;
      case "update_menu_item":
      case "set_menu_item_price":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "PATCH",
          path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, "restaurant_id")}/items/${validatePathId(args.menu_item_id, "menu_item_id")}`,
          body: args,
          idempotencyKey,
        });
        break;
      case "delete_menu_item":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "DELETE",
          path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, "restaurant_id")}/items/${validatePathId(args.menu_item_id, "menu_item_id")}`,
          idempotencyKey,
        });
        break;
      case "set_daily_menu":
        result = await callPaxaverApi(env, ctx, origin, {
          method: "POST",
          path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, "schoolSlug")}/menu/daily`,
          body: args,
          idempotencyKey,
        });
        break;

      default:
        return toolError(id, -32601, `Unknown tool: ${name}`);
    }

    if (!result.ok) {
      const err = apiErrorToMcp(result.status, name);
      return toolError(id, err.code, err.message);
    }

    // Extract the backend's `data` envelope if present.
    const data = (result.data as { data?: unknown })?.data ?? result.data;
    return toolResult(data);
  } catch (err) {
    // Never leak internal error details to the AI client.
    console.error(
      `[dispatchTool] ${name} error:`,
      err instanceof Error ? err.message : String(err),
    );
    return toolError(
      id,
      -32603,
      "The request could not be completed. Please try again later.",
    );
  }
}
