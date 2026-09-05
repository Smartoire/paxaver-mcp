# ChatGPT Marketplace - App Info

> Fill in the ChatGPT developer portal "App Info" tab using the values below.

## App Name

Paxaver

## Short Description (for directory card)

Paxaver is the school community platform that connects PACs, schools, and families. Use this app to check lunch menus, place hot-lunch orders, view wallet balances, and manage school restaurant menus - all from ChatGPT. No personal contact information is collected or returned through MCP tools.

## Full Description (for listing page)

Paxaver is the operating system connecting Parent Advisory Committees (PACs), schools, and communities. This ChatGPT app lets parents, school staff, and PAC members interact with their Paxaver school account through natural conversation.

**For parents & families:**

- View the daily and monthly lunch menu for your child's school
- Place hot-lunch orders for your students
- Check your wallet balance and recent transactions
- Review your order history

**For PAC Coordinators, PAC members & lunch coordinators:**

- Manage restaurants linked to your school
- Create, update, and price menu items
- Assign menu items to dates on the daily menu
- View all orders placed for a given school day

**How it works:**
When you first connect, ChatGPT will ask you to sign in with your Paxaver account via secure OAuth. Once authorized, ChatGPT can call Paxaver tools on your behalf - it will always show you what it's doing and ask for confirmation before placing orders or making changes.

**Privacy & Data Collection:**

- **What this app collects:** Your first and last name, your active school name and slug, your students' first names, last names, and school slugs, and your roles (parent, guardian, PAC member, PAC coordinator).
- **What this app does NOT collect:** Email addresses, phone numbers, physical addresses, allergies, birthday, health information, free-form notes about students, payment information, credit card numbers, or authentication credentials.
- **How data is handled:** All data is transmitted over HTTPS with RS256 JWT authentication. The MCP server is a thin adapter — it does not store data. All actions are delegated to the Paxaver backend via Cloudflare service binding (same region, no public network hop). The MCP server does not log user data. No data is shared with third parties.
- **Tool-specific notes:** `create_restaurant` only accepts a restaurant name. `create_event` and `update_event` do not collect contact email or phone. `order_lunch` uses student ID and menu item ID — no PII transmitted. `get_user_info` returns name, school, students, and roles only.

## Category

Education / School Management

## Website

https://paxaver.com

## Support URL

https://paxaver.com/support

## Support Email

support@paxaver.com

## Privacy Policy URL

https://paxaver.com/privacy

## Terms of Service URL

https://paxaver.com/privacy/terms

## Logo

See `branding-assets.md` for specifications. Upload a square app icon (minimum 512×512px, PNG or SVG).

## Video Demo

See `branding-assets.md` for specifications. A 30–60 second screen recording showing the OAuth sign-in flow and a lunch order being placed through ChatGPT.

## Monetization

Paxaver is free for families to use. Schools pay a subscription for the platform. The ChatGPT app itself does not charge users - it is an interface to an existing Paxaver account. Orders and donations are placed against the user's existing wallet balance, which is managed on the Paxaver website. The ChatGPT app cannot process payments or top up wallets directly.

- **Pricing model:** Free (requires existing Paxaver account)
- **In-app purchases:** None
- **Transactions through ChatGPT:** Orders and donations are placed against the user's existing wallet balance. No payments are processed within ChatGPT.
