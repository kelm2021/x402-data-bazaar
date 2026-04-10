import type { Metadata } from 'next';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'AurelianFlo — Compliance APIs for the agent era',
  description: 'Pay-per-call compliance API. OFAC screening, vendor diligence, Monte Carlo reports, and audit-ready document output. No subscription. Works with Claude Connectors and MCP-compatible clients.',
  alternates: { types: { 'application/json': 'https://api.aurelianflo.com/api?format=json' } },
};

async function getEndpointCount(): Promise<number> {
  // The homepage markets the curated public surface, which is fixed at 8 routes.
  // Pulling this from backend discovery reintroduced hidden/internal routes into the hero stat.
  return 8;
}

const services = [
  { number: '01', category: 'Compliance', name: 'EDD Memo', desc: 'Full Enhanced Due Diligence memo from a single API call — status labels, evidence summary, and required follow-up actions.', features: ['JSON · PDF · DOCX', 'Audit-ready'], price: '$0.25 / call', href: '/services/edd-memo' },
  { number: '02', category: 'OFAC / Sanctions', name: 'Wallet Screening', desc: 'Screen addresses against OFAC SDN and sanctions lists in real time. Single-address or batch up to 100.', features: ['Single + batch', 'Real-time'], price: '$0.01 – $0.10', href: '/services/wallet-screening' },
  { number: '03', category: 'Analysis', name: 'Monte Carlo', desc: 'Simulation-backed decision memos for finance and compliance scenarios. Structured output with confidence ranges.', features: ['10K simulations', 'Scenario tables'], price: 'MCP only', href: '/services/monte-carlo' },
  { number: '04', category: 'Documents', name: 'Report Generation', desc: 'Render compliance data as publication-ready documents in PDF, editable DOCX, or workbook-ready XLSX.', features: ['PDF · DOCX · XLSX', 'Fixed or editable'], price: '$0.05 – $0.07', href: '/services/report-generation' },
] as const;

const connectLinks = [
  { badge: 'REST', name: 'Service Catalog', desc: 'All 8 endpoints with pricing and schemas.', href: '/services' },
  { badge: 'JSON', name: 'OpenAPI Reference', desc: 'Full API spec with parameters, schemas, and response shapes.', href: '/openapi' },
  { badge: 'MCP', name: 'MCP Server Card', desc: '9 tools, 4 prompts, setup guide for Claude Connectors and MCP-compatible clients.', href: '/server-card' },
  { badge: 'DOCS', name: 'Integration Guide', desc: 'x402 payment flow, curl examples, Claude Connectors setup, and generic MCP client setup.', href: '/docs' },
] as const;

export default async function HomePage() {
  const endpointCount = await getEndpointCount();
  return (
    <>
      <Nav />
      <main className="page">
        <section className="hero">
          <div className="hero-layout">
            <div>
              <div className="hero-eyebrow"><span className="hero-eyebrow-dot" />Compliance · Screening · Analysis</div>
              <h1 className="hero-h1">Compliance APIs<br />for AI agents.</h1>
              <p className="hero-desc">Pay-per-call compliance API for OFAC screening, vendor diligence, and audit-ready document output. No subscription, no API keys — settle each call in USDC on Base.</p>
              <div className="hero-actions">
                <a href="/services" className="btn btn-primary">Browse Services</a>
                <a href="/docs" className="btn btn-outline">Integration Guide</a>
                <a href="/server-card" className="btn btn-outline">Connect via MCP</a>
              </div>
            </div>
            <div className="hero-stats">
              <div className="stat-cell"><div className="stat-value gold">{endpointCount}</div><div className="stat-label">Paid routes</div></div>
              <div className="stat-cell"><div className="stat-value">4</div><div className="stat-label">Output formats</div></div>
              <div className="stat-cell"><div className="stat-value">x402</div><div className="stat-label">Payment protocol</div></div>
              <div className="stat-cell"><div className="stat-value">MCP</div><div className="stat-label">Claude Connectors</div></div>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="section-head"><span className="section-title">Services</span><a href="/services" className="section-all">Full catalog →</a></div>
          <div className="services-grid">
            {services.map((s) => (
              <article className="service-card" key={s.number}>
                <div className="card-top"><span className="card-category">{s.category}</span><span className="card-number">{s.number}</span></div>
                <div className="card-name">{s.name}</div>
                <p className="card-desc">{s.desc}</p>
                <div className="card-features">{s.features.map((f) => <span className="card-feature" key={f}>{f}</span>)}</div>
                <div className="card-footer"><span className="card-pricing">{s.price}</span><a href={s.href} className="card-link">Details <span aria-hidden="true">→</span></a></div>
              </article>
            ))}
          </div>
        </section>
        <section className="section">
          <div className="section-head"><span className="section-title">Connect</span></div>
          <div className="connect-grid">
            {connectLinks.map((link) => (
              <a href={link.href} className="connect-card" key={link.href}>
                <span className="connect-badge">{link.badge}</span>
                <div className="connect-name">{link.name}</div>
                <p className="connect-desc">{link.desc}</p>
              </a>
            ))}
          </div>
        </section>
        <footer className="site-footer">
          <span className="footer-brand">AurelianFlo</span>
          <div className="footer-meta"><span>x402 protocol</span><span>USDC on Base</span><span>No API keys</span></div>
        </footer>
      </main>
    </>
  );
}
