# Paxaver MCP Server

> AI-facing adapter over the [Paxaver](https://paxaver.com) school lunch platform.
> Implements the Model Context Protocol (MCP) on Cloudflare Workers with OAuth 2.1,
> capability-first authorization, and Streamable HTTP transport.

**Proprietary / Source-Available — UNLICENSED.** See [`LICENSE`](./LICENSE).
This source code is made available for review and educational purposes.
Unauthorized use, reproduction, or distribution is prohibited.

---

## What this is

The Paxaver MCP server lets AI assistants (ChatGPT, Claude, Perplexity, and any
MCP-compatible client) act on behalf of a Paxaver user: check a lunch menu, order
lunch, top up a wallet, view orders, and — for school administrators — manage
restaurants, menu items, events, and daily orders.

It is a **thin adapter**. It contains no business logic and never touches the
database, Stripe, or email directly. Every action is delegated to the private
Paxaver backend API over a Cloudflare **service binding** (same region, no public
network hop). The MCP server's only responsibilities are:

- MCP protocol handling (JSON-RPC 2.0, Streamable HTTP)
- OAuth 2.1 authorization server (Authorization Code + PKCE S256)
- Per-tool capability policy and role gating
- Sanitized, user-safe error mapping

---

## Architecture

```
┌───────────────┐     MCP (Streamable HTTP)      ┌──────────────────────┐
│   AI Client   │ ─────────────────────────────▶ │   Paxaver MCP Worker │
│ ChatGPT/Claude│ ◀───────────────────────────── │  (this repo)         │
│  /Perplexity  │     OAuth 2.1 + JSON-RPC 2.0   │  Hono + jose         │
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

```bash
# 1. Install dependencies (Node >= 20)
npm install

# 2. Configure local secrets
cp .dev.vars.example .dev.vars   # then fill in JWT_SECRET, OAUTH_STATE_SECRET, ...

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

Three environments, each a separate Worker with its own custom domain and region:

| Environment     | Worker name           | Domain                | Region | Currency |
| --------------- | --------------------- | --------------------- | ------ | -------- |
| `staging`       | `paxaver-mcp-staging` | `mcp.paxaver.dev`     | ca     | CAD      |
| `production-ca` | `paxaver-mcp-ca`      | `mcp.paxaver.ca`      | ca     | CAD      |
| `production-us` | `paxaver-mcp-us`      | `mcp.paxaver.com`     | us     | USD      |

```bash
npm run deploy:staging   # wrangler deploy --env staging
npm run deploy:ca        # wrangler deploy --env production-ca
npm run deploy:us        # wrangler deploy --env production-us
npm run deploy:prod      # both production regions
```

Secrets must be set per environment with `wrangler secret put --env <env>`:
`JWT_SECRET`, `OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`CHATGPT_VERIFY_TOKEN`. See [`docs/deployment.md`](./docs/deployment.md).

---

## Tools

The server exposes 20 tools grouped into five categories. Visibility in
`tools/list` is filtered by the caller's roles; every call is re-authorized
before dispatch, and the backend re-checks data-level access (defense-in-depth).

| Category              | Tools |
| --------------------- | ----- |
| User / account        | `get_user_info`, `update_student` |
| Wallet                | `get_wallet_balance`, `get_wallet_status`, `add_funds` |
| Orders & menu         | `order_lunch`, `get_orders`, `get_daily_menu`, `get_updates`, `get_daily_orders`, `get_monthly_orders` |
| Events                | `get_upcoming_events`, `create_event`, `update_event`, `cancel_event` |
| Admin / restaurant    | `list_school_restaurants`, `create_restaurant`, `list_menu_items`, `create_menu_item`, `update_menu_item`, `set_menu_item_price`, `delete_menu_item`, `set_daily_menu` |

Financial and destructive tools are labeled and require user confirmation. Full
reference: [`docs/tools.md`](./docs/tools.md). Authorization policy:
[`docs/authorization.md`](./docs/authorization.md).

---

## Documentation

| Document | Topic |
| -------- | ----- |
| [docs/architecture.md](./docs/architecture.md) | System architecture, service binding boundary, regional isolation |
| [docs/authentication.md](./docs/authentication.md) | OAuth 2.1 flow, PKCE, discovery, CIMD, token format |
| [docs/authorization.md](./docs/authorization.md) | Capability policy table, role gating, defense-in-depth |
| [docs/tools.md](./docs/tools.md) | Full tool reference with input schemas and classifications |
| [docs/deployment.md](./docs/deployment.md) | Wrangler config, environments, secrets, custom domains |
| [docs/security.md](./docs/security.md) | Security model, CORS, CSRF, error sanitization, headers |
| [docs/compatibility.md](./docs/compatibility.md) | MCP protocol version, transports, supported AI clients |
| [docs/migration.md](./docs/migration.md) | Migration from the legacy `mcp-server/` in the private monorepo |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |
| [SECURITY.md](./SECURITY.md) | Vulnerability reporting policy |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Development setup and contribution process |

---

## Tech stack

- **Runtime:** Cloudflare Workers (`compatibility_date: 2026-08-01`, `nodejs_compat`)
- **Framework:** [Hono](https://hono.dev) v4
- **JWT:** [jose](https://github.com/panva/jose) v5 (HS256)
- **Protocol:** MCP `2025-06-18`, Streamable HTTP (+ legacy SSE compat)
- **Auth:** OAuth 2.1, Authorization Code + PKCE (S256 only)
- **Build/deploy:** [Wrangler](https://developers.cloudflare.com/workers/wrangler/) v4
- **Test:** [Vitest](https://vitest.dev) v2 (Workers pool + Node pool)

---

## License

Proprietary / Source-Available — **UNLICENSED**. Copyright (c) 2026 Smartoire.
See [`LICENSE`](./LICENSE).
