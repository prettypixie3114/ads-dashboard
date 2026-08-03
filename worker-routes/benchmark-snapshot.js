/* ═══════════════════════════════════════════════════════════════════════
 *  BENCHMARK SNAPSHOT /benchmark-snapshot ROUTE — add to the LIVE worker.
 *
 *  Purpose: server-side computation of the account-level benchmark metrics
 *  so the daily GitHub Action can persist versioned history WITHOUT the Meta
 *  token ever touching GitHub. The token lives ONLY here (private Worker
 *  secret store, alongside your Google/Shopify secrets).
 *
 *  Scope: the account-level rows that come from ONE Meta Insights call
 *  (1,2,3,4,6,7,10-16) + Shopify AOV + GA4. The per-entity rows
 *  (8/9 frequency, 19-23 ad/adset/activities, 25 audiences) and the
 *  manual/worker rows (17/18/24) are NOT in the daily snapshot — add later
 *  if you want to trend them.
 *
 *  EDIT 1 — in fetch() dispatch, add BEFORE `return handleGa4(...)`:
 *      if (url.pathname === "/benchmark-snapshot") {
 *        return handleBenchmarkSnapshot(request, env, since, until, cors);
 *      }
 *
 *  EDIT 2 — paste handleBenchmarkSnapshot() below at top level.
 *
 *  REQUIRED SECRETS (set once; the token stays in the Worker only):
 *      wrangler secret put META_ACCESS_TOKEN      # STRONGLY prefer a System
 *                                                 # User token (non-expiring)
 *                                                 # so the daily job doesn't
 *                                                 # break every ~60 days
 *      wrangler secret put META_AD_ACCOUNT_ID     # digits only, no "act_"
 *  OPTIONAL:
 *      META_API_VERSION   (default v19.0)
 *
 *  Reuses the worker's own /shopify and / (GA4) routes via self-fetch, so no
 *  Shopify/GA4 logic is duplicated here.
 * ═══════════════════════════════════════════════════════════════════════ */
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
    const md = await mr.json();
    if (md.error) return json({ error: `Meta API: ${md.error.message} (code ${md.error.code})` }, 502, cors);
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
      if (sd.error || !sd.totals) return json({ error: `snapshot incomplete — Shopify leg failed: ${sd.error || "no totals"}` }, 502, cors);
      if (Number(sd.totals.orders) === 0) return json({ error: "snapshot incomplete — Shopify returned zero orders (zero-day rejected)" }, 502, cors);
      shop = sd.totals;
    } catch (e) {
      return json({ error: `snapshot incomplete — Shopify leg threw: ${e.message || e}` }, 502, cors);
    }
    try {
      const gd = await (await handleGa4(env, since, until, cors)).json();
      if (gd.error || !gd.totals) return json({ error: `snapshot incomplete — GA4 leg failed: ${gd.error || "no totals"}` }, 502, cors);
      ga4 = gd.totals;
    } catch (e) {
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
