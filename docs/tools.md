# Tool reference

This is the complete reference for every tool exposed by the Paxaver MCP server.
Tools are grouped by category. For each tool: name, description, input schema,
required roles, capability, classifications, and whether confirmation is
required.

Authorization policy lives in `apps/mcp/src/lib/policies.ts`; tool definitions in
`apps/mcp/src/schemas.ts`. See [authorization.md](./authorization.md) for the policy model.

> **Convention:** `ALWAYS call get_my_context first` to establish the user's
> context (active school, students, roles) before calling any other tool.

---

## User / account

### `get_my_context`

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

### `get_my_wallet_balance`

Returns the current wallet balance for the authenticated user at their active
school. Use this to check funds before ordering lunch. The response also
carries `topUpUrl` — the caller's regional wallet top-up page on the Paxaver
site — to hand to the user when funds are low. Top-ups never run through MCP.

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
    "currency": { "type": "string" },
    "topUpUrl": { "type": "string" }
  }
}
```

**Backend:** `GET /api/wallet/balance`

---

### `list_my_wallet_transactions`

Returns the caller's own wallet transaction history — type, signed amount,
running balance, description, status, timestamps, and school — newest first
with cursor pagination (`nextCursor` → `cursor`). Never exposes card numbers,
payment-method identifiers, wallet internals, or checkout links.

|                     |                         |
| ------------------- | ----------------------- |
| **Capability**      | `view_balance`          |
| **Required roles**  | _(any member)_          |
| **Classifications** | READ, PRIVACY_SENSITIVE |
| **Confirmation**    | no                      |

**Input schema**

| Property      | Type    | Required | Description                                                        |
| ------------- | ------- | -------- | ------------------------------------------------------------------ |
| `student_id`  | string  | no       | Filter to one of the caller's own students                         |
| `school_slug` | string  | no       | Scope to a school the caller belongs to; defaults to active school |
| `all_schools` | boolean | no       | `true` returns history across all of the caller's schools          |
| `type`        | string  | no       | Transaction type (e.g. `deposit`, `payment`, `refund`)             |
| `status`      | string  | no       | `pending` \| `completed` \| `failed` \| `cancelled`                |
| `start`       | string  | no       | Range start, YYYY-MM-DD or ISO timestamp                           |
| `end`         | string  | no       | Range end, YYYY-MM-DD or ISO timestamp                             |
| `per_page`    | integer | no       | Page size, 1–100 (default 50)                                      |
| `cursor`      | string  | no       | `nextCursor` from the previous response                            |

**Backend:** `GET /api/wallet/transactions`

---

## Orders & menu

Ordering is **draft → review → payment**. Nothing is charged until
`pay_lunch_order_draft` runs. The retired `order_lunch` tool is removed and
returns `Unknown tool` (-32601).

### `create_lunch_order_draft`

Creates an unpaid lunch order draft for a student the authenticated user is
a guardian of. Takes `menu_date` plus an `items` array (each item:
`menu_item_id`, `menu_item_name`, `quantity` — IDs from `get_lunch_menu`;
the server prices each item from the menu, a client-sent price is ignored).
`student_id` and `school_slug` default to the caller's
first student / active school. **WRITE** — returns the draft `order_id` and
computed total; no charge occurs.

|                          |                |
| ------------------------ | -------------- |
| **Capability**           | `ai_write`     |
| **Entitlement required** | yes            |
| **Required roles**       | _(any member)_ |
| **Classifications**      | WRITE          |
| **Confirmation**         | yes            |

**Backend:** `POST /api/lunch/orders/draft`

---

### `update_lunch_order_draft`

Replaces the items on an existing unpaid draft (`order_id` required).
Returns the revised amount and version. **WRITE**.

**Backend:** `PATCH /api/lunch/orders/{order_id}`

---

### `discard_lunch_order_draft`

Deletes an unpaid draft (`order_id` required). Never triggers a refund —
drafts are uncharged. **DESTRUCTIVE**.

**Backend:** `DELETE /api/lunch/orders/{order_id}`

---

### `pay_lunch_order_draft`

Commits a reviewed draft and charges the wallet (`order_id` required,
optional `tip_cents`). **FINANCIAL + WRITE** — confirm the total with the
user before calling.

**Wallet-only:** card payments are never offered through MCP. If the wallet
balance cannot cover the full total, the call fails with an error telling
the user to open the Paxaver panel and top up the wallet balance, then
retry.

|                          |                  |
| ------------------------ | ---------------- |
| **Capability**           | `ai_write`       |
| **Entitlement required** | yes              |
| **Required roles**       | _(any member)_   |
| **Classifications**      | FINANCIAL, WRITE |
| **Confirmation**         | **yes**          |

**Backend:** `POST /api/lunch/orders/{order_id}/finalize`

---

### `cancel_my_lunch_order`

Cancels a placed order (`order_id` required). Existing cutoff and refund
rules apply on the backend. **WRITE** — confirm with the user.

**Backend:** `POST /api/lunch/orders/{order_id}/cancel`

---

### `list_my_lunch_orders`

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

### `get_lunch_menu`

Returns the lunch menu for the user's active school. Accepts `date`
(YYYY-MM-DD) or `month` (YYYY-MM). If neither is given, returns today's menu.
Use this to find `menu_item_id` values for `create_lunch_order_draft`.

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

### `list_school_events`

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

### `get_school_event`

Returns one event's detail: date, times, location, capacity, ticket price,
status, and visibility — plus its volunteer shifts (cancelled shifts are
excluded) and the caller's own active signups on those shifts. `shifts[].id`
is the `shift_id` for `sign_up_for_volunteer_shift`; `mySignups[].signupId`
feeds `cancel_my_volunteer_signup`. Get `event_id` from `list_school_events`.

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_events`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

| Property      | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `event_id`    | string | yes      | From `list_school_events` |
| `school_slug` | string | no       | Defaults to active school |

**Backend:** `GET /api/events/{event_id}/detail`

---

### `list_event_attendees` _(admin)_

Lists the attendee tickets for one school event — the minimum check-in desk
needs: ticket `id`, attendee name, `quantity`, `status`, and `checkedInAt`.
Contact details, internal user ids, and payment amounts are intentionally not
returned. Paginate with `per_page` and `offset`; `hasMore` reports whether
another page exists. Get `event_id` from `list_school_events`; the `id` values
feed `check_in_event_ticket`.

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, event_cordinator |
| **Classifications** | READ, ADMIN, PRIVACY_SENSITIVE   |
| **Confirmation**    | no                               |

**Input schema**

| Property      | Type    | Required | Description                    |
| ------------- | ------- | -------- | ------------------------------ |
| `event_id`    | string  | yes      | From `list_school_events`      |
| `school_slug` | string  | no       | Defaults to active school      |
| `per_page`    | integer | no       | Page size, 1–100 (default 50)  |
| `offset`      | integer | no       | Rows to skip for the next page |

**Backend:** `GET /api/events/{event_id}/tickets`

---

### `create_school_event` _(admin)_

Creates a school event. Do not create events without explicit user request.

|                          |                                  |
| ------------------------ | -------------------------------- |
| **Capability**           | `ai_write`                       |
| **Entitlement required** | yes                              |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN                     |
| **Confirmation**         | **yes**                          |

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

### `update_school_event` _(admin)_

Updates an existing school event.

|                          |                                  |
| ------------------------ | -------------------------------- |
| **Capability**           | `ai_write`                       |
| **Entitlement required** | yes                              |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN                     |
| **Confirmation**         | **yes**                          |

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

### `cancel_school_event` _(admin)_

Cancels a school event. **DESTRUCTIVE** — cancelled events cannot be reactivated.

|                          |                                  |
| ------------------------ | -------------------------------- |
| **Capability**           | `ai_write`                       |
| **Entitlement required** | yes                              |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | DESTRUCTIVE, ADMIN               |
| **Confirmation**         | **yes**                          |

**Input schema**

| Property   | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `event_id` | string | yes      |             |

**Backend:** `POST /api/events/{event_id}/cancel`

---

### `check_in_event_ticket` _(admin)_

Marks one attendee ticket as checked in (`ticket_id` from
`list_event_attendees`). Only `paid` tickets can check in — a repeat call on
an already checked-in ticket is rejected by the backend.

|                          |                                  |
| ------------------------ | -------------------------------- |
| **Capability**           | `ai_write`                       |
| **Entitlement required** | yes                              |
| **Required roles**       | pac_cordinator, event_cordinator |
| **Classifications**      | WRITE, ADMIN                     |
| **Confirmation**         | **yes**                          |

**Input schema**

| Property      | Type   | Required | Description                 |
| ------------- | ------ | -------- | --------------------------- |
| `ticket_id`   | string | yes      | From `list_event_attendees` |
| `school_slug` | string | no       | Defaults to active school   |

**Backend:** `POST /api/events/tickets/{ticket_id}/check-in`

---

### `register_for_event`

Registers the authenticated user for an event and issues tickets (`quantity`
tickets for the caller, 1–20). For paid events the wallet is charged
`quantity × ticket_price_cents`; the call fails on insufficient balance with
an error carrying the regional Paxaver top-up page — card payments are never
offered through MCP. **FINANCIAL + WRITE** — confirm before calling.

|                          |                  |
| ------------------------ | ---------------- |
| **Capability**           | `ai_write`       |
| **Entitlement required** | yes              |
| **Required roles**       | _(any member)_   |
| **Classifications**      | FINANCIAL, WRITE |
| **Confirmation**         | **yes**          |

**Input schema**

| Property      | Type    | Required | Description                         |
| ------------- | ------- | -------- | ----------------------------------- |
| `event_id`    | string  | yes      | From `list_school_events`           |
| `quantity`    | integer | no       | Number of tickets, 1–20 (default 1) |
| `school_slug` | string  | no       | Defaults to active school           |

**Backend:** `POST /api/events/{event_id}/register`

---

### `list_my_event_registrations`

Lists the caller's own event registrations/tickets.

**Backend:** `GET /api/events/tickets/mine`

---

### `cancel_my_event_registration`

Cancels one of the caller's own registrations (`ticket_id` required — this
is a ticket/registration ID, not an event ID). Seat release and refund
semantics are enforced by the backend. **DESTRUCTIVE** — confirm.

**Backend:** `POST /api/events/tickets/{ticket_id}/cancel`

---

## Volunteering

Volunteer signups are separate from ticket registration: a `shift_id`
(from `get_school_event`) identifies the volunteer shift; the signup
itself returns a `signup_id`.

### `list_my_volunteer_signups`

Lists the caller's own volunteer signups.

**Backend:** `GET /api/volunteers/my-signups`

---

### `sign_up_for_volunteer_shift`

Signs the caller up for a volunteer shift (`shift_id` required).
**WRITE**.

**Backend:** `POST /api/volunteers/signups`

---

### `cancel_my_volunteer_signup`

Cancels one of the caller's own volunteer signups (`signup_id` required).
**DESTRUCTIVE** — confirm.

**Backend:** `POST /api/volunteers/signups/{signup_id}/cancel`

---

### `create_volunteer_shift` _(admin)_

Creates a volunteer shift at the active school, optionally attached to an
event (`event_id` must belong to the same school). Parents discover the shift
via `get_school_event` and sign up through `sign_up_for_volunteer_shift`.

|                          |                            |
| ------------------------ | -------------------------- |
| **Capability**           | `ai_write`                 |
| **Entitlement required** | yes                        |
| **Required roles**       | pac_cordinator, pac_member |
| **Classifications**      | WRITE, ADMIN               |
| **Confirmation**         | **yes**                    |

**Input schema**

| Property      | Type    | Required | Description                  |
| ------------- | ------- | -------- | ---------------------------- |
| `title`       | string  | yes      | Shift title shown to parents |
| `shift_date`  | string  | yes      | YYYY-MM-DD                   |
| `start_time`  | string  | yes      | HH:MM                        |
| `end_time`    | string  | yes      | HH:MM                        |
| `school_slug` | string  | no       | Defaults to active school    |
| `event_id`    | string  | no       | Event the shift belongs to   |
| `description` | string  | no       | Description of the work      |
| `slots`       | integer | no       | Volunteer slots (default 1)  |

**Backend:** `POST /api/volunteers/shifts`

---

## Programs

Programs are before/after-school care, enrichment, and camp registrations.
`list_school_programs` is the catalog; `register_for_program` enrolls one of
the caller's students (or waitlists them at capacity); the two admin tools
manage the waitlist. Registration records the program fee — no wallet charge
happens at registration.

### `list_school_programs`

Returns the active programs for the user's active school: name, description,
type, dates, fee, capacity, and current enrollment. Filter by `program_type`
(`before_school`, `after_school`, `enrichment`, `camp`).

|                     |                |
| ------------------- | -------------- |
| **Capability**      | `view_events`  |
| **Required roles**  | _(any member)_ |
| **Classifications** | READ           |
| **Confirmation**    | no             |

**Input schema**

| Property       | Type   | Required | Description                |
| -------------- | ------ | -------- | -------------------------- |
| `school_slug`  | string | no       | Defaults to active school  |
| `program_type` | string | no       | Filter to one program type |

**Backend:** `GET /api/programs`

---

### `register_for_program`

Registers one of the caller's own students for a program (`program_id` from
`list_school_programs`, `student_id` from `get_my_context`). Returns
`registered` when a seat is free or `waitlist` at capacity — the backend
enforces capacity atomically. The fee (`amountCents`) is recorded on the
registration; nothing is charged at this point. **WRITE** — confirm.

|                          |                |
| ------------------------ | -------------- |
| **Capability**           | `ai_write`     |
| **Entitlement required** | yes            |
| **Required roles**       | _(any member)_ |
| **Classifications**      | WRITE          |
| **Confirmation**         | **yes**        |

**Input schema**

| Property      | Type   | Required | Description                       |
| ------------- | ------ | -------- | --------------------------------- |
| `program_id`  | string | yes      | From `list_school_programs`       |
| `student_id`  | string | yes      | Caller's own student              |
| `school_slug` | string | no       | Defaults to active school         |
| `notes`       | string | no       | Note to staff on the registration |

**Backend:** `POST /api/programs/registrations`

---

### `list_program_registrations` _(admin)_

Lists the school's program registrations — including waitlisted ones — with
student name, status, fee, and notes. Use it to find the registration `id` for
`admit_program_registration`; filter to one program with `program_id`.

|                     |                       |
| ------------------- | --------------------- |
| **Capability**      | _(null — admin only)_ |
| **Required roles**  | pac_cordinator        |
| **Classifications** | READ, ADMIN           |
| **Confirmation**    | no                    |

**Input schema**

| Property      | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `school_slug` | string | no       | Defaults to active school |
| `program_id`  | string | no       | Filter to one program     |

**Backend:** `GET /api/programs/registrations`

---

### `cancel_program_registration`

Cancels one of the caller's own students' program registrations
(`registration_id` from `register_for_program`). When the program has a
waitlist, the next waitlisted registration is promoted automatically.
**DESTRUCTIVE** — confirm.

|                          |                    |
| ------------------------ | ------------------ |
| **Capability**           | `ai_write`         |
| **Entitlement required** | yes                |
| **Required roles**       | _(any member)_     |
| **Classifications**      | DESTRUCTIVE, WRITE |
| **Confirmation**         | **yes**            |

**Input schema**

| Property          | Type   | Required | Description                 |
| ----------------- | ------ | -------- | --------------------------- |
| `registration_id` | string | yes      | From `register_for_program` |
| `school_slug`     | string | no       | Defaults to active school   |

**Backend:** `POST /api/programs/registrations/{registration_id}/cancel`

---

### `admit_program_registration` _(admin)_

Manually promotes a waitlisted registration to a seat. The backend rejects
registrations that are not in `waitlist` status. Find the registration `id`
with `list_program_registrations`.

|                          |                |
| ------------------------ | -------------- |
| **Capability**           | `ai_write`     |
| **Entitlement required** | yes            |
| **Required roles**       | pac_cordinator |
| **Classifications**      | WRITE, ADMIN   |
| **Confirmation**         | **yes**        |

**Input schema**

| Property          | Type   | Required | Description                       |
| ----------------- | ------ | -------- | --------------------------------- |
| `registration_id` | string | yes      | From `list_program_registrations` |
| `school_slug`     | string | no       | Defaults to active school         |

**Backend:** `POST /api/programs/registrations/{registration_id}/admit`

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

### `create_school_restaurant` _(admin)_

Creates a restaurant for the active school. Platform admins may select another school with `school_slug`.

|                     |                       |
| ------------------- | --------------------- |
| **Capability**      | _(null — admin only)_ |
| **Required roles**  | pac_cordinator        |
| **Classifications** | WRITE, ADMIN          |
| **Confirmation**    | **yes**               |

**Input schema**

| Property      | Type   | Required | Description                                                          |
| ------------- | ------ | -------- | -------------------------------------------------------------------- |
| `name`        | string | yes      |                                                                      |
| `school_slug` | string | no       | Defaults to active school; platform admins may select another school |
| `description` | string | no       |                                                                      |
| `tax_percent` | number | no       |                                                                      |

**Backend:** `POST /api/schools/{school_slug}/restaurants`

---

### `list_restaurant_menu_items` _(admin)_

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

### `create_restaurant_menu_item` _(admin)_

Creates a menu item for a restaurant.

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                     |
| **Confirmation**    | **yes**                          |

**Input schema**

| Property        | Type     | Required | Description |
| --------------- | -------- | -------- | ----------- |
| `restaurant_id` | string   | yes      |             |
| `name`          | string   | yes      |             |
| `description`   | string   | no       |             |
| `cost_cents`    | integer  | no       |             |
| `price_cents`   | integer  | no       |             |
| `ingredients`   | string[] | no       |             |
| `calories`      | integer  | no       |             |

**Backend:** `POST /api/restaurants/{restaurant_id}/items`

---

### `update_restaurant_menu_item` _(admin)_

Partially updates a menu item, including its price (`price_cents` — **FINANCIAL**, confirm the new price).

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                     |
| **Confirmation**    | **yes**                          |

**Input schema**

| Property        | Type     | Required | Description |
| --------------- | -------- | -------- | ----------- |
| `restaurant_id` | string   | yes      |             |
| `menu_item_id`  | string   | yes      |             |
| `name`          | string   | no       |             |
| `description`   | string   | no       |             |
| `cost_cents`    | integer  | no       |             |
| `ingredients`   | string[] | no       |             |
| `calories`      | integer  | no       |             |
| `is_active`     | boolean  | no       |             |
| `price_cents`   | integer  | no       |             |

**Backend:** `PATCH /api/restaurants/{restaurant_id}/items/{menu_item_id}`

---

### `archive_restaurant_menu_item` _(admin)_

Soft-deletes a menu item. **DESTRUCTIVE**.

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | DESTRUCTIVE, ADMIN               |
| **Confirmation**    | **yes**                          |

**Input schema**

| Property        | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `restaurant_id` | string | yes      |             |
| `menu_item_id`  | string | yes      |             |

**Backend:** `DELETE /api/restaurants/{restaurant_id}/items/{menu_item_id}`

---

### `schedule_lunch_menu_item` _(admin)_

Adds or schedules a single menu item on a date (with an optional
`available_qty` portion cap) — it does not replace the whole day's menu.

|                     |                                  |
| ------------------- | -------------------------------- |
| **Capability**      | _(null — admin only)_            |
| **Required roles**  | pac_cordinator, lunch_cordinator |
| **Classifications** | WRITE, ADMIN                     |
| **Confirmation**    | **yes**                          |

**Input schema**

| Property        | Type    | Required | Description               |
| --------------- | ------- | -------- | ------------------------- |
| `school_slug`   | string  | no       | Defaults to active school |
| `restaurant_id` | string  | yes      |                           |
| `menu_item_id`  | string  | yes      |                           |
| `menu_date`     | string  | yes      | YYYY-MM-DD                |
| `available_qty` | integer | no       |                           |

**Backend:** `POST /api/schools/{school_slug}/menu/daily`

---

## Prompts

The server currently registers four prompts. Clients can discover them with
`prompts/list` and retrieve the instructions with `prompts/get`.

| Prompt               | Description                                                              | Arguments               |
| -------------------- | ------------------------------------------------------------------------ | ----------------------- |
| `daily_lunch_menu`   | Show today's school lunch menu; supports a date or month.                | None                    |
| `wallet_balance`     | Report the spendable wallet balance and remind the user where to top up. | None                    |
| `upcoming_events`    | List upcoming school events and offer event or volunteer registration.   | None                    |
| `lunch_order_helper` | Guide the user through selecting, reviewing, and paying for lunch.       | Optional `student_name` |

## Legacy tool names

Pre-2.5 tool names still work: `tools/call` resolves them to the canonical
tool via `TOOL_ALIASES` in `apps/mcp/src/lib/policies.ts`, with the same
policy checks and handler. They are **not** advertised in `tools/list`.
There are no argument or response differences — only the name.

| Legacy name                  | Canonical name                 |
| ---------------------------- | ------------------------------ |
| `get_user_info`              | `get_my_context`               |
| `get_wallet_balance`         | `get_my_wallet_balance`        |
| `get_menu`                   | `get_lunch_menu`               |
| `get_orders`                 | `list_my_lunch_orders`         |
| `create_draft_order`         | `create_lunch_order_draft`     |
| `update_draft_order`         | `update_lunch_order_draft`     |
| `discard_draft_order`        | `discard_lunch_order_draft`    |
| `finalize_order`             | `pay_lunch_order_draft`        |
| `cancel_order`               | `cancel_my_lunch_order`        |
| `get_upcoming_events`        | `list_school_events`           |
| `create_event`               | `create_school_event`          |
| `update_event`               | `update_school_event`          |
| `cancel_event`               | `cancel_school_event`          |
| `register_event`             | `register_for_event`           |
| `get_my_event_registrations` | `list_my_event_registrations`  |
| `cancel_event_registration`  | `cancel_my_event_registration` |
| `sign_up_to_volunteer`       | `sign_up_for_volunteer_shift`  |
| `get_my_volunteer_signups`   | `list_my_volunteer_signups`    |
| `cancel_volunteer_signup`    | `cancel_my_volunteer_signup`   |
| `create_restaurant`          | `create_school_restaurant`     |
| `list_menu_items`            | `list_restaurant_menu_items`   |
| `create_menu_item`           | `create_restaurant_menu_item`  |
| `update_menu_item`           | `update_restaurant_menu_item`  |
| `delete_menu_item`           | `archive_restaurant_menu_item` |
| `set_daily_menu`             | `schedule_lunch_menu_item`     |

`order_lunch` is removed: it bought lunch at once and skipped the draft
review and the wallet-only payment. It returns `Unknown tool` (-32601).
Integrations must use `create_lunch_order_draft` + `pay_lunch_order_draft`.

**Disabling compatibility:** remove the entry from `TOOL_ALIASES` to make a
legacy name return
`Method not found` (-32601). Aliases are candidates for removal once usage
metrics show no calls for a deprecation window.
