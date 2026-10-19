# Contributing

Contributions to the Paxaver MCP server are welcome from the Smartoire team.
This is a proprietary / source-available project (see [`LICENSE`](./LICENSE)),
so external contributions are limited to review and educational purposes.

## Development setup

**Requirements:** Node.js >= 26.8.2 (see [`.nvmrc`](./.nvmrc)) and pnpm >= 10
(see `packageManager` in [`package.json`](./package.json)).

```bash
git clone <repo-url> paxaver-mcp
cd paxaver-mcp
nvm use              # use the pinned Node version
pnpm install
```

### Local secrets

The worker requires no secrets for local development.

For full integration testing, run the Paxaver backend worker locally; the
`API_BASE_URL_*` vars (in `wrangler.jsonc` top-level `vars`) already point at
`http://localhost:8787`. Without the `PAXAVER_API_*` service bindings, the
client falls back to authenticated HTTPS.

### Run locally

```bash
pnpm dev             # wrangler dev (Miniflare) on http://localhost:8787
pnpm dev:staging     # wrangler dev --env staging
```

## Testing

Two Vitest configurations:

```bash
pnpm test            # runs both: vitest ( Workers-style ) + vitest.node
pnpm test:node       # node-pool tests only (apps/mcp/tests/node/**/*.test.ts)
pnpm test:watch      # watch mode for the primary config
```

Test files live in `apps/mcp/tests/`:

| File                                   | Coverage                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `apps/mcp/tests/authz.test.ts`         | `canSeeTool`, `checkToolAuthorization`, policy table     |
| `apps/mcp/tests/node/regional.test.ts` | Wrangler config validation, regional routing             |
| `apps/mcp/tests/protocol.test.ts`      | JSON-RPC initialize, tools/list, tools/call, error codes |
| `apps/mcp/tests/safety.test.ts`        | Error sanitization, financial/destructive labeling       |

### Smoke tests

Post-deploy smoke tests hit live endpoints and require network access:

```bash
pnpm smoke:staging
pnpm smoke:prod
```

## Typecheck

```bash
pnpm typecheck       # tsc --noEmit
```

The project uses `strict` mode and `noUncheckedIndexedAccess`. All type errors
must be resolved before a PR can merge.

## Lint

```bash
pnpm lint            # eslint .
```

ESLint config is in [`eslint.config.mjs`](./eslint.config.mjs) (flat config,
TypeScript-aware). Lint errors must be fixed; warnings should be addressed.

## Build

```bash
pnpm build              # wrangler deploy --dry-run (default env)
pnpm build:staging      # wrangler deploy --dry-run --env staging
pnpm wrangler:check     # dry-run for all environments
```

The build is a Wrangler dry-run — it validates the bundle and config without
deploying. CI runs `wrangler:check` to ensure all environments build.

## Code style

- **TypeScript, strict.** No `any` without an explanatory comment (see
  `apps/mcp/src/server/json-rpc.ts` for the one justified exception).
- **ESM only.** The project uses `"type": "module"` and `.js` import specifiers
  (TypeScript's `verbatimModuleSyntax`).
- **Hono for routing.** Keep route handlers thin; business logic belongs in the
  backend.
- **No business logic in the MCP server.** It is an adapter. If you find
  yourself writing domain rules, they belong in the private backend, not here.
- **Vendored names.** `apps/mcp/src/lib/policies.ts` mirrors the backend's
  capability and role names. If the backend's capability/role model changes,
  update the names to match.
- **Every tool needs a policy entry.** A tool without an entry in
  `TOOL_POLICIES` is rejected as unknown. Add the entry when adding a tool.
- **Errors are sanitized.** Never return raw backend error text to the client.
  Use `apiErrorToMcp` or `mcpError`.
- **Mutations need idempotency.** Mutating tools must set `mutates: true` in
  their policy so the dispatcher includes an `Idempotency-Key`.

## PR process

1. Create a branch from `main`: `feat/...`, `fix/...`, `docs/...`, or
   `chore/...`.
2. Write tests for new behavior. Update existing tests for changed behavior.
3. Ensure all checks pass locally:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm wrangler:check
   ```
4. Update [`CHANGELOG.md`](./CHANGELOG.md) under an `## [Unreleased]` section.
5. Open a PR with a clear description. Link any related backend changes.
6. CI must be green. Request review from a maintainer.
7. Squash-merge to `main`. The commit message should follow
   [Conventional Commits](https://www.conventionalcommits.org/) where practical.

### Adding a new tool

1. Add the tool definition to `apps/mcp/src/schemas.ts` (add to `ALL_TOOLS`).
2. Add a policy entry in `apps/mcp/src/lib/policies.ts` (`TOOL_POLICIES`).
3. Add a spec entry in `apps/mcp/src/tools/tools.ts` (`TOOL_SPECS`) mapping the
   tool to a backend API path. Mutations get an `Idempotency-Key` automatically
   via `mutates: true` in their policy.
4. Add tests in `apps/mcp/tests/authz.test.ts` (visibility/authorization) and
   `apps/mcp/tests/protocol.test.ts` (dispatch) as appropriate.
5. Document the tool in the internal tool reference (`docs/paxaver-mcp/tools.md`
   in the private Paxaver monorepo).
6. Update the tool count in [`README.md`](./README.md) if needed.

## Questions

Internal team: ping in the Paxaver engineering channel. External: this repo is
source-available for review; we do not accept external PRs at this time.
