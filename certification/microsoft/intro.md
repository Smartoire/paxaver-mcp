# Paxaver MCP Server

Paxaver is the school community platform that connects Parent Advisory
Committees (PACs), schools, and families. This MCP server exposes Paxaver
account tools to Microsoft 365 Copilot and Copilot Studio agents.

## Features

For parents and families:

- View the daily and monthly lunch menu for a student's school.
- Place, finalize, and cancel hot-lunch orders.
- Check the wallet balance and recent transactions.
- Review order history by day or month.
- View upcoming school events and register for tickets.
- Sign up for volunteer shifts.

For PAC coordinators and school staff:

- Manage restaurants linked to the school.
- Create, update, price, and delete menu items.
- Assign menu items to dates on the daily menu.
- Create, update, and cancel school events.
- View all orders placed for a school day.

## Prerequisites

- A Paxaver account with an active school. Sign up at https://paxaver.com.
- The account role determines which tools are available (parent, guardian,
  PAC member, PAC coordinator).

## Authentication

OAuth 2.1 Authorization Code flow with PKCE (S256). When the agent first
connects, the user signs in with their Paxaver account. Tokens are RS256
JWTs issued by the Paxaver authorization server and validated against its
JWKS. Refresh tokens are supported.

- Authorization endpoint: `https://auth.paxaver.com/authorize`
- Token endpoint: `https://auth.paxaver.com/token`
- Scopes: `openid profile email offline_access tools`

## Data handling

The MCP server is a thin adapter. It stores no user data and performs no
business logic. Every tool call is delegated to the regional Paxaver
backend over a private Cloudflare service binding. The server filters
personally identifiable information from tool output: emails, phone
numbers, addresses, and payment details are never returned to the agent.

## Known issues and limitations

- Tools that act on a school require the account to have an active school.
  Accounts without an active school receive an error response.
- Wallet top-ups and donations are not available through MCP tools. Use
  the Paxaver web app for payment operations.
- `get_user_info` should be called first to establish account context
  (active school, students, roles).
- Regional routing is automatic based on the account tenant. No user
  action is required.

## Support

- Support email: feedback@paxaver.com
- Support site: https://paxaver.com/support
- Privacy policy: https://paxaver.com/privacy
- Terms of use: https://paxaver.com/terms
