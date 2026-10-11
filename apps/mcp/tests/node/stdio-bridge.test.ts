/**
 * Integration test (#2202): run scripts/stdio-bridge.mjs over stdio, as a
 * registry inspector does, and check that initialize and tools/list work
 * without a token.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { ALL_TOOLS } from '../../src/schemas.js';

// Override with BRIDGE_TEST_PORT when the default port is in use.
const PORT = process.env.BRIDGE_TEST_PORT ?? '8320';

describe('stdio bridge', () => {
  let bridge: ChildProcessWithoutNullStreams | undefined;

  // SIGTERM makes the bridge stop its wrangler process group.
  afterAll(async () => {
    if (!bridge || bridge.exitCode !== null) return;
    const exited = new Promise((r) => bridge!.once('exit', r));
    bridge.kill('SIGTERM');
    await exited;
  });

  it('answers initialize and tools/list without a token', { timeout: 120_000 }, async () => {
    const env = { ...process.env, PORT };
    delete env.MCP_BEARER_TOKEN;
    bridge = spawn('node', [resolve(process.cwd(), 'scripts/stdio-bridge.mjs')], { env, stdio: 'pipe' });
    bridge.stderr.resume(); // wrangler logs go to stderr

    const lines = createInterface({ input: bridge.stdout })[Symbol.asyncIterator]();
    const next = async () => {
      const { value, done } = await lines.next();
      if (done) throw new Error('bridge closed stdout');
      return JSON.parse(value as string) as {
        id: number;
        result?: { serverInfo?: { name: string }; tools?: { name: string }[] };
        error?: unknown;
      };
    };
    const send = (msg: unknown) => bridge!.stdin.write(JSON.stringify(msg) + '\n');

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    const init = await next();
    expect(init.error).toBeUndefined();
    expect(init.result?.serverInfo?.name).toBe('paxaver-mcp');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await next();
    expect(list.id).toBe(2);
    expect(list.result?.tools?.map((t) => t.name)).toEqual(ALL_TOOLS.map((t) => t.name));
  });
});
