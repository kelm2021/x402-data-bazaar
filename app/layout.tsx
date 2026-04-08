import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "../web/src/app/globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AurelianFlo - Compliance APIs for the agent era",
  description:
    "Pay-per-call compliance API. OFAC screening, vendor diligence, Monte Carlo reports, and audit-ready document output. No subscription. Works with Claude via MCP.",
  openGraph: {
    type: "website",
    url: "https://aurelianflo.com",
    title: "AurelianFlo - Compliance APIs for the agent era",
    description:
      "Pay-per-call compliance API for compliance teams, fintech operators, and AI agents.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AurelianFlo - Compliance APIs for the agent era",
    description:
      "Pay-per-call compliance API for compliance teams, fintech operators, and AI agents.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
