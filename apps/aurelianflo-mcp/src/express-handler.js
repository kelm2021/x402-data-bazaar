import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { processPriceToAtomicAmount } from "x402/shared";
import { exact } from "x402/schemes";
import { useFacilitator } from "x402/verify";
import z from "zod";

import { getUpstreamBaseUrl } from "./internal-upstream.js";
import { MCP_PROMPT_DEFINITIONS } from "./prompt-catalog.js";
import { buildServerCapabilitiesResult } from "./server-capabilities.js";
import { MCP_TOOL_DEFINITIONS } from "./tool-catalog.js";
import { invokeUpstream } from "./upstream.js";

const X402_VERSION = 1;
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

function createPaidToolMethod(server, config) {
  return (name, description, options, paramsSchema, annotations, cb) => {
    const cbWithPayment = async (args, extra) => {
      const { verify, settle } = useFacilitator(config.facilitator);
      const makeErrorResponse = (obj) => ({
        isError: true,
        structuredContent: obj,
        content: [{ type: "text", text: JSON.stringify(obj) }],
      });

      const payment = extra?._meta?.["x402/payment"];
      const atomicAmountForAsset = processPriceToAtomicAmount(options.price, config.network);
      if ("error" in atomicAmountForAsset) {
        throw new Error("Failed to process price to atomic amount");
      }

      const { maxAmountRequired, asset } = atomicAmountForAsset;
      const paymentRequirements = {
        scheme: "exact",
        network: config.network,
        maxAmountRequired,
        payTo: config.recipient,
        asset: asset.address,
        maxTimeoutSeconds: 300,
        resource: `mcp://tool/${name}`,
        mimeType: "application/json",
        description,
        extra: asset.eip712,
      };

      if (!payment) {
        return makeErrorResponse({
          x402Version: X402_VERSION,
          error: "_meta.x402/payment is required",
          accepts: [paymentRequirements],
        });
      }

      let decodedPayment;
      try {
        decodedPayment = exact.evm.decodePayment(z.string().parse(payment));
        decodedPayment.x402Version = X402_VERSION;
      } catch (_error) {
        return makeErrorResponse({
          x402Version: X402_VERSION,
          error: "Invalid payment",
          accepts: [paymentRequirements],
        });
      }

      const verification = await verify(decodedPayment, paymentRequirements);
      if (!verification.isValid) {
        return makeErrorResponse({
          x402Version: X402_VERSION,
          error: verification.invalidReason,
          accepts: [paymentRequirements],
          payer: verification.payer,
        });
      }

      let result;
      let executionError = false;
      try {
        result = await cb(args, extra);
        if (result && typeof result === "object" && "isError" in result && result.isError) {
          executionError = true;
        }
      } catch (error) {
        executionError = true;
        result = {
          isError: true,
          content: [{ type: "text", text: `Tool execution failed: ${error}` }],
        };
      }

      if (!executionError) {
        try {
          const settlement = await settle(decodedPayment, paymentRequirements);
          if (settlement.success && result) {
            result._meta ||= {};
            result._meta["x402/payment-response"] = {
              success: true,
              transaction: settlement.transaction,
              network: settlement.network,
              payer: settlement.payer,
            };
          }
        } catch (settlementError) {
          return makeErrorResponse({
            x402Version: X402_VERSION,
            error: `Settlement failed: ${settlementError}`,
            accepts: [paymentRequirements],
          });
        }
      }

      return result;
    };

    return server.tool(
      name,
      description,
      paramsSchema,
      {
        ...annotations,
        paymentHint: true,
      },
      cbWithPayment,
    );
  };
}

async function registerAurelianFloServer(server, options = {}) {
  const paidTool = createPaidToolMethod(server, {
    recipient: options.recipient,
    facilitator: {
      url: options.facilitatorUrl || process.env.X402_FACILITATOR_URL || DEFAULT_PAYMENT_CONFIG.facilitator.url,
    },
    network: options.network || process.env.AURELIANFLO_MCP_NETWORK || DEFAULT_PAYMENT_CONFIG.network,
  });

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

    paidTool(
      tool.name,
      tool.description,
      { price: tool.price },
      tool.zodShape,
      tool.annotations,
      async (args) => {
        const payload = options.invokeImpl
          ? await options.invokeImpl(tool, args, { fetchImpl: options.fetchImpl })
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
}

export function createAurelianFloExpressMcpHandler(options = {}) {
  return async function aurelianFloExpressMcpHandler(req, res, next) {
    try {
      const recipient = options.recipient || process.env.AURELIANFLO_MCP_RECIPIENT || process.env.WALLET_ADDRESS;
      if (!recipient) {
        throw new Error("AURELIANFLO_MCP_RECIPIENT or WALLET_ADDRESS is required.");
      }

      const server = new McpServer(
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
        {},
      );

      await registerAurelianFloServer(server, {
        ...options,
        recipient,
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error?.message || "Internal server error",
          },
          id: null,
        });
        return;
      }
      next(error);
    }
  };
}
