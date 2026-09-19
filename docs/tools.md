# Tool reference

This is the complete reference for every tool exposed by the Paxaver MCP server.
Tools are grouped by category. For each tool: name, description, input schema,
required roles, capability, classifications, and whether confirmation is
required.

Authorization policy lives in `src/lib/policy.ts`; tool definitions in
`src/schemas/`. See [authorization.md](./authorization.md) for the policy model.

> **Convention:** `ALWAYS call get_user_info first` to establish the user's
> context (active school, students, roles) before calling any other tool.

> **Lifecycle tools (v2.5.0):** related lifecycle operations are consolidated
> behind an `action` parameter. `order` (place, cancel), `draft_order`
> (create, update, discard, finalize), `manage_event` (create, update, cancel),
> `event_registration` (register, cancel), `volunteer_signup` (signup, cancel),
> and `manage_menu_item` (create, update, delete) each take `action` plus the
> fields the chosen action requires. Unknown actions and missing fields are
> rejected with JSON-RPC `-32602`.

---

## User / account

### `get_user_info`

Returns the authenticated Paxaver user context: name, active school, students
they are a guardian of, and available roles. **Always call this first.**

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_account` |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

```json
{ "type": "object", "properties": {} }
```

**Output schema**

```json
{
  "type": "object",
  "properties": {
    "firstName": { "type": "string" },
    "lastName": { "type": "string" },
    "schoolSlug": { "type": "string" },
    "schoolName": { "type": "string" },
    "students": { "type": "array", "items": { "type": "object" } },
    "roles": { "type": "array", "items": { "type": "string" } }
  }
}
```

**Backend:** `GET /api/users/me`

---

## Wallet

### `get_wallet_balance`

Returns the current wallet balance for the authenticated user at their active
school. Use this to check funds before ordering lunch.

|                     |                         |
| ------------------- | ----------------------- |
| **Capability**      | `view_balance`          |
| **Required roles**  | _(any member)_          |
| **Classifications** | READ, PRIVACY_SENSITIVE |
| **Confirmation**    | no                      |

**Input schema**

```json
{ "type": "object", "properties": {} }
```

**Output schema**

```json
{
  "type": "object",
  "properties": {
    "balanceCents": { "type": "number" },
    "balanceFormatted": { "type": "string" },
    "currency": { "type": "string" }
  }
}
```

**Backend:** `GET /api/wallet/balance`

---

## Orders & menu

### `order`

Lunch order lifecycle. `action: place` places and pays for a single-item lunch
order for one student — the wallet is charged immediately. For multi-item
orders or user review before paying, use `draft_order` instead.
`action: cancel` cancels a finalized order. **FINANCIAL + WRITE** — confirm
order details (student, item, date, quantity) with the user before calling.
Idempotent.

|                          |                               |
| ------------------------ | ----------------------------- |
| **Capability**           | `ai_write`                    |
| **Entitlement required** | yes                           |
| **Required roles**       | _(any member)_                |
| **Classifications**      | FINANCIAL, WRITE, DESTRUCTIVE |
| **Confirmation**         | **yes**                       |

**Input schema**

| Property       | Type    | Required     | Description                     |
| -------------- | ------- | ------------ | ------------------------------- |
| `action`       | string  | yes          | `place` \| `cancel`             |
| `menu_item_id` | string  | for `place`  | From `get_menu`                 |
| `menu_date`    | string  | for `place`  | YYYY-MM-DD                      |
| `student_id`   | string  | no           | Defaults to user's only student |
| `quantity`     | integer | no           | Servings (default 1, min 1)     |
| `order_id`     | string  | for `cancel` | From `get_orders`               |

**Backend:** `POST /api/lunch/orders`, `POST /api/lunch/orders/{order_id}/cancel`

---

### `draft_order`

Unpaid draft order lifecycle — nothing is charged until `action: finalize`
commits it. `create` builds a draft from `menu_date` and `items`; `update`
replaces its items and/or `menu_date`; `discard` abandons it; `finalize` pays
from the wallet (optional `tip_cents` PAC donation). **FINANCIAL + WRITE** —
confirm student, items, and date before finalizing. Idempotent.

|                          |                               |
| ------------------------ | ----------------------------- |
| **Capability**           | `ai_write`                    |
| **Entitlement required** | yes                           |
| **Required roles**       | _(any member)_                |
| **Classifications**      | FINANCIAL, WRITE, DESTRUCTIVE |
| **Confirmation**         | **yes**                       |

**Input schema**

| Property      | Type    | Required                            | Description                                                           |
| ------------- | ------- | ----------------------------------- | --------------------------------------------------------------------- |
| `action`      | string  | yes                                 | `create` \| `update` \| `discard` \| `finalize`                       |
| `order_id`    | string  | for `update`, `discard`, `finalize` | Draft order ID                                                        |
| `menu_date`   | string  | for `create`                        | YYYY-MM-DD; optional new date for `update`                            |
| `items`       | array   | for `create`                        | `menu_item_id`, `menu_item_name`, `price_cents`, `quantity` per entry |
| `student_id`  | string  | no                                  | Defaults to user's only student                                       |
| `school_slug` | string  | no                                  | Defaults to the active school                                         |
| `tip_cents`   | integer | no                                  | PAC donation added at `finalize`                                      |

**Backend:** `POST /api/lunch/orders/draft`, `PATCH /api/lunch/orders/{order_id}`,
`DELETE /api/lunch/orders/{order_id}`, `POST /api/lunch/orders/{order_id}/finalize`

---

### `get_orders`

Returns lunch orders for the authenticated user's students. Filter by
`student_id`, a single `menu_date`, or a `month`. With no filters, returns
recent orders. Admins (pac_cordinator, lunch_cordinator) receive school-wide
orders for the requested period; parents only see their own students.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_orders`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

| Property     | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `student_id` | string | no       | Filter to a specific student (must be your own) |
| `menu_date`  | string | no       | Single day to query, YYYY-MM-DD                 |
| `month`      | string | no       | Calendar month to query, YYYY-MM                |

**Backend:** `GET /api/lunch/orders`

---

### `get_menu`

Returns the lunch menu for the user's active school. Accepts `date`
(YYYY-MM-DD) or `month` (YYYY-MM). If neither is given, returns today's menu.
Use this to find `menu_item_id` values for `order` and `draft_order`.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_menu`    |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

| Property | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `date`   | string | no       | YYYY-MM-DD  |
| `month`  | string | no       | YYYY-MM     |

**Backend:** `GET /api/schools/{school_slug}/menu/daily`

---

## Events

### `get_upcoming_events`

Returns upcoming events for the user's active school. Optionally filter by date
range.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_events`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

| Property     | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `start_date` | string | no       | YYYY-MM-DD  |
| `end_date`   | string | no       | YYYY-MM-DD  |

**Backend:** `GET /api/events`

---

### `manage_event` _(admin)_

School event lifecycle. `create` schedules an event (requires `name` and
`event_date`); `update` edits fields on an existing event (requires
`event_id`, pass only fields to change); `cancel` cancels an event and refunds
paid registrations (requires `event_id`). **DESTRUCTIVE** when cancelling —
cancelled events cannot be reactivated.

|                          |                                  |
| ------------------------ | -------------------------------- |
| **Capability**           | `ai_write`                       |
| **Entitlement required** | yes                              |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN, DESTRUCTIVE        |
| **Confirmation**         | **yes**                          |

**Input schema**

| Property             | Type    | Required               | Description                          |
| -------------------- | ------- | ---------------------- | ------------------------------------ |
| `action`             | string  | yes                    | `create` \| `update` \| `cancel`     |
| `event_id`           | string  | for `update`, `cancel` | From `get_upcoming_events`           |
| `name`               | string  | for `create`           |                                      |
| `event_date`         | string  | for `create`           | YYYY-MM-DD                           |
| `school_slug`        | string  | no                     | Defaults to active school (`create`) |
| `description`        | string  | no                     |                                      |
| `starts_at`          | string  | no                     | HH:MM 24h                            |
| `ends_at`            | string  | no                     | HH:MM 24h                            |
| `location`           | string  | no                     |                                      |
| `max_capacity`       | integer | no                     |                                      |
| `ticket_price_cents` | integer | no                     | Ticket price in cents (0 = free)     |
| `status`             | string  | no                     | `active` \| `cancelled` (`update`)   |

**Backend:** `POST /api/events`, `PATCH /api/events/{event_id}`,
`POST /api/events/{event_id}/cancel`

---

### `event_registration`

Event ticket lifecycle. `register` registers the authenticated user for an
event — paid events charge the wallet immediately and fail on insufficient
funds (**FINANCIAL** — confirm before registering). `cancel` cancels an
existing registration (`ticket_id` from `get_my_event_registrations`) and
refunds the ticket price when applicable.

|                          |                               |
| ------------------------ | ----------------------------- |
| **Capability**           | `ai_write`                    |
| **Entitlement required** | yes                           |
| **Required roles**       | _(any member)_                |
| **Classifications**      | WRITE, FINANCIAL, DESTRUCTIVE |
| **Confirmation**         | **yes**                       |

**Input schema**

| Property    | Type    | Required       | Description                       |
| ----------- | ------- | -------------- | --------------------------------- |
| `action`    | string  | yes            | `register` \| `cancel`            |
| `event_id`  | string  | for `register` | From `get_upcoming_events`        |
| `quantity`  | integer | no             | Tickets (default 1, min 1)        |
| `ticket_id` | string  | for `cancel`   | From `get_my_event_registrations` |

**Backend:** `POST /api/events/{event_id}/register`,
`POST /api/events/tickets/{ticket_id}/cancel`

---

### `get_my_event_registrations`

Returns the authenticated user's own event tickets at their active school —
ticket id, event name/date/location, quantity, total paid, and status.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_events`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

```json
{ "type": "object", "properties": {} }
```

**Backend:** `GET /api/events/tickets/mine`

---

### `volunteer_signup`

Volunteer shift lifecycle — no payment involved. `signup` signs the
authenticated user up for one volunteer shift (requires `shift_id`, from the
event's volunteer shifts in `get_upcoming_events`); fails when the shift is
full or cancelled. `cancel` cancels an existing signup (`signup_id` from
`get_my_volunteer_signups`).

|                          |                    |
| ------------------------ | ------------------ |
| **Capability**           | `ai_write`         |
| **Entitlement required** | yes                |
| **Required roles**       | _(any member)_     |
| **Classifications**      | WRITE, DESTRUCTIVE |
| **Confirmation**         | **yes**            |

**Input schema**

| Property    | Type   | Required     | Description                                     |
| ----------- | ------ | ------------ | ----------------------------------------------- |
| `action`    | string | yes          | `signup` \| `cancel`                            |
| `shift_id`  | string | for `signup` | Volunteer shift ID (from `get_upcoming_events`) |
| `signup_id` | string | for `cancel` | Signup ID (from `get_my_volunteer_signups`)     |

**Backend:** `POST /api/volunteers/signups`,
`POST /api/volunteers/signups/{signup_id}/cancel`

---

### `get_my_volunteer_signups`

Returns the authenticated user's active volunteer signups at their school —
signup id, shift title/date/times, and the parent event.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_events`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

```json
{ "type": "object", "properties": {} }
```

**Backend:** `GET /api/volunteers/my-signups`

---

## Admin / restaurant

### `list_school_restaurants` _(admin)_

Lists restaurants for the active school.

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Capability**      | _(null — admin only)_                        |
| **Required roles**  | pac_cordinator, pac_member, lunch_cordinator |
| **Classifications** | READ, ADMIN                                  |
| **Confirmation**    | no                                           |

**Input schema**

| Property      | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `school_slug` | string | no       | Defaults to active school |

**Backend:** `GET /api/schools/{school_slug}/restaurants`

---

### `create_restaurant` _(admin)_

Creates a restaurant for the active school.

|                     |                       |
| ------------------- | --------------------- |
| **Capability**      | _(null — admin only)_ |
| **Required roles**  | pac_cordinator        |
| **Classifications** | WRITE, ADMIN          |
| **Confirmation**    | **yes**               |

**Input schema**

| Property      | Type   | Required | Description |
| ------------- | ------ | -------- | ----------- |
| `name`        | string | yes      |             |
| `school_slug` | string | no       |             |
| `description` | string | no       |             |
| `tax_percent` | number | no       |             |

**Backend:** `POST /api/schools/{school_slug}/restaurants`

---

### `list_menu_items` _(admin)_

Lists menu items for a restaurant.

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | READ, ADMIN                      |
| **Confirmation**    | no                               |

**Input schema**

| Property        | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `restaurant_id` | string | yes      |             |

**Backend:** `GET /api/restaurants/{restaurant_id}/items`

---

### `manage_menu_item` _(admin)_

Restaurant menu item lifecycle. `create` adds an item (requires
`restaurant_id` and `name`); `update` edits fields on an existing item
(requires `restaurant_id` and `menu_item_id`, pass only fields to change —
`price_cents` changes are **FINANCIAL**, confirm the new price); `delete`
soft-deletes an item (**DESTRUCTIVE** — the item disappears from ordering but
stays on past orders). Items become orderable via `set_daily_menu`, not via
the item record itself.

|                     |                                      |
| ------------------- | ------------------------------------ |
| **Capability**      | _(null — admin only)_                |
| **Required roles**  | pac_cordinator, lunch_cordinator     |
| **Classifications** | WRITE, ADMIN, FINANCIAL, DESTRUCTIVE |
| **Confirmation**    | **yes**                              |

**Input schema**

| Property        | Type     | Required               | Description                           |
| --------------- | -------- | ---------------------- | ------------------------------------- |
| `action`        | string   | yes                    | `create` \| `update` \| `delete`      |
| `restaurant_id` | string   | yes                    | From `list_school_restaurants`        |
| `menu_item_id`  | string   | for `update`, `delete` | From `list_menu_items`                |
| `name`          | string   | for `create`           |                                       |
| `description`   | string   | no                     |                                       |
| `cost_cents`    | integer  | no                     | Ingredient cost (PAC margin tracking) |
| `price_cents`   | integer  | no                     | Sale price in cents                   |
| `ingredients`   | string[] | no                     | Ingredient list                       |
| `calories`      | integer  | no                     |                                       |
| `is_active`     | boolean  | no                     | On/off the restaurant menu (`update`) |

**Backend:** `POST /api/restaurants/{restaurant_id}/items`,
`PATCH /api/restaurants/{restaurant_id}/items/{menu_item_id}`,
`DELETE /api/restaurants/{restaurant_id}/items/{menu_item_id}`

---

### `set_daily_menu` _(admin)_

Sets the daily menu (assigns a menu item to a date with available quantity).

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                     |
| **Confirmation**    | **yes**                          |

**Input schema**

| Property        | Type    | Required | Description |
| --------------- | ------- | -------- | ----------- |
| `restaurant_id` | string  | yes      |             |
| `menu_item_id`  | string  | yes      |             |
| `menu_date`     | string  | yes      | YYYY-MM-DD  |
| `available_qty` | integer | no       |             |

**Backend:** `POST /api/schools/{school_slug}/menu/daily`
