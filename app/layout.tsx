import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://api.aurelianflo.com"),
  title: "AurelianFlo API",
  description:
    "Machine-readable API surface for AurelianFlo. Discovery, OpenAPI, MCP, and x402-backed endpoints.",
  icons: {
    icon: "/aurelianflo-icon.png",
    shortcut: "/aurelianflo-icon.png",
    apple: "/aurelianflo-icon.png",
  },
  openGraph: {
    type: "website",
    url: "https://api.aurelianflo.com",
    title: "AurelianFlo API",
    description:
      "Machine-readable API surface for AurelianFlo.",
    images: ["/aurelianflo-icon.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AurelianFlo API",
    description: "Machine-readable API surface for AurelianFlo.",
    images: ["/aurelianflo-icon.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
