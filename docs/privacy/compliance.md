# Paxaver MCP Privacy Compliance

## Overview

The Paxaver MCP server is a public, AI-facing adapter that routes tool calls to the
Paxaver backend API via Cloudflare service bindings. **The MCP server itself does not
store, process, or transmit PII directly.** All personal data remains in the Paxaver
backend, which owns GDPR/CCPA/PIPEDA compliance.

## Data Flow

```
AI Client → MCP Server (this repo) → Service Binding → Paxaver Backend API → D1/R2
```

- The MCP server validates JWT tokens (RS256 via JWKS) and checks authorization policies.
- Tool calls are forwarded to the backend API with the user's JWT context.
- No data is persisted by the MCP server — it is stateless.

## Applicable Regulations

Since the MCP server is a pass-through with no data storage, its privacy obligations are
limited to:

| Regulation             | Relevance                                                                  |
| ---------------------- | -------------------------------------------------------------------------- |
| GDPR (EU)              | No data stored; transport via TLS; auth tokens validated but not persisted |
| CCPA/CPRA (California) | No data stored; no cookies; no tracking                                    |
| PIPEDA/Law 25 (Canada) | No data stored; no collection of personal information                      |

## What the MCP Server Does NOT Do

- Does not store user data (no D1, no R2, no KV)
- Does not set cookies
- Does not log PII (error sanitization strips backend details)
- Does not track users across sessions
- Does not share data with third parties

## JWT Token Handling

- JWT tokens are validated per-request via JWKS (RS256)
- Tokens are not stored, cached, or logged
- Token claims (user_id, tenant_id, capabilities) are used only for authorization

## Privacy Contact

For privacy questions: security@smartoire.com

For the full Paxaver privacy compliance documentation, see the Paxaver backend repository.
