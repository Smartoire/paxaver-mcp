# Security Policy

## Reporting a vulnerability

We take security vulnerabilities seriously. If you believe you have found a
security issue in the Paxaver MCP server, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report via one of:

1. **Email:** security@smartoire.com
2. **GitHub private vulnerability reporting** (Security tab → "Report a
   vulnerability").

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof of concept, if possible).
- The affected environment (staging / production) if known.
- Your contact information for follow-up.

We will acknowledge receipt within **2 business days** and aim to send an initial
assessment within **5 business days**.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | yes       |
| < 2.0   | no        |

Only the latest minor release of v2 receives security fixes. The legacy v1
`mcp-server/` in the private monorepo is end-of-life.

## Disclosure timeline

| Step | Timing |
| ---- | ------ |
| Report acknowledged | within 2 business days |
| Initial assessment | within 5 business days |
| Fix or mitigation developed | depends on severity; target ≤ 30 days for high/critical |
| Coordinated disclosure | after fix is deployed, or after 90 days from report (whichever is sooner), unless an extension is agreed |

We request a **90-day embargo** on public disclosure to allow time for fix
development and deployment. We will credit reporters in release notes unless
they prefer to remain anonymous.

## Security measures summary

The Paxaver MCP server is designed with defense-in-depth. Key measures:

- **No direct data access.** The MCP worker does not bind D1, Stripe, or SES.
  All data access flows through the Paxaver backend via a same-region Cloudflare
  service binding. See [docs/architecture.md](./docs/architecture.md).
- **Service binding auth.** Backend calls carry a short-lived (120s) HS256 JWT
  with audience `paxaver-internal`; the user's OAuth token is never forwarded.
- **OAuth 2.1 + PKCE S256.** Authorization Code flow with PKCE; `S256` is the
  only accepted challenge method. See [docs/authentication.md](./docs/authentication.md).
- **CSRF state tokens.** OAuth `state` is HMAC-signed and verified with
  timing-safe comparison.
- **CORS allowlist.** Origins are allowlisted; no reflect-any-origin.
- **Error sanitization.** Backend errors are mapped to generic MCP error
  messages; stack traces and internal details are never leaked.
- **Security headers.** `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Idempotency.** Mutating tool calls include an `Idempotency-Key` to suppress
  duplicate side effects from retries.
- **Stateless auth.** User context is reloaded from the backend on every
  request; revocation is immediate.
- **Defense-in-depth authorization.** Tool authorization is checked at the MCP
  layer and re-checked (data-level) by the backend. See
  [docs/authorization.md](./docs/authorization.md) and
  [docs/security.md](./docs/security.md).

## Scope

This policy covers the Paxaver MCP server (this repository). The private Paxaver
backend has its own security policy in the private monorepo. Vulnerabilities that
require backend access to exploit should be reported to both if the boundary is
relevant.
