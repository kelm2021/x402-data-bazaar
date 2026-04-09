import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Nav } from '@/components/nav';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface SchemaField {
  field: string;
  type: string;
  required: boolean;
  desc: string;
}

interface ServiceEndpoint {
  method: string;
  path: string;
  price: string;
  desc: string;
}

interface ServiceData {
  name: string;
  category: string;
  priceRange: string;
  summary: string;
  endpoints: ServiceEndpoint[];
  schema: SchemaField[];
  exampleRequest: string;
  exampleResponse: string;
}

const services: Record<string, ServiceData> = {
  'edd-memo': {
    name: 'EDD Memo',
    category: 'Compliance',
    priceRange: '$0.25 / call',
    summary: 'Generate a full Enhanced Due Diligence memo in a single API call. The endpoint accepts entity data and returns a structured memo with status labels, evidence summary, and required follow-up actions in JSON, PDF, or DOCX format.',
    endpoints: [
      { method: 'POST', path: '/api/workflows/compliance/edd-report', price: '$0.25', desc: 'Full EDD memo — JSON, PDF, or DOCX output' },
    ],
    schema: [
      { field: 'entity_name', type: 'string', required: true, desc: 'Full legal name of the entity or individual' },
      { field: 'entity_type', type: 'string', required: true, desc: '"individual" or "company"' },
      { field: 'jurisdiction', type: 'string', required: false, desc: 'ISO 3166-1 alpha-2 country code' },
      { field: 'wallet_address', type: 'string', required: false, desc: 'Blockchain wallet address to include in screening' },
      { field: 'format', type: 'string', required: false, desc: '"json" (default), "pdf", or "docx"' },
    ],
    exampleRequest: `POST /api/workflows/compliance/edd-report
Content-Type: application/json

{
  "entity_name": "Acme Holdings Ltd",
  "entity_type": "company",
  "jurisdiction": "KY",
  "wallet_address": "0xAbC123...",
  "format": "json"
}`,
    exampleResponse: `{
  "status": "elevated_risk",
  "memo": {
    "entity_name": "Acme Holdings Ltd",
    "jurisdiction": "KY",
    "risk_level": "elevated",
    "sanctions_hit": false,
    "pep_flag": false,
    "adverse_media": true,
    "evidence_summary": "...",
    "required_actions": ["Enhanced monitoring", "Source of funds documentation"]
  },
  "format": "json",
  "generated_at": "2025-04-07T12:00:00Z"
}`,
  },
  'wallet-screening': {
    name: 'Wallet Screening',
    category: 'OFAC / Sanctions',
    priceRange: '$0.01 – $0.10',
    summary: 'Screen wallet addresses against OFAC SDN and consolidated sanctions lists in real time. Supports single-address lookup and batch screening of up to 100 addresses per call.',
    endpoints: [
      { method: 'GET', path: '/api/ofac-wallet-screen/:address', price: '$0.01', desc: 'Single wallet OFAC SDN screening' },
      { method: 'POST', path: '/api/workflows/compliance/wallet-sanctions-report', price: '$0.04', desc: 'Structured compliance payload with risk score' },
      { method: 'POST', path: '/api/workflows/compliance/batch-wallet-screen', price: '$0.10', desc: 'Batch screen up to 100 addresses' },
    ],
    schema: [
      { field: 'address', type: 'string', required: true, desc: 'Wallet address to screen (GET: path param, POST: body)' },
      { field: 'addresses', type: 'string[]', required: true, desc: 'Array of wallet addresses for batch endpoint (max 100)' },
      { field: 'chain', type: 'string', required: false, desc: 'Chain identifier, e.g. "eth", "btc", "trx"' },
    ],
    exampleRequest: `GET /api/ofac-wallet-screen/0xAbC123...

# or batch:
POST /api/workflows/compliance/batch-wallet-screen
Content-Type: application/json

{
  "addresses": ["0xAbC123...", "0xDeF456..."],
  "chain": "eth"
}`,
    exampleResponse: `{
  "results": [
    {
      "address": "0xAbC123...",
      "sanctioned": false,
      "matches": [],
      "checked_at": "2025-04-07T12:00:00Z"
    },
    {
      "address": "0xDeF456...",
      "sanctioned": true,
      "matches": [{ "list": "OFAC_SDN", "name": "...", "score": 1.0 }],
      "checked_at": "2025-04-07T12:00:00Z"
    }
  ],
  "total": 2,
  "flagged": 1
}`,
  },
  'monte-carlo': {
    name: 'Monte Carlo',
    category: 'Analysis',
    priceRange: 'MCP only',
    summary: 'Simulation-backed decision memos for finance and compliance scenarios. Runs 10,000 simulations and returns a structured output with probability distributions, confidence ranges, and scenario tables. Available via MCP tools only.',
    endpoints: [],
    schema: [
      { field: 'scenario', type: 'string', required: true, desc: 'Natural language description of the decision scenario' },
      { field: 'variables', type: 'object', required: true, desc: 'Named numeric variables with min/max/distribution' },
      { field: 'simulations', type: 'number', required: false, desc: 'Number of iterations (default: 10000, max: 100000)' },
      { field: 'output_format', type: 'string', required: false, desc: '"json" or "memo"' },
    ],
    exampleRequest: `// Via MCP tool: monte_carlo_report
{
  "scenario": "Probability of portfolio loss exceeding 15% in 12 months",
  "variables": {
    "annual_return": { "min": -0.3, "max": 0.5, "distribution": "normal" },
    "volatility": { "min": 0.1, "max": 0.4, "distribution": "uniform" }
  },
  "simulations": 10000
}`,
    exampleResponse: `{
  "p_loss_exceeds_threshold": 0.127,
  "confidence_interval_95": [-0.18, 0.31],
  "median_outcome": 0.08,
  "scenarios": [
    { "label": "Bear case (p10)", "outcome": -0.21 },
    { "label": "Base case (p50)", "outcome": 0.08 },
    { "label": "Bull case (p90)", "outcome": 0.28 }
  ],
  "simulations_run": 10000
}`,
  },
  'report-generation': {
    name: 'Report Generation',
    category: 'Documents',
    priceRange: '$0.05 – $0.07',
    summary: 'Render compliance data as publication-ready documents. Supports PDF, editable DOCX, and workbook-ready XLSX output. Pass structured content and receive a signed download URL.',
    endpoints: [
      { method: 'POST', path: '/api/tools/report/generate', price: '$0.05', desc: 'PDF report from structured content' },
      { method: 'POST', path: '/api/tools/report/pdf/generate', price: '$0.05', desc: 'Styled PDF with metrics and formatted sections' },
      { method: 'POST', path: '/api/tools/report/docx/generate', price: '$0.06', desc: 'Editable DOCX memo output' },
      { method: 'POST', path: '/api/tools/report/xlsx/generate', price: '$0.07', desc: 'XLSX workbook with tabular data' },
    ],
    schema: [
      { field: 'title', type: 'string', required: true, desc: 'Document title' },
      { field: 'sections', type: 'Section[]', required: true, desc: 'Array of { heading: string, body: string } objects' },
      { field: 'metrics', type: 'Metric[]', required: false, desc: 'Optional callout metrics: [{ label, value }]' },
      { field: 'rows', type: 'object[]', required: false, desc: 'Array of row objects for XLSX export' },
    ],
    exampleRequest: `POST /api/tools/report/pdf/generate
Content-Type: application/json

{
  "title": "Q1 Compliance Summary",
  "sections": [
    { "heading": "Executive Summary", "body": "..." },
    { "heading": "Findings", "body": "..." }
  ],
  "metrics": [
    { "label": "Wallets Screened", "value": "1,240" },
    { "label": "Flags Raised", "value": "3" }
  ]
}`,
    exampleResponse: `{
  "url": "https://cdn.aurelianflo.com/reports/abc123.pdf",
  "expires_at": "2025-04-08T12:00:00Z",
  "size_bytes": 142080,
  "pages": 4
}`,
  },
};

// ---------------------------------------------------------------------------
// Static params + metadata
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  return Object.keys(services).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const service = services[slug];
  if (!service) return {};
  return {
    title: `${service.name} — AurelianFlo`,
    description: service.summary,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = services[slug];
  if (!service) notFound();

  return (
    <>
      <Nav active="services" cta={{ label: '← All Services', href: '/services' }} />
      <main className="inner-page">
        <header className="page-header">
          <div className="page-header-top">
            <span className="page-header-badge">{service.category}</span>
            <span className="page-header-badge" style={{ background: 'rgba(212,168,75,0.08)', color: 'var(--bright-gold)', borderColor: 'rgba(212,168,75,0.18)' }}>{service.priceRange}</span>
          </div>
          <h1 className="page-header-title">{service.name}</h1>
          <p className="page-header-desc">{service.summary}</p>
        </header>

        {service.endpoints.length > 0 && (
          <div className="catalog-group">
            <div className="catalog-group-header">
              <span className="catalog-group-title">Endpoints</span>
              <span className="catalog-group-count">{service.endpoints.length} endpoint{service.endpoints.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="catalog-rows">
              {service.endpoints.map((ep) => (
                <div className="catalog-row" key={ep.path}>
                  <div className="catalog-row-left">
                    <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="catalog-path">{ep.path}</span>
                  </div>
                  <div className="catalog-row-right">
                    <span className="price-badge">{ep.price}</span>
                    <span className="catalog-desc">{ep.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {slug === 'monte-carlo' && (
          <div className="catalog-group">
            <div className="catalog-group-header">
              <span className="catalog-group-title">Access</span>
            </div>
            <div className="callout-row" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
              <div className="callout-cell"><div className="callout-label">Available via</div><div className="callout-value">MCP tools only</div></div>
              <div className="callout-cell"><div className="callout-label">Tools</div><div className="callout-value">monte_carlo_report, monte_carlo_decision_report</div></div>
            </div>
          </div>
        )}

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Request Schema</span>
          </div>
          <div className="schema-table">
            <div className="schema-head">
              <span>Field</span>
              <span>Type</span>
              <span>Required</span>
              <span>Description</span>
            </div>
            {service.schema.map((row) => (
              <div className="schema-row" key={row.field}>
                <span className="schema-field">{row.field}</span>
                <span className="schema-type">{row.type}</span>
                <span className={`schema-req ${row.required ? 'req-yes' : 'req-no'}`}>{row.required ? 'Yes' : 'No'}</span>
                <span className="schema-desc">{row.desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Example Request</span>
          </div>
          <pre className="code-block">{service.exampleRequest}</pre>
        </div>

        <div className="catalog-group">
          <div className="catalog-group-header">
            <span className="catalog-group-title">Example Response</span>
          </div>
          <pre className="code-block">{service.exampleResponse}</pre>
        </div>

        <div className="detail-footer-links">
          <a href="/services" className="page-link">← All Services</a>
          <a href="/openapi" className="page-link">OpenAPI Reference →</a>
          <a href="/docs" className="page-link">Integration Guide →</a>
          <a href="/server-card" className="page-link">MCP Server Card →</a>
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
