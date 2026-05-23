/**
 * ═══════════════════════════════════════════════════════════════════════
 *  META ADS DASHBOARD — config.js
 *  Full API field reference + runtime configuration
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  META GRAPH API  →  https://graph.facebook.com/v19.0
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  CAMPAIGN SETUP  (GET /act_{ID}/campaigns)                      │
 *  │  fields= id, name, objective, buying_type, daily_budget,        │
 *  │          lifetime_budget, status, created_time,                 │
 *  │          start_time, stop_time                                  │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  AD SET SETUP  (GET /act_{ID}/adsets)                           │
 *  │  fields= id, name, campaign_id, status, optimization_goal,      │
 *  │          billing_event, bid_strategy, daily_budget,             │
 *  │          lifetime_budget, targeting                             │
 *  │                                                                 │
 *  │  targeting{} keys used here:                                    │
 *  │    age_min, age_max, genders[],                                 │
 *  │    geo_locations{ countries[], regions[], cities[] },           │
 *  │    interests[{id,name}], flexible_spec[],                       │
 *  │    behaviors[{id,name}], custom_audiences[]                     │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  CAMPAIGN INSIGHTS  (GET /{campaign_id}/insights)               │
 *  │  fields= spend, impressions, clicks, reach, ctr, cpc, cpp,     │
 *  │          actions, cost_per_action_type, action_values           │
 *  │  &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}       │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  AD SET INSIGHTS  (GET /{adset_id}/insights)                    │
 *  │  fields= spend, impressions, clicks, reach, ctr, cpc,          │
 *  │          actions, cost_per_action_type, action_values           │
 *  │  &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}       │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  actions[] array format:                                        │
 *  │    [{ "action_type": "purchase", "value": "12" }, ...]         │
 *  │  Conversion action_types: purchase, lead,                       │
 *  │    complete_registration, subscribe, contact                    │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  date_preset alternatives to time_range:                        │
 *  │    today | yesterday | last_7d | last_30d |                     │
 *  │    this_month | last_month | last_quarter                       │
 *  └─────────────────────────────────────────────────────────────────┘
 */

const CONFIG = {

  /* ── Credentials ──────────────────────────────────────────────────
     DO NOT put real values here if this file is committed to a public
     repo. The dashboard's Settings modal (⚙ icon, top-right) writes
     credentials to localStorage on a per-browser basis — that's the
     intended way to provide them. Anything left below is just a
     placeholder fallback.
     ───────────────────────────────────────────────────────────────── */
  META_ACCESS_TOKEN:  'YOUR_META_ACCESS_TOKEN',
  META_APP_ID:        'YOUR_META_APP_ID',
  META_APP_SECRET:    'YOUR_META_APP_SECRET',
  META_AD_ACCOUNT_ID: 'YOUR_AD_ACCOUNT_ID', // digits only, no "act_"
  ANTHROPIC_API_KEY:  'sk-ant-YOUR_ANTHROPIC_KEY_HERE',

  /* ── API config ───────────────────────────────────────────────── */
  API: {
    META_BASE:  'https://graph.facebook.com/v19.0',
    ANTHROPIC:  'https://api.anthropic.com/v1/messages',
    MAX_LIMIT:  100,           // items per API page (lower = safer with heavy fields)
    BATCH_SIZE: 10             // parallel insight requests
  },

  /* ── Field strings sent to Meta Graph API ─────────────────────── */
  FIELDS: {
    CAMPAIGN_SETUP: [
      'id','name','objective','buying_type',
      'daily_budget','lifetime_budget','status',
      'created_time','start_time','stop_time'
    ].join(','),

    ADSET_SETUP: [
      'id','name','campaign_id','status',
      'optimization_goal','billing_event','bid_strategy',
      'daily_budget','lifetime_budget','targeting',
      'created_time','start_time','end_time'
    ].join(','),

    CAMPAIGN_INSIGHTS: [
      'spend','impressions','clicks','reach',
      'ctr','cpc','cpp',
      'actions','cost_per_action_type','action_values'
    ].join(','),

    ADSET_INSIGHTS: [
      'spend','impressions','clicks','reach',
      'ctr','cpc',
      'actions','cost_per_action_type','action_values'
    ].join(',')
  },

  /* ── action_type values counted as conversions ─────────────────── */
  CONVERSION_ACTIONS: [
    'purchase','lead','complete_registration','subscribe','contact'
  ],

  /* ── Compliance thresholds (editable in Settings UI) ─────────── */
  THRESHOLDS: {
    ROAS_TARGET:     3.0,
    CPA_TARGET:      25.0,
    CTR_MIN:         1.0,
    BUDGET_VARIANCE: 0.20
  },

  /* ── UI defaults ─────────────────────────────────────────────── */
  UI: {
    DEFAULT_PRESET:   'last_30d',
    /* Refresh policy: manual (Refresh button) + one auto-fetch per
       calendar day. No background polling — keeps API quota healthy. */
    CURRENCY:         '$'
  }
};

/* ── Persistence helpers ──────────────────────────────────────────── */
function initConfig() {
  try {
    const raw = localStorage.getItem('metaAdsCfg_v4');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.t)  CONFIG.META_ACCESS_TOKEN  = p.t;
    if (p.ai) CONFIG.META_APP_ID        = p.ai;
    if (p.as) CONFIG.META_APP_SECRET    = p.as;
    if (p.ac) CONFIG.META_AD_ACCOUNT_ID = p.ac;
    if (p.ak) CONFIG.ANTHROPIC_API_KEY  = p.ak;
    if (p.th) Object.assign(CONFIG.THRESHOLDS, p.th);
  } catch (_) {}
}

function persistConfig() {
  localStorage.setItem('metaAdsCfg_v4', JSON.stringify({
    t:  CONFIG.META_ACCESS_TOKEN,
    ai: CONFIG.META_APP_ID,
    as: CONFIG.META_APP_SECRET,
    ac: CONFIG.META_AD_ACCOUNT_ID,
    ak: CONFIG.ANTHROPIC_API_KEY,
    th: CONFIG.THRESHOLDS
  }));
}

function isConfigured() {
  return CONFIG.META_ACCESS_TOKEN  && !CONFIG.META_ACCESS_TOKEN.includes('YOUR_')
      && CONFIG.META_AD_ACCOUNT_ID && !CONFIG.META_AD_ACCOUNT_ID.includes('YOUR_');
}
