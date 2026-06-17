import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { provisionOrg } from "../lib/provisionOrg.server";
import { orgScoped } from "../lib/orgScopedClient.server";

/**
 * Analytics page for ecom-integrator.
 *
 * Read-only overview of the tenant's marketplace footprint, sourced entirely
 * from the shared Supabase backend (scoped to this shop's org via `orgScoped`):
 *   - channels connected (vs. total configured)
 *   - orders synced, broken down per channel
 *   - recent sync activity (total runs + last run time)
 *
 * Everything is computed from org-scoped reads and aggregated in-process — the
 * page never mutates data. Each section degrades to an empty state when there
 * is nothing to show yet.
 */

// Column projections kept narrow: only what the aggregates below need.
const CHANNELS_COLUMNS = "id, name, platform, status";
const ORDERS_COLUMNS = "id, channel_id, total";
const SYNC_LOGS_COLUMNS = "id, status, created_at";

// Cap on sync_logs rows pulled to summarise recent activity.
const SYNC_SAMPLE_LIMIT = 100;

interface ChannelRow {
  id: string;
  name: string | null;
  platform: string | null;
  status: string | null;
}

interface OrderRow {
  id: string;
  channel_id: string | null;
  total: number | string | null;
}

interface SyncLogRow {
  id: number;
  status: string | null;
  created_at: string;
}

interface ChannelOrderStat {
  channelId: string;
  name: string;
  orderCount: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const orgId = await provisionOrg(session.shop);
  const db = orgScoped(orgId);

  // Pull the three datasets in parallel; all are org-scoped reads.
  const [channelsRes, ordersRes, syncRes] = await Promise.all([
    db.select("channels", CHANNELS_COLUMNS),
    db.select("orders", ORDERS_COLUMNS),
    db
      .select("sync_logs", SYNC_LOGS_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(SYNC_SAMPLE_LIMIT),
  ]);

  const firstError = channelsRes.error || ordersRes.error || syncRes.error;
  if (firstError) {
    throw new Response(`Failed to load analytics: ${firstError.message}`, {
      status: 500,
    });
  }

  // `orgScoped` rows are loosely typed until generated Supabase types are wired
  // in; narrow to the shapes this page aggregates.
  const channels = (channelsRes.data ?? []) as unknown as ChannelRow[];
  const orders = (ordersRes.data ?? []) as unknown as OrderRow[];
  const syncLogs = (syncRes.data ?? []) as unknown as SyncLogRow[];

  const connectedChannels = channels.filter(
    (c) => c.status === "connected",
  ).length;

  // Orders per channel: count by channel_id, resolve to channel display names.
  const channelNameById = new Map<string, string>(
    channels.map((c) => [c.id, c.name ?? c.platform ?? "Unknown channel"]),
  );
  const orderCountByChannel = new Map<string, number>();
  for (const order of orders) {
    if (!order.channel_id) continue;
    orderCountByChannel.set(
      order.channel_id,
      (orderCountByChannel.get(order.channel_id) ?? 0) + 1,
    );
  }
  const ordersPerChannel: ChannelOrderStat[] = Array.from(
    orderCountByChannel.entries(),
  )
    .map(([channelId, orderCount]) => ({
      channelId,
      name: channelNameById.get(channelId) ?? "Unknown channel",
      orderCount,
    }))
    .sort((a, b) => b.orderCount - a.orderCount);

  const lastSyncAt = syncLogs.length > 0 ? syncLogs[0].created_at : null;

  return {
    totalChannels: channels.length,
    connectedChannels,
    totalOrders: orders.length,
    ordersPerChannel,
    recentSyncCount: syncLogs.length,
    recentSyncSampleLimit: SYNC_SAMPLE_LIMIT,
    lastSyncAt,
  };
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KpiCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      minInlineSize="200px"
    >
      <s-stack direction="block" gap="small-200">
        <s-text tone="neutral">{label}</s-text>
        <s-heading>{String(value)}</s-heading>
        {caption ? <s-text tone="neutral">{caption}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

export default function AnalyticsPage() {
  const {
    totalChannels,
    connectedChannels,
    totalOrders,
    ordersPerChannel,
    recentSyncCount,
    recentSyncSampleLimit,
    lastSyncAt,
  } = useLoaderData<typeof loader>();

  const recentSyncCaption =
    recentSyncCount >= recentSyncSampleLimit
      ? `${recentSyncCount}+ recent runs`
      : lastSyncAt
        ? `Last run ${formatDateTime(lastSyncAt)}`
        : "No runs yet";

  return (
    <s-page heading="Analytics">
      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <KpiCard
            label="Channels connected"
            value={connectedChannels}
            caption={`of ${totalChannels} configured`}
          />
          <KpiCard
            label="Orders synced"
            value={totalOrders}
            caption="across all channels"
          />
          <KpiCard
            label="Recent sync runs"
            value={recentSyncCount}
            caption={recentSyncCaption}
          />
        </s-stack>
      </s-section>

      <s-section heading="Orders per channel">
        {ordersPerChannel.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No orders synced yet.</s-paragraph>
            <s-paragraph>
              <s-text tone="neutral">
                Once a connected marketplace syncs orders into the shared
                backend, the per-channel breakdown appears here. Connect a
                marketplace on the <s-link href="/app">Channels</s-link> page to
                get started.
              </s-text>
            </s-paragraph>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Channel</s-table-header>
              <s-table-header>Orders</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ordersPerChannel.map((stat) => (
                <s-table-row key={stat.channelId}>
                  <s-table-cell>{stat.name}</s-table-cell>
                  <s-table-cell>{stat.orderCount}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Sync activity">
        {recentSyncCount === 0 ? (
          <s-paragraph>
            <s-text tone="neutral">
              No sync runs recorded yet. Manual and scheduled syncs are logged in
              the shared backend; the full audit trail lives on the{" "}
              <s-link href="/app/sync">Sync activity</s-link> page.
            </s-text>
          </s-paragraph>
        ) : (
          <s-paragraph>
            {recentSyncCount}
            {recentSyncCount >= recentSyncSampleLimit ? "+" : ""} recent sync run
            {recentSyncCount === 1 ? "" : "s"}
            {lastSyncAt ? `, last at ${formatDateTime(lastSyncAt)}` : ""}. See the
            full trail on the <s-link href="/app/sync">Sync activity</s-link>{" "}
            page.
          </s-paragraph>
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
