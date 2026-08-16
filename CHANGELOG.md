# Changelog

All notable changes to the Paxaver MCP server are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-08-12

Extraction of the MCP server from the private Paxaver monorepo into a standalone
repository. This is a major release with breaking changes.

### Added

- **Standalone repository.** The MCP server is now its own repo
  (`@paxaver/mcp`) with vendored contracts (`src/lib/contracts.ts`) and zero
  compile-time dependency on private code.
- **OAuth 2.1 authorization server.** Full Authorization Code + PKCE (S256)
  flow with hosted login page, RFC 9728 (Protected Resource Metadata) and
  RFC 8414 (Authorization Server Metadata) discovery endpoints, and dynamic
  client registration (RFC 7591).
- **Client ID Metadata Document (CIMD) support.** ChatGPT, Claude, and
  Perplexity can authenticate via published metadata documents with PKCE (no
  client secret).
- **ChatGPT marketplace domain verification.** `/.well-known/openai-apps-challenge`
  endpoint for `CHATGPT_VERIFY_TOKEN`.
- **Streamable HTTP transport.** `POST /mcp` as the primary MCP endpoint per
  protocol version `2025-06-18`, with `GET /mcp` (SSE stream) and
  `DELETE /mcp` (session termination).
- **Service binding architecture.** The MCP worker calls the Paxaver backend
  via a same-region Cloudflare service binding (`PAXAVER_API`) carrying a
  short-lived (120s) HS256 service JWT. No D1 binding.
- **Three deployment environments.** `staging` (`mcp.paxaver.dev`),
  `production-ca` (`mcp.paxaver.ca`), `production-us` (`mcp.paxaver.com`) with
  regional isolation and per-region service bindings.
- **Per-tool capability policy table.** Every tool has an explicit
  `TOOL_POLICIES` entry with capability, entitlement requirement,
  classifications, required roles, mutation/financial/destructive flags, and
  confirmation requirement.
- **Tool visibility filtering.** `tools/list` omits tools the caller cannot
  use based on `canSeeTool`.
- **Defense-in-depth authorization.** `checkToolAuthorization` at the MCP
  layer plus backend re-checks for school membership, student ownership, and
  entitlement.
- **Idempotency keys.** Mutating tool calls include an `Idempotency-Key`
  header derived from tool + correlation ID + critical args.
- **CORS allowlist.** Origin-based allowlist with wildcard subdomain support;
  no reflect-any-origin.
- **CSRF-protected OAuth state.** HMAC-signed state tokens with timing-safe
  verification.
- **Security headers.** `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` on all responses.
- **Error sanitization.** Backend errors mapped to generic MCP error codes;
  no internal detail leakage.
- **Correlation IDs.** `X-Correlation-Id` on every request/response for
  tracing.
- **Legacy static token fallback.** v1 static tokens still work via backend
  `/api/mcp/whoami`.
- **Legacy SSE compatibility.** `GET /sse` + `POST /messages` retained for
  older clients.
- **GitHub Actions CI.** Typecheck, lint, dual Vitest configs, Wrangler
  dry-run for all 3 environments, and a no-secrets scan.
- **Documentation suite.** README, architecture, authentication,
  authorization, tools, deployment, security, compatibility, migration,
  SECURITY, CONTRIBUTING.

### Changed

- **Protocol version** bumped from `2024-11-05` to `2025-06-18`.
- **Transport** changed from SSE-only to Streamable HTTP (primary) with SSE as
  a compat shim.
- **Data access** changed from direct D1 binding to service-binding-only.
- **User context loading** moved from D1 queries to backend
  `GET /api/users/me/context` over the service binding, called on every
  request.
- **Wrangler config** migrated from `wrangler.toml` to `wrangler.jsonc` with
  three named environments.
- **Package** scoped as `@paxaver/mcp`, marked `private: true`,
  `license: UNLICENSED`.

### Deprecated

- **Static bearer tokens.** Still functional via `/api/mcp/whoami` but
  deprecated; new integrations should use OAuth.
- **SSE-only transport** (`/sse` + `/messages`). Retained as a compatibility
  shim; new clients should use `POST /mcp`.

### Removed

- **Direct D1 binding.** The MCP worker no longer binds or queries D1.
- **Direct Stripe / SES access.** Removed from the MCP worker; all such
  operations go through the backend.
- **Private package imports.** `@paxaver/shared` imports replaced with
  vendored contracts.

### Security

- No D1, Stripe, or SES credentials in the MCP worker.
- Service JWTs with 120s TTL and `paxaver-internal` audience.
- PKCE S256-only enforcement.
- Timing-safe comparisons for state tokens and secrets.
- Allowlisted CORS with `Vary: Origin`.
- Sanitized error responses; no stack traces leaked.
- Security headers on all responses.
- Immediate revocation via per-request context reload.

### Migration

See [`docs/migration.md`](./docs/migration.md) for the full migration guide
from v1 (`mcp-server/` in the private monorepo).

## [1.x] — end of life

The legacy `mcp-server/` that lived in the private Paxaver monorepo. SSE-only
transport, static bearer tokens, direct D1 access. No longer supported.
