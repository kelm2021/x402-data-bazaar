import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Integration Guide — AurelianFlo',
  description: 'How to integrate AurelianFlo APIs: x402 payment flow, curl examples, MCP setup, and reference links.',
};

const restQuickStart = `import { fetch402 } from 'x402-fetch';

const response = await fetch402(
  'https://api.aurelianflo.com/api/ofac-wallet-screen/0xAbC123...',
  {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  },
  {
    walletClient,  // viem WalletClient on Base
  }
);

const result = await response.json();
console.log(result.sanctioned, result.matches);`;

const mcpConfig = `{
  "mcpServers": {
    "aurelianflo": {
      "type": "http",
      "url": "https://api.aurelianflo.com/mcp",
      "payment": {
        "protocol": "x402",
        "network": "eip155:8453",
        "asset": "USDC"
      }
    }
  }
}`;

export default function DocsPage() {
  return (
    <>
      <Nav active="docs" />
      <main className="inner-page">
        <header className="page-header">
          <div className="page-header-top">
            <span className="page-header-badge">Docs</span>
          </div>
          <h1 className="page-header-title">Integration Guide</h1>
          <p className="page-header-desc">Connect to AurelianFlo APIs via REST or MCP. All calls settle in USDC on Base using the x402 payment protocol — no API keys, no subscriptions.</p>
          <div className="page-header-links">
            <a href="/openapi" className="page-link">OpenAPI Reference →</a>
            <a href="/server-card" className="page-link">MCP Server Card →</a>
            <a href="/services" className="page-link">Service Catalog →</a>
          </div>
        </header>

        <div className="docs-section">
          <div className="docs-section-title">How x402 works</div>
          <div className="flow-steps">
            <div className="flow-step">
              <div className="flow-num">1</div>
              <div>
                <strong>Client sends request</strong>
                <span>Your app (or Claude) calls the endpoint normally — no auth header needed.</span>
              </div>
            </div>
            <div className="flow-step">
              <div className="flow-num">2</div>
              <div>
                <strong>Server responds 402 Payment Required</strong>
                <span>The response includes a payment descriptor: amount, asset (USDC), network (Base), and recipient address.</span>
              </div>
            </div>
            <div className="flow-step">
              <div className="flow-num">3</div>
              <div>
                <strong>Client settles on-chain</strong>
                <span>The x402 client library signs and submits a USDC transfer on Base (eip155:8453) to <span className="inline-code">0x348Df429BD49A7506128c74CE1124A81B4B7dC9d</span>.</span>
              </div>
            </div>
            <div className="flow-step">
              <div className="flow-num">4</div>
              <div>
                <strong>Server verifies &amp; responds</strong>
                <span>Once payment is confirmed, the server executes the request and returns the result. The whole flow completes in one HTTP round-trip for the caller.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="docs-section">
          <div className="docs-section-title">Quick start — REST</div>
          <p className="docs-body" style={{ marginBottom: '16px' }}>
            Use <span className="inline-code">x402-fetch</span> (or any x402-compatible client) to handle payment automatically:
          </p>
          <pre className="code-block">{restQuickStart}</pre>
        </div>

        <div className="docs-section">
          <div className="docs-section-title">MCP setup — Claude Desktop</div>
          <p className="docs-body" style={{ marginBottom: '16px' }}>
            Add this to your <span className="inline-code">claude_desktop_config.json</span> to connect Claude to all 9 AurelianFlo tools:
          </p>
          <pre className="code-block">{mcpConfig}</pre>
        </div>

        <div className="docs-section">
          <div className="docs-section-title">Authentication</div>
          <p className="docs-body">
            No API keys. No accounts. Payment is authentication. Every paid call settles USDC directly to the recipient address on Base:<br />
            <span className="inline-code">0x348Df429BD49A7506128c74CE1124A81B4B7dC9d</span>
          </p>
        </div>

        <div className="docs-section">
          <div className="docs-section-title">Reference</div>
          <div className="ref-grid">
            <a href="/openapi" className="ref-card">
              <span className="ref-badge">JSON</span>
              <div className="ref-name">OpenAPI Reference</div>
              <p className="ref-desc">Full spec with parameters, request/response schemas, and pricing per endpoint.</p>
            </a>
            <a href="/server-card" className="ref-card">
              <span className="ref-badge">MCP</span>
              <div className="ref-name">MCP Server Card</div>
              <p className="ref-desc">9 tools, 4 prompts, and connection instructions for Claude and other MCP clients.</p>
            </a>
            <a href="/services" className="ref-card">
              <span className="ref-badge">REST</span>
              <div className="ref-name">Service Catalog</div>
              <p className="ref-desc">All 8 REST endpoints grouped by category with pricing and detail pages.</p>
            </a>
            <a href="/openapi.json" className="ref-card">
              <span className="ref-badge">RAW</span>
              <div className="ref-name">Raw OpenAPI JSON</div>
              <p className="ref-desc">Machine-readable OpenAPI 3.1 spec. Import directly into Postman, Insomnia, or any tool.</p>
            </a>
          </div>
        </div>

        <footer className="inner-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/services" className="footer-link">Services</a>
            <a href="/openapi" className="footer-link">OpenAPI</a>
            <a href="/server-card" className="footer-link">MCP</a>
          </div>
        </footer>
      </main>
    </>
  );
}
