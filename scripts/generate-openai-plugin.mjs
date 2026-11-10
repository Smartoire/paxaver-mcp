/**
 * Builds the OpenAI plugin ZIP, paxaver-openai-plugin-<version>.zip, at the
 * repo root (gitignored). The archive holds only .codex-plugin/, .mcp.json,
 * skills/ and assets/, at its root.
 *
 * The files are copied to a private temp directory first, so the archive
 * never picks up anything else from the working tree.
 *
 * Usage: pnpm package:openai-plugin
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
const entries = ['.codex-plugin', '.mcp.json', 'skills', 'assets'];
const out = join(root, `paxaver-openai-plugin-${plugin.version}.zip`);

const stage = mkdtempSync(join(tmpdir(), 'paxaver-openai-plugin-'));
try {
  for (const entry of entries) {
    cpSync(join(root, entry), join(stage, entry), { recursive: true });
  }
  rmSync(out, { force: true });
  // zip -X drops extra file attributes, so rebuilds are byte-stable.
  execFileSync('zip', ['-r', '-X', '-q', out, ...entries], { cwd: stage, stdio: 'inherit' });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log(`Wrote ${out}`);
