import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { findOrgIdByShopDomain } from "../lib/provisionOrg.server";
import { logSyncEvent } from "../lib/syncLog.server";

/**
 * Mandatory GDPR compliance webhook: `customers/redact`.
 *
 * Shopify sends this 48h after a store customer requests redaction. This app's
 * business data (marketplace orders in the shared Supabase backend) is not keyed
 * to Shopify customer ids, so there is no customer-scoped row to delete here. We
 * HMAC-authenticate the request, record the redaction request in the `sync_logs`
 * audit trail best-effort, and acknowledge with 200.
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
    eventType: "customers/redact",
    status: "ok",
    message: `GDPR customer redaction request received for ${shop}`,
    payload: {
      shop_domain: payload?.shop_domain ?? shop,
      customer_id: customer.id ?? null,
    },
  });

  return new Response();
};
