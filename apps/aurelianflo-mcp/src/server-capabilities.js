import { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";

const PRODUCTION_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://x402.aurelianflo.com")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");
const SMITHERY_GATEWAY_URL = String(process.env.SMITHERY_GATEWAY_URL || "https://core--aurelianflo.run.tools")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");

function getToolTitle(tool) {
  return tool.annotations?.title || tool.name;
}

function formatPrice(price) {
  if (!price) {
    return "free";
  }
  return `$${Number(price).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function buildServerCapabilitiesPayload(baseUrl = PRODUCTION_BASE_URL) {
  const normalizedBaseUrl = String(baseUrl || PRODUCTION_BASE_URL).replace(/\/+$/, "");
  const freeTools = [];
  const paidTools = [];

  for (const tool of MCP_TOOL_DEFINITIONS) {
    const entry = {
      name: tool.name,
      title: getToolTitle(tool),
      pricing: formatPrice(tool.price),
      paymentRequired: Boolean(tool.price),
      description: tool.description,
    };
    if (tool.price) {
      paidTools.push(entry);
    } else {
      freeTools.push(entry);
    }
  }

  return {
    server: {
      name: "AurelianFlo",
      version: "0.1.1",
      endpoint: `${normalizedBaseUrl}/mcp`,
      serverCard: `${normalizedBaseUrl}/.well-known/mcp/server-card.json`,
      docs: `${normalizedBaseUrl}/mcp/docs`,
      privacy: `${normalizedBaseUrl}/mcp/privacy`,
      support: `${normalizedBaseUrl}/mcp/support`,
      icon: `${normalizedBaseUrl}/icon.png`,
    },
    transport: "streamable-http",
    payment: {
      protocol: "x402",
      asset: "USDC",
      network: "base",
      requiredFor: paidTools.map((tool) => tool.name),
      notRequiredFor: freeTools.map((tool) => tool.name),
    },
    connectionModes: [
      {
        id: "direct_origin",
        label: "Direct origin",
        url: `${normalizedBaseUrl}/mcp`,
        auth: "none",
      },
      {
        id: "smithery_hosted",
        label: "Smithery-hosted gateway",
        url: SMITHERY_GATEWAY_URL,
        auth: "smithery-oauth",
      },
    ],
    recommendedFlows: [
      {
        id: "batch_wallet_screening",
        label: "Batch wallet screening",
        tools: ["batch_wallet_screen", "report_pdf_generate", "report_docx_generate"],
        outputFormats: ["json", "pdf", "docx"],
        summary: "Screen multiple wallets in one request, get a batch-level proceed-or-pause decision, then render the structured result to PDF or DOCX if needed.",
      },
      {
        id: "edd_memo",
        label: "EDD memo",
        tools: ["edd_report"],
        outputFormats: ["json", "pdf", "docx"],
        summary: "Generate an enhanced due diligence memo with case metadata, evidence summary, required follow-up, and JSON, PDF, or DOCX output.",
      },
      {
        id: "wallet_screening_bundle",
        label: "Wallet screening bundle",
        tools: ["ofac_wallet_report"],
        outputFormats: ["json", "pdf", "docx"],
        summary: "Compliance workflow for exact-match OFAC wallet screening with structured JSON or document output.",
      },
      {
        id: "simulation_bundle",
        label: "Simulation bundle",
        tools: ["monte_carlo_report"],
        outputFormats: ["json", "pdf", "docx"],
        summary: "Monte Carlo reporting workflow with JSON, PDF, or DOCX output.",
      },
      {
        id: "simulation_building_blocks",
        label: "Simulation building blocks",
        tools: ["monte_carlo_decision_report", "report_pdf_generate", "report_docx_generate"],
        summary: "Structured report payload plus artifact generators for clients that want to render each step separately.",
      },
    ],
    tools: {
      free: freeTools,
      paid: paidTools,
    },
  };
}

export function buildServerCapabilitiesResult(baseUrl = PRODUCTION_BASE_URL) {
  const payload = buildServerCapabilitiesPayload(baseUrl);
  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
