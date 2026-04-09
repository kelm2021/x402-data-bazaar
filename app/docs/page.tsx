import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API Docs - AurelianFlo",
  description: "Quick links for discovery, OpenAPI, MCP, and machine-readable metadata.",
};

export default function ApiDocsPage() {
  return (
    <main className="api-shell">
      <span className="api-eyebrow">API Docs</span>
      <h1 className="api-title">AurelianFlo machine surface.</h1>
      <p className="api-copy">
        Use this host for machine-readable integration points. For the product UI and
        human-facing docs, use <a href="https://aurelianflo.com">aurelianflo.com</a>.
      </p>
      <div className="api-links">
        <a className="api-link" href="/api?format=json">
          <span>Discovery JSON</span>
          <code>/api?format=json</code>
        </a>
        <a className="api-link" href="/openapi.json">
          <span>OpenAPI JSON</span>
          <code>/openapi.json</code>
        </a>
        <a className="api-link" href="/mcp">
          <span>MCP Endpoint</span>
          <code>/mcp</code>
        </a>
        <a className="api-link" href="/.well-known/mcp/server-card.json">
          <span>Server Card</span>
          <code>/.well-known/mcp/server-card.json</code>
        </a>
      </div>
    </main>
  );
}
