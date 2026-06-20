import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { findOrgIdByShopDomain } from "../lib/provisionOrg.server";
import { logSyncEvent } from "../lib/syncLog.server";

/**
 * Mandatory GDPR compliance webhook: `customers/data_request`.
 *
 * Shopify sends this when a store customer requests their data. ecom-integrator
 * does not store customer PII keyed to Shopify customer ids (its business data
 * is marketplace orders synced into the shared Supabase backend), so there is no
 * data export to assemble here. We authenticate the request (HMAC-verified by
 * `authenticate.webhook`), record the request in the `sync_logs` audit trail
 * best-effort, and acknowledge with 200 so Shopify marks it delivered.
 *
 * Registered via `compliance_topics` in shopify.app.toml.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orgId = await findOrgIdByShopDomain(shop);
  const customer = (payload?.customer ?? {}) as Record<string, unknown>;

  await logSyncEvent({
    orgId,
    source: "shopify-webhook",
    eventType: "customers/data_request",
    status: "ok",
    message: `GDPR data request received for ${shop}`,
    payload: {
      shop_domain: payload?.shop_domain ?? shop,
      customer_id: customer.id ?? null,
      orders_requested: payload?.orders_requested ?? null,
    },
  });

  return new Response();
};
