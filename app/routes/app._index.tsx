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

/**
 * Channels (home) page for ecom-integrator.
 *
 * Reads the merchant's connected marketplaces from the shared Supabase
 * `channels` table, scoped to this shop's tenant org. The org is resolved from
 * the authenticated shop domain via `provisionOrg` (idempotent — it returns the
 * existing org id created at install time), then queried through the
 * `orgScoped` helper so the service-role client stays tenant-isolated.
 *
 * The "Connect marketplace" form posts to this route's `action`, which inserts
 * an org-scoped `channels` row (status `connected`) for the chosen platform.
 * The insert is idempotent per platform+org: a channel that already exists is
 * left untouched rather than duplicated.
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
  const platform = String(formData.get("platform") ?? "");

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
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formMethod?.toLowerCase() === "post";

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
            <s-button type="submit" variant="primary" loading={isSubmitting}>
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
