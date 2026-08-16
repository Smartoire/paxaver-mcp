/**
 * Regional isolation tests: prove the wrangler config locks each environment
 * to its region and never allows cross-region routing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadConfig(): Record<string, unknown> {
  const raw = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf-8");
  // Strip JSONC line comments (but not // inside strings like https://)
  const clean = raw
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(clean);
}

describe("Regional isolation", () => {
  const config = loadConfig();
  const envs = config.env as Record<string, Record<string, unknown>>;

  it("production-ca has REGION=ca and CAD", () => {
    const vars = envs["production-ca"]!.vars as Record<string, string>;
    expect(vars.REGION).toBe("ca");
    expect(vars.DEFAULT_CURRENCY).toBe("CAD");
    expect(vars.API_BASE_URL).toContain("paxaver.ca");
  });

  it("production-us has REGION=us and USD", () => {
    const vars = envs["production-us"]!.vars as Record<string, string>;
    expect(vars.REGION).toBe("us");
    expect(vars.DEFAULT_CURRENCY).toBe("USD");
    expect(vars.API_BASE_URL).toContain("paxaver.com");
  });

  it("staging has its own domain", () => {
    const vars = envs["staging"]!.vars as Record<string, string>;
    expect(vars.API_BASE_URL).toContain("paxaver.dev");
  });

  it("CA routes to mcp.paxaver.ca only", () => {
    const routes = envs["production-ca"]!.routes as Array<{ pattern: string }>;
    expect(routes[0]!.pattern).toBe("mcp.paxaver.ca");
  });

  it("US routes to mcp.paxaver.com only", () => {
    const routes = envs["production-us"]!.routes as Array<{ pattern: string }>;
    expect(routes[0]!.pattern).toBe("mcp.paxaver.com");
  });

  it("staging routes to mcp.paxaver.dev only", () => {
    const routes = envs["staging"]!.routes as Array<{ pattern: string }>;
    expect(routes[0]!.pattern).toBe("mcp.paxaver.dev");
  });

  it("no environment references the wrong region API", () => {
    for (const [name, env] of Object.entries(envs)) {
      const vars = env!.vars as Record<string, string>;
      if (vars.REGION === "ca") {
        expect(
          vars.API_BASE_URL,
          `${name} CA env must not point to US`,
        ).not.toContain("paxaver.com");
      }
      if (vars.REGION === "us") {
        expect(
          vars.API_BASE_URL,
          `${name} US env must not point to CA`,
        ).not.toContain("paxaver.ca");
      }
    }
  });

  it("no D1 database bindings in any environment", () => {
    expect(config.d1_databases).toBeUndefined();
    for (const env of Object.values(envs)) {
      expect(
        env.d1_databases,
        "no env should have D1 bindings",
      ).toBeUndefined();
    }
  });
});
