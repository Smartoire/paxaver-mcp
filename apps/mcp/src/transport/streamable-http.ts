/**
 * Streamable HTTP transport for MCP (2025-06-18).
 *
 * Primary endpoint: POST /mcp
 *   - initialize returns a correlation Mcp-Session-Id
 *   - Accept: application/json, text/event-stream
 *   - GET /mcp returns 405: this stateless server sends no server-to-client
 *     notifications, and the spec allows 405 in place of an SSE stream
 */

import type { Env, AppVariables } from '../env.js';
import { mcpError } from '../lib/errors.js';
import { handleJsonRpc } from '../server/json-rpc.js';

type JsonRpcMessage = Parameters<typeof handleJsonRpc>[1];

interface TransportContext {
  env: Env;
  var: AppVariables;
}

/** The POST body, parsed once in index.ts. null = the body is not JSON. */
export type ParsedBody = { value: unknown } | null;

/** Maximum number of messages in one JSON-RPC batch. */
export const MAX_BATCH_SIZE = 20;

function isMessage(m: unknown): m is JsonRpcMessage {
  return (
    typeof m === 'object' && m !== null && !Array.isArray(m) && typeof (m as { method?: unknown }).method === 'string'
  );
}

// A batch runs every message and replies with one result per request, in
// order. Notifications (no `id`) get no entry. A batch of notifications
// only gets 202 with no body.
async function handleBatch(batch: unknown[], c: TransportContext): Promise<Response> {
  if (batch.length === 0 || batch.length > MAX_BATCH_SIZE) {
    const message =
      batch.length === 0 ? 'Invalid Request: empty batch' : `Invalid Request: batch exceeds ${MAX_BATCH_SIZE} messages`;
    return Response.json(mcpError(null, -32600, message), { status: 400 });
  }
  const results = await Promise.all(
    batch.map(async (m) => {
      if (!isMessage(m)) return mcpError(null, -32600, 'Invalid Request');
      const reply: unknown = await (await handleJsonRpc(c, m)).json();
      return 'id' in m ? reply : undefined;
    }),
  );
  const replies = results.filter((r) => r !== undefined);
  return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
}

// --- Streamable HTTP: POST /mcp ---
async function handlePost(parsed: ParsedBody, ctx: TransportContext): Promise<Response> {
  if (!parsed) {
    return Response.json(mcpError(null, -32700, 'Parse error'), { status: 400 });
  }

  const body = parsed.value;
  const c = { env: ctx.env, var: ctx.var };

  if (Array.isArray(body)) return handleBatch(body, c);

  if (!isMessage(body)) {
    return Response.json(mcpError(null, -32600, 'Invalid Request'), { status: 400 });
  }

  // initialize returns a correlation session id but does not store state
  if (body.method === 'initialize') {
    const response = await handleJsonRpc(c, body);
    if (!response.ok) return response;
    const sessionId = crypto.randomUUID();
    const json = await response.json();
    return Response.json(json, { status: 200, headers: { 'Mcp-Session-Id': sessionId } });
  }

  return handleJsonRpc(c, body);
}

async function transportFetch(request: Request, ctx: TransportContext, parsed: ParsedBody): Promise<Response> {
  if (request.method === 'POST') {
    return handlePost(parsed, ctx);
  }
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}

export const transportApp = { fetch: transportFetch };
