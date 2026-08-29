/**
 * Streamable HTTP transport for MCP (2025-06-18).
 *
 * Primary endpoint: POST /mcp
 *   - initialize returns a correlation Mcp-Session-Id
 *   - Accept: application/json, text/event-stream
 *   - GET /mcp opens an SSE stream for server-to-client notifications
 */

import type { Env, AppVariables } from '../env.js';
import { handleJsonRpc } from '../server/json-rpc.js';

export function originFrom(url: string): string {
  return new URL(url).origin.replace(/^http:/, 'https:');
}

interface TransportContext {
  env: Env;
  var: AppVariables;
  request: Request;
}

// --- Streamable HTTP: POST /mcp ---
async function handlePost(request: Request, ctx: TransportContext): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      },
      { status: 400 },
    );
  }

  // initialize returns a correlation session id but does not store state
  if (!Array.isArray(body) && (body as any).method === 'initialize') {
    const c = { env: ctx.env, var: ctx.var, req: request };
    const response = await handleJsonRpc(c, body as any);
    if (!response.ok) return response;
    const sessionId = crypto.randomUUID();
    const json = await response.json();
    return Response.json(json, { status: 200, headers: { 'Mcp-Session-Id': sessionId } });
  }

  if (Array.isArray(body)) {
    const c = { env: ctx.env, var: ctx.var, req: request };
    const results = await Promise.all(body.map((r) => handleJsonRpc(c, r)));
    return Response.json(results);
  }

  const c = { env: ctx.env, var: ctx.var, req: request };
  return handleJsonRpc(c, body as any);
}

// --- Streamable HTTP: GET /mcp (SSE stream for server→client) ---
function handleGet(request: Request): Response {
  // Per spec, GET opens an SSE stream. We send a single endpoint event
  // pointing back to /mcp, then keep-alive. Server-initiated notifications
  // are not generated in this stateless deployment.
  const stream = new ReadableStream({
    start(controller) {
      const origin = originFrom(request.url);
      controller.enqueue(`event: endpoint\ndata: ${origin}/mcp\n\n`);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);
      request.signal?.addEventListener('abort', () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

async function transportFetch(request: Request, ctx: TransportContext): Promise<Response> {
  if (request.method === 'POST') {
    return handlePost(request, ctx);
  }
  if (request.method === 'GET') {
    return handleGet(request);
  }
  return new Response('Method not allowed', { status: 405 });
}

async function request(path: string, init: RequestInit = {}, ctx: Record<string, unknown>): Promise<Response> {
  const req = new Request(new URL(path, 'http://localhost'), init);
  return transportFetch(req, ctx as unknown as TransportContext);
}

export const transportApp = { fetch: transportFetch, request };
export default transportApp;
