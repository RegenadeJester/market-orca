# Notion OAuth 2.0 Setup Guide

> Notion **no longer supports Internal Integration Tokens** for new integrations.
> All new integrations must use **OAuth 2.0** (Authorization Code grant type).
> Existing internal tokens still work but cannot be created for new apps.

---

## 1. Create OAuth App in Notion

1. Go to https://www.notion.so/profile/integrations
2. Click **+ New integration**
3. Fill in:
   - **Name**: `Market Orca` (or your app name)
   - **Associated workspace**: Select your workspace
   - **Capabilities**: Check `Read content`, `Insert content`, `Update content`
   - **User Information**: `Email address` (optional but recommended)
4. Click **Submit**
5. Copy the **Client ID** and **Client Secret** — save them securely
6. In the **OAuth Domain & URIs** section:
   - **OAuth Redirect URI**: `https://n8n.your-domain.com/rest/oauth2-credential/callback`
   - Or for local dev: `http://localhost:5678/rest/oauth2-credential/callback`

## 2. OAuth Authorization URL

```
https://api.notion.com/v1/oauth/authorize?client_id={CLIENT_ID}&response_type=code&owner=user&redirect_uri={REDIRECT_URI}
```

### Parameters

| Parameter      | Value                                           |
|----------------|-------------------------------------------------|
| `client_id`    | Your Notion OAuth Client ID                     |
| `response_type`| `code`                                          |
| `owner`        | `user`                                          |
| `redirect_uri` | URL-encoded callback (n8n or your app)          |
| `state`        | Optional CSRF token                             |

### Full URL Template

```
https://api.notion.com/v1/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&owner=user&redirect_uri=http%3A%2F%2Flocalhost%3A5678%2Frest%2Foauth2-credential%2Fcallback
```

## 3. Token Exchange (n8n handles this automatically)

### POST `https://api.notion.com/v1/oauth/token`

```json
{
  "grant_type": "authorization_code",
  "code": "AUTHORIZATION_CODE_FROM_REDIRECT",
  "redirect_uri": "http://localhost:5678/rest/oauth2-credential/callback",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

**Response:**

```json
{
  "access_token": "ntn_...",
  "token_type": "bearer",
  "bot_id": "...",
  "workspace_name": "My Workspace",
  "workspace_id": "...",
  "duplicated_template_id": null,
  "owner": {
    "type": "user",
    "user": { ... }
  }
}
```

## 4. Share Database with OAuth Integration

After OAuth flow completes, the integration can only access pages **explicitly shared** with it:

1. Open your target Notion database/page
2. Click **Share** (top-right)
3. Add the integration name (e.g., `Market Orca`)
4. Click **Invite**

## 5. n8n OAuth Credential Setup

In n8n web UI (`http://localhost:5678`):

1. Go to **Settings → Credentials**
2. Click **+ Add Credential**
3. Search for **Notion**
4. Select **Notion OAuth2 API**
5. **OAuth Redirect URL**: Copy the URL shown in the modal
6. Enter **Client ID** and **Client Secret** from step 1
7. Click **Connect Account**
8. Authorize in Notion popup
9. Done — credential is ready to use in workflows

## 6. Verify OAuth Token

```bash
curl https://api.notion.com/v1/users/me \
  -H "Authorization: Bearer ntn_YOUR_ACCESS_TOKEN" \
  -H "Notion-Version: 2022-06-28"
```

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Ensure the redirect URI in Notion matches exactly (trailing slash, encoding) |
| `invalid_client` | Check Client ID / Secret are correct |
| Token expired | n8n auto-refreshes OAuth tokens; revoke in Notion settings if stuck |
| `unauthorized` | Database/page not shared with the integration |

## 8. Security Notes

- **Client Secret** = treat like a password. Never commit to git.
- Store in environment variables or n8n credential store
- OAuth tokens are auto-refreshed by n8n (Notion tokens last ~90 days)
- Rotate Client Secret periodically via Notion integration settings
