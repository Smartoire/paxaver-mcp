# Security

This document describes the security model of the Paxaver MCP server. For
vulnerability reporting, see [../SECURITY.md](../SECURITY.md).

## Principles

1. **Least privilege.** The MCP worker holds no database, payment, or email
   credentials. It can only call the Paxaver backend via a service binding.
2. **Defense-in-depth.** Authorization is checked at the MCP layer **and**
   re-checked by the backend on every call.
3. **No internal detail leakage.** Errors returned to AI clients are generic
   and mapped; stack traces and backend error text are never exposed.
4. **Stateless trust.** Auth context is reloaded from the backend on every
   request. There is no cached session trust; revocation is immediate.

## No D1 access

The MCP worker does **not** bind D1. This is enforced at the infrastructure
level — the binding is not declared in `wrangler.jsonc`. A compromise of the MCP
worker cannot directly read or corrupt the database, issue Stripe charges, or
send email. All data access flows through the backend's authenticated API.

See [architecture.md](./architecture.md) for the rationale.

## Service binding authentication

Every backend call carries a **short-lived service JWT** (`src/api/client.ts`):

- Algorithm: HS256, signed with `JWT_SECRET` (shared with the backend).
- Claims: `sub` (real Paxaver user ID), `type: "mcp_service"`, `schoolSlug`.
- Audience: `paxaver-internal`. Issuer: the MCP worker origin.
- TTL: **120 seconds**. `jti`: random UUID.

The backend trusts `type: "mcp_service"` with audience `paxaver-internal` as an
internal call and attributes the action to `sub`. Because the token expires in
two minutes and is single-use in practice, a captured service token has a
negligible replay window.

The user's OAuth access token is **never** forwarded to the backend. The MCP
server consumes it for authentication, then mints its own service token for the
backend call.

## CORS allowlist

CORS is **allowlist-based**, not reflect-any-origin (`src/index.ts`):

- `ALLOWED_ORIGINS` is a comma-separated list of exact origins and `*.domain`
  wildcard patterns.
- Only matching origins receive `Access-Control-Allow-Origin`.
- `Vary: Origin` is always set when CORS headers are present.
- Non-matching origins receive no CORS headers — the browser blocks them.
- `OPTIONS` preflight returns `204` with the allowlist headers when the origin
  matches; otherwise no CORS headers.

Production allowlists include the Paxaver app origins and the AI client origins
(`chatgpt.com`, `claude.ai`, `www.perplexity.ai`). Staging is restricted to
`paxaver.dev` subdomains. Local dev allows `localhost`.

Allowed methods: `GET, POST, DELETE, OPTIONS`.
Allowed headers: `Content-Type, Authorization, MCP-Protocol-Version,
MCP-Session-Id`. Exposed headers: `MCP-Session-Id`.

## CSRF state tokens

The OAuth `state` parameter is wrapped in an **HMAC-SHA256 signed token** before
being round-tripped through the login form (`src/lib/crypto.ts`):

```
stateToken = payload + "." + base64url(HMAC-SHA256(OAUTH_STATE_SECRET, payload))
```

Verification uses a **timing-safe comparison** (constant-time XOR loop). This
binds state to the issuer and prevents CSRF on the authorization endpoint.

## PKCE — S256 only

PKCE is **required** and only `S256` is accepted (`src/auth/oauth.ts`):

- `code_challenge_method` must be `S256`.
- `plain` and missing challenges are rejected before the login form renders.
- Verification: `base64url(SHA-256(code_verifier)) === code_challenge`.

The code challenge is stored by the backend with the authorization code and
re-checked at token exchange. CIMD clients (ChatGPT, Claude) use
`token_endpoint_auth_method: none` — security comes from PKCE, not a secret.

## Timing-safe comparisons

All secret comparisons use constant-time XOR loops (`timingSafeEqual`,
`verifyStateToken` in `src/lib/crypto.ts`):

```ts
let diff = 0;
for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
return diff === 0;
```

Length mismatches short-circuit to `false` (which is safe — the only leak is
that the lengths differ, not the content).

## Error sanitization

Errors returned to AI clients are **generic and mapped** (`src/lib/errors.ts`).
Backend error text, D1 messages, Stripe errors, and stack traces are never
forwarded.

| Backend status | MCP code | Message |
| -------------- | -------- | ------- |
| 401 | -32001 | Authentication failed. Please reconnect your Paxaver account. |
| 403 | -32002 | You do not have permission to perform this action. |
| 404 | -32001 | The requested resource was not found or you do not have access to it. |
| 409 | -32003 | This action conflicts with existing data. It may have already been performed. |
| 429 | -32004 | Too many requests. Please wait and try again. |
| 422 | -32602 | The request was invalid. Check the parameters and try again. |
| other | -32603 | The request could not be completed. Please try again later. |

The global error handler (`src/index.ts`) catches all unhandled errors and
returns `{ error: "Internal error" }` with `500`. The actual error is logged to
`console.error` (Cloudflare observability) but never sent to the client.

## Security headers

Applied to all responses (`src/index.ts`):

| Header | Value | Purpose |
| ------ | ----- | ------- |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Referrer-Policy` | `no-referrer` | No referrer leakage |

The OAuth login pages are inline HTML with no external assets and `X-Frame-Options:
DENY` prevents them from being embedded.

## Idempotency for mutations

All mutating tool calls include an `Idempotency-Key` header (`src/tools/dispatch.ts`):

```
mcp-<toolName>-<correlationId>-<criticalArgs>
```

The key is derived from the tool name, the per-request correlation ID, and the
critical arguments. Retries of the **same** MCP request (same correlation ID)
produce the same key, so the backend can suppress duplicates. Distinct user
intents produce different keys. The backend is expected to honor the
`Idempotency-Key` header for duplicate suppression.

This protects against AI client retries (e.g. network blips causing a double
`order_lunch` or `add_funds`).

## Data minimization

- The MCP server returns only the backend's `data` envelope, unwrapped. It does
  not augment responses with internal fields.
- `tools/list` omits tools the user cannot access — they are not returned with a
  "forbidden" marker, reducing prompt surface area.
- User context loaded from the backend (`/api/users/me/context`) contains only
  what the policy table needs: `userId`, `email`, `schoolSlug`, `permissions`,
  `isPlatformAdmin`, `studentIds`.
- OAuth tokens carry only `sub`, `scope`, and `type` — no PII beyond the user ID.

## Correlation IDs

Every request gets an `X-Correlation-Id` (from the inbound header or a generated
UUID). This is used for log tracing and as the idempotency key nonce. It is
echoed back in the response header for client-side correlation.

## What is explicitly NOT done

- **No D1 binding.** Ever.
- **No Stripe / SES credentials.** Ever.
- **No `Access-Control-Allow-Origin: *`.** CORS is allowlisted.
- **No stack traces in responses.** Errors are sanitized.
- **No cached auth.** Context is reloaded every request.
- **No cross-region service bindings.** Each region is isolated.
- **No `plain` PKCE.** S256 only.
