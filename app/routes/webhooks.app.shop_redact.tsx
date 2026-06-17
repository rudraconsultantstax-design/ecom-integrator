import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { findOrgIdByShopDomain } from "../lib/provisionOrg.server";
import { orgScoped, type OrgScopedTable } from "../lib/orgScopedClient.server";
import { logSyncEvent } from "../lib/syncLog.server";

/**
 * Mandatory GDPR compliance webhook: `shop/redact`.
 *
 * Shopify sends this 48h after a shop uninstalls, signalling that the app must
 * erase that shop's data. We HMAC-authenticate the request, resolve the tenant
 * org for the shop (WITHOUT recreating it — the shop is gone), and best-effort
 * delete all org-scoped business data from the shared Supabase backend. The
 * redaction itself is recorded in `sync_logs` for the compliance audit trail.
 *
 * Deletion is ordered child → parent so it satisfies the foreign keys that do
 * NOT cascade (`returns`, `stock_levels`). Each delete is independent and
 * best-effort: a failure on one table is logged but does not abort the rest,
 * and the handler always returns 200 so Shopify marks the webhook delivered.
 *
 * The `orgs` row itself is intentionally left in place: it carries no merchant
 * PII (just the shop domain + tenant id) and removing the org-scoped rows above
 * already erases the business data. `sync_logs` is likewise retained as the
 * compliance record.
 *
 * Registered via `compliance_topics` in shopify.app.toml.
 */

// Per-tenant tables to purge, ordered so children are deleted before the
// parents they reference (covers the non-cascading `returns`/`stock_levels`).
const REDACT_TABLE_ORDER: OrgScopedTable[] = [
  "shipments",
  "returns",
  "order_items",
  "payments",
  "orders",
  "channel_listings",
  "stock_levels",
  "customers",
  "products",
  "channels",
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orgId = await findOrgIdByShopDomain(shop);

  // No tenant for this shop (never installed, or already redacted): nothing to
  // erase. Record it and acknowledge.
  if (!orgId) {
    await logSyncEvent({
      orgId: null,
      source: "shopify-webhook",
      eventType: "shop/redact",
      status: "skipped",
      message: `GDPR shop redaction for ${shop}: no org found, nothing to delete`,
      payload: { shop_domain: payload?.shop_domain ?? shop },
    });
    return new Response();
  }

  const db = orgScoped(orgId);
  const failures: string[] = [];

  for (const table of REDACT_TABLE_ORDER) {
    const { error } = await db.delete(table);
    if (error) {
      // Best-effort: log and continue so one failing table can't block the rest.
      console.error(
        `shop/redact: failed to delete ${table} for ${shop}: ${error.message}`,
      );
      failures.push(`${table}: ${error.message}`);
    }
  }

  await logSyncEvent({
    orgId,
    source: "shopify-webhook",
    eventType: "shop/redact",
    status: failures.length === 0 ? "ok" : "error",
    message:
      failures.length === 0
        ? `GDPR shop redaction complete for ${shop}: org-scoped data deleted`
        : `GDPR shop redaction for ${shop} completed with ${failures.length} table error(s)`,
    payload: {
      shop_domain: payload?.shop_domain ?? shop,
      tables_purged: REDACT_TABLE_ORDER.length - failures.length,
      failures: failures.length > 0 ? failures : undefined,
    },
  });

  return new Response();
};
