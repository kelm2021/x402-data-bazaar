const AURELIANFLO_ALLOWED_ROUTE_KEYS = [
  "GET /api/ofac-wallet-screen/:address",
  "POST /api/workflows/compliance/wallet-sanctions-report",
  "POST /api/workflows/compliance/batch-wallet-screen",
  "POST /api/workflows/compliance/edd-report",
  "GET /api/vendor-entity-brief",
  "POST /api/workflows/vendor/risk-assessment",
  "POST /api/workflows/vendor/risk-forecast",
  "POST /api/workflows/vendor/due-diligence-report",
  "POST /api/sim/probability",
  "POST /api/sim/batch-probability",
  "POST /api/sim/compare",
  "POST /api/sim/sensitivity",
  "POST /api/sim/forecast",
  "POST /api/sim/composed",
  "POST /api/sim/optimize",
  "POST /api/sim/report",
  "POST /api/workflows/finance/cash-runway-forecast",
  "POST /api/workflows/finance/startup-runway-forecast",
  "POST /api/workflows/finance/pricing-plan-compare",
  "POST /api/workflows/finance/pricing-scenario-forecast",
  "POST /api/workflows/finance/pricing-sensitivity-report",
  "POST /api/tools/report/generate",
  "POST /api/tools/report/pdf/generate",
  "POST /api/tools/report/docx/generate",
  "POST /api/tools/report/xlsx/generate",
  "POST /api/tools/pdf/render-html",
  "POST /api/tools/docx/render-template",
  "POST /api/tools/xlsx/render-template",
  "POST /api/tools/pdf/generate",
  "POST /api/tools/docx/generate",
  "POST /api/tools/xlsx/generate",
];

const PUBLIC_CORE_DISCOVERY_ROUTE_KEYS = [
  "POST /api/workflows/compliance/edd-report",
  "POST /api/workflows/compliance/batch-wallet-screen",
  "GET /api/ofac-wallet-screen/:address",
  "POST /api/workflows/compliance/wallet-sanctions-report",
  "GET /api/vendor-entity-brief",
  "POST /api/workflows/finance/cash-runway-forecast",
  "POST /api/workflows/finance/startup-runway-forecast",
  "POST /api/workflows/finance/pricing-plan-compare",
  "POST /api/workflows/finance/pricing-sensitivity-report",
  "POST /api/workflows/vendor/risk-assessment",
  "POST /api/workflows/vendor/due-diligence-report",
  "POST /api/sim/probability",
  "POST /api/sim/batch-probability",
  "POST /api/sim/compare",
  "POST /api/sim/sensitivity",
  "POST /api/sim/forecast",
  "POST /api/sim/composed",
  "POST /api/sim/optimize",
  "POST /api/sim/report",
  "POST /api/tools/report/generate",
  "POST /api/tools/report/pdf/generate",
  "POST /api/tools/report/docx/generate",
  "POST /api/tools/report/xlsx/generate",
  "POST /api/tools/docx/generate",
  "POST /api/tools/xlsx/generate",
  "POST /api/tools/pdf/generate",
  "POST /api/tools/pdf/render-html",
  "POST /api/tools/docx/render-template",
  "POST /api/tools/xlsx/render-template",
];

const WELL_KNOWN_DESCRIPTION =
  "AurelianFlo is a pay-per-call API for compliance screening, vendor due diligence, Monte Carlo decision analysis, finance scenario workflows, and PDF, DOCX, and XLSX document generation over x402.";

const WELL_KNOWN_INSTRUCTIONS = [
  "# AurelianFlo",
  "",
  "AurelianFlo is a pay-per-call API for AI agents and operations teams that need compliance screening, vendor due diligence, Monte Carlo decision analysis, finance scenario workflows, and formatted document output.",
  "",
  "## Retained Surface",
  "- Compliance screening: OFAC wallet checks, batch wallet screening, and EDD memos",
  "- Vendor due diligence: entity briefs and decision workflows for procurement and onboarding",
  "- Decision simulation: Monte Carlo report and decision analysis workflows",
  "- Finance workflows: cash runway and pricing scenario workflows",
  "- Document generation: report PDF, DOCX, and XLSX output",
  "",
  "## Payment",
  "USDC on Base via x402. Paid endpoints return `402 Payment Required` with machine-readable settlement instructions until payment is attached.",
  "",
  "## Discovery",
  "Use `GET /api` for the buyer-facing catalog and `GET /api/system/discovery/full` for the full retained 31-route inventory.",
].join("\n");

function buildAllowedRouteKeySet() {
  return new Set(AURELIANFLO_ALLOWED_ROUTE_KEYS);
}

function buildPublicCoreRouteKeySet() {
  return new Set(PUBLIC_CORE_DISCOVERY_ROUTE_KEYS);
}

function isAllowedAurelianFloRouteKey(routeKey) {
  return buildAllowedRouteKeySet().has(String(routeKey || ""));
}

function isPublicCoreDiscoveryRouteKey(routeKey) {
  return buildPublicCoreRouteKeySet().has(String(routeKey || ""));
}

module.exports = {
  AURELIANFLO_ALLOWED_ROUTE_KEYS,
  PUBLIC_CORE_DISCOVERY_ROUTE_KEYS,
  WELL_KNOWN_DESCRIPTION,
  WELL_KNOWN_INSTRUCTIONS,
  buildAllowedRouteKeySet,
  buildPublicCoreRouteKeySet,
  isAllowedAurelianFloRouteKey,
  isPublicCoreDiscoveryRouteKey,
};
