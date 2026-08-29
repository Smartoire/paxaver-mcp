/**
 * Streamable HTTP transport for MCP (2025-06-18).
 *
 * Primary endpoint: POST /mcp
 *   - initialize returns a correlation Mcp-Session-Id
 *   - Accept: application/json, text/event-stream
 *   - GET /mcp opens an SSE stream for server-to-client notifications
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env.js';
import { handleJsonRpc } from '../server/json-rpc.js';

export function originFrom(url: string): string {
  return new URL(url).origin.replace(/^http:/, 'https:');
}

export const transportApp = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

// --- Streamable HTTP: POST /mcp ---
transportApp.post('/mcp', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      },
      400,
    );
  }

  // Accept header negotiation: we always return JSON for POST.
  // SSE is only available via GET /mcp.

  // initialize returns a correlation session id but does not store state
  if (!Array.isArray(body) && body.method === 'initialize') {
    const response = await handleJsonRpc(c, body);
    if (!response.ok) return response;
    const sessionId = crypto.randomUUID();
    const json = await response.json();
    return c.json(json, 200, { 'Mcp-Session-Id': sessionId });
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((r) => handleJsonRpc(c, r)));
    return c.json(results);
  }

  const response = await handleJsonRpc(c, body);
  return response;
});

// --- Streamable HTTP: GET /mcp (SSE stream for server→client) ---
transportApp.get('/mcp', async (c) => {
  // Per spec, GET opens an SSE stream. We send a single endpoint event
  // pointing back to /mcp, then keep-alive. Server-initiated notifications
  // are not generated in this stateless deployment.
  const stream = new ReadableStream({
    start(controller) {
      const origin = originFrom(c.req.url);
      controller.enqueue(`event: endpoint\ndata: ${origin}/mcp\n\n`);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);
      c.req.raw.signal?.addEventListener('abort', () => {
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
});

