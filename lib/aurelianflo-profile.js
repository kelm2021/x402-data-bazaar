const DEFAULT_ORIGIN_TITLE = "AurelianFlo";

const DESCRIPTION_SHORT =
  "Compliance screening and decision reports for AI agents.";

const DESCRIPTION_MEDIUM =
  "OFAC screening, vendor diligence, Monte Carlo reports, finance scenario workflows, and PDF/DOCX/XLSX document output for AI agents.";

const DESCRIPTION_FULL =
  "AurelianFlo is a pay-per-call API for OFAC screening, vendor diligence, Monte Carlo decision analysis, finance scenario workflows, and formatted document output (PDF, DOCX, XLSX). Built for compliance teams, fintech developers, and AI agents. No API keys. Paid in USDC via x402.";

const HEALTH_PAGE_LEDE =
  "OFAC screening, vendor diligence, finance scenario workflows, and document output for AI agents.";

const CATALOG_PAGE_LEDE =
  "OFAC screening, vendor review, Monte Carlo decision analysis, finance scenario modeling, and formatted document output.";

const HOME_PAGE_AUDIENCE =
  "Built for compliance teams, fintech developers, and AI agents that need OFAC screening, vendor review, and decision analysis in automated workflows.";

const HOME_PAGE_VALUE_PROP =
  "Use one paid API surface for OFAC screening, vendor diligence, finance scenarios, Monte Carlo reporting, and document output instead of stitching together separate tools.";

const PRIMARY_NAV_ITEMS = [
  { label: "Catalog", href: "catalog", variant: "primary" },
  { label: "OpenAPI", href: "openapi", variant: "secondary" },
];

const JARGON_REPLACEMENTS = {
  workflowSafe: "status labels for compliance review pipelines",
  workbookReady: "structured tables compatible with Excel and Sheets",
  premium: "formatted",
  onchainCompliance: "blockchain wallet compliance",
};

module.exports = {
  DEFAULT_ORIGIN_TITLE,
  DESCRIPTION_SHORT,
  DESCRIPTION_MEDIUM,
  DESCRIPTION_FULL,
  HEALTH_PAGE_LEDE,
  CATALOG_PAGE_LEDE,
  HOME_PAGE_AUDIENCE,
  HOME_PAGE_VALUE_PROP,
  PRIMARY_NAV_ITEMS,
  JARGON_REPLACEMENTS,
};
