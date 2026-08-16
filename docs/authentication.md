# Authentication

The Paxaver MCP server is its own OAuth 2.1 authorization server. AI clients
authenticate end users with the **Authorization Code + PKCE (S256)** flow and
receive a bearer JWT that is validated on every MCP request.

## Flow at a glance

```
AI Client                MCP Server (authz server)        Paxaver Backend
   │                            │                               │
   │  1. GET /oauth/authorize   │                               │
   │  ?response_type=code       │                               │
   │  &client_id=...            │                               │
   │  &redirect_uri=...         │                               │
   │  &code_challenge=...       │                               │
   │  &code_challenge_method=S256                                │
   │  &state=...                │                               │
   │ ─────────────────────────▶ │                               │
   │                            │  validate client + redirect   │
   │  2. HTML login page        │                               │
   │ ◀───────────────────────── │                               │
   │  3. POST /oauth/authorize  │                               │
   │     (email + password)     │                               │
   │ ─────────────────────────▶ │  POST /api/auth/mcp-login     │
   │                            │ ────────────────────────────▶ │
   │                            │  ◀── userId ──────────────────│
   │                            │  POST /api/mcp/oauth-codes    │
   │                            │ ────────────────────────────▶ │
   │                            │  ◀── code ────────────────────│
   │  4. 302 redirect           │                               │
   │     ?code=...&state=...    │                               │
   │ ◀───────────────────────── │                               │
   │                            │                               │
   │  5. POST /oauth/token      │                               │
   │     code + code_verifier   │                               │
   │ ─────────────────────────▶ │  POST /api/mcp/oauth-token-exchange
   │                            │ ────────────────────────────▶ │
   │                            │  ◀── userId, scope ───────────│
   │                            │  sign OAuth access JWT        │
   │  6. access_token (JWT)     │                               │
   │ ◀───────────────────────── │                               │
   │                            │                               │
   │  7. POST /mcp              │                               │
   │  Authorization: Bearer ... │                               │
   │ ─────────────────────────▶ │  verify JWT + load context    │
```

## PKCE — S256 only

PKCE (RFC 7636) is **required**. The only accepted `code_challenge_method` is
`S256`. Plain and `plain` challenges are rejected at `/oauth/authorize` before
any login form is rendered.

Verification (`src/lib/crypto.ts`):

```ts
verifyPkceS256(codeVerifier, codeChallenge)
  → base64url(SHA-256(codeVerifier)) === codeChallenge
```

The code challenge is stored by the backend alongside the authorization code and
re-checked during token exchange (`/api/mcp/oauth-token-exchange`). The MCP
server itself does not store codes — it delegates issuance and exchange to the
backend so that code storage, PKCE validation, and redirect-URI matching all
happen server-side.

## Discovery endpoints

### RFC 9728 — Protected Resource Metadata

`GET /.well-known/oauth-protected-resource`

```json
{
  "resource": "https://mcp.paxaver.com",
  "authorization_servers": ["https://mcp.paxaver.com"],
  "scopes_supported": ["tools"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://mcp.paxaver.com/docs/security"
}
```

When a request arrives without a valid bearer token, the `401` response includes
a `WWW-Authenticate` header pointing the client here:

```
Bearer resource_metadata="https://mcp.paxaver.com/.well-known/oauth-protected-resource", scope="tools"
```

### RFC 8414 — Authorization Server Metadata

`GET /.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://mcp.paxaver.com",
  "authorization_endpoint": "https://mcp.paxaver.com/oauth/authorize",
  "token_endpoint": "https://mcp.paxaver.com/oauth/token",
  "registration_endpoint": "https://mcp.paxaver.com/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["tools"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "client_id_metadata_document_supported": true,
  "service_documentation": "https://mcp.paxaver.com/docs/authentication"
}
```

`GET /oauth` and `GET /oauth/` redirect to this document for convenience.

## Client types

### Client ID Metadata Document (CIMD)

For AI platforms that publish a client metadata document at an HTTPS URL (the
approach used by ChatGPT and Claude), the `client_id` **is** that URL. The MCP
server fetches the document (cached 300s at the edge), reads `client_name` and
`redirect_uris`, and validates the `redirect_uri` against them.

Allowed CIMD hosts (`ALLOWED_CIMD_HOSTS` in `src/auth/oauth.ts`):

- `chatgpt.com` (and subdomains)
- `chat.openai.com`
- `openai.com`
- `claude.ai`
- `anthropic.com`
- `perplexity.ai`, `www.perplexity.ai`

If the metadata document is unreachable, a conservative default redirect-URI
allowlist is used. CIMD clients use `token_endpoint_auth_method: none` (public
client) — security comes from PKCE, not a client secret.

### Registered OAuth clients (RFC 7591)

`POST /oauth/register` accepts a client registration request and delegates
storage to the backend (`POST /api/mcp/oauth-clients`). Registered clients
receive a `client_id` and optional `client_secret` and are validated at
`/oauth/authorize` via `GET /api/mcp/oauth-clients/validate`. These support
`client_secret_post` authentication at the token endpoint.

## CSRF protection on the authorization endpoint

The `state` parameter from the AI client is wrapped in an **HMAC-signed token**
before being round-tripped through the login form (`src/lib/crypto.ts`):

```
stateToken = payload + "." + base64url(HMAC-SHA256(OAUTH_STATE_SECRET, payload))
```

On `POST /oauth/authorize`, the signed state is verified with a **timing-safe**
comparison. This binds the state to the issuer origin and prevents CSRF on the
authorization endpoint even though the login form is a standard POST.

## Token format

Access tokens are **JWTs** signed with `JWT_SECRET` (HS256), via `jose`:

| Claim | Value |
| ----- | ----- |
| `sub` | Paxaver user ID |
| `type` | `mcp_oauth` |
| `scope` | `tools` (or negotiated scope) |
| `iss` | MCP worker origin (e.g. `https://mcp.paxaver.com`) |
| `aud` | `mcp`, or the `resource` parameter from the token request |
| `iat` | issued-at |
| `exp` | `iat + 86400` (24 hours) |
| `jti` | random UUID (for revocation / audit) |

Validation (`src/auth/validate.ts`) accepts audience **`mcp`** or the request
origin, so a token issued for a specific `resource` still validates at the
issuer's own endpoint.

### Context loading

A valid JWT alone is not sufficient. On every MCP request, the server calls the
backend's `GET /api/users/me/context` over the service binding to load the
**live** user context:

```ts
AuthContext {
  userId, email, schoolSlug, permissions[], isPlatformAdmin, studentIds[]
}
```

If the user has been deactivated, removed from the school, or had permissions
revoked since the token was issued, the context call fails and the request is
rejected with `401`. There is no cached session trust — revocation is immediate.

## Legacy static token support

For backwards compatibility, a request whose bearer token is **not** a valid
`mcp_oauth` JWT is delegated to the backend's `GET /api/mcp/whoami` endpoint.
The backend validates legacy static MCP client tokens and returns the same
`AuthContext` shape. This keeps older integrations working without the MCP
server touching D1.

> Legacy static tokens are deprecated. New integrations should use the OAuth
> flow. See [`docs/migration.md`](./migration.md).

## Google sign-in (optional)

`GET /oauth/google` initiates Google sign-in when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are configured. This is an optional convenience; the
primary flow is email/password via the hosted login page.

## ChatGPT marketplace verification

`GET /.well-known/openai-apps-challenge` returns the `CHATGPT_VERIFY_TOKEN`
secret as plain text, satisfying ChatGPT's domain-ownership verification for
the marketplace connector. Returns `404` if the token is not configured.
