import Image from 'next/image';

interface NavProps {
  active?: 'services' | 'docs' | 'mcp';
  cta?: { label: string; href: string };
}

export function Nav({ active, cta = { label: 'Browse Services', href: '/services' } }: NavProps) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a href="/" className="nav-logo">
          <span className="nav-logo-mark">
            <Image src="/aurelianflo-icon.png" alt="AurelianFlo" width={26} height={26} />
          </span>
          AurelianFlo
        </a>
        <div className="nav-links">
          <a href="/services" className={`nav-link${active === 'services' ? ' nav-link-active' : ''}`}>Services</a>
          <a href="/docs" className={`nav-link${active === 'docs' ? ' nav-link-active' : ''}`}>Docs</a>
          <a href="/server-card" className={`nav-link${active === 'mcp' ? ' nav-link-active' : ''}`}>MCP</a>
        </div>
        <a href={cta.href} className="nav-cta">{cta.label}</a>
      </div>
    </nav>
  );
}
