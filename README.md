# Paxaver MCP Server

> AI-facing adapter over the [Paxaver](https://paxaver.com) school community platform.
> Implements the Model Context Protocol (MCP) on Cloudflare Workers with RS256 JWT
> validation, capability-first authorization, and Streamable HTTP transport.

[![npm version](https://img.shields.io/npm/v/@paxaver/mcp.svg)](https://www.npmjs.com/package/@paxaver/mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![MCP Badge](https://lobehub.com/badge/mcp/paxaver)](https://lobehub.com/mcp/paxaver)

---

## What this is

The Paxaver MCP server lets AI assistants (ChatGPT, Claude, Perplexity, and any
MCP-compatible client) act on behalf of a Paxaver user: check a lunch menu, order
lunch, register for fundraising events, volunteer, and — for school administrators
— manage restaurants, menu items,
events, and daily orders.

It is a **thin adapter**. It contains no business logic and never touches the
database, Stripe, or email directly. Every action is delegated to the private
Paxaver backend API over a Cloudflare **service binding** (same region, no public
network hop). The MCP server's only responsibilities are:

- MCP protocol handling (JSON-RPC 2.0, Streamable HTTP)
- RS256 JWT validation via JWKS from the centralized Paxaver auth worker
- Per-tool capability policy and role gating
- Sanitized, user-safe error mapping

Authentication is handled by the Paxaver auth worker (`auth.paxaver.com`), which
serves as the OAuth 2.0 / OIDC authorization server. The MCP server validates
the resulting RS256 JWTs and forwards them to the backend. The MCP server itself
is not an authorization server.

---

## Architecture

```text
┌───────────────┐     MCP (Streamable HTTP)      ┌──────────────────────┐
│   AI Client   │ ─────────────────────────────▶ │   Paxaver MCP Worker │
│ ChatGPT/Claude│ ◀───────────────────────────── │  (this repo)         │
│  /Perplexity  │     RS256 JWT + JSON-RPC 2.0   │  Hono + jose         │
└───────────────┘                                └──────────┬───────────┘
                                                            │
                                          Cloudflare service binding
                                          (PAXAVER_API, same region)
                                                            │
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Paxaver API Worker  │
                                                 │  (private backend)   │
                                                 │  D1 · Stripe · SES   │
                                                 └──────────────────────┘
```

The MCP worker **never** binds D1, Stripe, or SES. The service binding carries a
short-lived JWT (120s TTL, audience `paxaver-internal`) that the backend trusts as
an internal call while still attributing the action to the authenticated Paxaver
user. See [`docs/architecture.md`](./docs/architecture.md) for the full picture.

---

## Quick start

### Install

```bash
npm install @paxaver/mcp
```

### Develop locally

```bash
# 1. Install dependencies (Node >= 22)
npm install

# 2. Configure local secrets
cp .dev.vars.example .dev.vars   # then fill in OAUTH_STATE_SECRET, ...

# 3. Run the worker locally (Miniflare)
npm run dev

# 4. Typecheck, lint, and test
npm run typecheck
npm run lint
npm test
```

The local dev server starts on `http://localhost:8787`. Discovery endpoints live
under `/.well-known/`; the MCP endpoint is `POST /mcp`.

> **Note:** Local development without the `PAXAVER_API` service binding falls back
> to authenticated HTTPS against `API_BASE_URL` (default `http://localhost:8787`).
> For full integration testing, run the Paxaver backend worker locally and point
> `API_BASE_URL` at it.

---

## Deployment

Two environments, each a separate Worker with its own custom domain:

| Environment  | Worker name           | Domain            |
| ------------ | --------------------- | ----------------- |
| `staging`    | `paxaver-mcp-staging` | `mcp.paxaver.dev` |
| `production` | `paxaver-mcp`         | `mcp.paxaver.com` |

The production worker serves both CA and US users through a single endpoint
(`mcp.paxaver.com`). User region is resolved from the JWT `tenant_id` claim,
and the worker routes to the correct regional backend via service bindings
(`PAXAVER_API_CA`, `PAXAVER_API_US`). Currency is determined by the user's
school, not by the MCP endpoint.

```bash
npm run deploy:staging   # wrangler deploy --env staging
npm run deploy:prod      # wrangler deploy --env production
```

Secrets must be set with `wrangler secret put --env production`:
`OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`CHATGPT_VERIFY_TOKEN`. See [`docs/deployment.md`](./docs/deployment.md).

---

## Tools

The server exposes 27 tools grouped into six categories. Visibility in
`tools/list` is filtered by the caller's roles; every call is re-authorized
before dispatch, and the backend re-checks data-level access (defense-in-depth).

| Category           | Tools                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User / account     | `get_user_info`, `update_student`                                                                                                                                      |
| Wallet             | `get_wallet_balance`, `get_wallet_status`                                                                                                                              |
| Orders & menu      | `order_lunch`, `get_orders`, `get_daily_menu`, `get_updates`, `get_daily_orders`, `get_monthly_orders`, `create_draft_order`, `finalize_order`, `cancel_order`         |
| Events             | `get_upcoming_events`, `create_event`, `update_event`, `cancel_event`, `register_event`, `be_volunteer`                                                                |
| Admin / restaurant | `list_school_restaurants`, `create_restaurant`, `list_menu_items`, `create_menu_item`, `update_menu_item`, `set_menu_item_price`, `delete_menu_item`, `set_daily_menu` |

Financial and destructive tools are labeled and require user confirmation. Full
reference: [`docs/tools.md`](./docs/tools.md). Authorization policy:
[`docs/authorization.md`](./docs/authorization.md).

### Privacy

No personal contact information (email, phone, address) is collected or
returned through MCP tools. The `get_user_info` tool returns only the user's
name, school, students, and roles. Student data is limited to IDs, names, and
school slugs. Allergies, notes, birthday, and other PII are not exposed in
read responses. The MCP server does not log user data.

---

## Documentation

| Document                                           | Topic                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)     | System architecture, service binding boundary, regional isolation |
| [docs/authentication.md](./docs/authentication.md) | JWT validation, JWKS, auth worker delegation, token format        |
| [docs/authorization.md](./docs/authorization.md)   | Capability policy table, role gating, defense-in-depth            |
| [docs/tools.md](./docs/tools.md)                   | Full tool reference with input schemas and classifications        |
| [docs/deployment.md](./docs/deployment.md)         | Wrangler config, environments, secrets, custom domains            |
| [docs/security.md](./docs/security.md)             | Security model, CORS, CSRF, error sanitization, headers           |
| [docs/compatibility.md](./docs/compatibility.md)   | MCP protocol version, transports, supported AI clients            |
| [docs/migration.md](./docs/migration.md)           | Migration from the legacy `mcp-server/` in the private monorepo   |
| [CHANGELOG.md](./CHANGELOG.md)                     | Release history                                                   |
| [SECURITY.md](./SECURITY.md)                       | Vulnerability reporting policy                                    |
| [CONTRIBUTING.md](./CONTRIBUTING.md)               | Development setup and contribution process                        |

---

## Tech stack

- **Runtime:** Cloudflare Workers (`compatibility_date: 2026-08-01`, `nodejs_compat`)
- **Framework:** [Hono](https://hono.dev) v4
- **JWT:** [jose](https://github.com/panva/jose) v6 (RS256 via JWKS)
- **Protocol:** MCP `2025-06-18`, Streamable HTTP
- **Auth:** RS256 JWT validation via centralized auth worker (`auth.paxaver.com`)
- **Build/deploy:** [Wrangler](https://developers.cloudflare.com/workers/wrangler/) v4
- **Test:** [Vitest](https://vitest.dev) v2 (Workers pool + Node pool)

---

## License

Apache-2.0. Copyright (c) 2026 Smartoire. See [`LICENSE`](./LICENSE).
