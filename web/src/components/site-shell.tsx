import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { navItems } from "@/lib/site-data";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function SiteShell({ title, subtitle, children }: Props) {
  return (
    <div className="site-wrap">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <Image
              src="/aurelianflo-icon.png"
              alt="AurelianFlo icon"
              width={22}
              height={22}
            />
            AurelianFlo
          </Link>
          <nav className="topnav" aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="content">
        <section className="hero-block">
          <p className="badge">x402-paid compliance infrastructure</p>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </section>
        {children}
      </main>
    </div>
  );
}
