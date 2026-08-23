# Authorization

Authorization is enforced in **two layers** — defense-in-depth. The MCP server
enforces the _interface-level_ policy (who can see and call which tool). The
backend re-enforces the _data-level_ policy (which school, which student, whether
the entitlement is active) on every service-binding call.

## How it works

```
tools/list   →  canSeeTool(toolName, ctx)        filters visible tools
tools/call   →  checkToolAuthorization(name, ctx)  →  "ok" | "forbidden" | "unknown_tool"
                  ↓ (if ok)
               dispatchTool → backend re-checks school membership, student ownership, entitlement
```

Both checks use the live `AuthContext` loaded from the backend on every request
(see [authentication.md](./authentication.md)). Platform admins bypass role
gating in both functions.

## Capability policy table

Every tool has an explicit entry in `TOOL_POLICIES` (`src/lib/policy.ts`).
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

| Tool                      | Capability     | Entitlement | Classifications          | Required roles                              | Mutates | Financial | Destructive | Confirm |
| ------------------------- | -------------- | ----------- | ------------------------ | ------------------------------------------- | ------- | --------- | ----------- | ------- |
| `get_user_info`           | `view_account` | no          | READ                     | _(any)_                                     | no      | no        | no          | no      |
| `update_student`          | `view_account` | no          | WRITE, PRIVACY_SENSITIVE | _(any)_                                     | yes     | no        | no          | **yes** |
| `get_wallet_balance`      | `view_balance` | no          | READ, PRIVACY_SENSITIVE  | _(any)_                                     | no      | no        | no          | no      |
| `get_wallet_status`       | `view_balance` | no          | READ, PRIVACY_SENSITIVE  | _(any)_                                     | no      | no        | no          | no      |
| `add_funds`               | `view_balance` | yes         | FINANCIAL, WRITE         | _(any)_                                     | yes     | yes       | no          | **yes** |
| `order_lunch`             | `ai_write`     | yes         | FINANCIAL, WRITE         | _(any)_                                     | yes     | yes       | no          | **yes** |
| `get_orders`              | `view_orders`  | no          | READ                     | _(any)_                                     | no      | no        | no          | no      |
| `get_daily_menu`          | `view_menu`    | no          | READ                     | _(any)_                                     | no      | no        | no          | no      |
| `get_updates`             | `view_orders`  | no          | READ                     | _(any)_                                     | no      | no        | no          | no      |
| `get_upcoming_events`     | `view_events`  | no          | READ                     | _(any)_                                     | no      | no        | no          | no      |
| `create_event`            | `ai_write`     | yes         | WRITE, ADMIN             | school_master, event_cordinator             | yes     | no        | no          | **yes** |
| `update_event`            | `ai_write`     | yes         | WRITE, ADMIN             | school_master, event_cordinator             | yes     | no        | no          | **yes** |
| `cancel_event`            | `ai_write`     | yes         | DESTRUCTIVE, ADMIN       | school_master, event_cordinator             | yes     | no        | yes         | **yes** |
| `list_school_restaurants` | _(null)_       | no          | READ, ADMIN              | school_master, pac_member, lunch_cordinator | no      | no        | no          | no      |
| `create_restaurant`       | _(null)_       | no          | WRITE, ADMIN             | school_master                               | yes     | no        | no          | **yes** |
| `list_menu_items`         | _(null)_       | no          | READ, ADMIN              | school_master, lunch_cordinator             | no      | no        | no          | no      |
| `create_menu_item`        | _(null)_       | no          | WRITE, ADMIN             | school_master, lunch_cordinator             | yes     | no        | no          | **yes** |
| `update_menu_item`        | _(null)_       | no          | WRITE, ADMIN             | school_master, lunch_cordinator             | yes     | no        | no          | **yes** |
| `set_menu_item_price`     | _(null)_       | no          | WRITE, ADMIN, FINANCIAL  | school_master, lunch_cordinator             | yes     | yes       | no          | **yes** |
| `delete_menu_item`        | _(null)_       | no          | DESTRUCTIVE, ADMIN       | school_master, lunch_cordinator             | yes     | no        | yes         | **yes** |
| `set_daily_menu`          | _(null)_       | no          | WRITE, ADMIN             | school_master, lunch_cordinator             | yes     | no        | no          | **yes** |
| `get_daily_orders`        | _(null)_       | no          | READ, ADMIN              | school_master, lunch_cordinator             | no      | no        | no          | no      |
| `get_monthly_orders`      | _(null)_       | no          | READ, ADMIN              | _(any)_                                     | no      | no        | no          | no      |

## Role gating

`canSeeTool` and `checkToolAuthorization` use the `permissions` array from the
user's `AuthContext`. These are the school-scoped roles mirrored from the
backend (`src/lib/contracts.ts`):

| Role                 | Typical capabilities                                 |
| -------------------- | ---------------------------------------------------- |
| `school_master`      | Full school admin: restaurants, menu, events, orders |
| `pac_member`         | Parent advisory committee — read restaurants/orders  |
| `lunch_cordinator`   | Manage menu items, daily menu, view daily orders     |
| `event_cordinator`   | Create/update/cancel events                          |
| `treasurer`          | Financial oversight (future)                         |
| `liaison`            | Communication roles (future)                         |
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

`add_funds`, `order_lunch`, `set_menu_item_price`. These move or commit money
(either directly debiting the wallet or creating a Stripe checkout). They are
always `requiresConfirmation: true`.

### Destructive tools

`cancel_event`, `delete_menu_item`. These are irreversible (soft-delete or
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
