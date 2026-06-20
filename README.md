# ecom-integrator

An embedded Shopify admin app: a **multi-marketplace connector** with order sync, inventory sync, analytics, and automation. It is one of three apps in the Baisa Jaipur Shopify product suite (see `docs/PROJECT_ARCHITECTURE.md`).

- **App URL:** https://ecom.baisajaipur.in
- **Distribution:** OPEN (public App Store-bound) — `AppDistribution.AppStore`
- **Template:** Shopify App **React Router** template (TypeScript)
- **Backend:** shared multi-tenant Supabase Postgres (project ref `mhlyicynbznlvbinvqna`), tenant-isolated by `org_id`. Prisma is used only for Shopify session storage.

This repo is a **scaffold**: OAuth, session storage, the embedded App Bridge shell, webhook plumbing, install-time org provisioning, and a starter **Channels** dashboard (reads connected marketplaces from the Supabase `channels` table) work. The full marketplace connector / sync / analytics business logic is not yet written; the build order is `docs/BUILD_RUNBOOK.md` section 8.

## Commands

```bash
npm install          # install dependencies
npm run dev          # shopify app dev — tunnels, injects env vars, opens an install link
npm run build        # react-router build
npm start            # serve the production build
npm run lint         # eslint
npm run typecheck    # react-router typegen && tsc --noEmit
npm run deploy       # shopify app deploy — pushes shopify.app.toml + registers webhooks
npm run setup        # prisma generate && prisma migrate deploy
```

There is no test runner. Verify with `npm run typecheck`, `npm run build`, and `npm run lint`.

`npm run dev` is the normal way to run — it must go through the Shopify CLI to obtain the API key/secret, tunnel URL, and scopes.

## First-time setup

1. `npm install`
2. Link the Shopify app to write the real Client ID into `shopify.app.toml`:
   ```bash
   shopify app config link   # choose "ecom integrator"
   ```
   The committed `client_id` is a placeholder (`REPLACE_WITH_ECOM_INTEGRATOR_CLIENT_ID`).
3. Copy `.env.example` to `.env` and fill in the Shopify and Supabase values (see `docs/BUILD_RUNBOOK.md` section 6). `.env` is gitignored — never commit secrets.

## Architecture

See `CLAUDE.md` for the detailed architecture and the embedded-app constraints (Polaris web components, iframe-safe navigation, webhook declaration). In short:

- `app/shopify.server.ts` is the single configured `shopifyApp` instance; import `authenticate`, `login`, etc. from it.
- Routes use file-system flat routing (`@react-router/fs-routes`). `app.tsx` is the embedded layout; `app._index.tsx` is the Channels page.
- `app/supabase.server.ts` holds the service-role Supabase client (server-only). Per-tenant access goes through `app/lib/orgScopedClient.server.ts`; installs provision an org via `app/lib/provisionOrg.server.ts` (the `afterAuth` hook).

## Deploy

1. **Link the app** so the real Client ID is written into `shopify.app.toml` (the committed value is the placeholder `REPLACE_WITH_ECOM_INTEGRATOR_CLIENT_ID`):
   ```bash
   shopify app config link   # choose "ecom integrator"
   ```
   Do not hand-edit `client_id`.
2. **Set environment variables** on the host (Hostinger subdomain `ecom.baisajaipur.in`). `shopify app dev` injects the Shopify values locally, but production must set them explicitly. See `.env.example` and `docs/BUILD_RUNBOOK.md` section 6:
   - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — from the app's Settings → Credentials.
   - `SCOPES` — must match `shopify.app.toml` `[access_scopes]`.
   - `SHOPIFY_APP_URL` — `https://ecom.baisajaipur.in`.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — service-role key is **server-only**; never expose it to the browser or commit it.
3. **Push config & register webhooks:**
   ```bash
   shopify app deploy
   ```
   This pushes `shopify.app.toml` and auto-registers the declared webhooks (including the mandatory GDPR ones: `customers/data_request`, `customers/redact`, `shop/redact`).
4. **Build & serve the production bundle** on Hostinger:
   ```bash
   npm ci
   npm run setup      # prisma generate && prisma migrate deploy (session storage)
   npm run build
   npm start          # serves build/ on $PORT
   ```
   Point the `ecom.baisajaipur.in` subdomain at the running server (see `docs/BUILD_RUNBOOK.md` for the DNS/CNAME step). Keep distribution on `AppDistribution.AppStore`.
