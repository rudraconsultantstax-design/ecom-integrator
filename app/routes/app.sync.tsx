import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { provisionOrg } from "../lib/provisionOrg.server";
import { orgScoped } from "../lib/orgScopedClient.server";

/**
 * Sync logs page for ecom-integrator.
 *
 * Reads the most recent rows from the shared Supabase `sync_logs` table, scoped
 * to this shop's tenant org, and renders them as an audit trail of marketplace
 * sync runs. The org is resolved from the authenticated shop domain via
 * `provisionOrg` (idempotent — returns the org id created at install time), then
 * queried through the `orgScoped` helper so the service-role client stays
 * tenant-isolated.
 */

// Columns of the Supabase `public.sync_logs` table (multi-tenant by org_id).
const SYNC_LOGS_COLUMNS =
  "id, source, event_type, status, message, created_at";

// Cap on the number of recent log rows fetched/rendered.
const RECENT_LIMIT = 50;

interface SyncLog {
  id: number;
  source: string | null;
  event_type: string | null;
  status: string;
  message: string | null;
  created_at: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Resolve (or lazily create) the tenant org for this shop, then read its most
  // recent sync logs. Both go through server-only Supabase modules.
  const orgId = await provisionOrg(session.shop);
  const { data, error } = await orgScoped(orgId)
    .select("sync_logs", SYNC_LOGS_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    throw new Response(`Failed to load sync logs: ${error.message}`, {
      status: 500,
    });
  }

  // `orgScoped` rows are loosely typed (generated Supabase types are not wired
  // in yet); narrow to the shape this page renders.
  const logs = (data ?? []) as unknown as SyncLog[];

  return { logs };
};

const STATUS_TONE: Record<string, "success" | "critical" | "warning"> = {
  ok: "success",
  error: "critical",
  skipped: "warning",
};

function statusTone(status: string): "success" | "critical" | "warning" | undefined {
  return STATUS_TONE[status?.toLowerCase()];
}

function formatStatus(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

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

export default function SyncLogsPage() {
  const { logs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Sync activity">
      <s-section heading={`Recent sync runs (${logs.length})`}>
        {logs.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No sync runs yet.</s-paragraph>
            <s-paragraph>
              <s-text tone="neutral">
                Once marketplaces are connected on the{" "}
                <s-link href="/app">Channels</s-link> page, each sync run (orders,
                inventory, analytics) is recorded in the shared backend and the
                audit trail appears here.
              </s-text>
            </s-paragraph>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>When</s-table-header>
              <s-table-header>Source</s-table-header>
              <s-table-header>Event</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Message</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {logs.map((log) => (
                <s-table-row key={log.id}>
                  <s-table-cell>{formatDateTime(log.created_at)}</s-table-cell>
                  <s-table-cell>{log.source ?? "—"}</s-table-cell>
                  <s-table-cell>{log.event_type ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(log.status)}>
                      {formatStatus(log.status)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{log.message ?? "—"}</s-table-cell>
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
