var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var worker_default = {
  async fetch(request, env) {
    const ALLOWED = [env.ALLOWED_ORIGIN, "http://localhost:8080", "http://127.0.0.1:8080"].filter(Boolean);
    const reqOrigin = request.headers.get("Origin") || "";
    const origin = ALLOWED.includes(reqOrigin) ? reqOrigin : (env.ALLOWED_ORIGIN || "*");
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    const url = new URL(request.url);
    const since = url.searchParams.get("since") || daysAgo(7);
    const until = url.searchParams.get("until") || today();
    if (url.pathname === "/google-ads") {
      return handleGoogleAds(env, since, until, cors);
    }
    if (url.pathname === "/shopify") {
      return handleShopify(env, since, until, cors);
    }
    if (url.pathname === "/pagespeed") {
      return handlePageSpeed(env, url, cors);
    }
    if (url.pathname === "/ga4-bounce") {
      return handleGa4Bounce(env, since, until, cors);
    }
    if (url.pathname === "/benchmark-snapshot") {
      return handleBenchmarkSnapshot(request, env, since, until, cors);
    }
    return handleGa4(env, since, until, cors);
  }
};
async function handleGa4(env, since, until, cors) {
  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GA4_PROPERTY_ID"
  ].filter((k) => !env[k]);
  if (missing.length) {
    return json({ error: `Worker missing secrets: ${missing.join(", ")}` }, 500, cors);
  }
  try {
    const accessToken = await getAccessToken(env, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN
    });
    const ga4Url = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`;
    const r = await fetch(ga4Url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: since, endDate: until }],
        dimensions: [{ name: "sessionCampaignName" }],
        metrics: [
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
          { name: "bounceRate" }
        ],
        limit: 1e4
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("[worker] handleGa4 upstream NOT OK — status", r.status, "body:", errText);
      return json({ error: `GA4 API ${r.status}: ${errText}` }, 502, cors);
    }
    const data = await r.json();
    const out = shapeGa4Response(data, env.GA4_PROPERTY_ID, since, until);
    return json(out, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handleGa4, "handleGa4");
async function handleGoogleAds(env, since, until, cors) {
  const missing = [
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID"
  ].filter((k) => !env[k]);
  if (!env.GOOGLE_ADS_CLIENT_ID && !env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_ADS_CLIENT_ID (or GOOGLE_CLIENT_ID)");
  if (!env.GOOGLE_ADS_CLIENT_SECRET && !env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)");
  if (missing.length) {
    return json({ error: `Worker missing secrets: ${missing.join(", ")}` }, 500, cors);
  }
  try {
    const accessToken = await getAccessToken(env, {
      clientId: env.GOOGLE_ADS_CLIENT_ID || env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN
    });
    const customerId = String(env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, "");
    const searchUrl = `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`;
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY metrics.cost_micros DESC
    `;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json"
    };
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      headers["login-customer-id"] = String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, "");
    }
    let results = [];
    let pageToken;
    do {
      const body = { query };
      if (pageToken) body.pageToken = pageToken;
      const r = await fetch(searchUrl, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) {
        const errText = await r.text();
        return json({ error: `Google Ads API ${r.status}: ${errText}` }, 502, cors);
      }
      const data = await r.json();
      results = results.concat(data.results || []);
      pageToken = data.nextPageToken;
    } while (pageToken);
    const out = shapeGoogleAdsResponse(results, customerId, since, until);
    return json(out, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handleGoogleAds, "handleGoogleAds");
async function handleShopify(env, since, until, cors) {
  const missing = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN"].filter((k) => !env[k]);
  if (missing.length) {
    return json({ error: `Worker missing secrets: ${missing.join(", ")}` }, 500, cors);
  }
  const domain = String(env.SHOPIFY_STORE_DOMAIN).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const version = env.SHOPIFY_API_VERSION || "2025-10";
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`;
  const shopifyql = `FROM sales SHOW orders, gross_sales, discounts, returns, net_sales, shipping_charges, taxes, total_sales, average_order_value SINCE ${since} UNTIL ${until}`;
  const gql = `
    query ShopifyqlSales($q: String!) {
      shopifyqlQuery(query: $q) {
        parseErrors
        tableData { columns { name } rows }
      }
    }`;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: gql, variables: { q: shopifyql } })
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("[worker] handleShopify upstream NOT OK — status", r.status, "body:", errText);
      return json({ error: `Shopify API ${r.status}: ${errText}` }, 502, cors);
    }
    const data = await r.json();
    if (data.errors) {
      return json({ error: `Shopify GraphQL: ${JSON.stringify(data.errors)}` }, 502, cors);
    }
    const q = data.data && data.data.shopifyqlQuery;
    if (q && q.parseErrors && q.parseErrors.length) {
      return json({ error: `ShopifyQL parse error: ${q.parseErrors.join("; ")}` }, 400, cors);
    }
    const rows = q && q.tableData && q.tableData.rows || [];
    const row = rows[0] || {};
    const num = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const totals = {
      orders: Math.round(num(row.orders)),
      grossSales: num(row.gross_sales),
      discounts: Math.abs(num(row.discounts)),
      returns: Math.abs(num(row.returns)),
      netSales: num(row.net_sales),
      shippingCharges: num(row.shipping_charges),
      taxes: num(row.taxes),
      totalSales: num(row.total_sales),
      averageOrderValue: num(row.average_order_value)
    };
    return json({ totals, meta: { domain, since, until, currency: "INR" } }, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handleShopify, "handleShopify");
function shapeGa4Response(data, propertyId, since, until) {
  const rows = data.rows || [];
  const byCampaign = {};
  let totSess = 0, totEng = 0, weightedBounce = 0, weightedEngRate = 0;
  rows.forEach((r) => {
    const name = r.dimensionValues[0]?.value || "(unset)";
    const m = r.metricValues || [];
    const sessions = +(m[0]?.value || 0);
    const engagedSessions = +(m[1]?.value || 0);
    const engagementRate = +(m[2]?.value || 0);
    const bounceRate = +(m[3]?.value || 0);
    byCampaign[name] = { sessions, engagedSessions, engagementRate, bounceRate };
    totSess += sessions;
    totEng += engagedSessions;
    weightedEngRate += engagementRate * sessions;
    weightedBounce += bounceRate * sessions;
  });
  const totals = {
    sessions: totSess,
    engagedSessions: totEng,
    engagementRate: totSess > 0 ? weightedEngRate / totSess : 0,
    bounceRate: totSess > 0 ? weightedBounce / totSess : 0
  };
  return { totals, byCampaign, meta: { propertyId, since, until, rowCount: rows.length } };
}
__name(shapeGa4Response, "shapeGa4Response");
function shapeGoogleAdsResponse(results, customerId, since, until) {
  const campaigns = results.map((r) => {
    const spend = +(r.metrics?.costMicros || 0) / 1e6;
    const impressions = +(r.metrics?.impressions || 0);
    const clicks = +(r.metrics?.clicks || 0);
    const conversions = +(r.metrics?.conversions || 0);
    const conversionValue = +(r.metrics?.conversionsValue || 0);
    const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
    const cpc = +(r.metrics?.averageCpc || 0) / 1e6;
    return {
      id: r.campaign?.id,
      name: r.campaign?.name || "(unnamed)",
      status: r.campaign?.status,
      channelType: r.campaign?.advertisingChannelType,
      spend,
      impressions,
      clicks,
      conversions,
      conversionValue,
      ctr,
      cpc,
      roas: spend > 0 ? conversionValue / spend : 0
    };
  });
  const byCampaign = {};
  campaigns.forEach((c) => {
    byCampaign[c.name] = c;
  });
  const totals = campaigns.reduce((acc, c) => {
    acc.spend += c.spend;
    acc.impressions += c.impressions;
    acc.clicks += c.clicks;
    acc.conversions += c.conversions;
    acc.conversionValue += c.conversionValue;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });
  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.roas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0;
  return { totals, campaigns, byCampaign, meta: { customerId, since, until, rowCount: campaigns.length } };
}
__name(shapeGoogleAdsResponse, "shapeGoogleAdsResponse");
async function getAccessToken(env, { clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const tk = await r.json();
  if (!tk.access_token) {
    throw new Error("Google token refresh failed: " + JSON.stringify(tk));
  }
  return tk.access_token;
}
__name(getAccessToken, "getAccessToken");
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
__name(today, "today");
function daysAgo(n) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
__name(daysAgo, "daysAgo");
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}
__name(json, "json");
async function handlePageSpeed(env, url, cors) {
  const target = url.searchParams.get("url");
  const strategy = url.searchParams.get("strategy") || "mobile";
  if (!target) return json({ error: "Missing url param" }, 400, cors);
  if (!env.PAGESPEED_API_KEY) return json({ error: "Worker missing secret: PAGESPEED_API_KEY" }, 500, cors);
  try {
    const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    api.searchParams.set("url", target);
    api.searchParams.set("strategy", strategy);
    api.searchParams.set("category", "performance");
    api.searchParams.set("key", env.PAGESPEED_API_KEY);
    const r = await fetch(api.toString());
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `PageSpeed API ${r.status}: ${t}` }, 502, cors);
    }
    const d = await r.json();
    // Prefer field (CrUX) LCP; fall back to lab LCP from Lighthouse audits.
    const fieldMs = d?.loadingExperience?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    const labSec = d?.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
    const lcpSeconds = isFinite(fieldMs) ? fieldMs / 1000 : (isFinite(labSec) ? labSec / 1000 : null);
    if (lcpSeconds == null) return json({ error: "No LCP in PageSpeed response" }, 502, cors);
    return json({ lcpSeconds, url: target, strategy, fetchedAt: new Date().toISOString() }, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handlePageSpeed, "handlePageSpeed");

async function handleGa4Bounce(env, since, until, cors) {
  const missing = ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN","GA4_PROPERTY_ID"].filter(k => !env[k]);
  if (missing.length) return json({ error: `Worker missing secrets: ${missing.join(", ")}` }, 500, cors);
  try {
    const accessToken = await getAccessToken(env, {
      clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN
    });
    const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`;
    /* Paid-social filter: sessionSource CONTAINS facebook/instagram/fb/ig
       OR sessionMedium in the paid/cpc family. landingPagePlusQueryString is
       returned so you can see WHICH landing pages match (and further restrict
       later if needed). */
    const body = {
      dateRanges: [{ startDate: since, endDate: until }],
      metrics: [{ name: "bounceRate" }, { name: "sessions" }],
      dimensions: [{ name: "landingPagePlusQueryString" }],
      dimensionFilter: {
        orGroup: { expressions: [
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "facebook", caseSensitive: false } } },
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "instagram", caseSensitive: false } } },
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "fb", caseSensitive: false } } },
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "ig", caseSensitive: false } } },
          { filter: { fieldName: "sessionMedium", inListFilter: { values: ["paid","cpc","ppc","paid_social","paidsocial","social","cpm"] } } }
        ] }
      },
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 250
    };
    const r = await fetch(reportUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const t = await r.text(); console.error("[worker] handleGa4Bounce upstream NOT OK — status", r.status, "body:", t); return json({ error: `GA4 API ${r.status}: ${t}` }, 502, cors); }
    const d = await r.json();
    const rows = d.rows || [];
    let totSess = 0, weighted = 0;
    const landingPages = rows.map(row => {
      const page = row.dimensionValues?.[0]?.value || "(not set)";
      const bounce = +(row.metricValues?.[0]?.value || 0);
      const sess = +(row.metricValues?.[1]?.value || 0);
      totSess += sess; weighted += bounce * sess;
      return { page, sessions: sess, bounceRate: bounce };
    });
    const bounceRate = totSess > 0 ? weighted / totSess : null;
    return json({
      totals: { bounceRate, sessions: totSess },
      landingPages,
      meta: { propertyId: env.GA4_PROPERTY_ID, since, until, rowCount: rows.length }
    }, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handleGa4Bounce, "handleGa4Bounce");

async function handleBenchmarkSnapshot(request, env, since, until, cors) {
  const missing = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"].filter(k => !env[k]);
  if (missing.length) return json({ error: `Worker missing secrets: ${missing.join(", ")}` }, 500, cors);

  const ver = env.META_API_VERSION || "v19.0";
  const acct = "act_" + String(env.META_AD_ACCOUNT_ID).replace(/^act_/, "");
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ac = (arr, type) => { if (!Array.isArray(arr)) return null; const h = arr.find(a => a.action_type === type); return h ? Number(h.value) : null; };
  const safe = (a, b) => (b && isFinite(a / b)) ? a / b : null;
  const pct = (a, b) => { const v = safe(a, b); return v === null ? null : v * 100; };

  try {
    /* one account-level Insights call (no level = account aggregation) */
    const fields = "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,video_thruplay_watched_actions";
    const insUrl = `https://graph.facebook.com/${ver}/${acct}/insights` +
      `?fields=${encodeURIComponent(fields)}` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
      `&access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;
    const mr = await fetch(insUrl);
    if (!mr.ok) {
      const bodyText = await mr.text();
      console.error("[benchmark-snapshot] Meta Insights upstream NOT OK — status", mr.status, "body:", bodyText);
      return json({ error: `Meta Insights ${mr.status}: ${bodyText}` }, 502, cors);
    }
    const md = await mr.json();
    if (md.error) {
      console.error("[benchmark-snapshot] Meta Insights returned error object — status", mr.status, "error:", JSON.stringify(md.error));
      return json({ error: `Meta API: ${md.error.message} (code ${md.error.code})` }, 502, cors);
    }
    const row = (md.data && md.data[0]) || {};
    const a = row.actions || [], av = row.action_values || [];

    const spend = num(row.spend), impressions = num(row.impressions), reach = num(row.reach);
    const linkClicks = num(row.inline_link_clicks || row.clicks);
    const lpv = ac(a, "landing_page_view"), atc = ac(a, "offsite_conversion.fb_pixel_add_to_cart");
    const ic = ac(a, "offsite_conversion.fb_pixel_initiate_checkout");
    const purchases = ac(a, "offsite_conversion.fb_pixel_purchase");
    const purchaseValue = ac(av, "offsite_conversion.fb_pixel_purchase");
    const postEng = ac(a, "post_engagement"), leads = ac(a, "lead");
    const video3s = ac(a, "video_view");
    const thruplay = ac(row.video_thruplay_watched_actions, "video_view");

    /* Call the Shopify + GA4 handlers IN-PROCESS and read their JSON. A
       Worker cannot fetch its OWN hostname (Cloudflare error 1042), so the
       self-subrequest pattern can't work — invoke the handlers directly.
       ALL-OR-NOTHING: if either leg errors, OR Shopify shows zero orders
       (handleShopify returns a zero-filled totals object when ShopifyQL is
       empty, so a zero-day would otherwise pass), reject the whole day.
       An absent day beats a misleading zero/partial one. */
    let shop, ga4;
    try {
      const sd = await (await handleShopify(env, since, until, cors)).json();
      if (sd.error || !sd.totals) { console.error("[benchmark-snapshot] Shopify leg failed:", sd.error || "no totals"); return json({ error: `snapshot incomplete — Shopify leg failed: ${sd.error || "no totals"}` }, 502, cors); }
      if (Number(sd.totals.orders) === 0) { console.error("[benchmark-snapshot] Shopify zero orders for", since, until); return json({ error: "snapshot incomplete — Shopify returned zero orders (zero-day rejected)" }, 502, cors); }
      shop = sd.totals;
    } catch (e) {
      console.error("[benchmark-snapshot] Shopify leg threw:", e && (e.stack || e.message || e));
      return json({ error: `snapshot incomplete — Shopify leg threw: ${e.message || e}` }, 502, cors);
    }
    try {
      const gd = await (await handleGa4(env, since, until, cors)).json();
      if (gd.error || !gd.totals) { console.error("[benchmark-snapshot] GA4 leg failed:", gd.error || "no totals"); return json({ error: `snapshot incomplete — GA4 leg failed: ${gd.error || "no totals"}` }, 502, cors); }
      ga4 = gd.totals;
    } catch (e) {
      console.error("[benchmark-snapshot] GA4 leg threw:", e && (e.stack || e.message || e));
      return json({ error: `snapshot incomplete — GA4 leg threw: ${e.message || e}` }, 502, cors);
    }

    /* account-level row values (same formulas as the panel) */
    const metrics = {
      1: pct(linkClicks, impressions),
      2: safe(spend, linkClicks),
      3: (impressions > 0 ? spend / impressions * 1000 : null),
      4: pct(purchases, lpv),
      6: safe(spend, purchases),
      7: safe(purchaseValue, spend),
      10: pct(video3s, impressions),
      11: pct(thruplay, impressions),
      12: pct(video3s, reach),
      13: pct(postEng, impressions),
      14: pct(atc, lpv),
      15: pct(ic, atc),
      16: pct(purchases, ic)
    };

    return json({
      date: until, since, until,
      metrics,
      raw: { spend, impressions, reach, linkClicks, lpv, atc, ic, purchases, purchaseValue, postEng, leads, video3s, thruplay },
      shopify: shop ? { aov: shop.averageOrderValue, orders: shop.orders, grossSales: shop.grossSales, netSales: shop.netSales } : null,
      ga4: ga4 ? { sessions: ga4.sessions, bounceRate: ga4.bounceRate } : null,
      meta: { account: acct, apiVersion: ver }
    }, 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors);
  }
}
__name(handleBenchmarkSnapshot, "handleBenchmarkSnapshot");


export {
  worker_default as default
};
