# Changelog

All notable changes to the Paxaver MCP server are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] — 2026-09-27

Canonical tool catalog: 26 tools renamed to unambiguous,
domain-scoped names. Legacy names remain callable as undocumented
aliases (`TOOL_ALIASES` in `src/lib/policies.ts`) but are no longer
advertised in `tools/list`.

### Changed

- Renamed tools (legacy → canonical): `get_user_info` →
  `get_my_context`, `get_wallet_balance` → `get_my_wallet_balance`,
  `get_menu` → `get_lunch_menu`, `get_orders` → `list_my_lunch_orders`,
  `create_draft_order` → `create_lunch_order_draft`, `update_draft_order`
  → `update_lunch_order_draft`, `discard_draft_order` →
  `discard_lunch_order_draft`, `finalize_order` →
  `pay_lunch_order_draft`, `cancel_order` → `cancel_my_lunch_order`,
  `get_upcoming_events` → `list_school_events`, `create_event` →
  `create_school_event`, `update_event` → `update_school_event`,
  `cancel_event` → `cancel_school_event`, `register_event` →
  `register_for_event`, `get_my_event_registrations` →
  `list_my_event_registrations`, `cancel_event_registration` →
  `cancel_my_event_registration`, `sign_up_to_volunteer` →
  `sign_up_for_volunteer_shift`, `get_my_volunteer_signups` →
  `list_my_volunteer_signups`, `cancel_volunteer_signup` →
  `cancel_my_volunteer_signup`, `create_restaurant` →
  `create_school_restaurant`, `list_menu_items` →
  `list_restaurant_menu_items`, `create_menu_item` →
  `create_restaurant_menu_item`, `update_menu_item` →
  `update_restaurant_menu_item`, `delete_menu_item` →
  `archive_restaurant_menu_item`, `set_daily_menu` →
  `schedule_lunch_menu_item`.
- `order_lunch` removed from `tools/list`; ordering is
  draft → review → `pay_lunch_order_draft`. The legacy name stays
  callable for compatibility.
- Backend payload contracts: tool args map explicitly to the camelCase
  fields the Paxaver backend expects (draft items, tips, shift IDs,
  school slugs, tax percent); `update_school_event` deliberately keeps
  snake_case, matching the backend's `allowedFields`.
- Missing/malformed tool arguments now return JSON-RPC `-32602`
  (invalid params) instead of `-32603`.
- Menu-item `ingredients` is an array; the unused `is_available` input
  was dropped (day-level orderability is `schedule_lunch_menu_item`).
- Prompt `order_lunch_helper` renamed to `lunch_order_helper` and now
  walks the draft → review → payment flow.

## [2.4.1] — 2026-09-11

### Changed

- Aligned package version with Paxaver platform release 2.4.1. Server version is now read from `package.json` at bundle time (`src/lib/version.ts`) so the health endpoint, discovery server card, and JSON-RPC `serverInfo` cannot drift.

## [2.1.3] — 2026-08-23

### Fixed

- Author metadata corrected to Vahid Ghafarpour.

## [2.1.2] — 2026-08-23

### Fixed

- Replaced pnpm `catalog:` protocol references in `package.json` with explicit version ranges. The published 2.1.1 used `catalog:` in dependencies, which npm and yarn cannot resolve. Consumer installs failed with `EUNSUPPORTEDPROTOCOL`. All dependency and devDependency versions are now inlined for tool-agnostic installation.

## [2.1.1] — 2026-08-23

### Added

- Published `@paxaver/mcp` to the npm registry as a public package under Apache-2.0.
- `publishConfig` with `access: public` for scoped package visibility.
- `files` allowlist in `package.json` to control tarball contents.
- `keywords`, `repository`, `homepage`, and `bugs` metadata for npm discovery.
- `prepublishOnly` script: typecheck, lint, test, and build run before every publish.
- npm version badge and license badge in README.

### Changed

- License changed from proprietary and unlicensed to Apache-2.0.
- `private: true` removed from `package.json` to enable npm publishing.
- README license notice updated from proprietary to Apache-2.0.
- README quick start updated with `npm install @paxaver/mcp` instructions.

## [2.0.0] — 2026-08-12

Extraction of the MCP server from the private Paxaver monorepo into a standalone repository. This is a major release with breaking changes.

### Added

- Standalone repository. The MCP server is now its own repo (`@paxaver/mcp`) with vendored contracts (`src/lib/contracts.ts`) and zero compile-time dependency on private code.
- OAuth 2.1 authorization server. Full Authorization Code + PKCE (S256) flow with hosted login page, RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata) discovery endpoints, and dynamic client registration (RFC 7591).
- Client ID Metadata Document (CIMD) support. ChatGPT, Claude, and Perplexity can authenticate via published metadata documents with PKCE (no client secret).
- ChatGPT marketplace domain verification. `/.well-known/openai-apps-challenge` endpoint for `CHATGPT_VERIFY_TOKEN`.
- Streamable HTTP transport. `POST /mcp` as the primary MCP endpoint per protocol version `2025-06-18`, with `GET /mcp` (SSE stream) and `DELETE /mcp` (session termination).
- Service binding architecture. The MCP worker calls the Paxaver backend via a same-region Cloudflare service binding (`PAXAVER_API`) carrying a short-lived (120s) HS256 service JWT. No D1 binding.
- Two deployment environments. `staging` (`mcp.paxaver.dev`) and `production` (`mcp.paxaver.com`) with dual-region service bindings (`PAXAVER_API_CA`, `PAXAVER_API_US`) routed by JWT `tenant_id`.
- 31 MCP tools across 6 categories: user and account, wallet, orders and menu, events, admin and restaurant management.
- Per-tool capability policy table. Every tool has an explicit `TOOL_POLICIES` entry with capability, entitlement requirement, classifications, required roles, mutation/financial/destructive flags, and confirmation requirement.
- Tool visibility filtering. `tools/list` omits tools the caller cannot use based on `canSeeTool`.
- Defense-in-depth authorization. `checkToolAuthorization` at the MCP layer plus backend re-checks for school membership, student ownership, and entitlement.
- Idempotency keys. Mutating tool calls include an `Idempotency-Key` header derived from tool, correlation ID, and critical args.
- CORS allowlist. Origin-based allowlist with wildcard subdomain support. No reflect-any-origin.
- CSRF-protected OAuth state. HMAC-signed state tokens with timing-safe verification.
- Security headers. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on all responses.
- Error sanitization. Backend errors mapped to generic MCP error codes. No internal detail leakage.
- Correlation IDs. `X-Correlation-Id` on every request and response for tracing.
- Legacy static token fallback. v1 static tokens still work via backend `/api/mcp/whoami`.
- Legacy SSE compatibility. `GET /sse` and `POST /messages` retained for older clients.
- GitHub Actions CI. Typecheck, lint, dual Vitest configs, Wrangler dry-run for all environments, and a no-secrets scan.
- Documentation suite. README, architecture, authentication, authorization, tools, deployment, security, compatibility, migration, SECURITY, CONTRIBUTING.

### Changed

- Protocol version bumped from `2024-11-05` to `2025-06-18`.
- Transport changed from SSE-only to Streamable HTTP (primary) with SSE as a compatibility shim.
- Data access changed from direct D1 binding to service-binding-only.
- User context loading moved from D1 queries to backend `GET /api/users/me/context` over the service binding, called on every request.
- Wrangler config migrated from `wrangler.toml` to `wrangler.jsonc` with named environments.
- Package scoped as `@paxaver/mcp`.

### Deprecated

- Static bearer tokens. Still functional via `/api/mcp/whoami` but deprecated. New integrations should use OAuth.
- SSE-only transport (`/sse` and `/messages`). Retained as a compatibility shim. New clients should use `POST /mcp`.

### Removed

- Direct D1 binding. The MCP worker no longer binds or queries D1.
- Direct Stripe and SES access. Removed from the MCP worker. All such operations go through the backend.
- Private package imports. `@paxaver/shared` imports replaced with vendored contracts.

### Security

- No D1, Stripe, or SES credentials in the MCP worker.
- Service JWTs with 120s TTL and `paxaver-internal` audience.
- PKCE S256-only enforcement.
- Timing-safe comparisons for state tokens and secrets.
- Allowlisted CORS with `Vary: Origin`.
- Sanitized error responses. No stack traces leaked.
- Security headers on all responses.
- Immediate revocation via per-request context reload.

## [1.0.0] — 2025-12-01

### Added

- Mature MCP server embedded in the private Paxaver monorepo.
- SSE-only transport with `GET /sse` and `POST /messages` endpoints.
- Static bearer token authentication.
- Direct D1 database access for user context and tool data.
- 15 MCP tools for lunch ordering, wallet, and menu queries.
- JSON-RPC 2.0 handler with tool dispatch.
- Basic CORS support.

### Deprecated

- This version is end of life. Replaced by the standalone 2.0.0 release.

## [0.1.0] — 2025-10-01

### Added

- Initial MCP server prototype inside the Paxaver monorepo.
- Basic JSON-RPC handler with 5 tools: get user info, get wallet balance, get daily menu, order lunch, and get orders.
- SSE transport.
- Static token authentication via environment variable.
