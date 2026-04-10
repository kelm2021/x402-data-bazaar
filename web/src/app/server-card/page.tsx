import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'MCP Server Card - AurelianFlo',
  description:
    'Connect AurelianFlo to Claude via Connectors, or to any MCP-compatible client using the MCP endpoint. 9 tools and 4 prompts, with x402 payment handled automatically per call.',
};

const mcpTools = [
  {
    name: 'server_capabilities',
    desc: 'Free capability and connection check for AurelianFlo, including direct and Smithery-hosted access modes and which tools require x402 payment.',
  },
  {
    name: 'ofac_wallet_report',
    desc: 'Run exact-match OFAC wallet screening and return either the structured screening payload or a PDF or DOCX artifact.',
  },
  {
    name: 'ofac_wallet_screen',
    desc: 'Screen a wallet address against OFAC SDN digital currency address designations, returning exact hits, sanctioned entity metadata, asset coverage, and a manual-review signal.',
  },
  {
    name: 'batch_wallet_screen',
    desc: 'Screen a batch of wallet addresses against OFAC SDN digital currency address designations, returning per-wallet results plus a batch-level proceed-or-pause decision and structured output.',
  },
  {
    name: 'edd_report',
    desc: 'Generate an enhanced due diligence memo for a wallet set using exact-match OFAC screening, evidence summary, required follow-up, and JSON, PDF, or DOCX output.',
  },
  {
    name: 'monte_carlo_report',
    desc: 'Run a supported Monte Carlo workflow and return either the structured report payload or a PDF or DOCX artifact.',
  },
  {
    name: 'monte_carlo_decision_report',
    desc: 'Generate a structured decision report from any supported Monte Carlo workflow, including executive summary, headline metrics, and spreadsheet-friendly tables.',
  },
  {
    name: 'report_pdf_generate',
    desc: 'Generate a PDF artifact from structured report tables, metrics, and summary content.',
  },
  {
    name: 'report_docx_generate',
    desc: 'Generate a DOCX artifact from structured report tables, metrics, and summary content.',
  },
] as const;

const mcpPrompts = [
  {
    name: 'batch_wallet_screening_brief',
    title: 'Batch Wallet Screening Brief',
    desc: 'Prepare a batch wallet OFAC screening request and response brief.',
  },
  {
    name: 'wallet_ofac_screening_brief',
    title: 'Wallet OFAC Screening Brief',
    desc: 'Prepare a wallet-address OFAC screening request and response brief.',
  },
  {
    name: 'decision_report_brief',
    title: 'Decision Report Brief',
    desc: 'Prepare a Monte Carlo decision report request.',
  },
  {
    name: 'report_artifact_brief',
    title: 'Report Artifact Brief',
    desc: 'Prepare a PDF or DOCX report rendering request.',
  },
] as const;

const assets = ['ETH', 'USDC', 'XBT', 'TRX', 'ARB', 'BSC'] as const;

const claudeServerUrl = 'https://api.aurelianflo.com/mcp';

const genericMcpClientJson = `{
  "mcpServers": {
    "aurelianflo": {
      "type": "http",
      "url": "https://api.aurelianflo.com/mcp"
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
            <span
              className="page-header-badge"
              style={{ background: 'rgba(245,240,232,0.06)', color: 'var(--muted)', borderColor: 'var(--border)' }}
            >
              v0.1.2
            </span>
          </div>
          <h1 className="page-header-title">Server Card</h1>
          <p className="page-header-desc">
            Connect AurelianFlo to Claude via Connectors, or to any MCP-compatible client using the MCP endpoint. 9
            tools and 4 prompts, with x402 payment handled automatically per call.
          </p>
          <div className="page-header-links">
            <a href="/.well-known/mcp/server-card.json" className="page-link">
              Raw JSON ↗
            </a>
            <a href="/docs" className="page-link">
              Integration Guide →
            </a>
            <a href="/services" className="page-link">
              Service Catalog →
            </a>
          </div>
        </header>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Connection</span>
          </div>
          <div className="callout-row">
            <div className="callout-cell">
              <div className="callout-label">Endpoint</div>
              <div className="callout-value">{claudeServerUrl}</div>
            </div>
            <div className="callout-cell">
              <div className="callout-label">Protocol</div>
              <div className="callout-value">Streamable HTTP (MCP)</div>
            </div>
            <div className="callout-cell">
              <div className="callout-label">User auth</div>
              <div className="callout-value">None</div>
            </div>
            <div className="callout-cell">
              <div className="callout-label">Payment</div>
              <div className="callout-value">x402 - USDC on Base</div>
            </div>
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Claude Setup</span>
          </div>
          <p className="docs-body" style={{ marginBottom: '16px' }}>
            Add AurelianFlo in Claude via Customize &gt; Connectors using this server URL:
          </p>
          <pre className="code-block">{claudeServerUrl}</pre>
          <p className="docs-body">
            Claude Desktop does not use <span className="inline-code">claude_desktop_config.json</span> for remote MCP
            servers.
          </p>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Generic MCP Client JSON</span>
          </div>
          <pre className="code-block">{genericMcpClientJson}</pre>
          <p className="docs-body">
            Use this JSON only for MCP clients that support remote HTTP server config directly; it is not the setup
            method for Claude Desktop.
          </p>
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
                <div className="catalog-row-right" style={{ display: 'grid', gap: '4px', justifyItems: 'start' }}>
                  <span className="catalog-desc">{prompt.title}</span>
                  <span className="catalog-desc" style={{ opacity: 0.82 }}>
                    {prompt.desc}
                  </span>
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
            {assets.map((asset) => (
              <span className="asset-chip" key={asset}>
                {asset}
              </span>
            ))}
          </div>
        </div>

        <footer className="inner-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/services" className="footer-link">
              Services
            </a>
            <a href="/openapi" className="footer-link">
              OpenAPI
            </a>
            <a href="/docs" className="footer-link">
              Docs
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}
