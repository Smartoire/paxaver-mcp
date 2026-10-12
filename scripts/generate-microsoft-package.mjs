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
import { format } from 'prettier';

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
// Format through prettier so the committed artifact passes format:check.
writeFileSync(out, await format(JSON.stringify(ALL_TOOLS, null, 2) + '\n', { filepath: out }));
console.log(`Wrote ${ALL_TOOLS.length} tools to ${out}`);
