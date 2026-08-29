# AGENTS.md

## Purpose

This file defines the rules for AI agents that work in the Paxaver MCP repository.

## Project Overview

The Paxaver MCP server is an AI-facing adapter over the Paxaver school community platform. It implements the Model Context Protocol (MCP) on Cloudflare Workers with RS256 JWT validation, capability-first authorization, and Streamable HTTP transport.

The server is a thin adapter. It contains no business logic and never touches the database, Stripe, or email directly. Every action is delegated to the private Paxaver backend API over a Cloudflare service binding.

## Repository Structure

- `apps/mcp/src/` — MCP server source code
  - `api/` — Paxaver backend API client
  - `auth/` — JWT validation and authorization
  - `discovery/` — Well-known endpoints (RFC 9728, RFC 8414)
  - `lib/` — Shared utilities (contracts, crypto, policy)
  - `schemas/` — Tool input schemas
  - `server/` — MCP server implementation
  - `tools/` — Tool handlers
  - `transport/` — Streamable HTTP transport
- `apps/mcp/tests/` — Unit, protocol, and smoke tests
- `docs/` — Documentation

## Tech Stack

- TypeScript 6
- Cloudflare Workers
- Native `fetch` handler
- jose (JWT validation)
- Vitest (testing)
- Wrangler 4

## Build and Verification Commands

```bash
# Install dependencies
pnpm install

# Typecheck
pnpm typecheck

# Run tests
pnpm test

# Lint
pnpm lint

# Format check
pnpm format:check

# Build (dry-run)
pnpm build

# Security audit
pnpm security:audit
```

## Architecture Rules

- The MCP server is a thin adapter. Do not add business logic.
- Delegate all actions to the Paxaver backend API via service bindings.
- Validate all trust-boundary inputs.
- Handle failures explicitly with sanitized, user-safe error messages.
- Do not expose secrets or private data in errors.

## Authorization Model

- RS256 JWT validation via JWKS from the centralized Paxaver auth worker.
- Per-tool capability policy and role gating.
- OAuth 2.1 Authorization Code + PKCE (S256) flow.

## Public Repository Policy

This is a public repository. It must contain only minimum necessary data:

- No secrets, tokens, or private keys.
- No private infrastructure details.
- No internal operational procedures.
- No customer or school data.
- Apache-2.0 license.

## MCP Tools

MCP tools are public integration contracts. Before adding or changing a tool:

1. Check existing tools in `apps/mcp/src/tools/`.
2. Check tool metadata and schemas in `apps/mcp/src/schemas/`.
3. Check authorization and capability policy in `apps/mcp/src/lib/policy.ts`.
4. Check input validation.
5. Check output behavior.
6. Check existing consumers.

Use clear tool names, precise input schemas, validated inputs, and predictable outputs.

## Testing

After making a change, run:

1. `pnpm test` — unit and protocol tests.
2. `pnpm typecheck` — type checking.
3. `pnpm lint` — linting.
4. `pnpm build` — build verification.

Do not modify tests only to make them pass unless the existing test is incorrect.

## Verification

Before reporting a task as complete:

1. Run relevant tests.
2. Run type checking.
3. Run linting.
4. Run the build.
5. Review the final diff.
6. Check for unintended changes.

## Git

Keep commits focused. Do not commit unrelated changes, secrets, or temporary files.

Follow the repository's existing commit conventions.

## Documentation

Update documentation when behavior, APIs, or configuration change. Use the existing documentation structure. Keep documentation concise and accurate.
