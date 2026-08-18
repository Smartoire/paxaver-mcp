# Architecture

## Overview

The Paxaver MCP server is a Cloudflare Worker that exposes the Paxaver
school community platform to AI assistants via the Model Context Protocol. It is
deliberately a **thin adapter**: it owns protocol handling, authentication, and
authorization policy, but contains no business logic and no direct data access.

```text
┌───────────────────┐                                ┌──────────────────────┐
│   AI Client       │   MCP / Streamable HTTP        │   Paxaver MCP Worker │
│  (ChatGPT,        │ ─────────────────────────────▶ │  (this repo)         │
│   Claude,         │ ◀───────────────────────────── │                      │
│   Perplexity,     │   RS256 JWT Bearer + JSON-RPC  │  Hono app            │
│   any MCP client) │                                │  ├─ well-known/      │
└───────────────────┘                                │  ├─ /mcp (transport) │
       │                                             │                      │
       │ OAuth 2.0 Authorization Code + PKCE         │                      │
       │ (user logs in to Paxaver auth worker)       │                      │
                                                     └──────────┬───────────┘
                                                                │
                              Cloudflare service bindings (regional routing)
                              PAXAVER_API_CA → paxaver-api-ca (CA users)
                              PAXAVER_API_US → paxaver-api-us (US users)
                              selected per-request from JWT tenant_id
                              forwards user's RS256 JWT
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

When the MCP server calls the backend, it forwards the user's RS256 JWT directly
as `Authorization: Bearer <token>` (`src/api/client.ts`). The backend validates
the JWT via its own JWKS check and performs authorization as if the user called
the API directly. This means:

- The backend's existing authz pipeline (school membership, student ownership,
  role checks, entitlement) applies to every MCP-initiated request.
- There is no separate service token or shared secret between the MCP worker and
  the backend for user-attributed calls.
- The MCP worker's `JWT_SECRET` binding is reserved for future internal use and
  is not currently used for service-to-service authentication.

## Regional isolation

Paxaver operates two production regions, each with its own API backend. The
MCP worker is a single deployment at `mcp.paxaver.com` that serves both regions:

| Region | API backend              | MCP endpoint         |
| ------ | ------------------------ | -------------------- |
| `ca`   | `api.paxaver.ca`         | `mcp.paxaver.com`    |
| `us`   | `api.paxaver.com`        | `mcp.paxaver.com`    |

The MCP worker binds to both regional backends (`PAXAVER_API_CA`,
`PAXAVER_API_US`) and routes each request to the correct region based on the
JWT `tenant_id` claim. This keeps user data within its region while exposing
a single public MCP endpoint. Currency is determined by the user's school,
not by the MCP endpoint.

Staging (`mcp.paxaver.dev`) is a single Canadian deployment used for integration
testing against `api.paxaver.dev`.

## Request lifecycle

1. **AI client** sends `POST /mcp` with `Authorization: Bearer <rs256-jwt>`.
2. **Auth middleware** (`src/auth/validate.ts`) verifies the JWT (RS256, via JWKS
   from the auth worker, audience `paxaver-api` / `mcp` / request origin), then
   calls the backend's `GET /api/users/me/context` over the service binding to
   load the live user context (permissions, schoolSlug, studentIds,
   isPlatformAdmin). Context is reloaded on **every** request — there is no
   cached session trust.
3. **JSON-RPC handler** (`src/server/json-rpc.ts`) dispatches `tools/list` or
   `tools/call`.
4. For `tools/call`, **`checkToolAuthorization`** enforces the interface-level
   role policy. If denied, returns `-32603` without calling the backend.
5. **`dispatchTool`** (`src/tools/dispatch.ts`) maps the tool to a backend API
   path and calls `PAXAVER_API.fetch(...)` with the user's JWT forwarded.
   Mutating calls include an `Idempotency-Key` header.
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

```text
src/
├── index.ts                     Hono app: CORS, security headers, auth middleware, route mounts
├── env.ts                       Env bindings (no D1), AuthContext, AppVariables
├── api/
│   └── client.ts                Service-binding client + regional routing + user JWT forwarding
├── auth/
│   └── validate.ts              RS256 JWT validation via JWKS + context loading
├── discovery/
│   └── well-known.ts            RFC 9728 + RFC 8414 (delegates to auth worker) + ChatGPT verification
├── lib/
│   ├── contracts.ts             Vendored capability/role/classification names
│   ├── policy.ts                Per-tool policy table, canSeeTool, checkToolAuthorization
│   ├── crypto.ts                Session ID generation
│   ├── errors.ts                MCP error codes + backend→MCP error sanitization
│   └── protocol-version.ts      MCP protocol version negotiation
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
│   └── dispatch.ts              Tool → backend API path mapping + ownership validation
└── transport/
    └── streamable-http.ts       POST /mcp, GET /mcp (SSE), DELETE /mcp
```
