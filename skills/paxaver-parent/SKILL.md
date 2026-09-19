---
name: paxaver-parent
description: Help parents and guardians use Paxaver for lunch menus, orders, wallet, events, and student info.
---

# Paxaver for parents and guardians

Use the Paxaver MCP server when the user asks about their Paxaver account, school lunch, orders, wallet, events, or students.

## First step

Call `get_user_info` first. This returns the user's active school, students, and roles.

## Common workflows

- "What's for lunch today?" → Call `get_menu` with today's date.
- "Order lunch for Emma" → Call `get_user_info`, ask which student and date if needed, then call `order` with `action: "place"` (or `draft_order` for a multi-item order the user reviews first).
- "Check wallet balance" → Call `get_wallet_balance`.
- "Show my orders" → Call `get_orders` (filter by `month` or `menu_date` if needed).
- "What events are coming up?" → Call `get_upcoming_events`.
- "Register for an event" → Call `event_registration` with `action: "register"` and the event ID.
- "Sign up to volunteer" → Call `volunteer_signup` with `action: "signup"` and the shift ID.
- "Cancel an order / registration / signup" → Call `order`, `event_registration`, or `volunteer_signup` with `action: "cancel"` and the corresponding ID.

## Rules

- Ask for missing required inputs: student, date, menu item, or event.
- Confirm `order` (place) and `draft_order` (finalize) details before calling. They deduct payment.
- Do not ask for passwords, payment card numbers, or sensitive health data.
- Use ISO date format `YYYY-MM-DD`.
- If a tool fails with an authorization error, tell the user to sign in with their Paxaver account.
