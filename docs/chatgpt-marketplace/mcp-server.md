# ChatGPT Marketplace - MCP Server Configuration

> Fill in the ChatGPT developer portal "MCP Server" tab using the values below.

## MCP Server URLs

Two regional deployments are published as separate marketplace listings:

| Listing          | Server URL                   | Region        |
| ---------------- | ---------------------------- | ------------- |
| Paxaver (Canada) | `https://mcp-ca.paxaver.com` | Canada        |
| Paxaver (US)     | `https://mcp-us.paxaver.com` | United States |

Both servers run identical code on Cloudflare Workers with separate D1 databases per region.

## Authentication

The MCP server delegates OAuth to the auth worker at `auth.paxaver.com`. The auth worker is the authorization server. The MCP server validates JWTs via JWKS from the auth worker. ChatGPT connects as an OAuth client.

### OAuth Discovery Endpoints

| Endpoint                               | URL                                                               |
| -------------------------------------- | ----------------------------------------------------------------- |
| Protected Resource (RFC 9728)          | `https://mcp-ca.paxaver.com/.well-known/oauth-protected-resource` |
| Authorization Server (RFC 8414)        | `https://auth.paxaver.com/.well-known/oauth-authorization-server` |
| Dynamic Client Registration (RFC 7591) | `https://auth.paxaver.com/register`                               |
| Authorization endpoint                 | `https://auth.paxaver.com/authorize`                              |
| Token endpoint                         | `https://auth.paxaver.com/token`                                  |

The Protected Resource endpoint is served by the MCP server. All other OAuth endpoints are served by the auth worker. (Replace `mcp-ca` with `mcp-us` for the US listing.)

### OAuth Flow

1. ChatGPT discovers the authorization server metadata via `https://auth.paxaver.com/.well-known/oauth-authorization-server`.
2. ChatGPT registers as a client via `https://auth.paxaver.com/register` (dynamic registration) or uses its Client ID Metadata Document (CIMD) - the auth worker fetches client metadata from `chatgpt.com` / `openai.com` hostnames.
3. ChatGPT redirects the user to `https://auth.paxaver.com/authorize` with PKCE challenge.
4. User signs in with their Paxaver email + password (or Google OAuth if configured).
5. The auth worker redirects back to ChatGPT with an authorization code.
6. ChatGPT exchanges the code at `https://auth.paxaver.com/token` for a JWT access token (1-hour expiry).
7. ChatGPT calls MCP tools with `Authorization: Bearer <jwt>`. The MCP server validates the JWT via JWKS from the auth worker.

### Scopes

- `tools` - Access all MCP tools (list tools, call tools)

### Supported Response Types & Grants

- Response types: `code`
- Grant types: `authorization_code`, `refresh_token`
- Code challenge methods: `S256`, `plain`
- Token endpoint auth: `none`, `client_secret_post`

## URL Verification Token

OpenAI will provide a verification token when you register the app in the developer portal. The MCP server includes a verification endpoint at:

```
/.well-known/chatgpt-verification/{token}
```

### Setup (per region)

1. Get the verification token from the ChatGPT developer portal.
2. Set it as a secret on each Worker:

```bash
cd mcp-server

# Canada
wrangler secret put CHATGPT_VERIFY_TOKEN --config wrangler.ca.toml
# paste the token when prompted

# US
wrangler secret put CHATGPT_VERIFY_TOKEN --config wrangler.us.toml
# paste the token when prompted
```

3. Redeploy:

```bash
npm run deploy:ca
npm run deploy:us
```

4. Enter the verification URL in the ChatGPT developer portal:
   - Canada: `https://mcp-ca.paxaver.com/.well-known/chatgpt-verification/<token>`
   - US: `https://mcp-us.paxaver.com/.well-known/chatgpt-verification/<token>`

The endpoint returns `200` with body `verify Ownership` when the token matches, and `404` otherwise.

## Tools Overview

The server exposes **23 tools** across four categories. Full schemas are in `docs/mcp/tools.md`.

### User & Wallet Tools (4)

| Tool                 | Description                                      | Read-only |
| -------------------- | ------------------------------------------------ | --------- |
| `get_user_info`      | User info, school memberships, and student list  | Yes       |
| `get_wallet_balance` | Current wallet balance at the active school      | Yes       |
| `get_wallet_status`  | Balance + recent transactions + pending deposits | Yes       |
| `top_up_balance`     | Create Stripe checkout session to top up wallet  | No        |

### Lunch & Ordering Tools (6)

| Tool                 | Description                             | Read-only |
| -------------------- | --------------------------------------- | --------- |
| `order_lunch`        | Place a lunch order for a student       | No        |
| `get_orders`         | Recent orders (optionally per student)  | Yes       |
| `get_daily_menu`     | Menu for a day or month                 | Yes       |
| `get_daily_orders`   | All orders for a school day (admin)     | Yes       |
| `get_monthly_orders` | All orders for a month (admin/parent)   | Yes       |
| `get_updates`        | Quick overview: balance, orders, events | Yes       |

### School Management Tools (12)

| Tool                      | Description                                    | Read-only        |
| ------------------------- | ---------------------------------------------- | ---------------- |
| `get_upcoming_events`     | Upcoming school events within a date window    | Yes              |
| `create_event`            | Create a school event (admin)                  | No               |
| `update_event`            | Update an event's properties (admin)           | No               |
| `cancel_event`            | Cancel a school event (admin)                  | No (destructive) |
| `list_school_restaurants` | Restaurants linked to a school (admin)         | Yes              |
| `create_restaurant`       | Create a restaurant (admin)                    | No               |
| `list_menu_items`         | Menu items with school-specific prices (admin) | Yes              |
| `create_menu_item`        | Create a menu item (admin)                     | No               |
| `update_menu_item`        | Update item / set school price (admin)         | No               |
| `set_menu_item_price`     | Set a menu item's price (admin)                | No               |
| `delete_menu_item`        | Deactivate a menu item (admin)                 | No (destructive) |
| `set_daily_menu`          | Assign item to a date (admin)                  | No               |

### Student Tools (1)

| Tool             | Description                                      | Read-only |
| ---------------- | ------------------------------------------------ | --------- |
| `update_student` | Update a student's profile fields (own students) | No        |

## How Tools Are Used

ChatGPT should always call `get_user_info` first to discover the user's `activeSchoolSlug` and `student_id` values. Most tools operate on the user's active school automatically; only `create_event` and `list_school_restaurants` take an explicit `school_slug` parameter. The tool descriptions include this guidance.
