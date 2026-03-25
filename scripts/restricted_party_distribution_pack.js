#!/usr/bin/env node

const sellerConfig = require("../apps/restricted-party-screen/seller.config.json");

const baseUrl = sellerConfig.baseUrl;
const sellerRoutes =
  Array.isArray(sellerConfig.routes) && sellerConfig.routes.length
    ? sellerConfig.routes
    : [sellerConfig.route];
const primaryRoute = sellerRoutes[0];
const vendorBatchRoute =
  sellerRoutes.find((route) => route.routePath === "/api/vendor-onboarding/restricted-party-batch") ??
  null;
const canonicalPath = primaryRoute.canonicalPath || primaryRoute.resourcePath;
const canonicalUrl = `${baseUrl}${canonicalPath}`;
const vendorBatchCanonicalUrl = vendorBatchRoute
  ? `${baseUrl}${vendorBatchRoute.canonicalPath || vendorBatchRoute.resourcePath}`
  : null;
const integrationUrl = `${baseUrl}/integrations/payments-mcp`;
const templateUrl =
  `${baseUrl}/api/ofac-sanctions-screening/<COUNTERPARTY_NAME>?minScore=90&limit=5`;

const sections = [
  "# Restricted Party MCP Distribution Pack",
  "",
  "## Live URLs",
  `- Seller root: ${baseUrl}/`,
  `- Payments MCP helper: ${integrationUrl}`,
  `- Canonical paid route: ${canonicalUrl}`,
  "",
  "## Install Commands",
  "- Codex: `npx @coinbase/payments-mcp --client codex --auto-config`",
  "- Claude Code: `npx @coinbase/payments-mcp --client claude-code --auto-config`",
  "- Gemini: `npx @coinbase/payments-mcp --client gemini --auto-config`",
  "",
  "## Copy-Paste Prompts",
  `- Smoke test: \`Use payments-mcp to pay ${canonicalUrl} and return the JSON response.\``,
  `- Supplier onboarding: \`Use payments-mcp to pay ${templateUrl}. Return the JSON, then tell me whether onboarding should proceed or pause for human review based on summary.manualReviewRecommended.\``,
  `- Payout gate: \`Before sending funds to <COUNTERPARTY_NAME>, use payments-mcp to pay ${templateUrl}. If the response shows potential matches, tell me to block payment and escalate.\``,
  ...(vendorBatchCanonicalUrl
    ? [
        `- Vendor batch screen: \`Use payments-mcp to pay ${vendorBatchCanonicalUrl}. Return the JSON, then summarize which counterparties are clear, which need manual review, and whether onboarding should proceed or pause.\``,
      ]
    : []),
  "",
  "## Outreach Copy",
  "- Short post: `Built a paid x402 restricted-party screening seller for agent workflows. It supports single-name OFAC checks plus a premium vendor-onboarding batch screen through Coinbase Payments MCP. Single route: "
    + canonicalUrl
    + (vendorBatchCanonicalUrl ? " | Batch route: " + vendorBatchCanonicalUrl : "")
    + "`",
  "- Developer DM: `If you are building procurement, payout, or cross-border agents, I have a live x402 seller for OFAC restricted-party screening. You can run single checks or a vendor-onboarding batch screen through Coinbase Payments MCP and pay per request instead of wiring a custom integration.`",
  "",
  "## Success Signals To Watch",
  "- external probes from MCP-capable clients",
  "- first non-self paid call",
  "- repeat paid use by the same anonymous source fingerprint",
];

console.log(sections.join("\n"));
