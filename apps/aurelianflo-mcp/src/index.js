import { createPaidMcpHandler } from "x402-mcp";

import { getUpstreamBaseUrl } from "./internal-upstream.js";
import { MCP_PROMPT_DEFINITIONS } from "./prompt-catalog.js";
import { buildServerCapabilitiesResult } from "./server-capabilities.js";
import { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";
import { invokeUpstream } from "./upstream.js";

const DEFAULT_PAYMENT_CONFIG = {
  facilitator: {
    url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  },
  network: "base",
};
const DEFAULT_PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://api.aurelianflo.com")
  .trim()
  .replace(/\s+/g, "")
  .replace(/\/+$/, "");
const DEFAULT_ICON_URL = `${DEFAULT_PUBLIC_BASE_URL}/aurelianflo-icon.png`;
const DEFAULT_DOCS_URL = `${DEFAULT_PUBLIC_BASE_URL}/mcp/docs`;

function buildToolResult(tool, payload) {
  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            tool: tool.name,
            route: tool.route.pathTemplate,
            result: payload,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function createAurelianFloMcpHandler(options = {}) {
  const recipient = options.recipient || process.env.AURELIANFLO_MCP_RECIPIENT || process.env.WALLET_ADDRESS;
  if (!recipient) {
    throw new Error("AURELIANFLO_MCP_RECIPIENT or WALLET_ADDRESS is required.");
  }

  const facilitatorUrl =
    options.facilitatorUrl || process.env.X402_FACILITATOR_URL || DEFAULT_PAYMENT_CONFIG.facilitator.url;
  const network = options.network || process.env.AURELIANFLO_MCP_NETWORK || DEFAULT_PAYMENT_CONFIG.network;
  const invokeImpl = typeof options.invokeImpl === "function" ? options.invokeImpl : null;

  return createPaidMcpHandler(
    async (server) => {
      for (const tool of MCP_TOOL_DEFINITIONS) {
        if (!tool.price) {
          server.tool(
            tool.name,
            tool.description,
            tool.zodShape,
            tool.annotations,
            async () => buildServerCapabilitiesResult(options.publicBaseUrl),
          );
          continue;
        }

        server.paidTool(
          tool.name,
          tool.description,
          { price: tool.price },
          tool.zodShape,
          tool.annotations,
          async (args) => {
            const payload = invokeImpl
              ? await invokeImpl(tool, args, {
                fetchImpl: options.fetchImpl,
              })
              : await invokeUpstream(tool, args, {
                baseUrl: options.baseUrl || (await getUpstreamBaseUrl()),
                fetchImpl: options.fetchImpl,
              });
            return buildToolResult(tool, payload);
          },
        );
      }

      for (const prompt of MCP_PROMPT_DEFINITIONS) {
        server.registerPrompt(
          prompt.name,
          {
            title: prompt.title,
            description: prompt.description,
            argsSchema: prompt.argsSchema,
          },
          prompt.handler,
        );
      }
    },
    {
      name: "AurelianFlo",
      version: "0.1.2",
      icons: [
        {
          src: DEFAULT_ICON_URL,
          mimeType: "image/png",
        },
      ],
      websiteUrl: DEFAULT_DOCS_URL,
    },
    {
      recipient,
      facilitator: { url: facilitatorUrl },
      network,
    },
  );
}

export { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";
