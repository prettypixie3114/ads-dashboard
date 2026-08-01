/* ═══════════════════════════════════════════════════════════════════════
 *  GA4 BOUNCE /ga4-bounce ROUTE — add to the LIVE worker (bundled worker.js)
 *  Powers Benchmark row 18: bounceRate filtered to PAID-SOCIAL sessions
 *  (Meta/Instagram) landing on the pages ads point at.
 *
 *  Uses the SAME Google OAuth creds the GA4 route already uses — NO new
 *  secret required.
 *
 *  EDIT 1 — in fetch() dispatch, add BEFORE `return handleGa4(...)`:
 *      if (url.pathname === "/ga4-bounce") {
 *        return handleGa4Bounce(env, since, until, cors);
 *      }
 *
 *  EDIT 2 — paste handleGa4Bounce() below at top level.
 *
 *  Response: { totals:{ bounceRate, sessions }, landingPages:[...], meta:{...} }
 *    - bounceRate is session-weighted across the matched rows (0..1)
 *    - sessions lets you confirm the filter isn't near-zero BEFORE wiring
 * ═══════════════════════════════════════════════════════════════════════ */
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
    if (!r.ok) { const t = await r.text(); return json({ error: `GA4 API ${r.status}: ${t}` }, 502, cors); }
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
