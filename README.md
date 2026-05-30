# Meta Ads Compliance Dashboard

A single-page dashboard that pulls campaigns, ad sets, and insights from the
Meta Marketing API and evaluates each one against a set of compliance KPIs
(CTR, CPA, ROAS, CVR, Daily Budget, Conversions for Performance; Age, Gender,
Location, Interests, Audience Type for Setup).

Renders entirely in the browser — no backend, no build step. Credentials are
stored per-browser in `localStorage` via the Settings modal.

## Local setup

1. Clone the repo.
2. Copy the template:
   ```bash
   cp config.example.js config.js
   ```
   `config.js` is gitignored — your credentials never leave your machine.
3. Open `index.html` in a browser. Click the **⚙ Settings** icon (top right)
   and paste in:
   - **Meta Access Token** — generate at
     https://developers.facebook.com/tools/explorer
   - **Meta App ID** and **App Secret** — from your app's basic settings
   - **Ad Account ID** — digits only, no `act_` prefix
4. Hit **Save & Connect**. The dashboard fetches once per calendar day and
   caches the result in `localStorage` to stay under Meta's rate limit.

## Security notes

- **Never** commit real credentials to `config.js`. Use the Settings modal.
- The repo has `config.js` gitignored and ships only `config.example.js`.
- All API calls run from the browser, so each user's credentials stay in
  that user's browser. There is no shared backend secret.
- GitHub Secret Scanning + Push Protection are enabled for this repo as a
  safety net against accidental commits.

## How compliance is evaluated

- **Setup tab KPIs** are local rules (e.g. "Age passes if range is not the
  default 18–65"). See `SETUP_METRICS` in `index.html`.
- **Performance tab KPIs** compare insights against thresholds in
  `CONFIG.THRESHOLDS` (editable in Settings).
- Campaign-level Setup compliance is rolled up from child ad sets
  (campaigns don't carry targeting fields).

## Stack

Vanilla JS, Tailwind via CDN, Meta Graph API v19.0. No dependencies.
