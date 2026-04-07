import { MCP_PROMPT_DEFINITIONS } from "./prompt-catalog.js";
import { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";

const PRODUCTION_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://x402.aurelianflo.com")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");
const NO_CONFIG_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
  description: "No user-supplied connection parameters are required.",
};

export const SERVER_CARD = {
  serverInfo: {
    name: "AurelianFlo",
    version: "0.1.1",
    description:
      "Pay-per-call MCP tools for compliance screening, vendor diligence, Monte Carlo decision analysis, and document output.",
    homepage: `${PRODUCTION_BASE_URL}/mcp/docs`,
    iconUrl: `${PRODUCTION_BASE_URL}/icon.png`,
    icons: [
      {
        src: `${PRODUCTION_BASE_URL}/icon.png`,
        mimeType: "image/png",
      },
    ],
    websiteUrl: `${PRODUCTION_BASE_URL}/mcp/docs`,
  },
  authentication: {
    required: false,
    schemes: [],
    description: "No end-user OAuth or API key is required for the direct origin.",
  },
  configSchema: NO_CONFIG_SCHEMA,
  security: {
    userAuthenticationRequired: false,
    paymentRequired: true,
    paymentProtocol: "x402",
    paymentAsset: "USDC",
    paymentNetwork: "base",
  },
  links: {
    documentation: `${PRODUCTION_BASE_URL}/mcp/docs`,
    privacy: `${PRODUCTION_BASE_URL}/mcp/privacy`,
    support: `${PRODUCTION_BASE_URL}/mcp/support`,
  },
  capabilities: {
    tools: true,
    resources: false,
    prompts: true,
  },
  resources: [],
  prompts: MCP_PROMPT_DEFINITIONS.map((prompt) => ({
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    arguments: prompt.arguments,
  })),
  tools: MCP_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    title: tool.annotations?.title || tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  })),
};
