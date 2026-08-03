/* Daily benchmark snapshot → data/benchmark-history.json (versioned history).
 *
 * TOKEN-FREE: this only calls the PUBLIC Worker endpoint /benchmark-snapshot,
 * which holds the Meta token server-side. No secrets are read here, so it is
 * safe to run in a public repo's Actions.
 *
 * Fail behaviour: on ANY problem (Worker down, non-200, error payload, missing
 * metrics) it exits non-zero and writes NOTHING. A failed run is a LOUD red X
 * and the day is simply absent from history — never a silently-written garbage
 * or zero day. The commit step in the workflow is gated on this succeeding.
 *
 * Backfill: set SNAPSHOT_DATE=YYYY-MM-DD (workflow_dispatch input) to recompute
 * a specific day from the APIs and overwrite that day's entry. Default = the
 * UTC "yesterday" (the most recent fully-closed day).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const WORKER_URL = process.env.WORKER_URL;
const HISTORY = 'data/benchmark-history.json';

function fail(msg) { console.error(`[benchmark-snapshot] FAILED: ${msg}`); process.exit(1); }

function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function resolveDate(input) {
  const s = (input || '').trim();
  if (!s) return yesterdayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`Bad SNAPSHOT_DATE "${s}" — expected YYYY-MM-DD`);
  return s;
}
function loadStore() {
  if (!existsSync(HISTORY)) return { days: {} };
  try {
    const s = JSON.parse(readFileSync(HISTORY, 'utf8'));
    if (!s.days || typeof s.days !== 'object') s.days = {};
    return s;
  } catch (e) { fail(`Corrupt ${HISTORY}: ${e.message}`); }
}

async function main() {
  if (!WORKER_URL) fail('WORKER_URL env not set');
  const date = resolveDate(process.env.SNAPSHOT_DATE);
  const url = `${WORKER_URL.replace(/\/+$/, '')}/benchmark-snapshot?since=${date}&until=${date}`;
  console.log(`[benchmark-snapshot] GET ${url}`);

  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch (e) { fail(`network error: ${e.message}`); }
  if (!res.ok) fail(`Worker HTTP ${res.status}`);

  let data;
  try { data = await res.json(); } catch (e) { fail(`bad JSON from worker: ${e.message}`); }
  if (data.error) fail(`worker error: ${data.error}`);
  if (!data.metrics || typeof data.metrics !== 'object' || !Object.keys(data.metrics).length) {
    fail('response has no metrics — refusing to write a partial day');
  }
  /* All-or-nothing: a day missing its Shopify or GA4 leg is rejected whole,
     never written with null fields (the Worker already errors on partial;
     this is defense in depth). */
  if (data.shopify == null || data.ga4 == null) {
    fail('incomplete snapshot — Shopify or GA4 leg missing; rejecting the whole day');
  }
  if (data.shopify && Number(data.shopify.orders) === 0) {
    fail('zero-order day — rejecting (an absent day beats a misleading zero)');
  }

  const store = loadStore();
  const mode = store.days[date] ? 'overwrote' : 'added';
  store.days[date] = {
    savedAt: new Date().toISOString(),
    since: date, until: date,
    metrics: data.metrics,
    raw: data.raw || null,
    shopify: data.shopify || null,
    ga4: data.ga4 || null
  };
  writeFileSync(HISTORY, JSON.stringify(store, null, 2) + '\n');
  console.log(`[benchmark-snapshot] ${mode} ${date} — ${Object.keys(store.days).length} day(s) in history.`);
}

main().catch(e => fail(e.message || String(e)));
