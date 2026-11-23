/**
 * Tool dispatcher. Routes each MCP tool call to the corresponding backend
 * API endpoint via the service-binding client. The MCP server contains NO
 * business logic — it is a thin adapter.
 *
 * Idempotency: mutating tools receive an idempotency key derived from the
 * user, the tool name, the canonical arguments and a per-call nonce (see
 * makeIdempotencyKey). The backend is expected to honor the Idempotency-Key
 * header for duplicate suppression.
 *
 * The tool → backend route mapping lives in `tools.ts` as a declarative
 * spec table (`TOOL_SPECS`). This module is the orchestrator: it resolves
 * the tool policy, derives the idempotency key, performs the shared
 * ownership validation, delegates to the spec-driven handler, and shapes
 * the final MCP response.
 */

import type { AppVariables, Env } from '../env.js';
import { mcpError, apiErrorToMcp } from '../lib/errors.js';
import { getToolPolicy } from '../lib/policies.js';
import { regionBaseUrl } from '../lib/regions.js';
import { ALL_TOOLS } from '../schemas.js';
import type { ApiCallResult } from '../api/client.js';
import type { DispatchContext, RpcId } from './shared.js';
import { InvalidParamsError } from './shared.js';
import { coerceBooleans } from './coerce.js';
import { handleTool, requiredArgsFor } from './tools.js';
import { applyElicitedArgs, buildInputRequired, confirmPaidRegistration, missingRequiredArgs } from './elicitation.js';
import type { ElicitationContext } from './elicitation.js';

function toolResult(id: RpcId, data: unknown): Response {
  return Response.json({
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data as Record<string, unknown>,
    },
  });
}

function toolError(id: RpcId, code: number, message: string): Response {
  return Response.json(mcpError(id, code, message));
}

// Wallet-charging tools surface the regional top-up page on insufficient
// funds. The URL is a static destination per region — never a checkout
// session or card-payment link.
function walletTopUpMessage(env: Env, ctx: AppVariables): string {
  const url = new URL('/wallet/top-up', regionBaseUrl(env, ctx.country)).toString();
  return `Insufficient wallet balance. Top up at ${url}, then retry this tool.`;
}

const WALLET_CHARGE_TOOLS = new Set(['pay_lunch_order_draft', 'register_for_event']);

// Draft create/update surface the backend's validation message: a missing
// required choice group names the group to pick, a closed day names the
// date — the model can fix the call and retry instead of reporting a bare
// error. Every 422 these routes raise is an AppError.validation message
// written for end users.
const DRAFT_ORDER_TOOLS = new Set(['create_lunch_order_draft', 'update_lunch_order_draft']);

// The backend already strips its 0X... ref code before sending
// (AppError.userMessage); strip it again defensively and cap the length so
// a malformed body cannot dump internals into the tool result.
function backendValidationMessage(data: unknown): string | undefined {
  const err = (data as { error?: unknown } | null | undefined)?.error;
  const message = typeof err === 'string' ? err : (err as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'string') return undefined;
  const cleaned = message.replace(/^0X[0-9A-Fa-f]+:\s*/, '').trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

/**
 * The backend's structured error object ({success:false, error:{code,
 * message, details}}), tolerant of the plain-string error shape older
 * routes still send.
 */
function backendError(data: unknown): { code?: string; message?: string; details?: unknown } | null {
  const err = (data as { error?: unknown } | null | undefined)?.error;
  if (typeof err === 'string') return { message: err };
  if (err && typeof err === 'object') return err as { code?: string; message?: string; details?: unknown };
  return null;
}

/**
 * ASSISTANT_PAYMENTS_DISABLED (#3679): the account turned "assistants may
 * pay from my wallet" off. Relay the backend's user-safe message and name
 * the draft/order the user can finish in the Paxaver app — never the
 * generic 403 text, which would hide the way forward.
 */
function assistantConsentMessage(result: ApiCallResult, name: string, args: Record<string, unknown>): string | null {
  if (result.status !== 403) return null;
  const err = backendError(result.data);
  if (err?.code !== 'ASSISTANT_PAYMENTS_DISABLED') return null;
  const base =
    typeof err.message === 'string' && err.message.trim()
      ? err.message
          .replace(/^0X[0-9A-Fa-f]+:\s*/, '')
          .trim()
          .slice(0, 500)
      : 'Assistant payments are turned off for this account.';
  const details = err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {};
  const draftId =
    (typeof details.orderId === 'string' && details.orderId) ||
    (typeof details.draftId === 'string' && details.draftId) ||
    (name === 'pay_lunch_order_draft' && typeof args.order_id === 'string' ? args.order_id : '') ||
    '';
  const eventId = typeof details.eventId === 'string' ? details.eventId : '';
  const ref = draftId
    ? ` Draft order ${draftId} stays saved — the user can pay it in the Paxaver app.`
    : eventId
      ? ` Event ${eventId} can be registered in the Paxaver app.`
      : '';
  return `${base}${ref}`;
}

// JSON with sorted object keys, so equal arguments give equal text.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Idempotency key: `mcp-<tool>-<sha256 hex>`. The hash covers the user, a
 * per-call nonce and the canonical arguments. The nonce is the session id
 * plus the JSON-RPC id, so a client that resends the same call in the same
 * session gets the same key. Without a session id the nonce is the
 * per-request correlation id, so two calls never share a key by accident.
 * The key is ASCII only, so it is always a valid header value.
 */
export async function makeIdempotencyKey(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Pick<AppVariables, 'userId' | 'sessionId' | 'correlationId'>,
  id: RpcId,
): Promise<string> {
  const nonce = ctx.sessionId ? `session:${ctx.sessionId}:${JSON.stringify(id)}` : `request:${ctx.correlationId}`;
  const material = JSON.stringify([ctx.userId, toolName, nonce, canonicalJson(args)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `mcp-${toolName}-${hex}`;
}

/**
 * Validate that user-supplied student_id and school_slug arguments are
 * owned by the authenticated user. Prevents cross-tenant access when the
 * MCP client sends an ID that does not belong to the user context.
 *
 * Platform admins are exempt — they may act on any school.
 */
function validateOwnership(args: Record<string, unknown>, ctx: AppVariables): void {
  // Non-admin callers must supply a student_id from their context.
  if (args.student_id !== undefined && !ctx.isPlatformAdmin && !ctx.studentIds?.includes(String(args.student_id))) {
    throw new InvalidParamsError('student_id is not permitted for this user');
  }
  // school_slug: if the caller supplies one, it must be a school the user
  // belongs to. If we don't know the user's schools and they aren't a
  // platform admin, we can't validate it — reject rather than forward
  // blindly. Platform admins can act on any school. Child credentials
  // stay on the active school only.
  if (args.school_slug !== undefined && !ctx.isPlatformAdmin) {
    const slug = String(args.school_slug);
    const schools = (
      ctx.assistantMode === 'child' ? [ctx.schoolSlug] : [ctx.schoolSlug, ...(ctx.schoolSlugs ?? [])]
    ).filter(Boolean);
    if (schools.length === 0) {
      throw new InvalidParamsError('school_slug cannot be verified for this user');
    }
    if (!schools.includes(slug)) {
      throw new InvalidParamsError('school_slug does not match the user school');
    }
    const studentSchool = args.student_id !== undefined ? ctx.studentSchools?.[String(args.student_id)] : undefined;
    if (studentSchool && studentSchool !== slug) {
      throw new InvalidParamsError('student does not belong to school_slug');
    }
  }
}

/**
 * Paid-registration gate (#3805): read the event's ticket price from the
 * detail route and, for a paid event, require the user's confirmation of
 * the total before the charging POST. Free events pass straight through.
 * An unreadable price counts as paid. Returns a Response to send instead
 * of registering, or null to go on with the registration.
 */
async function gatePaidRegistration(
  id: RpcId,
  args: Record<string, unknown>,
  ctx: AppVariables,
  env: Env,
  elicitation: ElicitationContext,
): Promise<Response | null> {
  const quantity = args.quantity ?? 1;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new InvalidParamsError('quantity must be a whole number from 1 to 20');
  }
  const detail = await handleTool({ env, ctx, name: 'get_school_event', args });
  if (!detail?.ok) {
    const err = apiErrorToMcp(detail?.status ?? 500);
    return toolError(id, err.code, err.message);
  }
  const event = ((detail.data as { data?: unknown })?.data ?? detail.data) as Record<string, unknown> | null;
  const price = event?.ticketPriceCents;
  if (price === 0) return null;
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
    throw new InvalidParamsError(
      'The ticket price of this event could not be read, so the charge cannot be confirmed. Register in the Paxaver app.',
    );
  }
  return confirmPaidRegistration(
    id,
    {
      eventId: String(args.event_id),
      eventName: typeof event?.name === 'string' ? event.name : 'this event',
      quantity,
      totalCents: quantity * price,
    },
    ctx,
    env,
    elicitation,
  );
}

export async function dispatchTool(
  c: DispatchContext,
  name: string,
  args: Record<string, unknown>,
  id: RpcId,
  elicitation: ElicitationContext = { form: false },
): Promise<Response> {
  const env = c.env;
  const ctx = c.var;
  const policy = getToolPolicy(name);

  try {
    // Guided flow (#3682): a retry carrying a valid requestState merges
    // the accepted elicitation values before anything else reads args.
    const elicited = await applyElicitedArgs(args, name, ctx, env, elicitation);

    const idempotencyKey = policy?.mutates ? await makeIdempotencyKey(name, args, ctx, id) : undefined;

    // Verify that user-supplied student_id and school_slug arguments are
    // owned by the authenticated user before dispatching to the backend.
    validateOwnership(args, ctx);

    // A call missing required args gets an InputRequiredResult when the
    // client declared form elicitation and every missing arg is
    // primitive; otherwise the usual -32602. Ownership stays ahead of
    // this check, matching the pre-elicitation error order.
    const required = requiredArgsFor(name);
    const missing = missingRequiredArgs(args, required);
    if (missing.length > 0) {
      if (elicited) {
        return toolError(id, -32602, `Missing required parameter(s): ${missing.join(', ')}`);
      }
      const inputRequired = await buildInputRequired(id, name, missing, ctx, env, elicitation);
      if (inputRequired) return inputRequired;
      return toolError(id, -32602, `Missing required parameter(s): ${missing.join(', ')}`);
    }

    if (name === 'register_for_event') {
      const gate = await gatePaidRegistration(id, args, ctx, env, elicitation);
      if (gate) return gate;
    }

    const result: ApiCallResult | undefined = await handleTool({
      env,
      ctx,
      name,
      args,
      idempotencyKey,
    });

    if (result === undefined) {
      return toolError(id, -32601, `Unknown tool: ${name}`);
    }

    if (!result.ok) {
      const consentMessage = assistantConsentMessage(result, name, args);
      if (consentMessage) return toolError(id, -32602, consentMessage);
      // Wallet-charging tools are wallet-only: an insufficient-balance
      // rejection must direct the user to top up in the panel — the
      // card-payment link is never surfaced through MCP.
      if (
        WALLET_CHARGE_TOOLS.has(name) &&
        result.status === 422 &&
        /insufficient/i.test(JSON.stringify(result.data ?? ''))
      ) {
        return toolError(id, -32602, walletTopUpMessage(env, ctx));
      }
      if (DRAFT_ORDER_TOOLS.has(name) && result.status === 422) {
        const message = backendValidationMessage(result.data);
        if (message) return toolError(id, -32602, message);
      }
      const err = apiErrorToMcp(result.status);
      return toolError(id, err.code, err.message);
    }

    // Extract the backend's `data` envelope if present, then match the
    // declared outputSchema (0/1 flags become booleans).
    const raw = (result.data as { data?: unknown })?.data ?? result.data;
    const data = coerceBooleans(raw, ALL_TOOLS.find((t) => t.name === name)?.outputSchema);

    // Wallet-only is enforced backend-side, but a backend that does not
    // yet honor the flag can still return a split-checkout shape. Never
    // relay a card payment link through MCP regardless of deploy order.
    if (
      name === 'pay_lunch_order_draft' &&
      typeof data === 'object' &&
      data !== null &&
      ('paymentUrl' in data || (data as Record<string, unknown>).status === 'awaiting_payment')
    ) {
      return toolError(id, -32602, walletTopUpMessage(env, ctx));
    }

    return toolResult(id, data);
  } catch (err) {
    if (err instanceof InvalidParamsError) {
      return toolError(id, -32602, err.message);
    }
    // Never leak internal error details to the AI client.
    console.error(`[dispatchTool] ${name} error:`, err instanceof Error ? err.message : String(err));
    return toolError(id, -32603, 'The request could not be completed. Please try again later.');
  }
}
