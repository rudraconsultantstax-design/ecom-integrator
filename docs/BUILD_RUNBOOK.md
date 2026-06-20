# Build & Deployment Runbook — Ecom OMS Integrator Suite

This runbook takes the project from its current state (platform configured, database ready, repos created, Vercel & Supabase connected) to a fully working, deployed application. Follow it top to bottom.

> You run these steps on a development machine (your laptop/desktop) using a terminal + code editor. An AI coding assistant that runs locally (Claude Code or Cursor) is strongly recommended to build out the business logic in the build loop.

---

## 0. Tools you will use

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js (v20 LTS or newer) | Runtime for the apps | https://nodejs.org (LTS) |
| npm (ships with Node) | Package manager | included with Node |
| Git | Version control | https://git-scm.com |
| Shopify CLI | Scaffolds & deploys Shopify apps | npm i -g @shopify/cli@latest |
| Vercel CLI (optional) | Deploy/manage from terminal | npm i -g vercel |
| Supabase CLI (optional) | Manage DB migrations | npm i -g supabase |
| A code editor | Editing code | VS Code (https://code.visualstudio.com) |
| Claude Code or Cursor | AI pair-programmer in the build loop | code.claude.com / cursor.com |

---

## 1. Verify your system (run these FIRST, paste output back)

```bash
node -v        # need v20.x or newer
npm -v         # need v10.x or newer
git --version  # any recent version
```

If `node -v` is missing or below v20: install the latest LTS from nodejs.org, reopen the terminal, and re-run.

Then install the global CLIs:

```bash
npm install -g @shopify/cli@latest
shopify version    # confirm it prints a version
```

---

## 2. Project references (real values for THIS project)

| Item | Value |
|------|-------|
| GitHub org | rudraconsultantstax-design |
| Repos | ecom-oms-integrator, ecom-integrator, web-store-builder |
| OMS app (Partner org) | App ID 381822402561 / org 222364823 |
| ecom integrator (Dev org) | App ID 353185366017 / org 213755507 |
| Web Store builder (Dev org) | App ID 381838163969 / org 213755507 |
| Supabase project ref | mhlyicynbznlvbinvqna |
| Supabase URL | https://mhlyicynbznlvbinvqna.supabase.co |
| Supabase region | ap-south-1 (Mumbai) |
| Dev store | the-baisa-dev-store.myshopify.com |
| Production domains | ecom-oms.baisajaipur.in / ecom.baisajaipur.in / webstore.baisajaipur.in |

The Shopify Client ID & Secret are on each app's Settings > Credentials page in the Dev Dashboard.
The Supabase anon key & service-role key are in Supabase > Project Settings > API Keys.
NEVER commit these to git — they go in environment variables only.

---

## 3. Get the code locally

```bash
# pick a working folder
mkdir baisa-apps && cd baisa-apps

# clone all three (they currently contain only README + docs)
git clone https://github.com/rudraconsultantstax-design/ecom-oms-integrator.git
git clone https://github.com/rudraconsultantstax-design/ecom-integrator.git
git clone https://github.com/rudraconsultantstax-design/web-store-builder.git
```

---

## 4. Scaffold each app with the Shopify CLI

Do this once per app. Example shown for the OMS integrator.

```bash
cd ecom-oms-integrator
shopify app init --template https://github.com/Shopify/shopify-app-template-remix
# When prompted, choose to CONNECT to an existing app and pick "Ecom OMS integrator".
# This auto-links the app via shopify.app.toml using the existing Client ID.
```

Repeat for `ecom-integrator` (link to "ecom integrator") and `web-store-builder` (link to "Web Store builder").

The Remix template already includes: OAuth, session storage, embedded App Bridge, webhook registration, and a working admin UI shell — i.e. a real running app, not a demo.

---

## 5. Wire up Supabase (shared database)

Install the client in each app:

```bash
npm install @supabase/supabase-js
```

Create `app/lib/supabase.server.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,   // server-side only
  { auth: { persistSession: false } }
);
```

The database schema already exists (orgs, customers, products, orders, order_items, payments, shipments, returns, channels, channel_listings, sync_logs) — all multi-tenant by org_id. Map each Shopify shop to an `orgs` row on install.

---

## 6. Environment variables (.env locally, and in Vercel later)

Create `.env` (already gitignored) in each app:

```bash
SHOPIFY_API_KEY=<client id from Dev Dashboard>
SHOPIFY_API_SECRET=<secret from Dev Dashboard>
SCOPES=<comma-separated scopes already configured for the app>
SHOPIFY_APP_URL=https://ecom-oms.baisajaipur.in   # per app
SUPABASE_URL=https://mhlyicynbznlvbinvqna.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase>
SUPABASE_ANON_KEY=<anon key from Supabase>
```

---

## 7. Run locally & test the install

```bash
shopify app dev
# opens a tunnel and an install link for the dev store
# install on the-baisa-dev-store.myshopify.com and confirm the embedded app loads
```

Fix any issues in the local build loop (this is where the AI coding assistant helps most).

---

## 8. Build the real features (prioritized order)

Build in this sequence; each is a working increment you can test before moving on:

1. Install lifecycle: on app install, create/lookup the org row, store the offline token.
2. GDPR/compliance webhooks: customers/data_request, customers/redact, shop/redact (mandatory for App Store).
3. Core sync: orders + products + inventory webhooks -> upsert into Supabase.
4. Admin UI: dashboards reading from Supabase (orders, inventory, sync status).
5. Marketplace connectors (per channel): Amazon, Flipkart, etc. — pull/push orders & inventory via the channels + channel_listings tables.
6. Returns & fulfillment flows.
7. Billing (Shopify Billing API) if charging merchants.
8. Background jobs / scheduled sync (Vercel Cron or a queue).

Each app: OMS integrator = full OMS. ecom integrator = marketplace connector + analytics. Web Store builder = themes/pages/SEO/translations.

---

## 9. Deploy Shopify config

From each app folder:

```bash
shopify app deploy
# pushes app config AND auto-registers the GDPR/compliance webhooks
```

This is the step that registers the mandatory webhooks that cannot be added through the dashboard UI.

---

## 10. Deploy to Vercel

Vercel is already linked to your GitHub. For each app:

1. Vercel dashboard > Add New > Project > import the repo (e.g. ecom-oms-integrator).
2. Framework preset: Remix (auto-detected).
3. Add the same environment variables from step 6 in Project > Settings > Environment Variables.
4. Deploy. Vercel builds and gives a *.vercel.app URL.
5. Project > Settings > Domains > add the custom domain (ecom-oms.baisajaipur.in) and follow Vercel's DNS instructions (CNAME).
6. In Hostinger DNS for baisajaipur.in, add the CNAME records Vercel shows for each subdomain.
7. Once DNS verifies, the app is live on the real domain with SSL auto-provisioned.

Every future `git push` to main auto-deploys.

---

## 11. Final checklist

- [ ] All three apps install on the dev store and load embedded.
- [ ] GDPR webhooks registered (shopify app deploy).
- [ ] Orders/inventory sync into Supabase verified.
- [ ] Custom domains live with SSL on Vercel.
- [ ] Harden Supabase RLS: replace anon_read_* with org-scoped policies (see PROJECT_ARCHITECTURE.md section 3).
- [ ] Add Privacy Policy URL during App Store listing submission (ecom integrator & web-store-builder).
- [ ] Submit the two open apps to the App Store.

---

## 12. Recommended way to build fast

Open each app folder in VS Code with Claude Code (or Cursor) running. Point it at this runbook and PROJECT_ARCHITECTURE.md, and have it implement section 8 feature-by-feature, running `shopify app dev` between steps to test. That gives you the real build/test loop that produces a production-grade result.
