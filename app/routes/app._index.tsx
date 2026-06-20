import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { provisionOrg } from "../lib/provisionOrg.server";
import { orgScoped } from "../lib/orgScopedClient.server";
import { logSyncEvent } from "../lib/syncLog.server";

/**
 * Channels (home) page for ecom-integrator.
 *
 * Reads the merchant's connected marketplaces from the shared Supabase
 * `channels` table, scoped to this shop's tenant org. The org is resolved from
 * the authenticated shop domain via `provisionOrg` (idempotent — it returns the
 * existing org id created at install time), then queried through the
 * `orgScoped` helper so the service-role client stays tenant-isolated.
 *
 * The "Connect marketplace" form posts to this route's `action` with
 * `intent=connect`, which inserts an org-scoped `channels` row (status
 * `connected`) for the chosen platform. The insert is idempotent per
 * platform+org: a channel that already exists is left untouched rather than
 * duplicated.
 *
 * Each connected channel also has a "Sync now" button that posts
 * `intent=sync` with the channel id; the action records a manual sync run in
 * the shared `sync_logs` audit table (source `manual`, event `sync`, status
 * `ok`, scoped to the org and channel) and surfaces the result in a banner.
 */

// Columns of the Supabase `public.channels` table (multi-tenant by org_id).
const CHANNELS_COLUMNS = "id, platform, name, status, created_at";

/**
 * Marketplaces a merchant can connect from this UI. Each `value` MUST match the
 * `public.channels.platform` CHECK constraint
 * (`'amazon' | 'flipkart' | 'meesho' | 'myntra' | ...`); `label` is the display
 * name also stored in `channels.name`.
 */
const CONNECTABLE_PLATFORMS = [
  { value: "amazon", label: "Amazon" },
  { value: "flipkart", label: "Flipkart" },
  { value: "meesho", label: "Meesho" },
  { value: "myntra", label: "Myntra" },
] as const;

type PlatformValue = (typeof CONNECTABLE_PLATFORMS)[number]["value"];

const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  CONNECTABLE_PLATFORMS.map((p) => [p.value, p.label]),
);

function isConnectablePlatform(value: string): value is PlatformValue {
  return CONNECTABLE_PLATFORMS.some((p) => p.value === value);
}

interface Channel {
  id: string;
  platform: string;
  name: string;
  status: string;
  created_at: string;
}

interface ActionResult {
  ok: boolean;
  message: string;
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

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const orgId = await provisionOrg(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "connect");

  if (intent === "sync") {
    return syncChannel(orgId, String(formData.get("channelId") ?? ""));
  }

  return connectChannel(orgId, String(formData.get("platform") ?? ""));
};

/**
 * Records a manual sync run for one channel in `sync_logs` (source `manual`,
 * event `sync`, status `ok`), scoped to the org and channel. This is the
 * user-triggered counterpart to the scheduled connectors that will later write
 * the same audit table.
 */
async function syncChannel(
  orgId: string,
  channelId: string,
): Promise<ActionResult> {
  if (!channelId) {
    return { ok: false, message: "Select a channel to sync." };
  }

  // Confirm the channel belongs to this tenant before logging against it.
  const { data: channel, error: lookupError } = await orgScoped(orgId)
    .select("channels", "id, name")
    .eq("id", channelId)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      message: `Could not start sync: ${lookupError.message}`,
    };
  }

  if (!channel) {
    return { ok: false, message: "That channel was not found." };
  }

  const channelName = (channel as { name?: string }).name ?? "channel";

  await logSyncEvent({
    orgId,
    channelId,
    source: "manual",
    eventType: "sync",
    status: "ok",
    message: `Manual sync triggered for ${channelName}`,
  });

  return { ok: true, message: `Sync started for ${channelName}.` };
}

/**
 * Connects a marketplace by inserting an org-scoped `channels` row (idempotent
 * per platform+org).
 */
async function connectChannel(
  orgId: string,
  platform: string,
): Promise<ActionResult> {
  if (!isConnectablePlatform(platform)) {
    return { ok: false, message: "Select a marketplace to connect." };
  }

  const db = orgScoped(orgId);
  const label = PLATFORM_LABELS[platform];

  // Idempotency: a marketplace is connected once per org. If a channel for this
  // platform already exists for the tenant, do nothing rather than duplicate.
  const { data: existing, error: lookupError } = await db
    .select("channels", "id")
    .eq("platform", platform)
    .limit(1);

  if (lookupError) {
    return {
      ok: false,
      message: `Could not check existing channels: ${lookupError.message}`,
    };
  }

  if (existing && existing.length > 0) {
    return { ok: true, message: `${label} is already connected.` };
  }

  // `id`, `config`, and `created_at` use database defaults; `org_id` is stamped
  // by `orgScoped`. Insert with status `connected`.
  const { error: insertError } = await db.insert("channels", {
    platform,
    name: label,
    status: "connected",
  });

  if (insertError) {
    return {
      ok: false,
      message: `Failed to connect ${label}: ${insertError.message}`,
    };
  }

  return { ok: true, message: `Connected ${label}.` };
}

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
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isPosting =
    navigation.state === "submitting" &&
    navigation.formMethod?.toLowerCase() === "post";
  const submittedIntent = navigation.formData?.get("intent");
  // Connect form is busy only while a connect (not a sync) post is in flight.
  const isConnecting = isPosting && submittedIntent !== "sync";
  // Track which channel, if any, is currently being synced for per-row spinners.
  const syncingChannelId =
    isPosting && submittedIntent === "sync"
      ? String(navigation.formData?.get("channelId") ?? "")
      : null;

  return (
    <s-page heading="Channels">
      <s-section heading="Connect a marketplace">
        {actionData ? (
          <s-banner
            tone={actionData.ok ? "success" : "critical"}
            heading={actionData.message}
          />
        ) : null}
        <Form method="post">
          <input type="hidden" name="intent" value="connect" />
          <s-stack direction="block" gap="base">
            <s-select
              name="platform"
              label="Marketplace"
              placeholder="Select a marketplace"
              required
            >
              {CONNECTABLE_PLATFORMS.map((platform) => (
                <s-option key={platform.value} value={platform.value}>
                  {platform.label}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary" loading={isConnecting}>
              Connect marketplace
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading={`Connected marketplaces (${channels.length})`}>
        {channels.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No marketplaces connected yet.</s-paragraph>
            <s-paragraph>
              <s-text tone="neutral">
                ecom-integrator connects your store to external marketplaces
                (Amazon, Flipkart, and more) to sync orders, inventory, and
                analytics. Connect a marketplace above to start syncing —
                connectors are stored in the shared backend.
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
              <s-table-header>Actions</s-table-header>
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
                  <s-table-cell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="sync" />
                      <input type="hidden" name="channelId" value={channel.id} />
                      <s-button
                        type="submit"
                        variant="secondary"
                        loading={syncingChannelId === channel.id}
                      >
                        Sync now
                      </s-button>
                    </Form>
                  </s-table-cell>
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
