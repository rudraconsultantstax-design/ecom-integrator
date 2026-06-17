import { supabase } from "../supabase.server";
import type { OrgId } from "./orgScopedClient.server";

/**
 * Best-effort writer for the shared Supabase `public.sync_logs` audit table.
 *
 * `sync_logs` columns (introspected from project `mhlyicynbznlvbinvqna`):
 *   - id          bigint, IDENTITY (auto — never inserted)
 *   - org_id      uuid, nullable, FK orgs(id) ON DELETE CASCADE
 *   - channel_id  uuid, nullable, FK channels(id) ON DELETE SET NULL
 *   - source      text, nullable
 *   - event_type  text, nullable
 *   - status      text, NOT NULL, CHECK in ('ok','error','skipped'), default 'ok'
 *   - message     text, nullable
 *   - payload     jsonb, nullable
 *   - created_at  timestamptz, NOT NULL, default now()
 *
 * This is intentionally "best effort": logging is observability, never the
 * thing the caller actually has to succeed at (e.g. a GDPR compliance webhook
 * must still return 200 even if the audit insert fails). Errors are swallowed
 * after being logged to the server console; the function never throws.
 *
 * It writes through the raw service-role client (not `orgScoped`) because
 * `org_id` is nullable here — a mandatory compliance webhook can fire for a
 * shop that has already uninstalled and no longer has a tenant row.
 *
 * Server-only: imports the service-role client.
 */
export type SyncLogStatus = "ok" | "error" | "skipped";

export interface SyncLogEntry {
  /** Tenant org, when known. `null` for shops with no provisioned org. */
  orgId?: OrgId | null;
  /** Channel this event relates to, when applicable. */
  channelId?: string | null;
  /** Logical origin of the event, e.g. 'manual', 'shopify-webhook'. */
  source: string;
  /** Event name, e.g. 'sync', 'customers/redact'. */
  eventType: string;
  /** Outcome; defaults to 'ok'. */
  status?: SyncLogStatus;
  /** Human-readable summary. */
  message?: string;
  /** Structured context stored in the `payload` jsonb column. */
  payload?: Record<string, unknown>;
}

export async function logSyncEvent(entry: SyncLogEntry): Promise<void> {
  try {
    const { error } = await supabase.from("sync_logs").insert({
      org_id: entry.orgId ?? null,
      channel_id: entry.channelId ?? null,
      source: entry.source,
      event_type: entry.eventType,
      status: entry.status ?? "ok",
      message: entry.message ?? null,
      payload: entry.payload ?? null,
    });

    if (error) {
      console.error(
        `logSyncEvent: failed to write sync_logs row (${entry.source}/${entry.eventType}): ${error.message}`,
      );
    }
  } catch (err) {
    // Never let observability take down the caller.
    console.error("logSyncEvent: unexpected error writing sync_logs", err);
  }
}
