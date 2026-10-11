/**
 * Test helper that matches the shape of Hono's app.request(input, init, env).
 * Relative paths resolve against http://localhost.
 */

import type { Env } from '../src/env.js';

export function request(
  app: { fetch: (request: Request, env: Env) => Promise<Response> },
  input: string,
  init: RequestInit = {},
  env: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(new Request(new URL(input, 'http://localhost'), init), env as unknown as Env);
}
