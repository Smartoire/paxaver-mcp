# Microsoft MCP Server Certification Package

Submission package for the Partner Center offer type
**Apps and Agents for M365 and Copilot**.

Reference:
https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-certification

## Package contents

| File            | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `manifest.json` | Teams devPreview manifest with the `agentConnectors` remote MCP server definition. |
| `mcptools.json` | Tool definitions. Generated from the live registry; do not edit by hand.           |
| `intro.md`      | Public documentation for the listing (features, auth, known issues).               |
| `Color.png`     | Color icon, 192x192.                                                               |
| `Outline.png`   | Outline icon, 32x32, white on transparent.                                         |

## Regenerating mcptools.json

```bash
pnpm package:microsoft
```

The script fails if any tool definition contains non-ASCII characters
(Microsoft validation rejects them).

## Azure Key Vault setup (completed 2026-09-05)

The manifest references the vault Microsoft's certification service reads
during validation.

- Vault: `https://paxaver-mcp-kv.vault.azure.net/`
  (resource group `paxaver-mcp-cert`, location `canadacentral`, RBAC mode)
- OAuth client: registered via `POST https://auth.paxaver.com/register`
  (RFC 7591 DCR), confidential client, name "Microsoft Copilot Studio",
  redirect URI `https://global.consent.azure-apim.net/redirect`,
  scopes `openid profile email offline_access tools`.
- Microsoft's certification service principal
  `8e91e74f-afe9-41cd-8c3f-17a9562a74ea` has **Key Vault Secrets User**
  on the vault.

Secrets stored (names are case-sensitive):

| Secret name        | Value                                       |
| ------------------ | ------------------------------------------- |
| `ClientId`         | DCR client ID (`mcp-dcr-...`)               |
| `ClientSecret`     | DCR client secret                           |
| `AuthorizationUrl` | `https://auth.paxaver.com/authorize`        |
| `TokenUrl`         | `https://auth.paxaver.com/token`            |
| `RefreshUrl`       | `https://auth.paxaver.com/token`            |
| `Scopes`           | `openid profile email offline_access tools` |

If Microsoft reports a different redirect URI during validation, register
an additional client (or update the client's `redirect_uris` in
`oauth_clients`) and update `ClientId`/`ClientSecret` in the vault.

## Partner Center prerequisites (manual)

- Verified publisher account enrolled in the Microsoft 365 and Copilot
  program.
- Test account credentials on the `@paxaver.dev` domain, with an active
  school and sample data, provided in the submission notes.
- Walkthrough video (5-10 min): connect, sign in via OAuth, call
  `get_user_info`, `get_daily_menu`, `get_wallet_balance`.

## Icon note

Both icons are derived from the product `favicon.png`: `Color.png` is
upscaled to 192x192 and `Outline.png` is downscaled to 32x32. If the
certification review flags the outline icon (Teams guidance prefers a
white glyph on transparent), replace `Outline.png` with a proper outline
asset.
