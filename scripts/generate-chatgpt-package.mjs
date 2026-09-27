/**
 * Regenerates chatgpt-app-submission.json from the canonical sources —
 * the live tool registry (ALL_TOOLS in apps/mcp/src/schemas.ts), the
 * published server descriptor (server.json), and the committed public
 * app metadata (.codex-plugin/plugin.json) — so the ChatGPT app
 * submission artifact never drifts from the deployed server.
 *
 * The output stays gitignored: it is the submission artifact, not a
 * canonical schema, and may carry deployment-specific fields added at
 * submission time. Regenerate before each OpenAI app submission.
 *
 * Usage: pnpm package:chatgpt
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { ALL_TOOLS } = await import('../apps/mcp/src/schemas.ts');
const server = JSON.parse(readFileSync(join(here, '../server.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(join(here, '../.codex-plugin/plugin.json'), 'utf8'));

const mcpServerUrl = server.remotes?.find((r) => r.type === 'streamable-http')?.url;
if (!mcpServerUrl) {
  console.error('No streamable-http remote found in server.json');
  process.exit(1);
}

const submission = {
  name: plugin.interface.displayName,
  version: server.version,
  description: plugin.interface.shortDescription,
  developerName: plugin.interface.developerName,
  category: plugin.interface.category,
  capabilities: plugin.interface.capabilities,
  mcpServerUrl,
  websiteURL: plugin.interface.websiteURL,
  privacyPolicyURL: plugin.interface.privacyPolicyURL,
  termsOfServiceURL: plugin.interface.termsOfServiceURL,
  brandColor: plugin.interface.brandColor,
  defaultPrompt: plugin.interface.defaultPrompt,
  tools: ALL_TOOLS,
};

const out = join(here, '../chatgpt-app-submission.json');
writeFileSync(out, JSON.stringify(submission, null, 2) + '\n');
console.log(`Wrote ${ALL_TOOLS.length} tools to ${out}`);
