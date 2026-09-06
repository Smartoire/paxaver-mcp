# ChatGPT Marketplace - Global & Submit

---

## Global (Localization & Countries)

### Default Language

English

### Supported Locales

The Paxaver frontend supports English and French (Canada). The MCP server tool descriptions are in English. For the marketplace listing:

- **App name:** Paxaver (same in all locales)
- **Short description:** Provide a French translation for the French-Canadian listing:

  > Paxaver est la plateforme communautaire scolaire qui connecte les comités de parents (PAC), les écoles et les familles. Utilisez cette application pour consulter les menus du dîner, passer des commandes de dîner chaud, voir le solde du portefeuille et gérer les menus de restaurant scolaire - le tout depuis ChatGPT.

- **Full description:** Provide a French translation of the full description (see `app-info.md`). Translate the entire description body.

### Countries

Publish to:

| Listing          | Countries     |
| ---------------- | ------------- |
| Paxaver (Canada) | Canada        |
| Paxaver (US)     | United States |

Select only the countries each regional server supports. The Canada server uses a Canada D1 database and CAD currency; the US server uses a US D1 database and USD currency.

---

## Submit (Release Notes & Compliance)

### Release Notes

> First submission - no prior version to compare against.

**Release notes (v1.0.0):**

```
Initial release of the Paxaver ChatGPT app.

Features:
- View daily and monthly lunch menus for your school
- Place hot-lunch orders for your students
- Check wallet balance and view order history
- Visual menu, order confirmation, and wallet balance widgets
- School management tools for PAC members and PAC Coordinators:
  financial summaries, school statistics, restaurant and menu item
  management, daily menu scheduling, and daily order views
- Secure OAuth 2.1 sign-in with your Paxaver account
- Canada and US regional deployments
```

### Compliance Checklist

Answer these compliance questions in the ChatGPT developer portal:

#### 1. Does your app collect, store, or transmit personal data?

**Yes.** The MCP server accesses the user's Paxaver account data (name, email, school memberships, student information, wallet balance, order history). However:

- Data is **not stored by the app/MCP server** - it is fetched from the existing Paxaver D1 database in real time and returned to ChatGPT as tool results.
- Data is **not shared with third parties**.
- Data is **not used for advertising**.
- The user explicitly authorizes access via OAuth and can revoke access at any time.

#### 2. Does your app make financial transactions?

**No.** The app does not process payments or charge users through ChatGPT. Lunch orders are placed against the user's existing wallet balance (pre-funded via the Paxaver website). No credit card or payment information is transmitted through the MCP server. Wallet deposits happen on `paxaver.com/wallet` via Stripe/PayPal, not through ChatGPT.

#### 3. Does your app access sensitive data (health, financial, government IDs)?

**Partial.** The app accesses wallet balance and order history (financial data in the context of school meal payments). Student records include allergy information (health-adjacent). This data is:

- Only accessible after explicit OAuth authorization by the account holder
- Scoped to the user's own data and schools they belong to
- Not transmitted to any third party
- Protected by JWT-based authentication with 1-hour token expiry

#### 4. Does your app target children (under 13)?

**No.** The app is designed for parents, school staff, and PAC members (adults). Students do not use the ChatGPT app. The app handles student data on behalf of parents/guardians who have authorized access.

#### 5. Does your app use AI to generate content?

**No.** The MCP server does not use AI to generate content. It is a tool server that returns structured data from the Paxaver database. ChatGPT (the host) generates the natural language responses.

#### 6. Does your app have a privacy policy?

**Yes.** https://paxaver.com/privacy

#### 7. Does your app have terms of service?

**Yes.** https://paxaver.com/privacy/terms

#### 8. Is your app open source?

**No.** Paxaver is proprietary software (see LICENSE in the repository).

### Pre-Submission Verification

Before clicking "Submit for review":

- [ ] Deploy both MCP servers with the `CHATGPT_VERIFY_TOKEN` secret set
- [ ] Verify the verification endpoint returns 200:
      `curl https://mcp-ca.paxaver.com/.well-known/chatgpt-verification/<token>`
- [ ] Verify OAuth discovery endpoints return valid JSON:
      `curl https://mcp-ca.paxaver.com/.well-known/oauth-authorization-server`
- [ ] Complete a full OAuth flow test (sign in, get token, call `get_user_info`)
- [ ] Upload the app logo (512×512px)
- [ ] Upload 1–4 screenshots (706px wide, at least one 2× retina)
- [ ] Upload the video demo
- [ ] Enter all App Info fields (description, website, support, privacy, terms URLs)
- [ ] Enter the MCP server URL and verification token
- [ ] Enter all 6 positive + 6 negative test cases
- [ ] Select countries (Canada for CA listing, US for US listing)
- [ ] Enter release notes
- [ ] Complete all compliance questions
- [ ] Submit and wait for OpenAI review
