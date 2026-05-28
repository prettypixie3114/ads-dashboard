/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GA4 PROXY WORKER — Meta Ads Dashboard
 *
 *  Static-site dashboards can't safely hold Google service-account keys.
 *  This Worker sits between the dashboard and GA4's Data API:
 *
 *    Dashboard ──HTTPS──> Worker ──signed JWT──> Google OAuth ──token──>
 *                                ──token + query──> GA4 Data API
 *                                <──JSON response──┘
 *    Dashboard <──JSON──
 *
 *  Credentials never reach the browser. Real-time data per request.
 *
 *  Required secrets (set via `wrangler secret put` or Dashboard UI):
 *    GA4_SERVICE_ACCOUNT  Full JSON of the Google service-account key
 *    GA4_PROPERTY_ID      9-digit GA4 property ID (without 'properties/')
 *
 *  Optional secret:
 *    ALLOWED_ORIGIN       Origin allowed by CORS, e.g.
 *                         'https://prettypixie3114.github.io'
 *                         Default '*' (any origin) — tighten in production.
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

    if (!env.GA4_SERVICE_ACCOUNT || !env.GA4_PROPERTY_ID) {
      return json({ error: 'Worker missing GA4_SERVICE_ACCOUNT or GA4_PROPERTY_ID secret' }, 500, cors);
    }

    let sa;
    try {
      sa = JSON.parse(env.GA4_SERVICE_ACCOUNT);
    } catch (_) {
      return json({ error: 'GA4_SERVICE_ACCOUNT is not valid JSON' }, 500, cors);
    }

    try {
      const accessToken = await getGoogleAccessToken(sa);
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
  let totSess = 0, totEng = 0, totBounce = 0, weightedBounce = 0, weightedEngRate = 0;

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

/* ── Service-account JWT → access token ──────────────────────────────
   Google's OAuth 2.0 service-account flow: build a JWT signed with the
   service account's private key, exchange it for an access token. */
async function getGoogleAccessToken(sa) {
  const now    = Math.floor(Date.now() / 1000);
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  };
  const jwt = await signJwtRS256(claims, sa.private_key);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:   `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  const tk = await r.json();
  if (!tk.access_token) {
    throw new Error('Google token exchange failed: ' + JSON.stringify(tk));
  }
  return tk.access_token;
}

async function signJwtRS256(claims, pemPrivateKey) {
  const header   = { alg: 'RS256', typ: 'JWT' };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(pemPrivateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64urlBytes(new Uint8Array(sig));
}

function pemToBuffer(pem) {
  /* Strip header/footer/newlines and decode the base64 body. */
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
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
