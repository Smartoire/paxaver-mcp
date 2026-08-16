# Architecture

## Overview

The Paxaver MCP server is a Cloudflare Worker that exposes the Paxaver school
lunch platform to AI assistants via the Model Context Protocol. It is
deliberately a **thin adapter**: it owns protocol handling, authentication, and
authorization policy, but contains no business logic and no direct data access.

```
┌───────────────────┐                                ┌──────────────────────┐
│   AI Client       │   MCP / Streamable HTTP        │   Paxaver MCP Worker │
│  (ChatGPT,        │ ─────────────────────────────▶ │  (this repo)         │
│   Claude,         │ ◀───────────────────────────── │                      │
│   Perplexity,     │   OAuth 2.1 Bearer + JSON-RPC  │  Hono app            │
│   any MCP client) │                                │  ├─ well-known/      │
└───────────────────┘                                │  ├─ oauth/           │
       │                                             │  ├─ /mcp (transport) │
       │ OAuth Authorization Code + PKCE             │  └─ /sse /messages   │
       │ (user logs in to Paxaver via hosted page)   │      (legacy compat) │
                                                     └──────────┬───────────┘
                                                                │
                                       Cloudflare service binding
                                       binding name: PAXAVER_API
                                       same region, no public hop
                                       carries short-lived JWT
                                                                │
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │  Paxaver API Worker  │
                                                     │  (private backend)   │
                                                     │                      │
                                                     │  ├─ D1 (database)    │
                                                     │  ├─ Stripe (payments)│
                                                     │  └─ SES (email)      │
                                                     └──────────────────────┘
```

## The boundary: why the MCP server has no D1 access

The MCP worker binds **only** the `PAXAVER_API` service binding. It does **not**
bind D1, the Stripe secret key, or SES credentials. This is enforced at the
infrastructure level — the binding simply is not declared in `wrangler.jsonc`.

Reasons:

1. **Least privilege.** The public-facing AI surface should not hold database
   credentials or payment keys. A compromise of the MCP worker cannot directly
   read or corrupt D1, issue Stripe charges, or send email.

2. **Single source of truth.** All authorization rules — school membership,
   student guardianship, entitlement, role checks — live in the backend. If the
   MCP server queried D1 directly, it would duplicate that logic and the two
   could drift. Delegating every call keeps the backend authoritative.

3. **Auditability.** Every action flows through the backend's existing request
   pipeline, logging, and rate limiting. The MCP server cannot bypass it.

4. **Stable contracts.** The MCP server depends only on the backend's HTTP API
   contract, not its schema. The backend can migrate D1 tables without the MCP
   server needing a change.

## Service binding authentication

When the MCP server calls the backend, it does not forward the user's OAuth
access token. Instead it mints a **short-lived service JWT** (`src/api/client.ts`):

```
signServiceToken(env, ctx, origin)
  → JWT, HS256, signed with JWT_SECRET (shared with backend)
    claims: { sub: <userId>, type: "mcp_service", schoolSlug: <slug> }
    iss:    <origin of the MCP worker>
    aud:    "paxaver-internal"
    exp:    now + 120s
    jti:    random UUID
```

The backend's `authenticate` middleware recognizes `type: "mcp_service"` with
audience `paxaver-internal` as a trusted internal call and attributes the action
to `sub` (the real Paxaver user). Because the TTL is 120 seconds and the token is
single-use in practice (one API call), a leaked service token is useless within
two minutes.

`JWT_SECRET` is shared between the MCP worker and the backend worker and is set
per environment via `wrangler secret put`. It is the same secret used to sign
OAuth access tokens.

## Regional isolation

Paxaver operates two production regions, each with its own stack:

| Region | API backend              | MCP worker             | Currency |
| ------ | ------------------------ | ---------------------- | -------- |
| `ca`   | `api.paxaver.ca`         | `mcp.paxaver.ca`       | CAD      |
| `us`   | `api.paxaver.com`        | `mcp.paxaver.com`      | USD      |

The service binding is **same-region only**: `paxaver-mcp-ca` binds to the
Canadian backend, `paxaver-mcp-us` binds to the US backend. There is no
cross-region service binding. This keeps user data within its region and avoids
a public-network hop between the MCP and API workers.

Staging (`mcp.paxaver.dev`) is a single Canadian deployment used for integration
testing against `api.paxaver.dev`.

## Request lifecycle

1. **AI client** sends `POST /mcp` with `Authorization: Bearer <oauth-jwt>`.
2. **Auth middleware** (`src/auth/validate.ts`) verifies the JWT (HS256, audience
   `mcp` or the request origin), then calls the backend's
   `GET /api/users/me/context` over the service binding to load the live user
   context (permissions, schoolSlug, studentIds, isPlatformAdmin). Context is
   reloaded on **every** request — there is no cached session trust.
3. **JSON-RPC handler** (`src/server/json-rpc.ts`) dispatches `tools/list` or
   `tools/call`.
4. For `tools/call`, **`checkToolAuthorization`** enforces the interface-level
   role policy. If denied, returns `-32603` without calling the backend.
5. **`dispatchTool`** (`src/tools/dispatch.ts`) maps the tool to a backend API
   path, mints a service JWT, and calls `PAXAVER_API.fetch(...)`. Mutating calls
   include an `Idempotency-Key` header.
6. The **backend** re-checks data-level authorization (school membership, student
   ownership, entitlement) and performs the action against D1/Stripe/SES.
7. The result is unwrapped from the backend's `{ data: ... }` envelope and
   returned as an MCP tool result. Errors are mapped through `apiErrorToMcp`
   so no internal details leak to the AI client.

## Vendored contracts layer

`src/lib/contracts.ts` is a **deliberately tiny local mirror** of the private
backend's capability, classification, and permission names. It exists so this
public repo compiles with zero dependency on private code.

- `CapabilityId` — the canonical capabilities (`view_account`, `view_balance`,
  `view_orders`, `view_menu`, `view_events`, `ai_write`, `assistant_actions`).
- `ToolClassification` — safety labels (`READ`, `WRITE`, `FINANCIAL`,
  `DESTRUCTIVE`, `ADMIN`, `PRIVACY_SENSITIVE`).
- `SchoolPermission` — role names (`school_master`, `pac_member`,
  `lunch_cordinator`, `event_cordinator`, `treasurer`, `liaison`,
  `restaurant_manager`).

The backend is the **source of truth** for enforcement. If the private model
changes, the names in `contracts.ts` must be updated to match. The MCP server
uses these names only for the policy table (`src/lib/policy.ts`) and for
filtering `tools/list` visibility — never for trusting a decision the backend
hasn't confirmed.

## Module map

```
src/
├── index.ts                     Hono app: CORS, security headers, auth middleware, route mounts
├── env.ts                       Env bindings (no D1), AuthContext, AppVariables
├── api/
│   └── client.ts                Service-binding client + service JWT signing
├── auth/
│   ├── oauth.ts                 Authorization server: /oauth/authorize, /oauth/token, /oauth/register
│   ├── oauth-ui.ts              Inline HTML login/error pages
│   └── validate.ts              Bearer token validation + context loading
├── discovery/
│   └── well-known.ts            RFC 9728 + RFC 8414 + ChatGPT domain verification
├── lib/
│   ├── contracts.ts             Vendored capability/role/classification names
│   ├── policy.ts                Per-tool policy table, canSeeTool, checkToolAuthorization
│   ├── crypto.ts                PKCE S256, state HMAC, JWT signing, timing-safe compare
│   └── errors.ts                MCP error codes + backend→MCP error sanitization
├── schemas/
│   ├── index.ts                 ToolDefinition type + ALL_TOOLS registry
│   ├── user-tools.ts
│   ├── wallet-tools.ts
│   ├── order-tools.ts
│   ├── event-tools.ts
│   └── restaurant-tools.ts
├── server/
│   └── json-rpc.ts              JSON-RPC 2.0 handler: initialize, tools/list, tools/call
├── tools/
│   └── dispatch.ts              Tool → backend API path mapping + idempotency keys
└── transport/
    └── streamable-http.ts       POST /mcp, GET /mcp (SSE), DELETE /mcp, legacy /sse + /messages
```
