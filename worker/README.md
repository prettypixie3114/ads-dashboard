# GA4 Proxy Worker

A tiny Cloudflare Worker that lets the static Meta Ads Dashboard pull
GA4 metrics (Sessions, Engaged Sessions, Engagement Rate, Bounce Rate)
without exposing Google service-account credentials in the browser.

## What you'll deploy

```
Dashboard (prettypixie3114.github.io)
  │ GET /?since=2026-05-20&until=2026-05-27
  ▼
Cloudflare Worker (your-worker.workers.dev)
  │ Signs a JWT with the service account → swaps for an access token
  ▼
Google GA4 Data API
  │ Returns per-campaign metrics
  ▼
Worker shapes the response → returns JSON to dashboard
```

## Setup (one time, ~15 min)

### 1. Create the GA4 service account

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts>
2. Pick (or create) a Google Cloud project
3. **Create Service Account** → name it `meta-ads-ga4-reader` → Create
4. Skip the role-grant step (the role lives on the GA4 property, not here)
5. Open the service account → **Keys** tab → **Add Key** → **JSON**
6. A `.json` file downloads. Keep it — you'll paste it into a Worker secret in step 4.

### 2. Grant the service account access to your GA4 property

1. Open <https://analytics.google.com> → pick your property
2. **Admin** (bottom-left gear) → **Property access management**
3. **+** (top right) → **Add users**
4. Paste the service account email (e.g. `meta-ads-ga4-reader@your-project.iam.gserviceaccount.com`)
5. Role: **Viewer** is enough
6. Save

### 3. Find your GA4 Property ID

In the same Admin view → **Property details** → copy the **PROPERTY ID**
(9 digits, e.g. `123456789` — *not* the measurement ID `G-XXXX`).

### 4. Deploy the Worker

```bash
# One-time: install Wrangler (Cloudflare's CLI) and log in
npm install -g wrangler
wrangler login

# From this folder:
cd worker
wrangler deploy

# Set the secrets (run each, paste value when prompted):
wrangler secret put GA4_SERVICE_ACCOUNT   # paste the FULL JSON from step 1
wrangler secret put GA4_PROPERTY_ID       # paste the 9-digit ID from step 3
wrangler secret put ALLOWED_ORIGIN        # optional: https://prettypixie3114.github.io
```

Wrangler prints the deployed URL — looks like
`https://meta-ads-ga4.<your-subdomain>.workers.dev`. Save that URL.

### 5. Tell the dashboard about the Worker

In [`../config.example.js`](../config.example.js), set:

```js
GA4_WORKER_URL: 'https://meta-ads-ga4.<your-subdomain>.workers.dev'
```

Commit + push. Dashboard auto-fetches GA4 on the next load.

## Testing the Worker directly

```bash
curl 'https://meta-ads-ga4.<your-subdomain>.workers.dev/?since=2026-05-20&until=2026-05-27'
```

Expected response:

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
  "meta": { "propertyId": "123456789", "since": "2026-05-20", "until": "2026-05-27", "rowCount": 47 }
}
```

If you see an error, the message tells you exactly what's wrong
(missing secret, invalid JSON, GA4 API rejection, etc.).

## Cost

Cloudflare Workers free tier: **100,000 requests/day**, **10 ms CPU/request**.
A typical team will use single-digit requests/day. Free forever for this workload.

## Updating

Worker code changes → `wrangler deploy` (same command). Takes ~5 seconds.
Secrets are preserved across deploys.

## Rotating the service account key

If the service account JSON ever leaks:

1. Cloud Console → service account → **Keys** → delete the leaked key
2. **Add Key** → JSON → download new one
3. `wrangler secret put GA4_SERVICE_ACCOUNT` → paste new JSON
4. Done — Worker uses the new key on the next request
