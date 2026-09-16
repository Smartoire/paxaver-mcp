#!/usr/bin/env node
// stdio → Streamable HTTP bridge for registries (e.g. Glama) that can only run
// a stdio MCP server. Spawns `wrangler dev` and forwards each JSON-RPC line on
// stdin to POST /mcp, echoing responses to stdout.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const port = process.env.PORT ?? '8788';
const url = `http://127.0.0.1:${port}/mcp`;

const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', port, '--ip', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
});
wrangler.stdout.pipe(process.stderr); // keep stdout clean for JSON-RPC
wrangler.on('exit', (code) => process.exit(code ?? 1));
process.on('exit', () => wrangler.kill());

for (let i = 0; i < 120; i++) {
  try {
    await fetch(url, { method: 'GET' });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

let sessionId;
const headers = () => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...(sessionId && { 'Mcp-Session-Id': sessionId }),
  ...(process.env.MCP_BEARER_TOKEN && { Authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}` }),
});

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const res = await fetch(url, { method: 'POST', headers: headers(), body: line });
  sessionId = res.headers.get('Mcp-Session-Id') ?? sessionId;
  const text = await res.text();
  const isNotification = /"method"/.test(line) && !/"id"\s*:/.test(line);
  if (!isNotification && text.trim()) process.stdout.write(text.trim() + '\n');
}
process.exit(0);
