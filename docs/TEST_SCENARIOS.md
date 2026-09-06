# Paxaver MCP Test Scenarios

This document lists the test scenarios for the Paxaver MCP server. It is intended to guide current and future test coverage.

## Test Infrastructure

- **Unit tests**: [Vitest](https://vitest.dev/) (`vitest.config.ts` at project root).
  - Run: `pnpm test` or `npx vitest run`
  - Watch: `npx vitest`
- **Node tests**: `vitest.node.config.ts` for Node-environment tests.
  - Run: `pnpm test:node`
- **Smoke tests**: `vitest.smoke.config.ts` for staging and production smoke checks.
  - Run: `pnpm test:smoke`
- **Build**: `pnpm build` (Wrangler dry-run deploy)
- **Typecheck**: `pnpm typecheck`
- **Lint**: `pnpm lint`
- **Format**: `pnpm format:check`
- **Security audit**: `pnpm security:audit`

## Unit Test Scenarios

### Authorization Policy (`apps/mcp/tests/authz.test.ts`)

- [x] Every tool has a policy entry in `TOOL_POLICIES`.
- [x] `canSeeTool` returns correct visibility based on user capabilities.
- [x] `checkToolAuthorization` enforces role gating per tool.
- [x] `getToolPolicy` returns the policy for a given tool name.

### Crypto Helpers (`apps/mcp/tests/crypto.test.ts`)

- [x] `generateSessionId` produces a valid hex string.
- [x] Session IDs are unique across multiple calls.

### Protocol (`apps/mcp/tests/protocol.test.ts`)

- [x] `initialize` handshake returns correct protocol version and capabilities.
- [x] `ping` returns pong.
- [x] `tools/list` returns all visible tools for the authenticated user.
- [x] `tools/call` executes a tool and returns the result.
- [x] Session lifecycle: initialize, use, delete works correctly.
- [x] Unknown method returns a JSON-RPC error.

### Errors (`apps/mcp/tests/errors.test.ts`)

- [x] `mcpError` produces a valid JSON-RPC error response.
- [x] `mcpError` includes data when provided, omits when undefined.
- [x] `mcpError` accepts null id.
- [x] `apiErrorToMcp` maps 401, 403, 404, 409, 429, 422 to correct codes.
- [x] `apiErrorToMcp` maps unknown status to internal error.
- [x] `apiErrorToMcp` never leaks backend details (D1, Stripe, stack traces).

### Discovery (`apps/mcp/tests/discovery.test.ts`)

- [x] ChatGPT domain verification returns token when configured.
- [x] ChatGPT domain verification returns 404 when not configured.
- [x] RFC 9728 protected resource metadata returns correct shape.
- [x] RFC 9728 points to staging auth in staging, localhost in development.
- [x] RFC 8414 authorization server metadata returns correct endpoints.
- [x] `/oauth` and `/oauth/` redirect to authorization server metadata.

### Protocol Version (`apps/mcp/tests/protocol-version.test.ts`)

- [x] `PROTOCOL_VERSION` is a valid date-based version string.
- [x] `PROTOCOL_VERSION` is `2025-06-18`.

### Safety (`apps/mcp/tests/safety.test.ts`)

- [x] Malformed JSON input returns an error.
- [x] Oversized input is rejected.
- [x] Unknown tool name returns an error.
- [x] Prompt-injection content in tool results is treated as data, not instructions.

### Regional Routing (`apps/mcp/tests/node/regional.test.ts`)

- [x] CA users route to the CA backend service binding.
- [x] US users route to the US backend service binding.
- [x] Unknown region defaults to CA.

## Smoke Test Scenarios

### Staging (`apps/mcp/tests/smoke/staging.smoke.ts`)

- [ ] Staging endpoint responds to MCP initialize handshake.
- [ ] Staging `tools/list` returns expected tools.
- [ ] Staging OAuth discovery endpoints return correct metadata.

### Production (`apps/mcp/tests/smoke/prod.smoke.ts`)

- [ ] Production endpoint responds to MCP initialize handshake.
- [ ] Production `tools/list` returns expected tools.
- [ ] Production OAuth discovery endpoints return correct metadata.

## API Smoke Test Scenarios

### HTTP Surface (`tests/api/mcp.spec.ts`)

- [ ] `GET /` returns 200 or 404.
- [ ] `GET /.well-known/oauth-protected-resource` returns resource metadata.
- [ ] `GET /.well-known/oauth-authorization-server` returns auth metadata.
- [ ] `POST /mcp` without auth returns 401.
- [ ] `POST /mcp` with invalid token returns 401.
- [ ] `server/discover` returns supported versions.

## Adding New Tests

1. **Unit tests**: Add `*.test.ts` in `apps/mcp/tests/`. Use Vitest and import from `../src/`.
2. **Node tests**: Add `*.test.ts` in `apps/mcp/tests/node/` for tests requiring Node APIs.
3. **Smoke tests**: Add `*.ts` in `apps/mcp/tests/smoke/` for environment-specific checks.
4. Update this document to mark the scenario as `[x]` once covered.
