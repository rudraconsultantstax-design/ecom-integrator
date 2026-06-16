# Ecom OMS + Marketplace Integrator & Web Store Builder — Project Architecture & Handover

**Owner:** The Consulting Crew (Rudra Tax Consultants), Jaipur
**Last updated:** 2026-06-13
**Status:** Infrastructure & platform configuration COMPLETE. Application code deployment PENDING.

## 1. Overview

A three-app Shopify product suite giving online sellers a complete operations solution.

| App | Purpose | Repo | App URL |
|-----|---------|------|---------|
| Ecom OMS integrator | Full order management + marketplace connectors (orders, fulfillment, returns, inventory, payments) | ecom-oms-integrator | https://ecom-oms.baisajaipur.in |
| ecom integrator | Multi-marketplace connector, order sync, analytics & automation | ecom-integrator | https://ecom.baisajaipur.in |
| Web Store builder | Theme customization, page builder, SEO, multi-language, marketing & conversion tools | web-store-builder | https://webstore.baisajaipur.in |

## 2. Hosting & Domains (Hostinger)

Primary domain baisajaipur.in. Subdomains provisioned, each with its own document root:

| Subdomain | Document Root |
|-----------|---------------|
| ecom-oms.baisajaipur.in | /public_html/ecom-oms |
| ecom.baisajaipur.in | /public_html/ecom |
| webstore.baisajaipur.in | /public_html/webstore |
| os.baisajaipur.in | /public_html/os |

NOTE: baisajaipur.in currently points to external nameservers. To activate subdomains, add A records (or point nameservers to Hostinger), deploy code, and provision SSL.

## 3. Database (Supabase)

- Project: oms-integrator
- Region: South Asia (Mumbai, ap-south-1)
- URL: https://mhlyicynbznlvbinvqna.supabase.co
- Status: Healthy

### Schema (public, multi-tenant)

All tables include an org_id column for tenant isolation. RLS is ENABLED on every table.

| Table | Purpose |
|-------|---------|
| orgs | Tenant/merchant accounts (id, name, gstin) |
| customers | Customer records (org-scoped PII: name, email, phone) |
| products | Product catalog |
| orders | Orders (Shopify + marketplace) |
| order_items | Line items |
| payments | Payment records per provider |
| shipments | Fulfillment/shipment tracking |
| returns | Returns/RMA |
| channels | Connected sales channels/marketplaces |
| channel_listings | Per-channel product listings |
| sync_logs | Integration sync audit trail |

### Security note (DEFERRED hardening)

Current RLS policies are permissive anon_read_* SELECT policies for development/seed data. Before production launch, replace with org-scoped policies (restrict by org_id JWT claim) plus INSERT/UPDATE/DELETE policies for the service/authenticated role. Hardening intentionally deferred until after functional testing & verification.

## 4. Shopify App Configuration

### 4.1 Ecom OMS integrator (Partner org: The Consulting Crew)
- Distribution: Custom distribution (locked to the Plus org of the-baisa-dev-store.myshopify.com — irreversible).
- Active version: ecom-oms-integrator-3. Embedded: yes. Webhooks API version: 2026-04.
- Protected Customer Data: Steps 1 & 2 complete (data-use reasons for Name/Email/Phone/Address; 16-question questionnaire answered).
- Redirect URLs: /auth/callback, /auth/shopify/callback, /api/auth/callback on ecom-oms.baisajaipur.in

### 4.2 ecom integrator (Dev Dashboard org: The Baisa)
- Distribution: OPEN — reserved for public App Store submission.
- Active version: ecom-integrator-2

### 4.3 Web Store builder (Dev Dashboard org: The Baisa)
- Distribution: OPEN — reserved for public App Store submission.
- Active version: web-store-builder-3
- Scopes include themes, content, online_store_pages, translations, marketing_events, script_tags.

## 5. Source Repositories (GitHub: rudraconsultantstax-design)

- ecom-oms-integrator (this repo)
- ecom-integrator
- web-store-builder

GitHub to Supabase auto-deploy is NOT yet connected (requires authorizing the Supabase GitHub App on the repos).

## 6. Remaining Work (Launch Checklist)

### Human / deployment tasks
- [ ] Write & push application code (backend + embedded frontend) to each repo.
- [ ] Deploy code to the three Hostinger subdomains; configure A records + SSL.
- [ ] Run shopify app deploy per app — auto-registers mandatory GDPR webhooks (customers/data_request, customers/redact, shop/redact).
- [ ] Connect Supabase to GitHub (authorize Supabase GitHub App) for migration-based deploys.
- [ ] Add Privacy Policy URLs for all three apps.
- [ ] Replace permissive RLS policies with org-scoped production policies (see section 3).
- [ ] Submit ecom integrator & Web Store builder to the public App Store (listing, screenshots, review).

### Verification
- [ ] End-to-end OAuth install flow on dev store.
- [ ] Order/inventory sync smoke test against seeded data.
- [ ] Webhook delivery verification.

## 7. Environment Reference

| Resource | Value |
|----------|-------|
| Supabase project ref | mhlyicynbznlvbinvqna |
| Supabase region | ap-south-1 (Mumbai) |
| Dev store | the-baisa-dev-store.myshopify.com |
| Production domain | baisajaipur.in |

Do not commit secrets (Supabase service-role key, Shopify API secret) to the repo. Store them in environment variables / Hostinger env config.
