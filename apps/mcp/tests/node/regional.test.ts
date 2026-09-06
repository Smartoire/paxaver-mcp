/**
 * Regional routing tests: prove the wrangler config routes the single
 * production MCP endpoint to both regional backends via service bindings.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadConfig(): Record<string, unknown> {
  const raw = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf-8');
  // Strip JSONC line comments (but not // inside strings like https://)
  const clean = raw
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(clean);
}

describe('Regional routing', () => {
  const config = loadConfig();
  const envs = config.env as Record<string, Record<string, unknown>>;

  it('production has both CA and US API base URLs', () => {
    const vars = envs['production']!.vars as Record<string, string>;
    expect(vars.API_BASE_URL_CA).toContain('paxaver.ca');
    expect(vars.API_BASE_URL_US).toContain('paxaver.com');
  });

  it('production has both regional service bindings', () => {
    const services = envs['production']!.services as Array<{ binding: string; service: string }>;
    const bindings = services.map((s) => s.binding);
    expect(bindings).toContain('PAXAVER_API_CA');
    expect(bindings).toContain('PAXAVER_API_US');
  });

  it('production routes to mcp.paxaver.com only', () => {
    const routes = envs['production']!.routes as Array<{ pattern: string }>;
    expect(routes).toHaveLength(1);
    expect(routes[0]!.pattern).toBe('mcp.paxaver.com');
  });

  it('staging routes to mcp.paxaver.dev only', () => {
    const routes = envs['staging']!.routes as Array<{ pattern: string }>;
    expect(routes[0]!.pattern).toBe('mcp.paxaver.dev');
  });

  it('staging has its own domain', () => {
    const vars = envs['staging']!.vars as Record<string, string>;
    expect(vars.API_BASE_URL_CA).toContain('paxaver.dev');
  });

  it('no production-ca or production-us environments exist', () => {
    expect(envs['production-ca']).toBeUndefined();
    expect(envs['production-us']).toBeUndefined();
  });

  it('no D1 database bindings in any environment', () => {
    expect(config.d1_databases).toBeUndefined();
    for (const env of Object.values(envs)) {
      expect(env.d1_databases, 'no env should have D1 bindings').toBeUndefined();
    }
  });
});
