# Migration: v1 (`mcp-server/` in the private monorepo) → v2 (this repo)

This document tracks what moved, what changed, and what was deprecated when the
MCP server was extracted from the private Paxaver monorepo into this standalone
repository.

## What moved

The entire `mcp-server/` package from the private monorepo was extracted into
this repo. Specifically:

| Source (private monorepo) | Destination (this repo) | Notes |
| ------------------------- | ----------------------- | ----- |
| `mcp-server/src/index.ts` | `src/index.ts` | Rewritten as Hono app with CORS, security headers, auth middleware. |
| `mcp-server/src/tools/*` | `src/tools/dispatch.ts` + `src/schemas/*` | Tool definitions split into schema files; dispatch centralized. |
| `mcp-server/src/auth/*` | `src/auth/*` | OAuth 2.1 added; static-token path retained as legacy. |
| `mcp-server/src/policy.ts` | `src/lib/policy.ts` | Expanded to full per-tool policy table. |
| `mcp-server/src/contracts.ts` | `src/lib/contracts.ts` | Vendored; no longer imports private packages. |
| `mcp-server/wrangler.toml` | `wrangler.jsonc` | Migrated to JSONC; three environments added. |
| `mcp-server/package.json` | `package.json` | Scoped as `@paxaver/mcp`, private, UNLICENSED. |

## What changed

### Architecture: no direct D1 access

**v1** bound D1 directly and queried the database for user context, orders,
wallet, etc. **v2** removes the D1 binding entirely. All data access flows
through the Paxaver backend API via a Cloudflare service binding (`PAXAVER_API`).

This is the most significant change. It means:

- The MCP server no longer holds database credentials.
- All business logic and authorization live in the backend.
- The MCP server is a thin protocol adapter.

### Transport: Streamable HTTP

**v1** used SSE-only transport (`GET /sse` + `POST /messages`). **v2** adopts
Streamable HTTP (`POST /mcp`) as the primary transport, per MCP `2025-06-18`.
The legacy SSE endpoints are retained as a compatibility shim for older clients.

### Auth: OAuth 2.1

**v1** used static bearer tokens stored in D1. **v2** implements a full OAuth 2.1
authorization server: Authorization Code + PKCE (S256), with RFC 9728 / RFC 8414
discovery and CIMD support for ChatGPT/Claude/Perplexity.

### Backend endpoints added

To support the service-binding architecture, the following endpoints were added
to the Paxaver backend (private repo). They are the contract this MCP server
depends on:

| Endpoint | Purpose |
| -------- | ------- |
| `GET /api/users/me/context` | Returns the `AuthContext` (permissions, schoolSlug, studentIds, isPlatformAdmin) for the authenticated user. Called on every MCP request. |
| `GET /api/mcp/whoami` | Validates a legacy static MCP token and returns `AuthContext`. Backwards-compat for v1 tokens. |
| `POST /api/auth/mcp-login` | Authenticates email/password for the OAuth login form. Returns `userId`. |
| `POST /api/mcp/oauth-codes` | Issues an authorization code (stores code + PKCE challenge + redirect URI). |
| `POST /api/mcp/oauth-token-exchange` | Exchanges a code for user ID + scope (validates code, PKCE, redirect URI, client). |
| `POST /api/mcp/oauth-clients` | Registers an OAuth client (RFC 7591). |
| `GET /api/mcp/oauth-clients/validate` | Validates a registered client ID and returns redirect URIs. |

### Vendored contracts

**v1** imported capability/role/classification types from the private
`@paxaver/shared` package. **v2** vendors a minimal mirror in
`src/lib/contracts.ts` so this repo compiles with zero private-code dependency.
If the private model changes, update the names in `contracts.ts` to match.

### Deployment: three environments

**v1** deployed a single Worker. **v2** deploys three: `staging`
(`mcp.paxaver.dev`), `production-ca` (`mcp.paxaver.ca`), and `production-us`
(`mcp.paxaver.com`), each with regional isolation and a same-region service
binding.

## What was deprecated

### Direct D1 access

**Removed.** The MCP server no longer queries D1. Any code that did so in v1
was replaced with service-binding calls. There is no migration path for direct
D1 access — it is intentionally gone.

### Static bearer tokens

**Deprecated, not removed.** v1 static tokens still work via the backend's
`/api/mcp/whoami` endpoint (`src/auth/validate.ts` legacy path). New
integrations should use OAuth. Existing tokens continue to function until
explicitly revoked, but no new static tokens should be issued.

### SSE-only transport

**Superseded.** `GET /sse` + `POST /messages` still work but are a compatibility
shim. New clients should use `POST /mcp` (Streamable HTTP).

## Migration checklist for operators

- [ ] Deploy the backend with the new `/api/*` endpoints listed above.
- [ ] Set `JWT_SECRET` on the MCP Worker **identical** to the backend's.
- [ ] Set `OAUTH_STATE_SECRET` on the MCP Worker.
- [ ] Configure the `PAXAVER_API` service binding (same region) in the
      Cloudflare dashboard.
- [ ] Configure custom domains (`mcp.paxaver.dev`, `.ca`, `.com`) in Cloudflare.
- [ ] Set `CHATGPT_VERIFY_TOKEN` if listing on the ChatGPT marketplace.
- [ ] Deploy staging first and run `npm run smoke:staging`.
- [ ] Notify existing static-token users to migrate to OAuth; revoke old tokens
      when ready.

## Compatibility

v2 is **not** wire-compatible with v1 clients that hardcode the SSE transport
and lack PKCE. Such clients should be upgraded. The legacy SSE endpoints ease
the transition but OAuth is required for new sessions.
