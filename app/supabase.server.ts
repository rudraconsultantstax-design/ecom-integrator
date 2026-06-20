import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for the business-data backend (orders, products,
 * inventory, etc.). This module is configured with the SERVICE-ROLE key, which
 * bypasses Row Level Security — it must NEVER be imported into client/browser
 * code. The `.server.ts` suffix enforces this: React Router will throw a build
 * error if any client module imports it.
 *
 * RLS hardening is intentionally deferred (see docs/PROJECT_ARCHITECTURE.md
 * §3). Because the service role bypasses RLS, tenant isolation is enforced in
 * application code via `app/lib/orgScopedClient.server.ts` — always go through
 * that helper for per-tenant tables instead of querying `supabase` directly.
 */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase configuration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. See .env.example.",
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      // This is a server process acting with the service role; no user session
      // to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

export default supabase;
