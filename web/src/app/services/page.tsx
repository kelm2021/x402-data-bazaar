import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Service Catalog — AurelianFlo',
  description: 'All AurelianFlo endpoints with pricing, schemas, and integration links. OFAC screening, EDD memos, report generation, and MCP tools.',
};

const complianceEndpoints = [
  { method: 'GET', path: '/api/ofac-wallet-screen/:address', price: '$0.01', desc: 'Single wallet OFAC SDN screening', slug: 'wallet-screening' },
  { method: 'POST', path: '/api/workflows/compliance/wallet-sanctions-report', price: '$0.04', desc: 'Wallet check with report-ready compliance payload', slug: 'wallet-screening' },
  { method: 'POST', path: '/api/workflows/compliance/batch-wallet-screen', price: '$0.10', desc: 'Batch screen up to 100 addresses simultaneously', slug: 'wallet-screening' },
  { method: 'POST', path: '/api/workflows/compliance/edd-report', price: '$0.25', desc: 'Full Enhanced Due Diligence memo with JSON, PDF, or DOCX', slug: 'edd-memo' },
] as const;

const documentEndpoints = [
  { method: 'POST', path: '/api/tools/report/generate', price: '$0.05', desc: 'PDF report from structured content', slug: 'report-generation' },
  { method: 'POST', path: '/api/tools/report/pdf/generate', price: '$0.05', desc: 'Styled PDF with metrics and formatted sections', slug: 'report-generation' },
  { method: 'POST', path: '/api/tools/report/docx/generate', price: '$0.06', desc: 'Editable DOCX memo output', slug: 'report-generation' },
  { method: 'POST', path: '/api/tools/report/xlsx/generate', price: '$0.07', desc: 'XLSX workbook with tabular data and row export', slug: 'report-generation' },
] as const;

const mcpTools = [
  { name: 'server_capabilities', price: 'Free' },
  { name: 'ofac_wallet_screen', price: '$0.01' },
  { name: 'batch_wallet_screen', price: '$0.10' },
  { name: 'ofac_wallet_report', price: '$0.04' },
  { name: 'edd_report', price: '$0.25' },
  { name: 'monte_carlo_report', price: 'Varies' },
  { name: 'monte_carlo_decision_report', price: 'Varies' },
  { name: 'report_pdf_generate', price: '$0.05' },
  { name: 'report_docx_generate', price: '$0.06' },
] as const;

export default function ServicesPage() {
  return (
    <>
      <Nav active="services" cta={{ label: 'OpenAPI Schema', href: '/openapi' }} />
      <main className="inner-page">
        <header className="page-header">
          <div className="page-header-top">
            <span className="page-header-badge">REST API</span>
          </div>
          <h1 className="page-header-title">Service Catalog</h1>
          <p className="page-header-desc">All endpoints accept USDC payment via the x402 protocol. No API keys required.</p>
          <div className="page-header-links">
            <a href="/openapi" className="page-link">OpenAPI Reference →</a>
            <a href="/docs" className="page-link">Integration Guide →</a>
            <a href="/server-card" className="page-link">MCP Server Card →</a>
          </div>
        </header>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Compliance &amp; Screening</span>
            <span className="catalog-group-count">4 endpoints</span>
          </div>
          <div className="catalog-rows">
            {complianceEndpoints.map((ep) => (
              <div className="catalog-row" key={ep.path}>
                <div className="catalog-row-left">
                  <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                  <span className="catalog-path">{ep.path}</span>
                </div>
                <div className="catalog-row-right">
                  <span className="price-badge">{ep.price}</span>
                  <span className="catalog-desc">{ep.desc}</span>
                  <a href={`/services/${ep.slug}`} className="catalog-link">Details →</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Document Generation</span>
            <span className="catalog-group-count">4 endpoints</span>
          </div>
          <div className="catalog-rows">
            {documentEndpoints.map((ep) => (
              <div className="catalog-row" key={ep.path}>
                <div className="catalog-row-left">
                  <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                  <span className="catalog-path">{ep.path}</span>
                </div>
                <div className="catalog-row-right">
                  <span className="price-badge">{ep.price}</span>
                  <span className="catalog-desc">{ep.desc}</span>
                  <a href={`/services/${ep.slug}`} className="catalog-link">Details →</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">MCP Tools</span>
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
                  <span className="price-badge">{tool.price}</span>
                  <a href="/server-card" className="catalog-link">Server Card →</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="inner-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/openapi" className="footer-link">OpenAPI Reference</a>
            <a href="/server-card" className="footer-link">Server Card</a>
          </div>
        </footer>
      </main>
    </>
  );
}
