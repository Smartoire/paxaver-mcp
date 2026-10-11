# Authentication

The Paxaver MCP server is a **resource server**. Each region (CA, US, MX) has
its own auth server (`paxaver.ca/auth`, `paxaver.com/auth`, `paxaver.mx/auth`),
which issues the OAuth 2.0 / OIDC tokens. MCP clients use one authorization
server, so the MCP server also shows a **facade** authorization server on its
own origin: the user picks the region at login, and the facade sends each
OAuth call to that region's auth server (see
[architecture.md](architecture.md#mcp-oauth-routing)). The MCP server validates
the resulting RS256 JWTs via JWKS and forwards them to the backend on every
request.

## Flow at a glance

```
AI Client          Regional Auth Server         MCP Server            Paxaver Backend
   │            (paxaver.{ca,com,mx}/auth)    (mcp.paxaver.com)
   │                       │                       │                       │
   │  0. POST /oauth/register, GET /oauth/authorize (region picker)        │
   │ ─────────────────────────────────────────────▶│                       │
   │  1. OAuth 2.0 Authorization Code + PKCE       │                       │
   │     GET <issuer>/authorize (link on picker)   │                       │
   │ ─────────────────────▶│                       │                       │
   │  2. Login + consent   │                       │                       │
   │ ◀─────────────────────│                       │                       │
   │  3. POST /oauth/token (routed to the region)  │                       │
   │ ─────────────────────────────────────────────▶│                       │
   │                       │◀──────────────────────│                       │
   │  4. RS256 access JWT  │                       │                       │
   │ ◀─────────────────────────────────────────────│                       │
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
  issuer, // a regional issuer of this environment (see below)
  audience: ['paxaver-api', 'mcp', origin],
});
```

The JWKS is fetched from `{issuer}/.well-known/jwks.json` and cached per-isolate
(`src/auth/validate.ts:34`). Workers isolates are short-lived, so the cache is
effectively per-request.

### Token claims

| Claim | Value                                                        |
| ----- | ------------------------------------------------------------ |
| `sub` | Paxaver user ID                                              |
| `iss` | Regional auth server (for example `https://paxaver.ca/auth`) |
| `aud` | `paxaver-api`, `mcp`, or the request origin                  |
| `exp` | Token expiration                                             |

### Regional routing

The user's region is the region of the verified token issuer (`iss`). Only
these issuers are accepted:

| Issuer (production)        | Region | Backend          |
| -------------------------- | ------ | ---------------- |
| `https://paxaver.ca/auth`  | `ca`   | `PAXAVER_API_CA` |
| `https://paxaver.com/auth` | `us`   | `PAXAVER_API_US` |
| `https://paxaver.mx/auth`  | `mx`   | `PAXAVER_API_MX` |

Staging and development accept `https://paxaver.dev/auth` only (one dev
backend). An unknown issuer gets `401` before any backend call. All regions
publish the same signing key, so the signed `iss` claim identifies the region.

### Alexa account linking

Alexa uses its own routes (`/alexa/authorize`, `/alexa/token`, `/alexa`). The
skill endpoint routes by the same issuer table. An unknown issuer gets an
Alexa "relink your account" response. See
[architecture.md](architecture.md#alexa-routing).

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

### Token revocation check

In parallel with the context call, the server calls the backend's internal
`GET /internal/auth/verify` endpoint (service binding, guarded by the
`x-internal-secret` shared secret) with the bearer token. The endpoint rejects
tokens whose `access_tokens` row is revoked or whose OAuth client is
deactivated — closing the gap where a 30-day MCP token would otherwise remain
usable after revocation. The check fails closed:

- `401` or `403` from the endpoint (token not active) rejects the request with
  `401`.
- Any other non-2xx response or a transport error gets one retry. If the retry
  also fails, the request is rejected with `503` (`AUTH_UNAVAILABLE`).

The check needs `INTERNAL_SERVICE_SECRET`. In staging and production, a worker
without the secret rejects every authenticated request with `503` and
`GET /health` returns `503` with `status: "degraded"`. Only
`ENVIRONMENT=development` skips the check when the secret is unset (a warning
is logged once per isolate) and uses JWKS + live context.

The user's JWT is forwarded to the backend as `Authorization: Bearer <token>`,
so the backend performs its own authorization checks (defense-in-depth).

## Discovery endpoints

The MCP JSON-RPC `server/discover` method is public so clients can inspect supported protocol versions without authenticating. Other `/mcp` requests still require a valid bearer token; tools and protected operations also retain their subscription and authorization checks.

### RFC 9728 — Protected Resource Metadata

`GET /.well-known/oauth-protected-resource`

```json
{
  "resource": "https://mcp.paxaver.com/mcp",
  "authorization_servers": ["https://mcp.paxaver.com"],
  "scopes_supported": ["tools"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://github.com/Smartoire/paxaver-mcp/blob/main/docs/security.md"
}
```

When a request arrives without a valid bearer token, the `401` response includes
a `WWW-Authenticate` header pointing the client here:

```
Bearer resource_metadata="https://mcp.paxaver.com/.well-known/oauth-protected-resource/mcp", scope="tools"
```

### RFC 8414 — Authorization Server Metadata

`GET /.well-known/oauth-authorization-server`

The metadata of the facade authorization server on the MCP origin. Its
endpoints route to the regional auth servers. `jwks_uri` points at one regional
server, because every region publishes the same key:

```json
{
  "issuer": "https://mcp.paxaver.com",
  "authorization_endpoint": "https://mcp.paxaver.com/oauth/authorize",
  "token_endpoint": "https://mcp.paxaver.com/oauth/token",
  "registration_endpoint": "https://mcp.paxaver.com/oauth/register",
  "revocation_endpoint": "https://mcp.paxaver.com/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "email", "tools", "offline_access"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "jwks_uri": "https://paxaver.ca/auth/.well-known/jwks.json"
}
```

`GET /oauth` and `GET /oauth/` redirect to this document for convenience.

## Legacy static token support

**Removed.** Legacy static MCP client tokens are no longer accepted. All
requests must present a valid RS256 JWT issued through the OAuth 2.1 flow.
See [`docs/migration.md`](./migration.md).
