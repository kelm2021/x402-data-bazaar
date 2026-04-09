import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AurelianFlo API",
  description: "Machine-readable API surface for AurelianFlo.",
};

const links = [
  { label: "Discovery JSON", href: "/api?format=json" },
  { label: "OpenAPI", href: "/openapi.json" },
  { label: "MCP Endpoint", href: "/mcp" },
  { label: "Server Card", href: "/.well-known/mcp/server-card.json" },
];

export default function ApiHomePage() {
  return (
    <main className="api-shell">
      <span className="api-eyebrow">AurelianFlo API</span>
      <h1 className="api-title">Machine-readable API surface.</h1>
      <p className="api-copy">
        This host serves discovery, OpenAPI, MCP, and x402-backed endpoints. The
        product UI lives at <a href="https://aurelianflo.com">aurelianflo.com</a>.
      </p>
      <div className="api-links">
        {links.map((link) => (
          <a key={link.href} href={link.href} className="api-link">
            <span>{link.label}</span>
            <code>{link.href}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
