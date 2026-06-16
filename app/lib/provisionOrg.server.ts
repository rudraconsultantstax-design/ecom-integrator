import { supabase } from "../supabase.server";
import type { OrgId } from "./orgScopedClient.server";

/**
 * Install-time org provisioning.
 *
 * Ensures a tenant `orgs` row exists for an installing Shopify shop, keyed by
 * its myshopify domain (e.g. "the-baisa-dev-store.myshopify.com"), and returns
 * the org's `id` for use as `org_id` everywhere else (see
 * app/lib/orgScopedClient.server.ts).
 *
 * Idempotent and race-safe: uses an `ON CONFLICT (shop_domain) DO NOTHING`
 * upsert (the unique constraint `orgs_shop_domain_key` added in
 * supabase/migrations/20260613025033_add_shop_domain_to_orgs.sql), then reads
 * the row back. Concurrent installs of the same shop converge on one row.
 *
 * `orgs` is the tenant table itself (keyed by `id`, not `org_id`), so this uses
 * the raw service-role `supabase` client rather than the org-scoped helper.
 *
 * Server-only: imports the service-role client.
 */
export async function provisionOrg(shopDomain: string): Promise<OrgId> {
  if (!shopDomain) {
    throw new Error("provisionOrg requires a non-empty shopDomain.");
  }

  // Insert the org if it's new; do nothing if it already exists. `name` is
  // seeded to the shop domain as a sensible default the merchant can rename
  // later — `ignoreDuplicates` ensures we never clobber an existing name.
  const { error: upsertError } = await supabase
    .from("orgs")
    .upsert(
      { shop_domain: shopDomain, name: shopDomain },
      { onConflict: "shop_domain", ignoreDuplicates: true },
    );

  if (upsertError) {
    throw new Error(
      `provisionOrg: failed to upsert org for "${shopDomain}": ${upsertError.message}`,
    );
  }

  // Read back the id (the row is guaranteed to exist now, whether just inserted
  // or pre-existing).
  const { data, error } = await supabase
    .from("orgs")
    .select("id")
    .eq("shop_domain", shopDomain)
    .single();

  if (error || !data) {
    throw new Error(
      `provisionOrg: org row missing after upsert for "${shopDomain}": ${error?.message ?? "no row returned"}`,
    );
  }

  return data.id as OrgId;
}
