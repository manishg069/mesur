# Mesur — universal size recommendations

**One profile. Every brand. Better fit.**

Shoppers save their body measurements once. A transparent recommendation engine matches them against each brand's own size charts. Brands manage their charts and products in a merchant dashboard and add a "Find My Size" button to their store with one script tag.

> **Demonstration data.** In demo mode the brands Zara, H&M, Uniqlo, Nike and Adidas appear with **invented** size charts so you can see how sizing differs between brands. Those charts are not sourced from, verified by or endorsed by the brands. "Northline Supply" is a fictional merchant. Analytics generated for the demo are flagged `is_sample` and labelled in the UI.

---

## Quick start

Requires **Node.js 22.13 or newer**. There are **no npm dependencies**, so there is nothing to install.

```bash
cp .env.example .env      # optional — the defaults run demo mode
npm start                 # app on http://localhost:4000
npm run storefront        # demo store on http://localhost:4100 (second terminal)
npm test                  # engine, CSV, unit-conversion and API tests
```

The database (`data/mesur.db`) is created and seeded the first time the app starts. To start again: `npm run reset`.

### Demo accounts (demo mode only)

| Role     | Email                 | Password          |
|----------|-----------------------|-------------------|
| Customer | customer@mesur.demo   | demo-customer-1   |
| Merchant | merchant@mesur.demo   | demo-merchant-1   |
| Admin    | admin@mesur.demo      | demo-admin-1      |

The login page shows these as one-click buttons in demo mode. They are never sent to the browser in production mode.

### A 5-minute tour

1. Open **/** and move the sliders in the "Try it" section. The real engine runs in the browser against a sample chart.
2. Log in as the **customer**. The dashboard shows a different size per brand for the same body. Open **Profile**, switch to inches, change a value, and save.
3. Open **http://localhost:4100**, choose a product and click **Find My Size**. You are already signed in to Mesur, so the widget shows your size. Pick a size; the store's size selector updates.
4. Log in as the **merchant**. Edit a size chart, export it as CSV, import it again, add a product and copy its embed snippet from **Integrations**.
5. Log in as the **admin**. Suspend Northline Supply, then reload the storefront: the button disappears. Approve it again.

---

## Features implemented

**Public site** — landing page with a live engine demo and a simulated product page; how-it-works; brand directory with public size charts.

**Authentication** — email and password signup and login, logout, password reset (single-use, 1-hour tokens), password change (signs out other devices), account deletion. Passwords are hashed with scrypt; sessions are HttpOnly cookies backed by hashed tokens in the database. Roles: `customer`, `merchant`, `admin`. They are enforced on every API route and on page routes (server-side redirect). The client-side guard only mirrors the server's checks. Signup cannot create admins.

**Customer app** — dashboard (greeting, body profile, completeness by category, per-brand sizes, recent recommendations, most recommended brands, quick actions); a measurement profile with a body figure that highlights the selected measurement, instructions for each measurement, cm/in switching that converts values already typed, validation of unrealistic values, unsaved drafts kept across navigation, and profile deletion; recommendations by category and fit preference; product-specific recommendations with full breakdown and history; brand explorer; settings.

**Recommendation engine** (`shared/engine.js`) — see below.

**Merchant dashboard** — overview KPIs, setup checklist and 30-day chart; product CRUD (image upload, category, fit type, chart assignment, available sizes, optional ease, activate/deactivate); size chart table editor (add, reorder and remove sizes, choose measurements, body or garment chart, cm or in, brand-wide or product-specific) with CSV import (validated, line-numbered errors), CSV export and template; integrations (public key, embed snippet per product, appearance with live preview, allowed origins, secret API key shown once, key rotation, Shopify/WooCommerce notes); analytics (7/30/90 days, impressions, requests, rate, size distribution, outcomes, per-product table); brand settings with logo upload.

**Widget** — `widget.js` renders the button, opens a modal with an iframe served by Mesur, and handles signed-out shoppers (log in or sign up inline), shoppers without a profile (quick measurement form), and signed-in shoppers (size, score, confidence, fit-preference switch, every size with its score, fit notes). "Select size" passes only the size label back to the store.

**Admin** — platform totals, merchant approval and suspension, platform configuration (merchant signup, approval required, minimum match score), brand CRUD including platform-managed brands, size chart management for any brand, user list with suspend and reactivate (no measurements shown), platform analytics and request log.

---

## The recommendation engine

`shared/engine.js` is a pure, dependency-free module. The same file runs on the server, in the browser demo and in the tests.

1. **Normalise the chart.** Inch charts are converted to cm; sizes are ordered.
2. **Body vs garment.**
   - *Body* charts list the body each size is cut for. The shopper's measurement is shifted by *(ease they want − ease the product is cut with)*, so an oversized preference on a regular tee sizes up.
   - *Garment* charts list finished garment measurements. The wanted ease is subtracted to get the body range each size fits. A garment is never matched as if it were the same size as the body.
   - Ease defaults per category and fit (`DEFAULT_CONFIG.ease`) can be overridden per product.
3. **Score each measurement.** Inside the range scores 0.92–1.0 (highest at the centre). Outside the range the score falls linearly with the distance, measured in per-measurement tolerances (chest ±4 cm, shoulder ±2 cm, …). Too tight is penalised 1.4× harder than too loose.
4. **Weight by category.** Tops: chest 45%, shoulder 25%, waist 15%, …; bottoms: waist 45%, hip 30%, …; dresses: chest, waist and hip. Weights renormalise over the measurements available.
5. **Reject bad fits.** A size is disqualified if a measurement weighted 25% or more is over a tolerance too tight. If nothing scores above the minimum (default 60%, configurable by the admin), the result is *"Your measurements fall outside the available size range."* rather than the nearest size.
6. **Ask for missing data.** Tops need chest, bottoms need waist, dresses need chest and waist. Missing optional measurements lower confidence and are listed.
7. **Confidence** (high, medium or low) combines the score, coverage (the share of the chart's weight the profile could fill) and the margin over the runner-up. It is always labelled an estimate, not a guarantee.

Output: size, match score, confidence with reasons, explanation, next closest size, per-measurement comparison, tight/loose notes, the fit preference used and how it was applied, and every size's score.

Tests: `tests/engine.test.js` covers the brief's worked example (96/82/44 → M), brand differences, sizes in between, weighting, configurable weights, missing data, out-of-range above and below, conflicting measurements, every fit preference, product ease overrides, garment charts, inch charts, available sizes, dresses and partial rows.

---

## Database schema

The bundled server uses SQLite through Node's built-in `node:sqlite` (`server/schema.sql`). `supabase/schema.sql` is the PostgreSQL equivalent with Row Level Security.

| Table | Purpose |
|---|---|
| `profiles` | Accounts: email, name, role, status, preferred unit and fit |
| `sessions`, `password_resets` | Hashed session and reset tokens (handled by Supabase Auth in the Postgres version) |
| `customer_measurements` | One row per customer, all values in cm, with range CHECK constraints |
| `merchants` | Brand accounts with `pending`, `approved` or `suspended` status |
| `brands` | Name, slug, logo, description, website, country, categories, integration status, `is_demo` |
| `size_charts` | Category, fit type, unit, body/garment, brand/product scope |
| `size_chart_entries` | One row per size; `ranges` JSON `{chest:{min,max},…}` |
| `products` | External identifier (used by the widget), category, fit, assigned chart, available sizes, ease |
| `recommendations` | A customer's own history; never exposed to merchants |
| `widget_integrations` | Public key, hashed secret key, allowed origins, widget appearance |
| `recommendation_events` | Anonymous analytics: impression, open, recommendation, size_selected |
| `platform_config` | Admin settings |

UUID primary keys, created/updated timestamps, foreign keys with cascades, unique constraints (email, slug, chart name per brand, size label per chart, product identifier per brand) and indexes on the lookup paths.

**Privacy rules:** measurements are readable only by their owner. Merchants see aggregated, anonymous event counts. Admins see account metadata and whether a profile exists, never the values. The API tests check this.

---

## Integrating the widget (for merchants)

1. Create size charts and products in the merchant dashboard. Each product's **identifier** should match your SKU or handle.
2. In **Integrations**, copy the snippet and place it on the product page:

```html
<script src="https://YOUR_MESUR_DOMAIN/widget.js"
        data-merchant="pk_your_public_key"
        data-product="your-product-id" async></script>
```

3. Optional: listen for the shopper's choice:

```js
document.addEventListener('mesur:size-selected', (e) => selectVariant(e.detail.size));
```

- **Shopify:** use a Custom Liquid block with `data-product="{{ product.handle }}"`.
- **WooCommerce:** use the single-product template with the product SKU.
- **Single-page apps:** call `MesurWidget.mount(element, { merchant, product })`.
- **Allowed origins:** restrict which sites may load your widget (enforced on the API and via `frame-ancestors`).
- **Server-to-server API:** `POST /api/v1/recommendations` with `Authorization: Bearer sk_…` and `{ product_id, measurements, unit, fit_preference }`. The secret key is hashed in the database and shown once.

The public key in the snippet can only fetch widget configuration and record anonymous events. Shopper measurements stay on the Mesur origin inside the iframe.

---

## Environment variables

See `.env.example`. The important ones are `APP_MODE` (`demo` or `production`), `APP_URL`, `DATABASE_PATH`, `COOKIE_SECURE`, `COOKIE_CROSS_SITE`, and `ADMIN_EMAIL`/`ADMIN_PASSWORD` (production bootstrap). The storefront uses `STOREFRONT_URL`, `STOREFRONT_PORT` and `STOREFRONT_MERCHANT_KEY`.

**Demo vs production:** demo mode seeds sample data, shows a banner and returns password-reset links in the browser. Production mode does none of this. Requests that fail are always shown as errors; the app never substitutes mock data.

---

## Remaining limitations

- **Stack differs from the brief.** Built with plain Node.js and browser ES modules plus SQLite, not Next.js, Tailwind, shadcn/ui or Supabase, because packages could not be installed in the build environment. The architecture (separate engine service, REST API, role guards, relational schema) is designed to port across. `supabase/schema.sql` with RLS is provided but **has not been run against a live Supabase project**.
- **No email delivery.** Password-reset links are logged on the server (and shown in the browser in demo mode). Connect an email provider in `server/routes/auth.js` (`/api/auth/forgot`) before production.
- **Cross-domain widget sessions** need HTTPS and `COOKIE_CROSS_SITE=1`. Browsers that block third-party cookies (Safari, and Chrome with that setting) will show the in-widget login each time. A token-based handoff is the planned fix.
- **Images** are stored as small data URLs in the database. Move them to object storage (Supabase Storage buckets are defined in the schema) for production.
- **Single process.** The rate limiter is in-memory and SQLite is single-node. Use Postgres and a shared rate limiter to scale horizontally.
- **Return insights** are not computed. The dashboard says so instead of estimating them, because no return data is ingested.
- **Size charts for real brands** shown in demo mode are fictional.
- Measurement accuracy depends on users measuring correctly, and every recommendation is an estimate.

## Project structure

```
shared/      engine.js · measurements.js · units.js · csv.js   (isomorphic, tested)
server/      index.js (HTTP, static, guards) · routes/{auth,customer,merchant,admin,widget}.js
             services.js · auth.js · db.js · schema.sql · seed.js · env.js
public/      index.html · css/app.css · js/{app,api,ui,result,figure,chart-editor,components}.js
             js/pages/{public,auth,customer,merchant,admin,account}.js
             widget.js · widget-frame.html
storefront/  server.js   — demo store on a separate origin
supabase/    schema.sql  — Postgres + RLS version
tests/       engine · units-csv · api
```
