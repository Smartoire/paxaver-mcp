# ChatGPT Marketplace Submission - Paxaver

Documents prepared for publishing the Paxaver MCP server to the ChatGPT app marketplace.

## Files

| File                   | Portal Tab             | Description                                                                                  |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `app-info.md`          | App Info               | App name, description, website/support/privacy/terms URLs, monetization                      |
| `mcp-server.md`        | MCP Server             | Server URLs, OAuth flow, verification token setup, tools overview                            |
| `test-cases.md`        | Testing                | 6 positive + 6 negative test cases with scenarios, prompts, tools, expected outputs          |
| `branding-assets.md`   | App Info / Screenshots | Specs for logo, screenshots (706px wide), and video demo                                     |
| `global-and-submit.md` | Global / Submit        | Localization, country selection, release notes, compliance answers, pre-submission checklist |

## Code Changes

A ChatGPT URL verification endpoint was added to the MCP server (in the separate `VaHiX/paxaver-mcp` repo):

- **Endpoint:** `GET /.well-known/chatgpt-verification/:token`
- **Env var:** `CHATGPT_VERIFY_TOKEN` (set via `wrangler secret put`)

## Deployment Steps

```bash
# In the VaHiX/paxaver-mcp repo:

# 1. Set the verification token (get it from the ChatGPT developer portal)
wrangler secret put CHATGPT_VERIFY_TOKEN --config wrangler.ca.jsonc
wrangler secret put CHATGPT_VERIFY_TOKEN --config wrangler.us.jsonc

# 2. Deploy both regions
npm run deploy

# 3. Verify the endpoint works
curl https://mcp-ca.paxaver.com/.well-known/chatgpt-verification/<your-token>
# Should return: verify Ownership
```

## Two Marketplace Listings

| Listing          | Server URL                   | Countries     |
| ---------------- | ---------------------------- | ------------- |
| Paxaver (Canada) | `https://mcp-ca.paxaver.com` | Canada        |
| Paxaver (US)     | `https://mcp-us.paxaver.com` | United States |

Each listing needs its own verification token, screenshots, and test cases (the test cases are identical, just point at the respective server URL).
