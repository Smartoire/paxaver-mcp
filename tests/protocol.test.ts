/**
 * Protocol tests: initialize, ping, tools/list, tools/call, session lifecycle.
 * Uses Hono's app.request() — no network needed.
 */

import { describe, it, expect } from "vitest";
import app from "../src/index.js";

// ponytail: Tests use a legacy static token. The mock PAXAVER_API handles
// /api/mcp/whoami to return user context. RS256 JWKS validation fails
// (no auth worker in test env), falling through to the legacy path.
const TEST_TOKEN = "test-static-mcp-token-for-vitest";

const USER_CONTEXT = {
  userId: "user-1",
  email: "test@paxaver.com",
  schoolSlug: "test-school",
  permissions: ["school_master"],
  isPlatformAdmin: false,
  studentIds: ["student-1"],
};

const TEST_ENV = {
  JWT_SECRET: "test-jwt-secret-for-vitest-only",
  ENVIRONMENT: "test" as const,
  REGION: "ca" as const,
  DEFAULT_CURRENCY: "CAD",
  ALLOWED_ORIGINS: "http://localhost:5173",
  API_BASE_URL: "http://localhost:8787",
  PAXAVER_API: {
    async fetch(request: Request | string, init?: RequestInit): Promise<Response> {
      const req = typeof request === "string" ? new Request(request, init) : request;
      const url = new URL(req.url);
      if (url.pathname === "/api/mcp/whoami") {
        const authHeader = req.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (token !== TEST_TOKEN) {
          return new Response(JSON.stringify({ error: "Invalid token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ data: USER_CONTEXT }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname === "/api/users/me/context") {
        return new Response(
          JSON.stringify({ data: USER_CONTEXT }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
};

async function mcpPost(body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request(
    "https://mcp.paxaver.test/mcp",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    TEST_ENV,
  );
}

describe("MCP protocol", () => {
  it("initialize returns protocol version and server info", async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      token,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.serverInfo.name).toBe("paxaver-mcp");
    expect(res.headers.get("Mcp-Session-Id")).toBeTruthy();
  });

  it("ping returns empty result", async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost({ jsonrpc: "2.0", id: 2, method: "ping" }, token);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result).toEqual({});
  });

  it("tools/list returns all tools", async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      token,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result.tools.length).toBeGreaterThan(10);
    expect(
      json.result.tools.some(
        (t: { name: string }) => t.name === "get_user_info",
      ),
    ).toBe(true);
  });

  it("unauthenticated request returns 401 with WWW-Authenticate", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 4, method: "ping" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

  it("invalid token returns 401", async () => {
    const res = await mcpPost(
      { jsonrpc: "2.0", id: 5, method: "ping" },
      "invalid-token",
    );
    expect(res.status).toBe(401);
  });

  it("unknown method returns -32601", async () => {
    const token = TEST_TOKEN;
    const res = await mcpPost(
      { jsonrpc: "2.0", id: 6, method: "nonexistent/method" },
      token,
    );
    const json = await res.json() as any;
    expect(json.error.code).toBe(-32601);
  });

  it("parse error on invalid JSON", async () => {
    const token = TEST_TOKEN;
    const res = await app.request(
      "https://mcp.paxaver.test/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "not json",
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error.code).toBe(-32700);
  });

  it("DELETE /mcp terminates session", async () => {
    const token = TEST_TOKEN;
    const initRes = await mcpPost(
      { jsonrpc: "2.0", id: 7, method: "initialize" },
      token,
    );
    const sessionId = initRes.headers.get("Mcp-Session-Id");
    expect(sessionId).toBeTruthy();

    const delRes = await app.request(
      "https://mcp.paxaver.test/mcp",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Mcp-Session-Id": sessionId!,
        },
      },
      TEST_ENV,
    );
    expect(delRes.status).toBe(200);
  });
});
