import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'API Reference — AurelianFlo',
  description: 'OpenAPI 3.1 reference for all 8 AurelianFlo endpoints with request parameters, schemas, and response shapes.',
};

const complianceEndpoints = [
  {
    method: 'GET',
    path: '/api/ofac-wallet-screen/:address',
    price: '$0.01',
    summary: 'Screen a single wallet address against the OFAC SDN list and consolidated sanctions database. Returns a sanctioned boolean plus any matching entries.',
    response: '{ sanctioned: boolean, matches: Match[], address: string, checked_at: string }',
  },
  {
    method: 'POST',
    path: '/api/workflows/compliance/wallet-sanctions-report',
    price: '$0.04',
    summary: 'Full sanctions screening with a structured compliance payload suitable for audit logs and case management. Includes risk score and evidence block.',
    response: '{ sanctioned: boolean, risk_score: number, evidence: Evidence, report_ready: boolean }',
  },
  {
    method: 'POST',
    path: '/api/workflows/compliance/batch-wallet-screen',
    price: '$0.10',
    summary: 'Screen up to 100 wallet addresses in a single call. Returns a result per address with sanctioned status and any SDN matches.',
    response: '{ results: AddressResult[], total: number, flagged: number }',
  },
  {
    method: 'POST',
    path: '/api/workflows/compliance/edd-report',
    price: '$0.25',
    summary: 'Generate a full Enhanced Due Diligence memo. Accepts entity data and returns a structured memo with status labels, evidence summary, and required follow-up actions in JSON, PDF, or DOCX.',
    response: '{ status: string, memo: EddMemo, format: "json" | "pdf" | "docx", url?: string }',
  },
] as const;

const documentEndpoints = [
  {
    method: 'POST',
    path: '/api/tools/report/generate',
    price: '$0.05',
    summary: 'Generate a PDF report from structured content. Accepts a title, sections array, and optional metrics. Returns a PDF download URL.',
    response: '{ url: string, size_bytes: number, pages: number }',
  },
  {
    method: 'POST',
    path: '/api/tools/report/pdf/generate',
    price: '$0.05',
    summary: 'Styled PDF output with formatted sections, metric callouts, and AurelianFlo document design. Returns a signed download URL.',
    response: '{ url: string, expires_at: string, size_bytes: number }',
  },
  {
    method: 'POST',
    path: '/api/tools/report/docx/generate',
    price: '$0.06',
    summary: 'Editable DOCX memo output. Returns a .docx file suitable for review in Microsoft Word or Google Docs.',
    response: '{ url: string, filename: string, size_bytes: number }',
  },
  {
    method: 'POST',
    path: '/api/tools/report/xlsx/generate',
    price: '$0.07',
    summary: 'XLSX workbook with tabular data and row export. Pass an array of row objects; receive a formatted Excel workbook.',
    response: '{ url: string, filename: string, rows: number, sheets: number }',
  },
] as const;

export default function OpenApiPage() {
  return (
    <>
      <Nav cta={{ label: 'Raw JSON ↗', href: '/openapi.json' }} />
      <main className="inner-page">
        <header className="page-header">
          <div className="page-header-top">
            <span className="page-header-badge">OpenAPI 3.1</span>
            <span className="page-header-badge" style={{ background: 'rgba(245,240,232,0.06)', color: 'var(--muted)', borderColor: 'var(--border)' }}>8 endpoints</span>
          </div>
          <h1 className="page-header-title">API Reference</h1>
          <p className="page-header-desc">Full endpoint reference with parameters, request schemas, and response shapes. All endpoints use x402 USDC payment — no API keys.</p>
          <div className="page-header-links">
            <a href="/openapi.json" className="page-link">Raw JSON ↗</a>
            <a href="/docs" className="page-link">Integration Guide →</a>
            <a href="/server-card" className="page-link">MCP Server Card →</a>
          </div>
        </header>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Payment</span>
          </div>
          <div className="callout-row">
            <div className="callout-cell"><div className="callout-label">Protocol</div><div className="callout-value">x402</div></div>
            <div className="callout-cell"><div className="callout-label">Currency</div><div className="callout-value">USDC</div></div>
            <div className="callout-cell"><div className="callout-label">Network</div><div className="callout-value">Base (eip155:8453)</div></div>
            <div className="callout-cell"><div className="callout-label">Auth</div><div className="callout-value">None required</div></div>
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Compliance &amp; Screening</span>
            <span className="catalog-group-count">4 endpoints</span>
          </div>
          <div className="openapi-list">
            {complianceEndpoints.map((ep) => (
              <div className="openapi-item" key={ep.path}>
                <div className="openapi-item-head">
                  <div className="openapi-item-left">
                    <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="catalog-path">{ep.path}</span>
                  </div>
                  <span className="price-badge">{ep.price}</span>
                </div>
                <p className="openapi-summary">{ep.summary}</p>
                <div className="openapi-response">
                  <span className="openapi-response-label">200 Response</span>
                  <span className="openapi-response-value">{ep.response}</span>
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
          <div className="openapi-list">
            {documentEndpoints.map((ep) => (
              <div className="openapi-item" key={ep.path}>
                <div className="openapi-item-head">
                  <div className="openapi-item-left">
                    <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="catalog-path">{ep.path}</span>
                  </div>
                  <span className="price-badge">{ep.price}</span>
                </div>
                <p className="openapi-summary">{ep.summary}</p>
                <div className="openapi-response">
                  <span className="openapi-response-label">200 Response</span>
                  <span className="openapi-response-value">{ep.response}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="inner-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/openapi.json" className="footer-link">Raw JSON</a>
            <a href="/server-card" className="footer-link">Server Card</a>
            <a href="/docs" className="footer-link">Docs</a>
          </div>
        </footer>
      </main>
    </>
  );
}
