/**
 * Regenerates certification/microsoft/mcptools.json from the live tool
 * registry (ALL_TOOLS in apps/mcp/src/schemas.ts) so the Microsoft
 * certification package never drifts from the deployed server.
 *
 * Usage: pnpm package:microsoft
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { ALL_TOOLS } = await import('../apps/mcp/src/schemas.ts');

// Microsoft validation accepts ASCII only in package files. Fail loudly
// instead of shipping a package that fails automated validation.
const hasNonAscii = (s) => [...s].some((c) => c.codePointAt(0) > 0x7f);
const nonAscii = ALL_TOOLS.filter((t) => hasNonAscii(JSON.stringify(t))).map((t) => t.name);
if (nonAscii.length) {
  console.error(`Non-ASCII characters in tool definitions: ${nonAscii.join(', ')}`);
  process.exit(1);
}

const out = join(here, '../certification/microsoft/mcptools.json');
writeFileSync(out, JSON.stringify(ALL_TOOLS, null, 2) + '\n');
console.log(`Wrote ${ALL_TOOLS.length} tools to ${out}`);
