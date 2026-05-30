/**
 * ═══════════════════════════════════════════════════════════════════════
 *  META ADS DASHBOARD — config.example.js
 *
 *  Committed template. Loaded as a fallback by index.html *only* when
 *  a local `config.js` is absent (typical on the public deploy).
 *
 *  For local development: copy this file to `config.js` and fill in real
 *  credentials. `config.js` is gitignored so your secrets stay local.
 *
 *  For the public deploy: this file is what runs. Visitors enter their
 *  own credentials via the ⚙ Settings modal, which persists them in
 *  their browser's localStorage — no shared secrets, no leaks.
 * ═══════════════════════════════════════════════════════════════════════
 */

/* Self-defending: skip everything if config.js already defined CONFIG. */
if (typeof CONFIG === 'undefined') {

  window.CONFIG = {

    /* ── Credentials (placeholders only — never put real values here) ─ */
    META_ACCESS_TOKEN:  'YOUR_META_ACCESS_TOKEN',
    META_APP_ID:        'YOUR_META_APP_ID',
    META_APP_SECRET:    'YOUR_META_APP_SECRET',
    META_AD_ACCOUNT_ID: 'YOUR_AD_ACCOUNT_ID',
    ANTHROPIC_API_KEY:  'sk-ant-YOUR_ANTHROPIC_KEY_HERE',

    /* ── API config ──────────────────────────────────────────────── */
    API: {
      META_BASE:  'https://graph.facebook.com/v19.0',
      ANTHROPIC:  'https://api.anthropic.com/v1/messages',
      MAX_LIMIT:  100,
      BATCH_SIZE: 10
    },

    /* ── Field strings sent to Meta Graph API ────────────────────── */
    FIELDS: {
      CAMPAIGN_SETUP: [
        'id','name','objective','buying_type',
        'daily_budget','lifetime_budget','status','effective_status',
        'created_time','start_time','stop_time'
      ].join(','),

      ADSET_SETUP: [
        'id','name','campaign_id','status','effective_status',
        'optimization_goal','billing_event','bid_strategy',
        'daily_budget','lifetime_budget','targeting',
        'created_time','start_time','end_time'
      ].join(','),

      CAMPAIGN_INSIGHTS: [
        'spend','impressions','clicks','reach',
        'ctr','cpc','cpp','cpm','inline_link_clicks',
        'actions','cost_per_action_type','action_values'
      ].join(','),

      ADSET_INSIGHTS: [
        'spend','impressions','clicks','reach',
        'ctr','cpc','cpm','inline_link_clicks',
        'actions','cost_per_action_type','action_values'
      ].join(',')
    },

    /* ── action_type values counted as conversions ───────────────── */
    CONVERSION_ACTIONS: [
      'purchase','lead','complete_registration','subscribe','contact'
    ],

    /* ── Compliance thresholds ─────────────────────────────────────
       Two sets baked here as a fallback. Both are normally OVERRIDDEN
       at runtime by the Google Sheet (see SHEET_ID below):

         • Phase 1 — entity age ≤ PHASE1_DAYS (looser, still learning)
         • End Goal — entity age > PHASE1_DAYS (strict final benchmark)

       Sheet parameter names → CONFIG threshold keys:
         CAC                    → CPA_TARGET   (₹, lower is better)
         ROAS                   → ROAS_TARGET  (multiple, higher is better)
         CTR                    → CTR_MIN      (%, higher is better)
         Conversion Rate        → CVR_MIN      (%, higher is better)
         Budget Campaign Level  → DAILY_BUDGET_MIN (₹/day, higher is better)
         Bounce Rate            → (GA4 — not currently evaluated) */
    PHASE1_DAYS: 30,

    THRESHOLDS: {                /* END GOAL — mature campaigns (> 30 days) */
      ROAS_TARGET:       3.0,
      CPA_TARGET:        25.0,
      CTR_MIN:           1.0,
      CVR_MIN:           3.0,
      DAILY_BUDGET_MIN:  2000
    },
    THRESHOLDS_PHASE1: {         /* PHASE 1 — first 30 days, looser */
      ROAS_TARGET:       1.5,
      CPA_TARGET:        40.0,
      CTR_MIN:           0.7,
      CVR_MIN:           0.9,
      DAILY_BUDGET_MIN:  1000
    },

    /* ── Live config from a Google Sheet ──────────────────────────
       The dashboard fetches two tabs on each load:
         • "Threshold" — Parameter / Phase 1 Target / End Goal
         • "Setup"     — KPIs / Target  (drives the Setup-tab rules)
       It uses the gviz CSV endpoint, which works on any sheet shared
       with "Anyone with the link" (no publish-to-web required).
       Sheet must be readable by the public.

       Sheet ID is the long string in the sheet URL:
       https://docs.google.com/spreadsheets/d/[THIS_PART]/edit  */
    SHEET_ID: '1MEpQjS_cIs3qGDBlBZWBorpwyHgKFbtenA3wIHxnDbY',

    /* ── GA4 proxy Worker (Sessions / Engagement / Bounce) ──────────
       Cloudflare Worker URL that holds the Google OAuth refresh token
       and proxies real-time queries to the GA4 Data API. See
       worker/README.md for one-time deploy steps and OAuth setup. */
    GA4_WORKER_URL: 'https://meta-ads-ga4.shy-boat-66a1.workers.dev',

    /* ── UI defaults ─────────────────────────────────────────────── */
    UI: {
      DEFAULT_PRESET:   'last_30d',
      CURRENCY:         'INR'
    }
  };

  /* ── Persistence helpers ──────────────────────────────────────── */
  window.initConfig = function() {
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
  };

  window.persistConfig = function() {
    localStorage.setItem('metaAdsCfg_v4', JSON.stringify({
      t:  CONFIG.META_ACCESS_TOKEN,
      ai: CONFIG.META_APP_ID,
      as: CONFIG.META_APP_SECRET,
      ac: CONFIG.META_AD_ACCOUNT_ID,
      ak: CONFIG.ANTHROPIC_API_KEY,
      th: CONFIG.THRESHOLDS
    }));
  };

  window.isConfigured = function() {
    return CONFIG.META_ACCESS_TOKEN  && !CONFIG.META_ACCESS_TOKEN.includes('YOUR_')
        && CONFIG.META_AD_ACCOUNT_ID && !CONFIG.META_AD_ACCOUNT_ID.includes('YOUR_');
  };

}
