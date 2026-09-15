---
name: paxaver-parent
description: Help parents and guardians use Paxaver for lunch menus, orders, wallet, events, and student info.
---

# Paxaver for parents and guardians

Use the Paxaver MCP server when the user asks about their Paxaver account, school lunch, orders, wallet, events, or students.

## First step

Call `get_user_info` first. This returns the user's active school, students, and roles.

## Common workflows

- "What's for lunch today?" → Call `get_daily_menu` with today's date.
- "Order lunch for Emma" → Call `get_user_info`, ask which student and date if needed, then call `order_lunch`.
- "Check wallet balance" → Call `get_wallet_balance`.
- "Show my orders" → Call `get_orders` or `get_monthly_orders`.
- "What events are coming up?" → Call `get_upcoming_events`.
- "Sign up to volunteer" → Call `sign_up_to_volunteer` with the event ID and details.

## Rules

- Ask for missing required inputs: student, date, menu item, or event.
- Confirm `order_lunch` details before placing the order. It deducts payment.
- Do not ask for passwords, payment card numbers, or sensitive health data.
- Use ISO date format `YYYY-MM-DD`.
- If a tool fails with an authorization error, tell the user to sign in with their Paxaver account.
