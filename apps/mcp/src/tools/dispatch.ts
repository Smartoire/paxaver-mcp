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

import type { AppVariables } from '../env.js';
import { mcpError, apiErrorToMcp } from '../lib/errors.js';
import { getToolPolicy } from '../lib/policies.js';
import type { ApiCallResult } from '../api/client.js';
import type { DispatchContext, RpcId } from './shared.js';
import { InvalidParamsError } from './shared.js';
import { handleTool } from './tools.js';

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

const WALLET_TOP_UP_MESSAGE =
  'Insufficient wallet balance. Open the Paxaver panel, top up the wallet balance, then retry this tool.';

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
  // If the context has a non-empty studentIds list, the supplied
  // student_id must be in that list.
  if (args.student_id !== undefined && ctx.studentIds?.length) {
    const sid = String(args.student_id);
    if (!ctx.studentIds.includes(sid)) {
      throw new Error('student_id is not permitted for this user');
    }
  }
  // school_slug: if the caller supplies one, it must match the user's own
  // school. If we don't know the user's school (empty ctx.schoolSlug) and
  // they aren't a platform admin, we can't validate it — reject rather than
  // forward blindly. Platform admins can act on any school.
  if (args.school_slug !== undefined && !ctx.isPlatformAdmin) {
    const slug = String(args.school_slug);
    if (!ctx.schoolSlug) {
      throw new Error('school_slug cannot be verified for this user');
    }
    if (slug !== ctx.schoolSlug) {
      throw new Error('school_slug does not match the user school');
    }
  }
}

export async function dispatchTool(
  c: DispatchContext,
  name: string,
  args: Record<string, unknown>,
  id: RpcId,
): Promise<Response> {
  const env = c.env;
  const ctx = c.var;
  const policy = getToolPolicy(name);

  try {
    const idempotencyKey = policy?.mutates ? await makeIdempotencyKey(name, args, ctx, id) : undefined;

    // Verify that user-supplied student_id and school_slug arguments are
    // owned by the authenticated user before dispatching to the backend.
    validateOwnership(args, ctx);

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
      // pay_lunch_order_draft is wallet-only: an insufficient-balance
      // rejection must direct the user to top up in the panel — the
      // card-payment link is never surfaced through MCP.
      if (
        name === 'pay_lunch_order_draft' &&
        result.status === 422 &&
        /insufficient/i.test(JSON.stringify(result.data ?? ''))
      ) {
        return toolError(id, -32602, WALLET_TOP_UP_MESSAGE);
      }
      const err = apiErrorToMcp(result.status);
      return toolError(id, err.code, err.message);
    }

    // Extract the backend's `data` envelope if present.
    const data = (result.data as { data?: unknown })?.data ?? result.data;

    // Wallet-only is enforced backend-side, but a backend that does not
    // yet honor the flag can still return a split-checkout shape. Never
    // relay a card payment link through MCP regardless of deploy order.
    if (
      name === 'pay_lunch_order_draft' &&
      typeof data === 'object' &&
      data !== null &&
      ('paymentUrl' in data || (data as Record<string, unknown>).status === 'awaiting_payment')
    ) {
      return toolError(id, -32602, WALLET_TOP_UP_MESSAGE);
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
