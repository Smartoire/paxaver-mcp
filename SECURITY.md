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

Only the latest minor release of v2 receives security fixes; v1 is
end-of-life.

## Disclosure timeline

| Step                        | Timing                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Report acknowledged         | within 2 business days                                                                                   |
| Initial assessment          | within 5 business days                                                                                   |
| Fix or mitigation developed | depends on severity; target ≤ 30 days for high/critical                                                  |
| Coordinated disclosure      | after fix is deployed, or after 90 days from report (whichever is sooner), unless an extension is agreed |

We request a **90-day embargo** on public disclosure to allow time for fix
development and deployment. We will credit reporters in release notes unless
they prefer to remain anonymous.

## Security measures summary

The Paxaver MCP server is designed with defense-in-depth. Key measures:

- **OAuth 2.1 + PKCE S256.** Authorization Code flow with PKCE; `S256` is the
  only accepted challenge method.
- **Per-request authentication.** Every request presents an RS256 JWT verified
  by signature, issuer, audience, scope, and expiry; the user context is
  reloaded on every request, so revocation takes effect immediately.
- **No direct data access.** The server holds no database, payment, or email
  credentials. All data access flows through the Paxaver backend API, which
  re-checks authorization on every call.
- **CORS allowlist.** Origins are allowlisted; the server never reflects an
  arbitrary origin.
- **Error sanitization.** Backend errors are mapped to generic messages; stack
  traces and internal details are never returned to the client.
- **Security headers.** `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on every response.

## Scope

This policy covers the Paxaver MCP server (this repository). The rest of the
Paxaver platform has its own security policy. Vulnerabilities that cross the
boundary should be reported to both.
