---
name: paxaver-parent
description: Help parents and guardians use Paxaver for lunch menus, orders, wallet, events, and student info.
---

# Paxaver for parents and guardians

Use the Paxaver MCP server when the user asks about their Paxaver account, school lunch, orders, wallet, events, or students.

## First step

Call `get_my_context` first. This returns the user's active school, students, and roles.

## Common workflows

- "What's for lunch today?" → Call `get_lunch_menu` with today's date.
- "Order lunch for Emma" → Call `get_my_context`, ask which student and date if needed, then build the draft flow: `get_lunch_menu`, `create_lunch_order_draft`, confirm the total, then `pay_lunch_order_draft`.
- "Check wallet balance" → Call `get_my_wallet_balance`.
- "Show my orders" → Call `list_my_lunch_orders` (filter by `month` or `menu_date` if needed).
- "What events are coming up?" → Call `list_school_events`.
- "Sign up to volunteer" → Call `sign_up_for_volunteer_shift` with the event ID and details.

## Rules

- Ask for missing required inputs: student, date, menu item, or event.
- When a menu item has choice groups (toppings, sizes, ...), ask the user for each required group one at a time, offer the optional groups, then confirm the item, its choices and the total before `create_lunch_order_draft`. Pass the picks as `selected_choices` (`group_id` + `option_id` from the item's `choiceGroups` in `get_lunch_menu`). If the draft call fails naming a missing group, ask for it and retry.
- Confirm the draft total before `pay_lunch_order_draft` — that is the only step that charges.
- Do not ask for passwords, payment card numbers, or sensitive health data.
- Use ISO date format `YYYY-MM-DD`.
- If a tool fails with an authorization error, tell the user to sign in with their Paxaver account.
