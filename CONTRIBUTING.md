# Contributing

Contributions to the Paxaver MCP server are welcome from the Smartoire team.
This is a proprietary / source-available project (see [`LICENSE`](./LICENSE)),
so external contributions are limited to review and educational purposes.

## Development setup

**Requirements:** Node.js >= 20 (see [`.nvmrc`](./.nvmrc)) and npm.

```bash
git clone <repo-url> paxaver-mcp
cd paxaver-mcp
nvm use              # use the pinned Node version
npm install
```

### Local secrets

Create a `.dev.vars` file (gitignored) for local development:

```
JWT_SECRET=local-dev-secret-change-me
OAUTH_STATE_SECRET=local-dev-state-secret
```

For full integration testing, run the Paxaver backend worker locally and point
`API_BASE_URL` (in `wrangler.jsonc` top-level `vars`) at it. Without the
`PAXAVER_API` service binding, the client falls back to authenticated HTTPS.

### Run locally

```bash
npm run dev          # wrangler dev (Miniflare) on http://localhost:8787
npm run dev:staging  # wrangler dev --env staging
```

## Testing

Two Vitest configurations:

```bash
npm test             # runs both: vitest ( Workers-style ) + vitest.node
npm run test:node    # node-pool tests only (tests/node/**/*.test.ts)
npm run test:watch   # watch mode for the primary config
```

Test files live in `tests/`:

| File | Coverage |
| ---- | -------- |
| `tests/authz.test.ts` | `canSeeTool`, `checkToolAuthorization`, policy table |
| `tests/crypto.test.ts` | PKCE S256, state HMAC, timing-safe compare, JWT signing |
| `tests/oauth.test.ts` | OAuth authorize/token flow, CIMD, redirect-URI matching |
| `tests/protocol.test.ts` | JSON-RPC initialize, tools/list, tools/call, error codes |
| `tests/safety.test.ts` | Error sanitization, financial/destructive labeling |
| `tests/node/*.test.ts` | Node-pool tests (crypto, pure functions) |

### Smoke tests

Post-deploy smoke tests hit live endpoints and require network access:

```bash
npm run smoke:staging
npm run smoke:ca
npm run smoke:us
```

## Typecheck

```bash
npm run typecheck    # tsc --noEmit
```

The project uses `strict` mode and `noUncheckedIndexedAccess`. All type errors
must be resolved before a PR can merge.

## Lint

```bash
npm run lint         # eslint .
```

ESLint config is in [`eslint.config.js`](./eslint.config.js) (flat config,
TypeScript-aware). Lint errors must be fixed; warnings should be addressed.

## Build

```bash
npm run build              # wrangler deploy --dry-run (default env)
npm run build:staging      # wrangler deploy --dry-run --env staging
npm run wrangler:check     # dry-run for all 3 environments
```

The build is a Wrangler dry-run — it validates the bundle and config without
deploying. CI runs `wrangler:check` to ensure all environments build.

## Code style

- **TypeScript, strict.** No `any` without an explanatory comment (see
  `src/server/json-rpc.ts` for the one justified exception).
- **ESM only.** The project uses `"type": "module"` and `.js` import specifiers
  (TypeScript's `verbatimModuleSyntax`).
- **Hono for routing.** Keep route handlers thin; business logic belongs in the
  backend.
- **No business logic in the MCP server.** It is an adapter. If you find
  yourself writing domain rules, they belong in the private backend, not here.
- **Vendored contracts.** `src/lib/contracts.ts` mirrors private names. If the
  backend's capability/role model changes, update this file to match.
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
   npm run typecheck && npm run lint && npm test && npm run wrangler:check
   ```
4. Update [`CHANGELOG.md`](./CHANGELOG.md) under an `## [Unreleased]` section.
5. Open a PR with a clear description. Link any related backend changes.
6. CI must be green. Request review from a maintainer.
7. Squash-merge to `main`. The commit message should follow
   [Conventional Commits](https://www.conventionalcommits.org/) where practical.

### Adding a new tool

1. Add the tool definition to the appropriate file in `src/schemas/` and export
   it from `src/schemas/index.ts` (add to `ALL_TOOLS`).
2. Add a policy entry in `src/lib/policy.ts` (`TOOL_POLICIES`).
3. Add a `case` in `src/tools/dispatch.ts` mapping the tool to a backend API
   path. Set `idempotencyKey` for mutations.
4. Add tests in `tests/authz.test.ts` (visibility/authorization) and
   `tests/protocol.test.ts` (dispatch) as appropriate.
5. Document the tool in [`docs/tools.md`](./docs/tools.md).
6. Update the tool count in [`README.md`](./README.md) if needed.

## Questions

Internal team: ping in the Paxaver engineering channel. External: this repo is
source-available for review; we do not accept external PRs at this time.
