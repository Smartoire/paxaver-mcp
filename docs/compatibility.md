# Compatibility

## MCP protocol version

The server implements MCP protocol version **`2025-06-18`**, returned in the
`initialize` response `result.protocolVersion` and expected in the
`MCP-Protocol-Version` request header.

## Transports

### Streamable HTTP

The only transport, per the `2025-06-18` spec:

| Method   | Path   | Purpose                                                                           |
| -------- | ------ | --------------------------------------------------------------------------------- |
| `POST`   | `/mcp` | JSON-RPC requests/responses. `initialize` returns `Mcp-Session-Id`.               |
| `GET`    | `/mcp` | Opens an SSE stream for server→client notifications (endpoint event + heartbeat). |
| `DELETE` | `/mcp` | Terminates a session.                                                             |

- `Accept: application/json, text/event-stream` is supported on `POST /mcp`.
- `Mcp-Session-Id` is returned on `initialize` and expected on subsequent
  requests. In this stateless deployment the session ID is a correlation token;
  auth is re-validated on every request via the Bearer token, so a missing or
  unknown session ID is tolerated (logged, not errored).
- Heartbeat interval: 15 seconds.

## OAuth client types

| Type       | `client_id` form              | Auth method                           | Use case                                  |
| ---------- | ----------------------------- | ------------------------------------- | ----------------------------------------- |
| CIMD       | HTTPS URL (metadata document) | `none` (PKCE)                         | ChatGPT, Claude, Perplexity               |
| Registered | opaque string                 | `client_secret_post` or `none` (PKCE) | Custom integrations via `/oauth/register` |

CIMD is advertised via `client_id_metadata_document_supported: true` in the
RFC 8414 metadata. See [authentication.md](./authentication.md).

## Supported AI clients

Tested against:

| Client                 | Transport       | Auth        | Notes                                                                           |
| ---------------------- | --------------- | ----------- | ------------------------------------------------------------------------------- |
| **ChatGPT** (OpenAI)   | Streamable HTTP | CIMD + PKCE | Marketplace connector; requires `CHATGPT_VERIFY_TOKEN` for domain verification. |
| **Claude** (Anthropic) | Streamable HTTP | CIMD + PKCE |                                                                                 |
| **Perplexity**         | Streamable HTTP | CIMD + PKCE |                                                                                 |

Any MCP-compatible client that implements OAuth 2.1 Authorization Code + PKCE
S256 and follows RFC 9728 / RFC 8414 discovery should work.

## Discovery

Clients discover the server via:

- `GET /.well-known/oauth-protected-resource` (RFC 9728) — returned in the
  `WWW-Authenticate` header on `401`.
- `GET /.well-known/oauth-authorization-server` (RFC 8414) — authorization
  server metadata.

## Breaking changes from v1

v2.0.0 (this version) introduced the following breaking changes relative to the
legacy `mcp-server/` that lived in the private monorepo:

| Area             | v1 (legacy)                      | v2 (this repo)                                                                                             |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Transport        | SSE only (`/sse` + `/messages`)  | Streamable HTTP (`POST /mcp`) only; legacy SSE removed.                                                    |
| Protocol version | `2024-11-05`                     | `2025-06-18`                                                                                               |
| Auth             | Static bearer tokens (D1-backed) | OAuth 2.1 Authorization Code + PKCE S256; static tokens retained as legacy fallback via `/api/mcp/whoami`. |
| Data access      | Direct D1 binding                | Service binding to backend only; no D1.                                                                    |
| Repo             | Embedded in private monorepo     | Standalone repo, vendored contracts, zero private-code dependency.                                         |
| Deployment       | Single Worker                    | Two environments (staging, production). Production routes to both CA and US backends.                      |
| Discovery        | None                             | RFC 9728 + RFC 8414 + ChatGPT domain verification.                                                         |
| CORS             | Reflect origin                   | Allowlist with wildcard subdomain support.                                                                 |

See [migration.md](./migration.md) for migration notes.

## Runtime compatibility

- **Cloudflare Workers** with `compatibility_date: 2026-08-01` and
  `nodejs_compat`.
- Requires the `PAXAVER_API` service binding in production; falls back to
  authenticated HTTPS in local dev.
- No Durable Objects or KV required (stateless). Sessions are per-isolate
  correlation tokens, not durable state.
