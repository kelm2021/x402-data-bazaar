import { MCP_PROMPT_DEFINITIONS } from "./prompt-catalog.js";
import { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";

const PRODUCTION_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://api.aurelianflo.com")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");
const SMITHERY_GATEWAY_URL = String(process.env.SMITHERY_GATEWAY_URL || "https://core--aurelianflo.run.tools")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");
const ICON_PATH = "/aurelianflo-icon.png";
const OPTIONAL_CONFIG_SCHEMA = {
  type: "object",
  description: "Optional client-side overrides for presentation and connection guidance.",
  properties: {
    public_base_url: {
      type: "string",
      format: "uri",
      description: "Optional override for the canonical direct-origin MCP base URL.",
      default: PRODUCTION_BASE_URL,
    },
    smithery_gateway_url: {
      type: "string",
      format: "uri",
      description: "Optional override for the Smithery-hosted gateway URL shown in connection guidance.",
      default: SMITHERY_GATEWAY_URL,
    },
    preferred_transport: {
      type: "string",
      enum: ["direct_origin", "smithery_hosted"],
      description: "Preferred connection mode to surface first in compatible MCP clients.",
      default: "direct_origin",
    },
    network: {
      type: "string",
      enum: ["base"],
      description: "Optional display hint for the x402 settlement network used by paid tools.",
      default: "base",
    },
  },
  required: [],
  additionalProperties: false,
};

export const SERVER_CARD = {
  serverInfo: {
    name: "AurelianFlo",
    version: "0.1.2",
    description:
      "Pay-per-call MCP tools for EDD memos, OFAC screening, and document output, with retained Monte Carlo reporting tools.",
    homepage: `${PRODUCTION_BASE_URL}/mcp/docs`,
    iconUrl: `${PRODUCTION_BASE_URL}${ICON_PATH}`,
    icons: [
      {
        src: `${PRODUCTION_BASE_URL}${ICON_PATH}`,
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
  configSchema: OPTIONAL_CONFIG_SCHEMA,
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
