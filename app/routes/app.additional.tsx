export default function SyncActivityPage() {
  return (
    <s-page heading="Sync activity">
      <s-section heading="Marketplace sync">
        <s-paragraph>
          ecom-integrator keeps your Shopify store and connected marketplaces in
          sync — orders, inventory, and analytics flow through the shared
          backend. Once connectors are configured on the{" "}
          <s-link href="/app">Channels</s-link> page, the audit trail of each
          sync run (from the <code>sync_logs</code> table) will appear here.
        </s-paragraph>
        <s-paragraph>
          <s-text tone="neutral">
            No sync runs yet. Connect a marketplace to start syncing.
          </s-text>
        </s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              App nav best practices
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
