import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { provisionOrg } from "../lib/provisionOrg.server";
import { orgScoped } from "../lib/orgScopedClient.server";

/**
 * Channels (home) page for ecom-integrator.
 *
 * Reads the merchant's connected marketplaces from the shared Supabase
 * `channels` table, scoped to this shop's tenant org. The org is resolved from
 * the authenticated shop domain via `provisionOrg` (idempotent — it returns the
 * existing org id created at install time), then queried through the
 * `orgScoped` helper so the service-role client stays tenant-isolated.
 */

// Columns of the Supabase `public.channels` table (multi-tenant by org_id).
const CHANNELS_COLUMNS = "id, platform, name, status, created_at";

interface Channel {
  id: string;
  platform: string;
  name: string;
  status: string;
  created_at: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Resolve (or lazily create) the tenant org for this shop, then read its
  // connected channels. Both go through server-only Supabase modules.
  const orgId = await provisionOrg(session.shop);
  const { data, error } = await orgScoped(orgId)
    .select("channels", CHANNELS_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Response(`Failed to load channels: ${error.message}`, {
      status: 500,
    });
  }

  // `orgScoped` rows are loosely typed (generated Supabase types are not wired
  // in yet); narrow to the shape this page renders.
  const channels = (data ?? []) as unknown as Channel[];

  return { channels };
};

function formatStatus(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ChannelsDashboard() {
  const { channels } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Channels">
      <s-section heading={`Connected marketplaces (${channels.length})`}>
        {channels.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No marketplaces connected yet.</s-paragraph>
            <s-paragraph>
              <s-text tone="neutral">
                ecom-integrator connects your store to external marketplaces
                (Amazon, Flipkart, and more) to sync orders, inventory, and
                analytics. Connect a marketplace to start syncing — connectors
                are configured here and stored in the shared backend.
              </s-text>
            </s-paragraph>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Channel</s-table-header>
              <s-table-header>Platform</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Connected</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {channels.map((channel) => (
                <s-table-row key={channel.id}>
                  <s-table-cell>{channel.name}</s-table-cell>
                  <s-table-cell>{channel.platform}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{formatStatus(channel.status)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDate(channel.created_at)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so their headers
// are included in the response.
export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
