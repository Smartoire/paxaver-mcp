# Paxaver MCP Server

> AI-facing adapter over the [Paxaver](https://paxaver.com) school community platform.
> Implements the Model Context Protocol (MCP) on Cloudflare Workers with RS256 JWT
> validation, capability-first authorization, and Streamable HTTP transport.

[![npm version](https://img.shields.io/npm/v/@paxaver/mcp.svg)](https://www.npmjs.com/package/@paxaver/mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![MCP Badge](https://lobehub.com/badge/mcp/paxaver)](https://lobehub.com/mcp/paxaver)
[![Paxaver MCP Server MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/Smartoire/paxaver-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Smartoire/paxaver-mcp)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/smartoire/paxaver-mcp)
[![Wellknown](https://wellknown.network/agents/paxaver-mcp/badge.svg)](https://wellknown.network/agents/paxaver-mcp)

---

## What this is

The Paxaver MCP server lets AI assistants (ChatGPT, Claude, Perplexity, and any
MCP-compatible client) act on behalf of a Paxaver user: check a lunch menu, order
lunch, review wallet balance and transaction history, register for fundraising
events, enroll students in school programs, volunteer, and — for school
administrators — manage restaurants, menu items, events, attendee check-in,
volunteer shifts, program waitlists, and daily orders.

It is a **thin adapter**. It contains no business logic and holds no database,
payment, or email credentials. Every action runs against the Paxaver backend API
as the authenticated user, and errors are sanitized before they reach the client.

---

## Connect

Point an MCP-compatible client at the hosted endpoint and sign in with a Paxaver
account when prompted (OAuth 2.1 Authorization Code + PKCE):

```text
https://mcp.paxaver.com/mcp
```

The server speaks MCP protocol `2025-06-18` over Streamable HTTP (`POST /mcp`).
One endpoint serves all regions; the user's region is resolved from their
account at sign-in.

---

## Install

```bash
npm install @paxaver/mcp
```

The package ships the Worker source for self-hosting and development. Most users
only need the hosted endpoint above.

### Run locally

```bash
pnpm install        # Node >= 26.8.2, pnpm >= 10
pnpm dev            # Miniflare on http://localhost:8787 — MCP endpoint: POST /mcp
```

### Docker

```bash
docker build -t paxaver-mcp .
docker run -p 8787:8787 paxaver-mcp
# MCP endpoint: http://localhost:8787/mcp
```

Self-hosted and local instances perform no token-revocation check: a revoked
token stays valid until it expires. Tokens are still verified by signature,
expiry, and a live user-context load.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development setup.

---

## Tools

The server exposes 37 tools grouped into seven categories. Visibility in
`tools/list` is filtered by the caller's roles; every call is re-authorized
before dispatch, and the backend re-checks data-level access (defense-in-depth).

| Category                | Tools                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User / wallet           | `get_my_context`, `sign_out`, `get_my_wallet_balance`, `list_my_wallet_transactions`                                                                                                                                    |
| Lunch ordering          | `get_lunch_menu`, `list_my_lunch_orders`, `create_lunch_order_draft`, `update_lunch_order_draft`, `discard_lunch_order_draft`, `pay_lunch_order_draft`, `cancel_my_lunch_order`                                         |
| Events & volunteering   | `list_school_events`, `get_school_event`, `register_for_event`, `list_my_event_registrations`, `cancel_my_event_registration`, `list_my_volunteer_signups`, `sign_up_for_volunteer_shift`, `cancel_my_volunteer_signup` |
| Event administration    | `create_school_event`, `update_school_event`, `cancel_school_event`, `list_event_attendees`, `check_in_event_ticket`, `create_volunteer_shift`                                                                          |
| Programs                | `list_school_programs`, `register_for_program`, `cancel_program_registration`, `list_program_registrations`, `admit_program_registration`                                                                               |
| Restaurant / menu admin | `list_school_restaurants`, `create_school_restaurant`, `list_restaurant_menu_items`, `create_restaurant_menu_item`, `update_restaurant_menu_item`, `archive_restaurant_menu_item`, `schedule_lunch_menu_item`           |

### Prompts

The server registers four prompts: `daily_lunch_menu`, `wallet_balance`,
`upcoming_events`, and `lunch_order_helper` (optional `student_name` argument).
Availability and content are returned by `prompts/list` and `prompts/get`.

Ordering is draft → review → payment: `create_lunch_order_draft`, adjust
with `update_lunch_order_draft`, then `pay_lunch_order_draft`.

`sign_out` ends the caller's sign-in for this MCP connection: the next request
gets the usual sign-in challenge. An app that holds its own Paxaver credentials
cannot be signed out this way — the result directs the user to disconnect
Paxaver in that app or in their Paxaver account settings instead.

Pre-2.5 tool names still resolve to the canonical tools but are no longer
advertised; the retired `order_lunch` tool is removed. Financial and destructive
tools are labeled and require user confirmation.

### Privacy

The only contact information returned through MCP tools is the caller's own
sign-in email — `get_my_context` includes it so a client can answer "which login
am I on?", and `sign_out` names the account it signs out. Phone, address, and
other contact fields are never returned. Student data is limited to IDs, names,
and school slugs; allergies, notes, birthday, and other PII are not exposed in
read responses. The MCP server does not log user data.

---

## Documentation

| Document                             | Topic                                      |
| ------------------------------------ | ------------------------------------------ |
| [CHANGELOG.md](./CHANGELOG.md)       | Release history                            |
| [SECURITY.md](./SECURITY.md)         | Vulnerability reporting policy             |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Development setup and contribution process |

Internal documentation (architecture, authentication, authorization, full tool
reference, deployment, security model, test scenarios) lives in the private
Paxaver monorepo under `docs/paxaver-mcp/` and is intentionally not published.

---

## Tech stack

- **Runtime:** Cloudflare Workers
- **Framework:** [Hono](https://hono.dev) v4
- **JWT:** [jose](https://github.com/panva/jose) v6 (RS256 via JWKS)
- **Protocol:** MCP `2025-06-18`, Streamable HTTP
- **Build/deploy:** [Wrangler](https://developers.cloudflare.com/workers/wrangler/) v4
- **Test:** [Vitest](https://vitest.dev) v2 (Workers pool + Node pool)

---

## Support

- Bug reports and feature requests:
  [GitHub issues](https://github.com/Smartoire/paxaver-mcp/issues)
- Security reports: see [SECURITY.md](./SECURITY.md)

## License

Apache-2.0. Copyright (c) 2026 Smartoire. See [`LICENSE`](./LICENSE).
