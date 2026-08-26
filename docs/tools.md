# Tool reference

This is the complete reference for every tool exposed by the Paxaver MCP server.
Tools are grouped by category. For each tool: name, description, input schema,
required roles, capability, classifications, and whether confirmation is
required.

Authorization policy lives in `src/lib/policy.ts`; tool definitions in
`src/schemas/`. See [authorization.md](./authorization.md) for the policy model.

> **Convention:** `ALWAYS call get_user_info first` to establish the user's
> context (active school, students, roles) before calling any other tool.

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

### `update_student`

Updates a student profile (allergies, notes, grade, division, etc.) for a
student the authenticated user is a guardian of. The `student_id` must be one of
the user's own students. Do **not** use this to look up arbitrary students.

|                     |                          |
| ------------------- | ------------------------ |
| **Capability**      | `view_account`           |
| **Required roles**  | _(any member)_           |
| **Classifications** | WRITE, PRIVACY_SENSITIVE |
| **Confirmation**    | **yes**                  |

**Input schema**

| Property     | Type   | Required | Description                              |
| ------------ | ------ | -------- | ---------------------------------------- |
| `student_id` | string | yes      | ID of the student (from `get_user_info`) |
| `first_name` | string | no       |                                          |
| `last_name`  | string | no       |                                          |
| `known_as`   | string | no       |                                          |
| `grade`      | string | no       |                                          |
| `division`   | string | no       |                                          |
| `allergies`  | string | no       | Comma-separated allergen list            |
| `notes`      | string | no       |                                          |
| `birthday`   | string | no       | YYYY-MM-DD                               |

**Backend:** `PATCH /api/users/me/students/{student_id}`

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

### `get_wallet_status`

Returns the wallet balance plus recent transactions and pending deposits.

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

**Backend:** `GET /api/wallet/transactions`

---

### `top_up_balance`

Creates a Stripe checkout session to add funds to the user's wallet and emails
the payment link. **FINANCIAL** — confirm the exact amount with the user first.
Minimum top-up is $5.00 (500 cents). The wallet is only credited after the user
completes the Stripe payment; this tool does not directly move money. Idempotent
per transaction.

|                          |                  |
| ------------------------ | ---------------- |
| **Capability**           | `view_balance`   |
| **Entitlement required** | yes              |
| **Required roles**       | _(any member)_   |
| **Classifications**      | FINANCIAL, WRITE |
| **Confirmation**         | **yes**          |

**Input schema**

| Property       | Type    | Required | Description                   |
| -------------- | ------- | -------- | ----------------------------- |
| `amount_cents` | integer | yes      | Amount in cents (min 500)     |
| `description`  | string  | no       | Optional note for the deposit |

**Backend:** `POST /api/wallet/deposits/stripe`

---

## Orders & menu

### `order_lunch`

Places a lunch order for a student the authenticated user is a guardian of.
Requires `menu_item_id` (from `get_daily_menu`) and `menu_date`. Payment is
deducted from the wallet. **FINANCIAL + WRITE** — confirm order details
(student, item, date, quantity) with the user before calling. Idempotent.

|                          |                  |
| ------------------------ | ---------------- |
| **Capability**           | `ai_write`       |
| **Entitlement required** | yes              |
| **Required roles**       | _(any member)_   |
| **Classifications**      | FINANCIAL, WRITE |
| **Confirmation**         | **yes**          |

**Input schema**

| Property       | Type    | Required | Description                                  |
| -------------- | ------- | -------- | -------------------------------------------- |
| `menu_item_id` | string  | yes      | From `get_daily_menu`                        |
| `menu_date`    | string  | yes      | YYYY-MM-DD                                   |
| `student_id`   | string  | no       | Defaults to user's first student if only one |
| `quantity`     | integer | no       | Servings (default 1, min 1)                  |

**Backend:** `POST /api/lunch/orders`

---

### `get_orders`

Returns recent lunch orders for the authenticated user's students. Optionally
filter by `student_id`.

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

**Backend:** `GET /api/lunch/orders`

---

### `get_daily_menu`

Returns the daily lunch menu for the user's active school. Accepts `date`
(YYYY-MM-DD) or `month` (YYYY-MM). If neither is given, returns today's menu.
Use this to find `menu_item_id` values for `order_lunch`.

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

**Backend:** `GET /api/lunch/daily-menu`

---

### `get_updates`

Returns a summary of recent activity: wallet balance, recent orders, upcoming
events. Use for a quick overview.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_orders`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

```json
{ "type": "object", "properties": {} }
```

**Backend:** `GET /api/users/me/updates`

---

### `get_daily_orders` _(admin)_

Returns all orders for the active school on a given date.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | READ, ADMIN                     |
| **Confirmation**    | no                              |

**Input schema**

| Property    | Type   | Required | Description |
| ----------- | ------ | -------- | ----------- |
| `menu_date` | string | yes      | YYYY-MM-DD  |

**Backend:** `GET /api/lunch/orders/daily`

---

### `get_monthly_orders`

Returns a monthly summary of orders. Optionally filter by month and student.

|                     |                       |
| ------------------- | --------------------- |
| **Capability**      | _(null — admin only)_ |
| **Required roles**  | _(any member)_        |
| **Classifications** | READ, ADMIN           |
| **Confirmation**    | no                    |

**Input schema**

| Property     | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `month`      | string | no       | YYYY-MM                                         |
| `student_id` | string | no       | Filter to a specific student (must be your own) |

**Backend:** `GET /api/lunch/orders/monthly`

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

### `create_event` _(admin)_

Creates a school event. Do not create events without explicit user request.

|                          |                                 |
| ------------------------ | ------------------------------- |
| **Capability**           | `ai_write`                      |
| **Entitlement required** | yes                             |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN                    |
| **Confirmation**         | **yes**                         |

**Input schema**

| Property             | Type    | Required | Description                      |
| -------------------- | ------- | -------- | -------------------------------- |
| `name`               | string  | yes      |                                  |
| `event_date`         | string  | yes      | YYYY-MM-DD                       |
| `school_slug`        | string  | no       | Defaults to active school        |
| `description`        | string  | no       |                                  |
| `starts_at`          | string  | no       |                                  |
| `ends_at`            | string  | no       |                                  |
| `location`           | string  | no       |                                  |
| `max_capacity`       | integer | no       |                                  |
| `ticket_price_cents` | integer | no       | Ticket price in cents (0 = free) |

**Backend:** `POST /api/events`

---

### `update_event` _(admin)_

Updates an existing school event.

|                          |                                 |
| ------------------------ | ------------------------------- |
| **Capability**           | `ai_write`                      |
| **Entitlement required** | yes                             |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN                    |
| **Confirmation**         | **yes**                         |

**Input schema**

| Property             | Type    | Required | Description                            |
| -------------------- | ------- | -------- | -------------------------------------- |
| `event_id`           | string  | yes      |                                        |
| `name`               | string  | no       |                                        |
| `description`        | string  | no       |                                        |
| `event_date`         | string  | no       | YYYY-MM-DD                             |
| `starts_at`          | string  | no       |                                        |
| `ends_at`            | string  | no       |                                        |
| `location`           | string  | no       |                                        |
| `max_capacity`       | integer | no       |                                        |
| `ticket_price_cents` | integer | no       |                                        |
| `status`             | string  | no       | `active` \| `cancelled` \| `completed` |

**Backend:** `PATCH /api/events/{event_id}`

---

### `cancel_event` _(admin)_

Cancels a school event. **DESTRUCTIVE** — cancelled events cannot be reactivated.

|                          |                                 |
| ------------------------ | ------------------------------- |
| **Capability**           | `ai_write`                      |
| **Entitlement required** | yes                             |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | DESTRUCTIVE, ADMIN              |
| **Confirmation**         | **yes**                         |

**Input schema**

| Property   | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `event_id` | string | yes      |             |

**Backend:** `PATCH /api/events/{event_id}` (body `{ status: "cancelled" }`)

---

## Admin / restaurant

### `list_school_restaurants` _(admin)_

Lists restaurants for the active school.

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Capability**      | _(null — admin only)_                       |
| **Required roles**  | pac_cordinator, pac_member, lunch_cordinator |
| **Classifications** | READ, ADMIN                                 |
| **Confirmation**    | no                                          |

**Input schema**

| Property      | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `school_slug` | string | no       | Defaults to active school |

**Backend:** `GET /api/schools/restaurants`

---

### `create_restaurant` _(admin)_

Creates a restaurant for the active school.

|                     |                       |
| ------------------- | --------------------- |
| **Capability**      | _(null — admin only)_ |
| **Required roles**  | pac_cordinator         |
| **Classifications** | WRITE, ADMIN          |
| **Confirmation**    | **yes**               |

**Input schema**

| Property        | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `name`          | string | yes      |             |
| `school_slug`   | string | no       |             |
| `description`   | string | no       |             |
| `contact_name`  | string | no       |             |
| `contact_email` | string | no       |             |
| `contact_phone` | string | no       |             |
| `tax_percent`   | number | no       |             |

**Backend:** `POST /api/schools/restaurants`

---

### `list_menu_items` _(admin)_

Lists menu items for a restaurant.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | READ, ADMIN                     |
| **Confirmation**    | no                              |

**Input schema**

| Property        | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `restaurant_id` | string | yes      |             |

**Backend:** `GET /api/lunch/restaurants/{restaurant_id}/menu-items`

---

### `create_menu_item` _(admin)_

Creates a menu item for a restaurant.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                    |
| **Confirmation**    | **yes**                         |

**Input schema**

| Property        | Type    | Required | Description |
| --------------- | ------- | -------- | ----------- |
| `restaurant_id` | string  | yes      |             |
| `name`          | string  | yes      |             |
| `description`   | string  | no       |             |
| `cost_cents`    | integer | no       |             |
| `price_cents`   | integer | no       |             |
| `ingredients`   | string  | no       |             |
| `calories`      | integer | no       |             |

**Backend:** `POST /api/lunch/restaurants/{restaurant_id}/menu-items`

---

### `update_menu_item` _(admin)_

Updates a menu item.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                    |
| **Confirmation**    | **yes**                         |

**Input schema**

| Property        | Type    | Required | Description |
| --------------- | ------- | -------- | ----------- |
| `restaurant_id` | string  | yes      |             |
| `menu_item_id`  | string  | yes      |             |
| `name`          | string  | no       |             |
| `description`   | string  | no       |             |
| `cost_cents`    | integer | no       |             |
| `ingredients`   | string  | no       |             |
| `calories`      | integer | no       |             |
| `is_active`     | boolean | no       |             |
| `price_cents`   | integer | no       |             |
| `is_available`  | boolean | no       |             |

**Backend:** `PATCH /api/lunch/restaurants/{restaurant_id}/menu-items/{menu_item_id}`

---

### `set_menu_item_price` _(admin)_

Sets the price of a menu item. **FINANCIAL** — confirm the new price with the
user.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN, FINANCIAL         |
| **Confirmation**    | **yes**                         |

**Input schema**

| Property        | Type    | Required | Description        |
| --------------- | ------- | -------- | ------------------ |
| `restaurant_id` | string  | yes      |                    |
| `menu_item_id`  | string  | yes      |                    |
| `price_cents`   | integer | yes      | New price in cents |

**Backend:** `PATCH /api/lunch/restaurants/{restaurant_id}/menu-items/{menu_item_id}`

---

### `delete_menu_item` _(admin)_

Soft-deletes a menu item. **DESTRUCTIVE**.

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | DESTRUCTIVE, ADMIN              |
| **Confirmation**    | **yes**                         |

**Input schema**

| Property        | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `restaurant_id` | string | yes      |             |
| `menu_item_id`  | string | yes      |             |

**Backend:** `DELETE /api/lunch/restaurants/{restaurant_id}/menu-items/{menu_item_id}`

---

### `set_daily_menu` _(admin)_

Sets the daily menu (assigns a menu item to a date with available quantity).

|                     |                                 |
| ------------------- | ------------------------------- |
| **Capability**      | _(null — admin only)_           |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                    |
| **Confirmation**    | **yes**                         |

**Input schema**

| Property        | Type    | Required | Description |
| --------------- | ------- | -------- | ----------- |
| `restaurant_id` | string  | yes      |             |
| `menu_item_id`  | string  | yes      |             |
| `menu_date`     | string  | yes      | YYYY-MM-DD  |
| `available_qty` | integer | no       |             |

**Backend:** `POST /api/lunch/daily-menu`
