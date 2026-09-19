# Authorization

Authorization is enforced in **two layers** — defense-in-depth. The MCP server
enforces the _interface-level_ policy (who can see and call which tool). The
backend re-enforces the _data-level_ policy (which school, which student, whether
the entitlement is active) on every service-binding call.

## How it works

```
tools/list   →  canSeeTool(toolName, ctx)        filters visible tools
tools/call   →  resolveToolName(name)            legacy alias → canonical (see below)
             →  checkToolAuthorization(name, ctx)  →  "ok" | "forbidden" | "unknown_tool"
                  ↓ (if ok)
               dispatchTool → backend re-checks school membership, student ownership, entitlement
```

Both checks use the live `AuthContext` loaded from the backend on every request
(see [authentication.md](./authentication.md)). Platform admins bypass role
gating in both functions.

### Legacy name resolution

`tools/list` advertises only the 26 canonical names. `tools/call` first runs
`resolveToolName`, which maps pre-2.5 names through `TOOL_ALIASES`
(`apps/mcp/src/lib/policies.ts`) onto the canonical policy and handler — same
capability, roles, entitlement, and confirmation checks. `order_lunch` has no
canonical equivalent, so it keeps its own hidden policy entry and handler.
Unknown names (including aliases that have been removed) return `unknown_tool`
→ JSON-RPC `-32601`.

## Capability policy table

Every tool has an explicit entry in `TOOL_POLICIES` (`apps/mcp/src/lib/policies.ts`).
Fields:

| Field                  | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `capability`           | Canonical capability the tool exercises (`null` = admin-only, gated by role)             |
| `requiresEntitlement`  | Whether an active paid entitlement is required (backend enforces)                        |
| `classifications`      | Safety labels: `READ`, `WRITE`, `FINANCIAL`, `DESTRUCTIVE`, `ADMIN`, `PRIVACY_SENSITIVE` |
| `requiredRoles`        | Roles that may invoke at the active school. Empty = any member                           |
| `mutates`              | Whether the tool mutates persistent state                                                |
| `financial`            | Whether the tool has financial impact                                                    |
| `destructive`          | Whether the tool is irreversible                                                         |
| `requiresConfirmation` | Whether the AI client should prompt the user before calling                              |

### Full table

| Tool                           | Capability     | Entitlement | Classifications         | Required roles                               | Mutates | Financial | Destructive | Confirm |
| ------------------------------ | -------------- | ----------- | ----------------------- | -------------------------------------------- | ------- | --------- | ----------- | ------- |
| `get_my_context`               | `view_account` | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `get_my_wallet_balance`        | `view_balance` | no          | READ, PRIVACY_SENSITIVE | _(any)_                                      | no      | no        | no          | no      |
| `order_lunch` (legacy)         | `ai_write`     | yes         | FINANCIAL, WRITE        | _(any)_                                      | yes     | yes       | no          | **yes** |
| `list_my_lunch_orders`         | `view_orders`  | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `get_lunch_menu`               | `view_menu`    | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `create_lunch_order_draft`     | `ai_write`     | yes         | FINANCIAL, WRITE        | _(any)_                                      | yes     | yes       | no          | **yes** |
| `pay_lunch_order_draft`        | `ai_write`     | yes         | FINANCIAL, WRITE        | _(any)_                                      | yes     | yes       | no          | **yes** |
| `update_lunch_order_draft`     | `ai_write`     | yes         | WRITE                   | _(any)_                                      | yes     | no        | no          | **yes** |
| `discard_lunch_order_draft`    | `ai_write`     | yes         | DESTRUCTIVE, WRITE      | _(any)_                                      | yes     | no        | yes         | **yes** |
| `cancel_my_lunch_order`        | `ai_write`     | yes         | DESTRUCTIVE, WRITE      | _(any)_                                      | yes     | no        | yes         | **yes** |
| `list_school_events`           | `view_events`  | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `create_school_event`          | `ai_write`     | yes         | WRITE, ADMIN            | pac_cordinator, event_cordinator             | yes     | no        | no          | **yes** |
| `update_school_event`          | `ai_write`     | yes         | WRITE, ADMIN            | pac_cordinator, event_cordinator             | yes     | no        | no          | **yes** |
| `cancel_school_event`          | `ai_write`     | yes         | DESTRUCTIVE, ADMIN      | pac_cordinator, event_cordinator             | yes     | no        | yes         | **yes** |
| `register_for_event`           | `ai_write`     | yes         | WRITE                   | _(any)_                                      | yes     | no        | no          | **yes** |
| `sign_up_for_volunteer_shift`  | `ai_write`     | yes         | WRITE                   | _(any)_                                      | yes     | no        | no          | **yes** |
| `list_my_event_registrations`  | `view_events`  | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `cancel_my_event_registration` | `ai_write`     | yes         | DESTRUCTIVE             | _(any)_                                      | yes     | no        | yes         | **yes** |
| `list_my_volunteer_signups`    | `view_events`  | no          | READ                    | _(any)_                                      | no      | no        | no          | no      |
| `cancel_my_volunteer_signup`   | `ai_write`     | yes         | DESTRUCTIVE             | _(any)_                                      | yes     | no        | yes         | **yes** |
| `list_school_restaurants`      | _(null)_       | no          | READ, ADMIN             | pac_cordinator, pac_member, lunch_cordinator | no      | no        | no          | no      |
| `create_school_restaurant`     | _(null)_       | yes         | WRITE, ADMIN            | pac_cordinator                               | yes     | no        | no          | **yes** |
| `list_restaurant_menu_items`   | _(null)_       | no          | READ, ADMIN             | pac_cordinator, lunch_cordinator             | no      | no        | no          | no      |
| `create_restaurant_menu_item`  | _(null)_       | yes         | WRITE, ADMIN            | pac_cordinator, lunch_cordinator             | yes     | no        | no          | **yes** |
| `update_restaurant_menu_item`  | _(null)_       | yes         | WRITE, ADMIN, FINANCIAL | pac_cordinator, lunch_cordinator             | yes     | yes       | no          | **yes** |
| `archive_restaurant_menu_item` | _(null)_       | yes         | DESTRUCTIVE, ADMIN      | pac_cordinator, lunch_cordinator             | yes     | no        | yes         | **yes** |
| `schedule_lunch_menu_item`     | _(null)_       | yes         | WRITE, ADMIN            | pac_cordinator, lunch_cordinator             | yes     | no        | no          | **yes** |

## Role gating

`canSeeTool` and `checkToolAuthorization` use the `permissions` array from the
user's `AuthContext`. These are the school-scoped roles mirrored from the
backend (`src/lib/contracts.ts`):

| Role                 | Typical capabilities                                 |
| -------------------- | ---------------------------------------------------- |
| `pac_cordinator`     | Full school admin: restaurants, menu, events, orders |
| `pac_member`         | Parent advisory committee — read restaurants/orders  |
| `lunch_cordinator`   | Manage menu items, daily menu, view daily orders     |
| `event_cordinator`   | Create/update/cancel events                          |
| `treasurer`          | Financial oversight (future)                         |
| `restaurant_manager` | Per-restaurant management (future)                   |

Rules:

- **`isPlatformAdmin` bypasses all role gating.** A platform admin sees and can
  call every tool.
- **Empty `requiredRoles`** means any authenticated member of the school may use
  the tool. Data-level access (e.g. "only your own students") is still enforced
  by the backend.
- **Non-empty `requiredRoles`** requires at least one of the listed roles.

## Tool visibility — `canSeeTool`

Used by `tools/list`. A tool is visible if:

1. A policy entry exists for it, **and**
2. The caller is a platform admin, **or** `requiredRoles` is empty, **or** the
   caller holds at least one of the required roles.

Tools a user cannot see are omitted entirely from `tools/list` — they are not
returned with a "forbidden" marker. This prevents AI clients from attempting to
call tools the user has no access to, and reduces prompt noise.

## Tool call authorization — `checkToolAuthorization`

Used by `tools/call` **before** dispatch. Returns:

- `"ok"` — proceed to dispatch.
- `"forbidden"` — return MCP error `-32603` ("You do not have permission to use
  this tool.") without calling the backend.
- `"unknown_tool"` — return `-32601` ("Unknown tool: ...").

Even when this returns `"ok"`, the backend performs its own authorization
checks (see below). The MCP check is a fast-fail that avoids a service-binding
round trip for obviously-disallowed calls.

## Defense-in-depth

The MCP layer's role check is **necessary but not sufficient**. The backend
re-checks on every call:

| Check                                              | Enforced by                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| Authentication (valid user)                        | MCP (JWT) + backend (service JWT `sub`)             |
| School membership                                  | Backend (user ↔ school)                             |
| Student guardianship                               | Backend (user ↔ student)                            |
| Active entitlement (`requiresEntitlement`)         | Backend (entitlement record)                        |
| Role at active school                              | MCP (`checkToolAuthorization`) + backend (re-check) |
| Resource ownership (event_id, restaurant_id, etc.) | Backend                                             |

If the MCP layer's role check were somehow bypassed (e.g. a policy table bug),
the backend would still reject the call. The two layers use the same role names
(vendored in `contracts.ts`) but the backend is the source of truth.

## Financial & destructive labeling

Tools are labeled with `FINANCIAL` and/or `DESTRUCTIVE` classifications and the
MCP `annotations` include `destructiveHint`. The `_meta` block in `tools/list`
surfaces these to the AI client:

```json
"_meta": {
  "capability": "ai_write",
  "requiresEntitlement": true,
  "classifications": ["FINANCIAL", "WRITE"],
  "requiresConfirmation": true
}
```

### Financial tools

`pay_lunch_order_draft` (charges the wallet), `create_lunch_order_draft`
(creates a payable draft), `update_restaurant_menu_item` (when setting
`price_cents`), and the legacy `order_lunch`. These move or commit money.
They are always `requiresConfirmation: true`.

### Destructive tools

`cancel_school_event`, `archive_restaurant_menu_item`. These are irreversible (soft-delete or
status flip that cannot be undone). Always `requiresConfirmation: true`.

## Confirmation requirements

`requiresConfirmation: true` is a **strong recommendation** to the AI client
that it must obtain explicit user confirmation before calling the tool. The
server itself does not enforce a confirmation round-trip — it cannot, since MCP
confirmation is a client-side UX concern — but the tool descriptions and
`_meta` both signal it. Tool descriptions for these tools include language like
"confirm with the user before calling".

In practice, every tool with `mutates: true` or `financial: true` or
`destructive: true` has `requiresConfirmation: true`. Read-only tools never do.
