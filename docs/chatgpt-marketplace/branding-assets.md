# ChatGPT Marketplace - Branding Assets

> This is a checklist of visual assets you need to create and upload to the ChatGPT developer portal. None of these can be generated from code - they must be designed and exported manually.

---

## 1. App Logo (required)

- **Size:** 512×512px minimum (square)
- **Format:** PNG (with transparency) or SVG
- **Content:** The Paxaver app icon - should be recognizable at small sizes (it appears as a small icon in the ChatGPT sidebar and directory)
- **Notes:** Use the Paxaver brand colors and logo mark. Avoid text that becomes illegible at small sizes. If you have an existing logo, export a square version with padding so the mark isn't cropped.

## 2. App Screenshots (required: 1–4 images)

Upload 1–4 screenshots of your app widget UI. These appear in the install views across all screen sizes and locales.

### Specifications

- **Format:** PNG or JPG
- **Width:** exactly 706px
- **Height:** 400–860px
- **Retina:** At least one screenshot must be 2× retina quality (1412px wide, height scaled proportionally)
- **Content:** Show ONLY your widget UI - no ChatGPT interface, no user prompts, no model responses, no embedded text overlays

### Recommended Screenshots

Prepare screenshots showing the ChatGPT conversation with Paxaver tool responses:

1. **Lunch Menu** - ChatGPT response to "What's for lunch today?" showing the menu items with names, prices (including tax), and restaurant names. This is the primary use case and should be screenshot #1.
2. **Order Confirmation** - ChatGPT response after placing an order, showing the item name, date, quantity, total, and order ID.
3. **Wallet Balance** - ChatGPT response showing the current wallet balance with currency.
4. **Monthly Orders (admin)** - ChatGPT response showing all lunch orders for a month (admin/PAC view), demonstrating the school management capabilities.

### How to Capture

1. Connect the MCP server to ChatGPT (or a local MCP client).
2. Trigger each conversation flow (e.g. "What's for lunch today?", "Order a pizza for Emma on Friday").
3. Screenshot the ChatGPT response - crop to 706px wide, showing only the conversation content.
4. For the retina version, capture at 2× or upscale the first screenshot to 1412px wide.

### Figma Template

OpenAI provides a public Figma template for screenshot design. Use it to frame your widget screenshots at the correct dimensions: [ChatGPT app screenshot Figma template](https://www.figma.com) (link available in the ChatGPT developer portal).

## 3. Video Demo (required)

- **Length:** 30–60 seconds
- **Format:** MP4 (H.264) or MOV
- **Content:** A screen recording showing the full user journey:
  1. User asks "What's for lunch today?" in ChatGPT
  2. OAuth sign-in flow (brief - show the Paxaver login page and redirect back)
  3. ChatGPT responds with the daily menu (items, prices, restaurants)
  4. User asks to place an order
  5. ChatGPT confirms the order with item name, date, total, and order ID
- **Notes:** Keep it concise. Show the OAuth flow and one complete ordering interaction. No narration needed - captions or on-screen text are optional. Ensure no real user PII (names, emails) is visible.

## 4. Additional Assets (optional but recommended)

- **App cover/banner image** - If the portal supports a hero image, prepare a 1920×1080px banner showing the Paxaver brand with a school community theme.
- **Localized screenshots** - If you publish to both English and French locales, consider capturing screenshots with French-language widget content for the French listing.
