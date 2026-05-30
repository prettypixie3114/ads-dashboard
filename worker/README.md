# GA4 Proxy Worker

A tiny Cloudflare Worker that lets the static Meta Ads Dashboard pull
GA4 metrics (Sessions, Engaged Sessions, Engagement Rate, Bounce Rate)
without exposing Google OAuth credentials in the browser.

**Auth flavor:** OAuth refresh token (NOT service account). The
`prettypixie.com` Workspace org blocks adding service accounts / external
groups to GA4 property access, so we authenticate as a real org user
(`info@prettypixie.com`) via a long-lived refresh token instead.

## What you'll deploy

```
Dashboard (prettypixie3114.github.io)
  │ GET /?since=2026-05-20&until=2026-05-27
  ▼
Cloudflare Worker (your-worker.workers.dev)
  │ refresh_token grant → Google OAuth → access_token
  ▼
Google GA4 Data API
  │ Returns per-campaign metrics
  ▼
Worker shapes the response → returns JSON to dashboard
```

## Setup (one time, ~30 min)

### 1. Enable the GA4 Data API

Go to <https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com>
→ pick your Cloud project → **Enable**.

### 2. Set up the OAuth consent screen

1. <https://console.cloud.google.com/apis/credentials/consent>
2. User Type: **External** → Create
3. App name: `Meta Ads Dashboard GA4`
4. User support / Developer contact: your email
5. Scopes: skip
6. Test users: **+ ADD USERS** → add the email that has GA4 access
   (e.g. `info@prettypixie.com`)
7. Save

### 3. Create the OAuth Client ID

1. <https://console.cloud.google.com/apis/credentials>
2. **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Type: **Web application**
4. Name: `Meta Ads Dashboard`
5. Authorized redirect URI: `https://developers.google.com/oauthplayground`
6. **Create** — note the **Client ID** and **Client Secret**

### 4. Get the refresh token via OAuth Playground

1. <https://developers.google.com/oauthplayground/>
2. **First**, click the ⚙ gear icon → check ☑ **Use your own OAuth credentials**
3. Paste your Client ID + Client Secret → Close
4. Left panel → bottom → "Input your own scopes":
   `https://www.googleapis.com/auth/analytics.readonly`
5. **Authorize APIs** → sign in with the GA4-authorized user → Allow
6. **Exchange authorization code for tokens** → copy the `refresh_token`

### 5. Find your GA4 Property ID

<https://analytics.google.com> → Admin → Property details → **PROPERTY ID**
(9 digits, e.g. `472233568` — *not* the measurement ID `G-XXXX`).

### 6. Deploy the Worker

```bash
# One-time: install Wrangler and log in
npm install -g wrangler
wrangler login

# From this folder:
cd worker
wrangler deploy
```

### 7. Set the secrets in Cloudflare

Dashboard → Workers & Pages → your worker → Settings → Variables and Secrets.
Add four secrets (Type: **Secret**):

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 3 |
| `GOOGLE_CLIENT_SECRET` | from step 3 |
| `GOOGLE_REFRESH_TOKEN` | from step 4 |
| `GA4_PROPERTY_ID` | from step 5 |

Optional: `ALLOWED_ORIGIN` (e.g. `https://prettypixie3114.github.io`).
Default is `*` (any origin) — tighten in production.

### 8. Tell the dashboard about the Worker

In [`../config.example.js`](../config.example.js), set:

```js
GA4_WORKER_URL: 'https://meta-ads-ga4.<your-subdomain>.workers.dev'
```

Commit + push. Dashboard auto-fetches GA4 on the next load.

## Testing the Worker directly

```bash
curl 'https://meta-ads-ga4.<your-subdomain>.workers.dev/?since=2026-05-20&until=2026-05-27'
```

Expected:

```json
{
  "totals": {
    "sessions": 12345,
    "engagedSessions": 9876,
    "engagementRate": 0.79,
    "bounceRate": 0.21
  },
  "byCampaign": {
    "PS | SINP | 09-Apr-26": { "sessions": 543, "engagedSessions": 430, ... },
    "PS | AD+CR | SINP | 23-May-26": { ... }
  },
  "meta": { "propertyId": "472233568", "since": "2026-05-20", "until": "2026-05-27", "rowCount": 47 }
}
```

Common errors:

| Error | Cause |
|---|---|
| `Worker missing secrets: GOOGLE_REFRESH_TOKEN` | Forgot a secret in step 7 |
| `Google token refresh failed: unauthorized_client` | Client ID / Secret / Refresh Token aren't from the same OAuth client. Redo step 4 making sure ⚙ "Use your own OAuth credentials" is checked BEFORE authorizing. |
| `GA4 API 403` | The signed-in user (step 4) doesn't have access to `GA4_PROPERTY_ID`. Check Property access management in GA4 Admin. |
| `Google token refresh failed: invalid_grant` | Refresh token expired or revoked. Redo step 4. |

## Cost

Cloudflare Workers free tier: **100,000 requests/day**, **10 ms CPU/request**.
A typical team will use single-digit requests/day. Free forever for this workload.

## Updating the Worker code

Code changes → `wrangler deploy` (same command). ~5 sec. Secrets are preserved.

## Rotating the refresh token

If the refresh token leaks or is revoked:

1. Cloud Console → Credentials → OAuth Client → consider rotating the Client Secret too if exposed
2. OAuth Playground → redo step 4 → get a fresh refresh token
3. Cloudflare → Variables and Secrets → edit `GOOGLE_REFRESH_TOKEN` → paste new value → Save and Deploy
4. Done — Worker uses the new token on the next request
