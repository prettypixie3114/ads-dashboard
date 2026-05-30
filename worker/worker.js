/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GA4 PROXY WORKER — Meta Ads Dashboard (OAuth refresh-token flavor)
 *
 *  Why OAuth instead of a service account:
 *    The prettypixie.com Workspace org blocks adding any external/non-human
 *    identity (service accounts, external groups) to GA4 property access.
 *    OAuth refresh tokens belong to a real org user (info@prettypixie.com)
 *    so they bypass that policy entirely.
 *
 *  Flow:
 *    Dashboard ──HTTPS──> Worker ──refresh_token grant──> Google OAuth ──>
 *                                ──token + query──> GA4 Data API
 *                                <──JSON response──┘
 *    Dashboard <──JSON──
 *
 *  Required secrets (set via Cloudflare dashboard → Settings → Variables):
 *    GOOGLE_CLIENT_ID      OAuth Client ID for "Web application" / "Desktop"
 *    GOOGLE_CLIENT_SECRET  Matching client secret
 *    GOOGLE_REFRESH_TOKEN  Long-lived refresh token from one-time auth flow
 *    GA4_PROPERTY_ID       9-digit GA4 property ID (without 'properties/')
 *
 *  Optional secret:
 *    ALLOWED_ORIGIN        Origin allowed by CORS, e.g.
 *                          'https://prettypixie3114.github.io'
 *                          Default '*' (any origin) — tighten in production.
 *
 *  Request shape:
 *    GET /?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 *  Response shape:
 *    {
 *      totals: { sessions, engagedSessions, engagementRate, bounceRate },
 *      byCampaign: { "<utm_campaign>": { sessions, ... }, … },
 *      meta: { propertyId, since, until }
 *    }
 * ═══════════════════════════════════════════════════════════════════════
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    const url   = new URL(request.url);
    const since = url.searchParams.get('since') || daysAgo(7);
    const until = url.searchParams.get('until') || today();

    const missing = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GA4_PROPERTY_ID'
    ].filter(k => !env[k]);
    if (missing.length) {
      return json({ error: `Worker missing secrets: ${missing.join(', ')}` }, 500, cors);
    }

    try {
      const accessToken = await getGoogleAccessToken(env);
      const ga4Url = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`;

      const r = await fetch(ga4Url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: since, endDate: until }],
          dimensions: [{ name: 'sessionCampaignName' }],
          metrics: [
            { name: 'sessions' },
            { name: 'engagedSessions' },
            { name: 'engagementRate' },
            { name: 'bounceRate' }
          ],
          limit: 10000
        })
      });

      if (!r.ok) {
        const errText = await r.text();
        return json({ error: `GA4 API ${r.status}: ${errText}` }, 502, cors);
      }

      const data = await r.json();
      const out  = shapeResponse(data, env.GA4_PROPERTY_ID, since, until);
      return json(out, 200, cors);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500, cors);
    }
  }
};

/* ── Shape Google's raw rows into a dashboard-friendly object ──────── */
function shapeResponse(data, propertyId, since, until) {
  const rows = data.rows || [];
  const byCampaign = {};
  let totSess = 0, totEng = 0, weightedBounce = 0, weightedEngRate = 0;

  rows.forEach(r => {
    const name = r.dimensionValues[0]?.value || '(unset)';
    const m    = r.metricValues || [];
    const sessions       = +(m[0]?.value || 0);
    const engagedSessions= +(m[1]?.value || 0);
    const engagementRate = +(m[2]?.value || 0);
    const bounceRate     = +(m[3]?.value || 0);

    byCampaign[name] = { sessions, engagedSessions, engagementRate, bounceRate };

    totSess += sessions;
    totEng  += engagedSessions;
    /* Engagement / bounce rates are session-weighted averages across
       all campaigns — sum of (rate × sessions) / total sessions. */
    weightedEngRate += engagementRate * sessions;
    weightedBounce  += bounceRate * sessions;
  });

  const totals = {
    sessions:        totSess,
    engagedSessions: totEng,
    engagementRate:  totSess > 0 ? weightedEngRate / totSess : 0,
    bounceRate:      totSess > 0 ? weightedBounce  / totSess : 0
  };

  return { totals, byCampaign, meta: { propertyId, since, until, rowCount: rows.length } };
}

/* ── Refresh token → access token ────────────────────────────────────
   Trade the long-lived refresh token for a 1-hour access token. Google
   accepts up to ~25k refreshes/day per client, way more than we need. */
async function getGoogleAccessToken(env) {
  const body = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type:    'refresh_token'
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString()
  });
  const tk = await r.json();
  if (!tk.access_token) {
    throw new Error('Google token refresh failed: ' + JSON.stringify(tk));
  }
  return tk.access_token;
}

function today()  { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}
