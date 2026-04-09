import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'MCP Server Card — AurelianFlo',
  description: 'Connect Claude and other MCP clients to AurelianFlo. 9 tools, 4 prompts, x402 payment on Base.',
};

const mcpTools = [
  { name: 'server_capabilities', desc: 'List all available tools, prompts, and server metadata.' },
  { name: 'ofac_wallet_screen', desc: 'Screen a single wallet address against OFAC SDN and sanctions lists.' },
  { name: 'batch_wallet_screen', desc: 'Screen up to 100 addresses simultaneously.' },
  { name: 'ofac_wallet_report', desc: 'Full sanctions report with structured compliance payload.' },
  { name: 'edd_report', desc: 'Generate a full Enhanced Due Diligence memo.' },
  { name: 'monte_carlo_report', desc: 'Run a Monte Carlo simulation and return a structured report.' },
  { name: 'monte_carlo_decision_report', desc: 'Simulation-backed decision memo with scenario analysis.' },
  { name: 'report_pdf_generate', desc: 'Render a styled PDF from structured content.' },
  { name: 'report_docx_generate', desc: 'Generate an editable DOCX memo.' },
] as const;

const mcpPrompts = [
  { name: 'screen_wallet', desc: 'Prompt template: screen a given wallet address and summarize findings.' },
  { name: 'edd_workflow', desc: 'Prompt template: run full EDD workflow for a named entity.' },
  { name: 'batch_screen', desc: 'Prompt template: batch screen a list of addresses and flag any hits.' },
  { name: 'generate_report', desc: 'Prompt template: produce a formatted compliance report from provided data.' },
] as const;

const assets = ['ETH', 'USDC', 'XBT', 'TRX', 'ARB', 'BSC'] as const;

const claudeConfig = `{
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

export default function ServerCardPage() {
  return (
    <>
      <Nav cta={{ label: 'Raw JSON ↗', href: '/.well-known/mcp/server-card.json' }} />
      <main className="inner-page">
        <header className="page-header">
          <div className="page-header-top">
            <span className="page-header-badge">MCP Server</span>
            <span className="page-header-badge" style={{ background: 'rgba(245,240,232,0.06)', color: 'var(--muted)', borderColor: 'var(--border)' }}>v0.1.1</span>
          </div>
          <h1 className="page-header-title">Server Card</h1>
          <p className="page-header-desc">Connect Claude Desktop or any MCP-compatible client to AurelianFlo. 9 tools and 4 prompts, with x402 payment handled automatically per call.</p>
          <div className="page-header-links">
            <a href="/.well-known/mcp/server-card.json" className="page-link">Raw JSON ↗</a>
            <a href="/docs" className="page-link">Integration Guide →</a>
            <a href="/services" className="page-link">Service Catalog →</a>
          </div>
        </header>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Connection</span>
          </div>
          <div className="callout-row">
            <div className="callout-cell"><div className="callout-label">Endpoint</div><div className="callout-value">https://api.aurelianflo.com/mcp</div></div>
            <div className="callout-cell"><div className="callout-label">Protocol</div><div className="callout-value">Streamable HTTP (MCP)</div></div>
            <div className="callout-cell"><div className="callout-label">Auth</div><div className="callout-value">None required</div></div>
            <div className="callout-cell"><div className="callout-label">Payment</div><div className="callout-value">x402 — USDC on Base</div></div>
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Claude Desktop Config</span>
          </div>
          <pre className="code-block">{claudeConfig}</pre>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Tools</span>
            <span className="catalog-group-count">9 tools</span>
          </div>
          <div className="catalog-rows">
            {mcpTools.map((tool) => (
              <div className="catalog-row" key={tool.name}>
                <div className="catalog-row-left">
                  <span className="method-badge method-mcp">MCP</span>
                  <span className="catalog-path">{tool.name}</span>
                </div>
                <div className="catalog-row-right">
                  <span className="catalog-desc">{tool.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Prompts</span>
            <span className="catalog-group-count">4 prompts</span>
          </div>
          <div className="catalog-rows">
            {mcpPrompts.map((prompt) => (
              <div className="catalog-row" key={prompt.name}>
                <div className="catalog-row-left">
                  <span className="method-badge method-mcp">PROMPT</span>
                  <span className="catalog-path">{prompt.name}</span>
                </div>
                <div className="catalog-row-right">
                  <span className="catalog-desc">{prompt.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Supported Assets</span>
          </div>
          <div className="asset-chips">
            {assets.map((a) => (
              <span className="asset-chip" key={a}>{a}</span>
            ))}
          </div>
        </div>

        <footer className="inner-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/services" className="footer-link">Services</a>
            <a href="/openapi" className="footer-link">OpenAPI</a>
            <a href="/docs" className="footer-link">Docs</a>
          </div>
        </footer>
      </main>
    </>
  );
}
