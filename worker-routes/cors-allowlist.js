/* ═══════════════════════════════════════════════════════════════════════
 *  CORS ALLOWLIST — small edit to the LIVE worker's fetch() handler so
 *  localhost preview can read Worker-backed rows (GA4 / Shopify / PageSpeed).
 *
 *  Safe: the Worker is unauthenticated + read-only and already curl-able by
 *  anyone regardless of CORS, so ALLOWED_ORIGIN is not an access boundary —
 *  it only decides which browser origins may read responses via JS. Adding
 *  localhost lets you validate in preview; it does NOT widen who can reach
 *  the data. (If write endpoints/auth are ever added, revisit.)
 *
 *  REPLACE, at the top of fetch(), this:
 *      const origin = env.ALLOWED_ORIGIN || "*";
 *  WITH:
 * ─────────────────────────────────────────────────────────────────────── */
const ALLOWED = [env.ALLOWED_ORIGIN, "http://localhost:8080", "http://127.0.0.1:8080"].filter(Boolean);
const reqOrigin = request.headers.get("Origin") || "";
const origin = ALLOWED.includes(reqOrigin) ? reqOrigin : (env.ALLOWED_ORIGIN || "*");
/* ─── everything else (the cors object, routes) stays the same. Deploy. ─── */
