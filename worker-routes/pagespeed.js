/* ═══════════════════════════════════════════════════════════════════════
 *  PAGESPEED /pagespeed ROUTE — add to the LIVE worker (bundled worker.js)
 *  Powers Benchmark row 17 (mobile LCP). Not deployed yet → row 17 stays
 *  NEEDS DATA until this ships.
 *
 *  EDIT 1 — in the fetch() dispatch, add BEFORE `return handleGa4(...)`:
 *      if (url.pathname === "/pagespeed") {
 *        return handlePageSpeed(env, url, cors);
 *      }
 *
 *  EDIT 2 — paste handlePageSpeed() (below) at top level.
 *
 *  SECRET (create a PageSpeed/Google API key with the "PageSpeed Insights
 *  API" enabled, then):
 *      wrangler secret put PAGESPEED_API_KEY
 *
 *  Response shape the panel expects:  { lcpSeconds, url, strategy, fetchedAt }
 * ═══════════════════════════════════════════════════════════════════════ */
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
