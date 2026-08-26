/**
 * Streamable HTTP transport for MCP (2025-06-18).
 *
 * Primary endpoint: POST /mcp
 *   - initialize → returns Mcp-Session-Id
 *   - subsequent requests must carry Mcp-Session-Id
 *   - Accept: application/json, text/event-stream
 *   - GET /mcp opens an SSE stream for server-to-client notifications
 *   - DELETE /mcp terminates a session
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env.js';
import { handleJsonRpc } from '../server/json-rpc.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

interface Session {
  createdAt: number;
  userId: string;
  initialized: boolean;
}

// ponytail: in-memory session map. Ceiling: sessions are per-isolate,
// so a given session id is only valid within the isolate that created it.
// For stateless Workers this means sessions are effectively per-request
// affinity. The MCP spec allows stateless servers; we use the session id
// as a correlation token and re-validate auth on every request. Upgrade
// path: move to Durable Objects or KV-backed sessions if true stateful
// resumability is needed.
const sessions = new Map<string, Session>();

function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

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

  // initialize creates a session
  if (!Array.isArray(body) && body.method === 'initialize') {
    const response = await handleJsonRpc(c, body);
    if (!response.ok) return response;
    cleanupSessions();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      createdAt: Date.now(),
      userId: c.var.userId,
      initialized: true,
    });
    const json = await response.json();
    return c.json(json, 200, { 'Mcp-Session-Id': sessionId });
  }

  // For non-initialize requests, validate session id if present.
  // (Stateless mode: we re-auth on every request via the Bearer token,
  // so a missing/invalid session id is tolerated but logged.)
  const sessionId = c.req.header('Mcp-Session-Id');
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      // Session unknown in this isolate — allow through (stateless mode)
      // but don't error; auth is the real gate.
    }
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

// --- Streamable HTTP: DELETE /mcp (terminate session) ---
transportApp.delete('/mcp', async (c) => {
  const sessionId = c.req.header('Mcp-Session-Id');
  if (sessionId) sessions.delete(sessionId);
  return c.json({}, 200);
});
