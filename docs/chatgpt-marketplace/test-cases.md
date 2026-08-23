# ChatGPT Marketplace - Test Cases

> Enter these in the ChatGPT developer portal "Testing" tab. Each test case requires a signed-in Paxaver user with the appropriate role. The tester should use the Canada MCP server (`https://mcp-ca.paxaver.com`) unless noted.

## Prerequisites

All test cases require a Paxaver account that has been set up with:

- At least one active school membership
- At least one student (for parent-role tests)
- Wallet balance > $0 (for ordering tests)
- At least one restaurant with menu items and a daily menu entry for the test date (for menu/ordering tests)

The tester signs in via the OAuth flow when ChatGPT first connects to the app.

---

## Positive Test Cases

### Test 1: View today's lunch menu

- **Scenario:** A parent wants to see what lunch options are available at their child's school today.
- **User prompt:** "What's for lunch at my kid's school today?"
- **Tool triggered:** `get_user_info` (to discover active school), then `get_daily_menu` (with today's date).
- **Expected output:** ChatGPT first calls `get_user_info` to find the user's active school and student list. It then calls `get_daily_menu` with today's date. The response contains an array of menu items with `menuItemId`, `menuItemName`, `restaurantName`, `priceCents`, `priceWithTax`, and `menuDate`. ChatGPT summarizes the options in text, showing each item with its name, price (including tax), and restaurant.

### Test 2: Check wallet balance

- **Scenario:** A parent wants to know how much money is in their lunch wallet before ordering.
- **User prompt:** "How much money do I have in my lunch wallet?"
- **Tool triggered:** `get_user_info` (to discover active school), then `get_wallet_balance`.
- **Expected output:** ChatGPT calls `get_user_info` to confirm the active school, then calls `get_wallet_balance`. The response contains `balanceCents` (integer), `balanceFormatted` (e.g. `"$42.50"`), and `currency` (`"CAD"`). ChatGPT states the balance in text, e.g. "Your lunch wallet balance is $42.50 CAD."

### Test 3: Place a lunch order

- **Scenario:** A parent wants to order lunch for their child for a specific day.
- **User prompt:** "Order a pepperoni pizza for Emma for lunch this Friday."
- **Tool triggered:** `get_user_info` (to discover `student_id`), then `get_daily_menu` (to find the `menu_item_id` for pepperoni pizza on Friday), then `order_lunch` (with `student_id`, `menu_item_id`, `menu_date`, and `quantity`).
- **Expected output:** ChatGPT calls `get_user_info` to find Emma's `student_id`. It calls `get_daily_menu` for Friday's date to find the pepperoni pizza `menuItemId` and confirms it's available. It calls `order_lunch` with the required parameters. The response contains `orderId`, `item`, `quantity`, `unitPriceCents`, `totalCents`, `totalFormatted` (e.g. `"$6.50"`), and `status: "confirmed"`. ChatGPT confirms the order in text, e.g. "Done - I've ordered 1 pepperoni pizza for Emma on Friday. Order total: $6.50. Your order ID is [id]."

### Test 4: View order history

- **Scenario:** A parent wants to review their recent lunch orders.
- **User prompt:** "Show me my recent lunch orders."
- **Tool triggered:** `get_user_info` (to discover students), then `get_orders`.
- **Expected output:** ChatGPT calls `get_user_info` to find the student list, then calls `get_orders`. The response is an array of recent orders, each with `id`, `student` (name), `item` (name), `menu_date`, `quantity`, `unit_price_cents`, `total_cents`, `status`, and `created_at`. ChatGPT presents the orders in a readable list or table, showing the date, student, item, quantity, total, and status for each.

### Test 5: View monthly orders (PAC member)

- **Scenario:** A PAC member wants to see all lunch orders for the school this month.
- **User prompt:** "Show me all the lunch orders for our school this month."
- **Tool triggered:** `get_user_info` (to confirm admin role), then `get_monthly_orders` (with `month` = current month).
- **Expected output:** ChatGPT calls `get_user_info` and sees the user's role is `pac_member` or `school_master`. It calls `get_monthly_orders` with the current month (YYYY-MM). The response contains `month`, `count`, and an `orders` array, each with `id`, `student`, `restaurant`, `item`, `menu_date`, `quantity`, `total_cents`, `status`, and `created_at`. ChatGPT summarizes the orders in text, presenting the total count and a breakdown by date or student.

### Test 6: Set the daily menu (school master)

- **Scenario:** A school master wants to assign a menu item to a specific date on the daily menu.
- **User prompt:** "Add the cheese sandwich to the daily menu for next Tuesday at our school."
- **Tool triggered:** `get_user_info` (to confirm admin role), then `list_school_restaurants` (with `school_slug`), then `list_menu_items` (to find the `menu_item_id` for "cheese sandwich"), then `set_daily_menu` (with `restaurant_id`, `menu_item_id`, `menu_date` = next Tuesday).
- **Expected output:** ChatGPT calls `get_user_info` to confirm admin role. It calls `list_school_restaurants` with the school slug to find the restaurant, then `list_menu_items` to find the cheese sandwich's `menu_item_id`. It calls `set_daily_menu` with the required parameters. The response confirms the menu item was assigned to the date. ChatGPT confirms in text, e.g. "Done - I've added the cheese sandwich to the daily menu for Tuesday, [date]."

---

## Negative Test Cases

### Negative Test 1: Order lunch for a non-existent student

- **Scenario:** A user tries to order lunch for a student ID that doesn't belong to them.
- **User prompt:** "Order a pizza for student ID 00000000-0000-0000-0000-000000000000 for lunch tomorrow."
- **Tool triggered:** `get_user_info` (to check student list), then `order_lunch` (with the invalid `student_id`).
- **Expected output:** ChatGPT calls `get_user_info` and sees the requested student ID is not in the user's student list. It may either inform the user that the student doesn't exist, or attempt `order_lunch` which returns `{ error: 'Student not found' }`. ChatGPT should inform the user that the student was not found and ask them to verify the student name or ID. No order is placed.

### Negative Test 2: Order a menu item not available on the requested date

- **Scenario:** A user tries to order a menu item that is not on the daily menu for the requested date.
- **User prompt:** "Order a sushi roll for Emma for lunch tomorrow."
- **Tool triggered:** `get_user_info`, then `get_daily_menu` (for tomorrow), then `order_lunch` (with a `menu_item_id` not on tomorrow's menu).
- **Expected output:** ChatGPT calls `get_daily_menu` for tomorrow and finds sushi is not listed. If it proceeds to call `order_lunch` with an invalid `menu_item_id` for that date, the server returns `{ error: 'Menu item not available for this date' }`. ChatGPT should inform the user that sushi is not available tomorrow and show what is available instead. No order is placed.

### Negative Test 3: Access daily orders without admin role

- **Scenario:** A regular parent (no PAC or school master role) tries to view all orders for a school day.
- **User prompt:** "Show me all the lunch orders for the school today."
- **Tool triggered:** `get_user_info` (role check), then `get_daily_orders` (which will be denied).
- **Expected output:** ChatGPT calls `get_user_info` and sees the user's role is `parent` (not `pac_member`, `school_master`, or `lunch_coordinator`). It calls `get_daily_orders`, which returns an error indicating admin access is required. ChatGPT should inform the user that they don't have permission to view all orders and that this feature is available to PAC members, school masters, and lunch coordinators only. It may suggest using `get_orders` to see their own students' orders instead.

### Negative Test 4: Order lunch with insufficient wallet balance

- **Scenario:** A user tries to place an order but their wallet balance is too low to cover the total.
- **User prompt:** "Order 5 pizzas for Emma for lunch tomorrow."
- **Tool triggered:** `get_user_info`, then `get_daily_menu`, then `get_wallet_balance` (to check balance), then `order_lunch` (which may fail or succeed depending on balance - if balance is insufficient, the server returns an error).
- **Expected output:** ChatGPT calls `get_wallet_balance` and sees the balance is less than the order total. It should warn the user that their wallet balance is insufficient before placing the order. If it proceeds with `order_lunch` and the server rejects it due to insufficient funds, the response contains an error. ChatGPT should inform the user of the insufficient balance and suggest topping up their wallet at paxaver.com/wallet.

### Negative Test 5: Call a tool without authentication

- **Scenario:** The MCP server is called without a valid OAuth token.
- **User prompt:** (This is a server-level test, not a user prompt. The tester makes a direct HTTP request to the MCP endpoint without an Authorization header.)
- **Tool triggered:** None - the request is rejected at the auth middleware.
- **Expected output:** The server returns `401 Unauthorized` with a `WWW-Authenticate` header pointing to `/.well-known/oauth-protected-resource`. The JSON body is `{ error: 'Authorization required' }`. ChatGPT should initiate the OAuth flow to obtain a valid token.

### Negative Test 6: Call a tool with an invalid/revoked token

- **Scenario:** The MCP server is called with a token that has been revoked or expired.
- **User prompt:** (Server-level test. The tester makes a direct HTTP request with an expired or revoked Bearer token.)
- **Tool triggered:** None - the request is rejected at the auth middleware.
- **Expected output:** The server returns `401 Unauthorized` with `{ error: 'Invalid, revoked or expired token' }` (legacy token) or a JWT verification failure (OAuth token). ChatGPT should prompt the user to re-authorize via the OAuth flow.
