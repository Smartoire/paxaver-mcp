/**
 * Tool dispatcher. Routes each MCP tool call to the corresponding backend
 * API endpoint via the service-binding client. The MCP server contains NO
 * business logic — it is a thin adapter.
 *
 * Idempotency: mutating tools receive an idempotency key derived from the
 * tool name + key arguments + a per-request nonce. The backend is expected
 * to honor the Idempotency-Key header for duplicate suppression.
 *
 * The per-category handler logic lives in sibling files
 * (`user-tools.ts`, `wallet-tools.ts`, `order-tools.ts`, `event-tools.ts`,
 * `restaurant-tools.ts`, `menu-tools.ts`). This module is the orchestrator:
 * it resolves the tool policy, derives the idempotency key, performs the
 * shared ownership validation, delegates to the matching category handler,
 * and shapes the final MCP response.
 */

import type { AppVariables } from '../env.js';
import { mcpError, apiErrorToMcp } from '../lib/errors.js';
import { getToolPolicy } from '../lib/policies.js';
import { originFrom } from '../transport/streamable-http.js';
import type { ApiCallResult } from '../api/client.js';
import type { DispatchContext, RpcId } from './shared.js';
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

function makeIdempotencyKey(toolName: string, args: Record<string, unknown>, correlationId: string): string {
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
  const origin = originFrom(c.req ? c.req.url : c.url);
  const policy = getToolPolicy(name);

  try {
    const idempotencyKey = policy?.mutates ? makeIdempotencyKey(name, args, ctx.correlationId) : undefined;

    // Verify that user-supplied student_id and school_slug arguments are
    // owned by the authenticated user before dispatching to the backend.
    validateOwnership(args, ctx);

    const result: ApiCallResult | undefined = await handleTool({
      env,
      ctx,
      origin,
      name,
      args,
      idempotencyKey,
    });

    if (result === undefined) {
      return toolError(id, -32601, `Unknown tool: ${name}`);
    }

    if (!result.ok) {
      const err = apiErrorToMcp(result.status);
      return toolError(id, err.code, err.message);
    }

    // Extract the backend's `data` envelope if present.
    const data = (result.data as { data?: unknown })?.data ?? result.data;
    return toolResult(id, data);
  } catch (err) {
    // Never leak internal error details to the AI client.
    console.error(`[dispatchTool] ${name} error:`, err instanceof Error ? err.message : String(err));
    return toolError(id, -32603, 'The request could not be completed. Please try again later.');
  }
}
