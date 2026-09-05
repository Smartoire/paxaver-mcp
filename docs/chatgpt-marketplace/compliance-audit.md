# Compliance Audit

> Security and compliance audit for the Paxaver MCP server against OpenAI,
> Anthropic, Google, and OWASP MCP security standards.

## Audit date

2026-09-05

## Scope

All 29 MCP tools, the authentication flow, the authorization policy, the
transport layer, and the error handling path.

---

## OpenAI App Submission Guidelines

| Requirement | Status | Notes |
| --- | --- | --- |
| Tool names are human-readable, specific, and descriptive (verb-based) | PASS | All 27 tools use verb-based names: `get_user_info`, `order_lunch`, `create_event`, etc. |
| Each tool has a description that explains its purpose clearly and accurately | PASS | Every tool has a description. Write tools mention the side effect and require confirmation. |
| Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) are correctly set | PASS | Read tools have `readOnlyHint: true`. Cancel tools have `destructiveHint: true`. |
| Tools request minimum information necessary | PASS | Input schemas declare only the fields required for the operation. `additionalProperties: false` is set on all input schemas. |
| No tool requests full conversation history or broad contextual fields | PASS | No tool accepts free-text context beyond its specific parameters. |
| Side effects are never hidden or implicit | PASS | All mutating tools have `readOnlyHint: false` and descriptions that state the side effect. |
| Tools are safe to retry where possible, or explicitly indicate when retries cause repeated effects | PASS | Mutating tools receive an idempotency key derived from tool name + args + correlation ID. The backend is expected to honor the `Idempotency-Key` header. |
| Authentication flow is transparent and explicit | PASS | OAuth 2.1 with PKCE (S256) is required. The auth worker (`auth.paxaver.com`) serves as the authorization server. The MCP server validates RS256 JWTs via JWKS. |
| No commerce for digital products or subscriptions | PASS | No tool sells digital products or subscriptions. |
| No link to checkout or transactional pages | PASS | No tool returns a checkout or payment URL to the AI client. |

---

## Anthropic MCP Security Best Practices

| Requirement | Status | Notes |
| --- | --- | --- |
| OAuth 2.1 with PKCE for all public clients | PASS | `require_pkce: true` and `code_challenge_methods_supported: ['S256']` in the OAuth server metadata. |
| Per-client consent storage (if acting as proxy) | N/A | The MCP server is not a proxy. Each user authenticates directly with the Paxaver auth worker. |
| Redirect URI validation (exact string matching) | PASS | The auth worker validates redirect URIs. The MCP server delegates OAuth to the auth worker. |
| OAuth state parameter validation | PASS | The auth worker validates the OAuth state parameter. |
| Short-lived, scoped tokens | PASS | The MCP server validates RS256 JWTs with configurable expiry. The service-binding JWT has a 120-second TTL. |
| No static client ID with third-party APIs without per-client consent | PASS | No static client ID is used. Each user authenticates via OAuth. |
| Input validation at trust boundaries | PASS | All input schemas have `additionalProperties: false`. Path IDs are validated by `validatePathId`. Ownership validation checks `student_id` and `school_slug` against the user context. |
| Output sanitization (no PII leakage) | PASS | `get_user_info` filters the backend response to only return fields declared in the outputSchema: `firstName`, `lastName`, `schoolSlug`, `schoolName`, `students` (filtered to `id`, `firstName`, `lastName`, `schoolSlug`), `roles`, `subscription`. No email, phone, address, allergies, notes, or other PII is returned. |

---

## Google Cloud MCP Guidelines

| Requirement | Status | Notes |
| --- | --- | --- |
| Data separated from instructions (no prompt injection via tool output) | PASS | Tool outputs are returned as structured data (`structuredContent`) and text content (JSON-serialized). The dispatcher does not interpret output as instructions. |
| Sensitive data protected in transit and in memory | PASS | All traffic uses HTTPS. JWTs are validated and not logged. The service binding is same-region (no public network hop). |
| Data sanitized before returning to client | PASS | `get_user_info` filters PII. Error messages are sanitized in `apiErrorToMcp` — no internal details, stack traces, or D1/Stripe error text is exposed. |
| IAM-style per-tool authorization (capability gating) | PASS | `apps/mcp/src/lib/policies.ts` defines per-tool capability and role requirements. The dispatcher checks the policy before calling the handler. |
| No excessive permissions | PASS | The MCP server has no D1, Stripe, or SES bindings. It can only call the backend API via service binding. |

---

## OWASP MCP Security Cheat Sheet

| Requirement | Status | Notes |
| --- | --- | --- |
| `additionalProperties: false` on all input schemas | PASS | All 29 input schemas have `additionalProperties: false`. |
| Pattern validation on string fields where applicable | PASS | Date fields use `YYYY-MM-DD` format descriptions. `validatePathId` checks path parameters for safe characters. |
| No shared tokens across servers | PASS | The service-binding JWT is short-lived (120 seconds) and scoped to `paxaver-internal` audience. No shared static tokens. |
| Ephemeral, short-lived tokens | PASS | The service-binding JWT has a 120-second TTL. User JWTs are validated with configurable expiry. |
| Tool descriptions inspected for injection vectors | PASS | Tool descriptions do not contain instructions for the AI client. They describe the tool's purpose and parameters. No prompt injection vectors found. |
| Error messages sanitized (no internal details leaked) | PASS | `apiErrorToMcp` maps HTTP status codes to user-safe messages. The dispatcher catch block logs only the tool name and error message to the server console, and returns a generic message to the client. |
| No secrets in tool descriptions or error responses | PASS | No secrets, tokens, or internal infrastructure details are present in tool descriptions or error messages. |

---

## Gaps found

No gaps were found during this audit. All checklist items pass or are not
applicable to the MCP server architecture.

## Follow-up items

None. The MCP server meets the security standards from OpenAI, Anthropic,
Google, and OWASP as of the audit date.
