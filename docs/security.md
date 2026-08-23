# Security

## Threat model

The MCP server is a thin adapter between AI clients (ChatGPT, Claude,
Perplexity) and the Paxaver backend. It holds no data and performs no
business logic. Its security responsibilities are:

1. Validate OAuth tokens (RS256 via JWKS).
2. Enforce capability-first authorization before dispatch.
3. Route to the correct regional backend.
4. Sanitize errors and enforce CORS.

## Authentication

All MCP requests (`POST /mcp`, `GET /mcp`, `DELETE /mcp`) require a
valid Bearer token. The token is an RS256 JWT issued by the centralized
auth worker (`auth.paxaver.com`).

Validation flow:

1. Extract Bearer token from `Authorization` header.
2. Verify RS256 signature against the auth worker's JWKS.
3. Check `iss`, `aud`, `exp`.
4. Extract `tenant_id` from JWT claims to determine user region (CA/US).
5. Call the regional backend's `/api/users/me/context` to load the
   full `AuthContext` (permissions, schoolSlug, studentIds, country).
6. Attach `AuthContext` to the request for downstream authorization.

Legacy static MCP tokens are supported as a fallback via the backend's
`/api/mcp/whoami` endpoint. New integrations must use OAuth 2.1.

## Authorization

Capability-first: the MCP server checks the user's permissions before
dispatching a tool call. The backend re-checks data-level access
(defense-in-depth).

See [authorization.md](./authorization.md) for the full policy table.

## CORS

The MCP server uses an allowlist-based CORS policy. Production allows:

- `https://paxaver.com`, `https://*.paxaver.com`
- `https://paxaver.ca`, `https://*.paxaver.ca`
- `https://chatgpt.com`
- `https://claude.ai`
- `https://www.perplexity.ai`

Wildcard subdomains are supported via the `*.domain` pattern.

## Security headers

Every response includes:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Correlation-Id` (per-request UUID for tracing)

## Error sanitization

Errors are sanitized before returning to the client. Internal paths,
stack traces, and backend details are never exposed. The standard error
format is:

```json
{
  "code": "ERROR_CODE",
  "message": "User-safe message"
}
```

## Secrets

| Secret                 | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `JWT_SECRET`           | Signs service-binding JWTs (HS256). Shared with the backend. |
| `CHATGPT_VERIFY_TOKEN` | ChatGPT marketplace domain verification.                     |

Secrets are set via `wrangler secret put` and never appear in source
code or configuration files.

## Regional routing

The single MCP endpoint (`mcp.paxaver.com`) routes to the correct
regional backend based on the authenticated user's tenant country:

- `tenant_id` ending in `-us` → US backend (`PAXAVER_API_US`)
- All others → CA backend (`PAXAVER_API_CA`)

This ensures user data never crosses regions. Service bindings are
same-account, same-region Cloudflare internal calls — no public network
hop.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md) for the vulnerability reporting policy.
