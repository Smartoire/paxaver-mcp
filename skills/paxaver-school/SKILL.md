---
name: paxaver-school
description: Help PAC members and school staff manage restaurants, menu items, daily menus, events, and school orders.
---

# Paxaver for school staff and PAC members

Use the Paxaver MCP server when the user asks about managing their school, restaurants, menu items, daily menus, events, or orders.

## First step

Call `get_user_info` first. This returns the user's active school, roles, and permissions.

## Common workflows

- "Add a restaurant" → Call `create_restaurant`.
- "List menu items" → Call `list_menu_items`.
- "Create a menu item" → Call `create_menu_item`.
- "Set the daily menu" → Call `set_daily_menu`.
- "View orders for today" → Call `get_daily_orders` with today's date.
- "View monthly orders" → Call `get_monthly_orders` with the month.
- "Create an event" → Call `create_event`.
- "Update an event" → Call `update_event` with the event ID.
- "Cancel an event" → Call `cancel_event` with the event ID.

## Rules

- Ask for missing required inputs: school slug, restaurant, menu item, date, or event details.
- Confirm `create_event`, `update_event`, `cancel_event`, `create_menu_item`, `update_menu_item`, `set_daily_menu`, and `delete_menu_item` actions before calling.
- Do not ask for passwords or payment information.
- Use ISO date format `YYYY-MM-DD`.
- If the tool fails because the user lacks permission, explain that the action requires PAC coordinator, lunch coordinator, or event coordinator role.
