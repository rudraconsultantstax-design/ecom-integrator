-- Add shop_domain to orgs so each Shopify shop maps 1:1 to a tenant org.
-- Used by app/lib/provisionOrg.server.ts to upsert an org on install/auth,
-- keyed by the myshopify domain (e.g. the-baisa-dev-store.myshopify.com).
--
-- Idempotent: safe to re-run. Does NOT touch RLS policies (hardening deferred,
-- see docs/PROJECT_ARCHITECTURE.md §3). The column is nullable so the existing
-- seed org row stays valid; Postgres allows multiple NULLs under a UNIQUE
-- constraint, and only provisioned shops carry a value.

alter table public.orgs
  add column if not exists shop_domain text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orgs_shop_domain_key'
      and conrelid = 'public.orgs'::regclass
  ) then
    alter table public.orgs
      add constraint orgs_shop_domain_key unique (shop_domain);
  end if;
end $$;
