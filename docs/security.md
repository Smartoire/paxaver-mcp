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
auth worker (`paxaver.com/auth`).

Validation flow:

1. Extract Bearer token from `Authorization` header.
2. Verify RS256 signature against the auth worker's JWKS.
3. Check `iss`, `aud`, `exp`.
4. Extract `tenant_id` from JWT claims to determine user region (CA/US).
5. Call the regional backend's `/api/users/me/context` to load the
   full `AuthContext` (permissions, schoolSlug, studentIds, country).
6. Attach `AuthContext` to the request for downstream authorization.

Legacy static MCP tokens have been removed. All requests must use OAuth 2.1.

## Authorization

Capability-first: the MCP server checks the user's permissions before
dispatching a tool call. The backend re-checks data-level access
(defense-in-depth).

See [authorization.md](./authorization.md) for the full policy table.

## CORS

The MCP server uses an allowlist-based CORS policy. Production allows:

- `https://paxaver.com`, `https://*.paxaver.com`
- `https://paxaver.ca`, `https://*.paxaver.ca`
- `https://paxaver.mx`, `https://*.paxaver.mx`
- `https://chatgpt.com`, `https://openai.com`, `https://*.openai.com`
- `https://claude.ai`
- `https://www.perplexity.ai`
- `https://glama.ai`, `https://*.glama.ai`
- `https://policylayer.com`, `https://*.policylayer.com`
- `https://vscode.dev`, `https://insiders.vscode.dev`
- `https://*.teams.microsoft.com`, `https://*.cloud.microsoft`

Wildcard subdomains are supported via the `*.domain` pattern. The VS Code
and Microsoft 365/Teams origins exist so browser-hosted MCP clients
(vscode.dev, Teams web, M365 Copilot) can run the OAuth discovery, DCR,
and token legs against this worker.

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

`INTERNAL_SERVICE_SECRET` and `ALEXA_SKILL_ID` are set as Worker secrets
(`wrangler secret put`, see [deployment.md](deployment.md#secrets)). They never
appear in source code or configuration files.

## Regional routing

The single MCP endpoint (`mcp.paxaver.com`) routes to the correct
regional backend based on the authenticated user's tenant country:

- `tenant_id` ending in `-us` → US backend (`PAXAVER_API_US`)
- `tenant_id` ending in `-mx` → MX backend (`PAXAVER_API_MX`)
- All others → CA backend (`PAXAVER_API_CA`)

This ensures user data never crosses regions. Service bindings are
same-account, same-region Cloudflare internal calls — no public network
hop.

## Alexa request verification

`POST /alexa` accepts only requests that Amazon signed for this skill
(`src/alexa/verify-request.ts`). Any failure returns `400`:

- `SignatureCertChainUrl`, after normalization: scheme `https`, host
  `s3.amazonaws.com`, path starts with `/echo.api/` (case-sensitive), port
  443 when present.
- The certificate chain: all certificates are within their validity dates,
  the signing certificate has the SAN `echo-api.amazon.com`, each certificate
  is signed by the next one (a CA), and the chain ends at a bundled public
  root (Amazon Root CA 1 or Starfield Services Root CA G2,
  `src/alexa/roots.ts`).
- `Signature-256`: RSASSA-PKCS1-v1_5 with SHA-256 over the raw body.
- `request.timestamp` is within 150 seconds of the current time.
- The application id equals `ALEXA_SKILL_ID`. In staging and production an
  unset `ALEXA_SKILL_ID` rejects every request. Only `development` skips the
  signature check.

The worker does not verify the Alexa access token. The regional backend does
that. When `INTERNAL_SERVICE_SECRET` is set, the worker sends it to the
backend, so the backend can accept skill calls only from this worker.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md) for the vulnerability reporting policy.
