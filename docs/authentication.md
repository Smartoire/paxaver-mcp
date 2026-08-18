# Authentication

The Paxaver MCP server is a **resource server**, not an authorization server.
Authentication is delegated to the centralized Paxaver auth worker
(`auth.paxaver.com`), which serves as the OAuth 2.0 / OIDC authorization server.
The MCP server validates the resulting RS256 JWTs via JWKS and forwards them to
the backend on every request.

## Flow at a glance

```
AI Client             Auth Worker               MCP Server            Paxaver Backend
   │                (auth.paxaver.com)        (mcp.paxaver.com)
   │                       │                       │                       │
   │  1. OAuth 2.0 Authorization Code + PKCE      │                       │
   │     GET /authorize    │                       │                       │
   │ ─────────────────────▶│                       │                       │
   │  2. Login + consent   │                       │                       │
   │ ◀─────────────────────│                       │                       │
   │  3. POST /token       │                       │                       │
   │ ─────────────────────▶│                       │                       │
   │  4. RS256 access JWT  │                       │                       │
   │ ◀─────────────────────│                       │                       │
   │                       │                       │                       │
   │  5. POST /mcp         │                       │                       │
   │  Authorization:       │                       │                       │
   │    Bearer <JWT>       │                       │                       │
   │ ─────────────────────────────────────────────▶│                       │
   │                       │  verify JWT via JWKS  │                       │
   │                       │  (from auth worker)   │                       │
   │                       │                       │  GET /api/users/me/context
   │                       │                       │ ─────────────────────▶│
   │                       │                       │ ◀── AuthContext ──────│
   │                       │                       │  forward JWT to backend│
   │                       │                       │  for tool dispatch     │
   │  6. MCP response      │                       │                       │
   │ ◀─────────────────────────────────────────────│                       │
```

## JWT validation

The MCP server validates RS256 JWTs using the auth worker's JWKS endpoint
(`src/auth/validate.ts`):

```ts
const { payload } = await jwtVerify(token, jwks, {
  algorithms: ['RS256'],
  issuer,        // auth.paxaver.com (or auth.paxaver.dev / localhost)
  audience: ['paxaver-api', 'mcp', origin],
});
```

The JWKS is fetched from `{issuer}/.well-known/jwks.json` and cached per-isolate
(`src/auth/validate.ts:34`). Workers isolates are short-lived, so the cache is
effectively per-request.

### Token claims

| Claim | Value |
| ----- | ----- |
| `sub` | Paxaver user ID |
| `iss` | Auth worker origin (`https://auth.paxaver.com`) |
| `aud` | `paxaver-api`, `mcp`, or the request origin |
| `tenant_id` | User tenant ID (used for regional routing) |
| `exp` | Token expiration |

### Regional routing

The user's region is determined from the JWT `tenant_id` claim:
- `tenant_id` ending in `-us` → routes to `PAXAVER_API_US` (US backend)
- All others → routes to `PAXAVER_API_CA` (CA backend)

## Context loading

A valid JWT alone is not sufficient. On every MCP request, the server calls the
backend's `GET /api/users/me/context` over the service binding to load the
**live** user context:

```ts
AuthContext {
  userId, email, schoolSlug, permissions[], isPlatformAdmin, studentIds[], country
}
```

If the user has been deactivated, removed from the school, or had permissions
revoked since the token was issued, the context call fails and the request is
rejected with `401`. There is no cached session trust — revocation is immediate.

The user's JWT is forwarded to the backend as `Authorization: Bearer <token>`,
so the backend performs its own authorization checks (defense-in-depth).

## Discovery endpoints

### RFC 9728 — Protected Resource Metadata

`GET /.well-known/oauth-protected-resource`

```json
{
  "resource": "https://mcp.paxaver.com",
  "authorization_servers": ["https://auth.paxaver.com"],
  "scopes_supported": ["tools"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://github.com/Smartoire/paxaver-mcp/blob/main/docs/security.md"
}
```

When a request arrives without a valid bearer token, the `401` response includes
a `WWW-Authenticate` header pointing the client here:

```
Bearer resource_metadata="https://mcp.paxaver.com/.well-known/oauth-protected-resource", scope="tools"
```

### RFC 8414 — Authorization Server Metadata

`GET /.well-known/oauth-authorization-server`

Delegates to the auth worker's OIDC discovery. The MCP server returns metadata
pointing to `auth.paxaver.com` as the authorization server:

```json
{
  "issuer": "https://auth.paxaver.com",
  "authorization_endpoint": "https://auth.paxaver.com/authorize",
  "token_endpoint": "https://auth.paxaver.com/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "email", "tools", "offline_access"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "jwks_uri": "https://auth.paxaver.com/.well-known/jwks.json"
}
```

`GET /oauth` and `GET /oauth/` redirect to this document for convenience.

## Legacy static token support

For backwards compatibility, a request whose bearer token is **not** a valid
RS256 JWT is delegated to the backend's `GET /api/mcp/whoami` endpoint.
The backend validates legacy static MCP client tokens and returns the same
`AuthContext` shape. The MCP server tries CA first, then US, since the region
cannot be determined from a static token.

> Legacy static tokens are deprecated. New integrations should use the OAuth
> flow via the auth worker. See [`docs/migration.md`](./migration.md).

## ChatGPT marketplace verification

`GET /.well-known/openai-apps-challenge` returns the `CHATGPT_VERIFY_TOKEN`
secret as plain text, satisfying ChatGPT's domain-ownership verification for
the marketplace connector. Returns `404` if the token is not configured.
