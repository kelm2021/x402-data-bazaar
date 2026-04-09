export type ServiceItem = {
  title: string;
  route: string;
  price: string;
  summary: string;
  href: string;
};

export const navItems = [
  { label: "Services", href: "/services" },
  { label: "OpenAPI", href: "/openapi" },
  { label: "Server Card", href: "/server-card" },
  { label: "Docs", href: "/docs" },
];

export const coreServices: ServiceItem[] = [
  {
    title: "Wallet OFAC Screen",
    route: "GET /api/ofac-wallet-screen/:address",
    price: "$0.01",
    summary: "Exact-match wallet sanctions screening for compliance gating.",
    href: "/services/wallet-screening",
  },
  {
    title: "Wallet Sanctions Report",
    route: "POST /api/workflows/compliance/wallet-sanctions-report",
    price: "$0.04",
    summary: "Single-wallet report payload optimized for case intake.",
    href: "/services/wallet-screening",
  },
  {
    title: "Batch Wallet Screen",
    route: "POST /api/workflows/compliance/batch-wallet-screen",
    price: "$0.10",
    summary: "Portfolio-level screening primitive for watchlist triage.",
    href: "/services/wallet-screening",
  },
  {
    title: "EDD Report",
    route: "POST /api/workflows/compliance/edd-report",
    price: "$0.25",
    summary: "Bundled JSON + PDF + DOCX enhanced due diligence memo.",
    href: "/services/edd-memo",
  },
  {
    title: "Report PDF Generator",
    route: "POST /api/tools/report/pdf/generate",
    price: "$0.05",
    summary: "Render audit documents as portable PDF artifacts.",
    href: "/services/report-generation",
  },
  {
    title: "Report DOCX Generator",
    route: "POST /api/tools/report/docx/generate",
    price: "$0.06",
    summary: "Generate editable DOCX reports for legal/compliance teams.",
    href: "/services/report-generation",
  },
  {
    title: "Report XLSX Generator",
    route: "POST /api/tools/report/xlsx/generate",
    price: "$0.07",
    summary: "Produce spreadsheet-ready output for analyst workflows.",
    href: "/services/report-generation",
  },
  {
    title: "Monte Carlo Decision Workflows",
    route: "POST /api/sim/* + finance/vendor workflows",
    price: "Route-based",
    summary: "Simulation and scenario tooling available by direct API route.",
    href: "/services/monte-carlo",
  },
];

export const mcpTools = [
  "ofac_wallet_screen",
  "batch_wallet_screen",
  "edd_report",
  "ofac_wallet_report",
  "report_pdf_generate",
  "report_docx_generate",
  "monte_carlo_report",
  "monte_carlo_decision_report",
  "server_capabilities",
];
