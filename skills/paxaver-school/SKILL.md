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
- "Create / update / delete a menu item" → Call `manage_menu_item` with `action: "create"`, `"update"`, or `"delete"`.
- "Set the daily menu" → Call `set_daily_menu`.
- "View orders" → Call `get_orders` with `menu_date` for a day or `month` for a month.
- "Create / update / cancel an event" → Call `manage_event` with `action: "create"`, `"update"`, or `"cancel"`.

## Rules

- Ask for missing required inputs: school slug, restaurant, menu item, date, or event details.
- Confirm `manage_event`, `manage_menu_item`, and `set_daily_menu` actions before calling.
- Do not ask for passwords or payment information.
- Use ISO date format `YYYY-MM-DD`.
- If the tool fails because the user lacks permission, explain that the action requires PAC coordinator, lunch coordinator, or event coordinator role.
