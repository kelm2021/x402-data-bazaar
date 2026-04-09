const restrictedPartyPrimaryHandler = require("../apps/restricted-party-screen/handlers/primary");
const genericSimulatorPrimaryHandler = require("../apps/generic-parameter-simulator/handlers/primary");
const { buildDocumentArtifact } = require("../routes/auto-local/doc-artifacts");
const { createAurelianFloRootExpressMcpHandler } = require("./aurelianflo-mcp-express-handler");

let handlerPromise = null;
let serverCardPromise = null;
let serverCapabilitiesPromise = null;
let expressHandlerPromise = null;

function createErrorFromPayload(statusCode, payload) {
  const error = new Error(
    (payload && (payload.message || payload.error)) || `Local MCP upstream failed with status ${statusCode}`,
  );
  error.statusCode = statusCode;
  error.payload = payload;
  return error;
}

async function executeJsonHandler(handler, reqLike) {
  let statusCode = 200;
  let resolved = false;

  return new Promise((resolve, reject) => {
    const req = {
      method: reqLike.method || "GET",
      path: reqLike.path || "/",
      params: reqLike.params || {},
      query: reqLike.query || {},
      body: reqLike.body || {},
      headers: reqLike.headers || {},
      get(headerName) {
        const normalized = String(headerName || "").toLowerCase();
        return this.headers[normalized];
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        if (resolved) {
          return this;
        }
        resolved = true;
        if (statusCode >= 400) {
          reject(createErrorFromPayload(statusCode, payload));
          return this;
        }
        resolve(payload);
        return this;
      },
    };

    Promise.resolve(handler(req, res))
      .then(() => {
        if (!resolved) {
          resolve(undefined);
        }
      })
      .catch(reject);
  });
}

async function readRequestBody(req) {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
      return req.body;
    }
    return JSON.stringify(req.body);
  }

  if (!req || typeof req[Symbol.asyncIterator] !== "function") {
    return undefined;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks);
}

async function toFetchRequest(req) {
  const host = typeof req.get === "function" ? req.get("host") : req.headers.host;
  const origin = `${req.protocol || "http"}://${host || "127.0.0.1"}`;
  const url = new URL(req.originalUrl || req.url || "/", origin);
  const method = String(req.method || "GET").toUpperCase();
  const headers = new Headers(req.headers);

  let body;
  if (!["GET", "HEAD"].includes(method)) {
    body = await readRequestBody(req);
    if (body !== undefined) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      headers.delete("content-length");
    }
  }

  return new Request(url, {
    method,
    headers,
    body,
    duplex: "half",
  });
}

async function writeFetchResponse(fetchResponse, res) {
  res.status(fetchResponse.status);
  fetchResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!fetchResponse.body) {
    res.end();
    return;
  }

  if (typeof fetchResponse.body.getReader === "function") {
    const reader = fetchResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(Buffer.from(value));
    }
    res.end();
    return;
  }

  const body = Buffer.from(await fetchResponse.arrayBuffer());
  res.end(body);
}

async function getServerCapabilities(baseUrl = "https://api.aurelianflo.com") {
  if (!serverCapabilitiesPromise) {
    serverCapabilitiesPromise = import("../apps/aurelianflo-mcp/src/server-capabilities.js").then(
      (mod) => mod.buildServerCapabilitiesPayload,
    );
  }

  const buildServerCapabilitiesPayload = await serverCapabilitiesPromise;
  return buildServerCapabilitiesPayload(baseUrl);
}

async function getExpressMcpHandler(options = {}) {
  if (!expressHandlerPromise) {
    expressHandlerPromise = Promise.resolve(
      createAurelianFloRootExpressMcpHandler({
        recipient: options.recipient,
        facilitatorUrl: options.facilitatorUrl,
        network: options.network,
        invokeImpl: invokeLocalMcpTool,
      }),
    );
  }
  return expressHandlerPromise;
}

async function runWalletScreen(args) {
  return executeJsonHandler(restrictedPartyPrimaryHandler, {
    method: "GET",
    path: `/api/ofac-wallet-screen/${encodeURIComponent(args.address)}`,
    params: { address: args.address },
    query: {
      asset: args.asset,
    },
  });
}

async function runBatchWalletScreen(args) {
  return executeJsonHandler(restrictedPartyPrimaryHandler, {
    method: "POST",
    path: "/api/workflows/compliance/batch-wallet-screen",
    body: {
      addresses: args.addresses,
      asset: args.asset,
    },
  });
}

async function runEddReport(args) {
  return executeJsonHandler(restrictedPartyPrimaryHandler, {
    method: "POST",
    path: "/api/workflows/compliance/edd-report",
    body: args,
  });
}

async function buildWalletScreenReport(args) {
  const screening = await runWalletScreen(args);
  const outputFormat = String(args.output_format || "json").toLowerCase();

  if (outputFormat === "json") {
    return screening;
  }

  const artifactPath =
    outputFormat === "docx"
      ? "/api/tools/report/docx/generate"
      : "/api/tools/report/pdf/generate";

  const artifactPayload = await buildDocumentArtifact({
    path: artifactPath,
    endpoint: `POST ${artifactPath}`,
    title: "OFAC Wallet Screening Report",
    body: screening.report,
  });

  return {
    screening: screening.data,
    report: screening.report,
    artifacts: screening.artifacts,
    output_format: outputFormat,
    output: artifactPayload.data,
    source: screening.source,
  };
}

async function runMonteCarloDecisionReport(args) {
  return executeJsonHandler(genericSimulatorPrimaryHandler, {
    method: "POST",
    path: "/api/sim/report",
    body: args,
  });
}

async function buildMonteCarloReport(args) {
  const outputFormat = String(args.output_format || "json").toLowerCase();
  const reportRequest = {
    analysis_type: args.analysis_type,
    title: args.title,
    summary_focus: args.summary_focus,
    request: args.request,
  };
  const report = await runMonteCarloDecisionReport(reportRequest);

  if (outputFormat === "json") {
    return report;
  }

  const artifactPath =
    outputFormat === "docx"
      ? "/api/tools/report/docx/generate"
      : "/api/tools/report/pdf/generate";

  const artifactPayload = await buildDocumentArtifact({
    path: artifactPath,
    endpoint: `POST ${artifactPath}`,
    title: "Monte Carlo Report",
    body: report,
  });

  return {
    report,
    output_format: outputFormat,
    output: artifactPayload.data,
    source: {
      route: "/api/sim/report",
      analysis_type: args.analysis_type,
    },
  };
}

async function invokeLocalMcpTool(tool, args) {
  switch (tool.name) {
    case "server_capabilities":
      return getServerCapabilities();
    case "ofac_wallet_report":
      return buildWalletScreenReport(args);
    case "ofac_wallet_screen":
      return runWalletScreen(args);
    case "batch_wallet_screen":
      return runBatchWalletScreen(args);
    case "edd_report":
      return runEddReport(args);
    case "monte_carlo_report":
      return buildMonteCarloReport(args);
    case "monte_carlo_decision_report":
      return runMonteCarloDecisionReport(args);
    case "report_pdf_generate":
      return buildDocumentArtifact({
        path: "/api/tools/report/pdf/generate",
        endpoint: "POST /api/tools/report/pdf/generate",
        title: "Report PDF",
        body: args,
      });
    case "report_docx_generate":
      return buildDocumentArtifact({
        path: "/api/tools/report/docx/generate",
        endpoint: "POST /api/tools/report/docx/generate",
        title: "Report DOCX",
        body: args,
      });
    default:
      throw new Error(`Unsupported local MCP tool: ${tool.name}`);
  }
}

async function getMcpHandler(options = {}) {
  if (!handlerPromise) {
    handlerPromise = import("../apps/aurelianflo-mcp/src/index.js").then((mod) => mod.createAurelianFloMcpHandler({
      recipient: options.recipient,
      facilitatorUrl: options.facilitatorUrl,
      network: options.network,
      invokeImpl: invokeLocalMcpTool,
    }));
  }
  return handlerPromise;
}

async function getServerCard() {
  if (!serverCardPromise) {
    serverCardPromise = import("../apps/aurelianflo-mcp/src/server-card.js").then((mod) => mod.SERVER_CARD);
  }
  return serverCardPromise;
}

function createAurelianFloMcpServerCardHandler() {
  return async function aurelianFloMcpServerCardHandler(_req, res, next) {
    try {
      const serverCard = await getServerCard();
      res.json(serverCard);
    } catch (error) {
      next(error);
    }
  };
}

function createAurelianFloMcpExpressBridge(options = {}) {
  return async function aurelianFloMcpExpressBridge(req, res, next) {
    try {
      const baseUrl = `${req.protocol || "https"}://${typeof req.get === "function" ? req.get("host") : req.headers.host}`;
      if (req.method === "OPTIONS") {
        res.setHeader("Allow", "GET, POST, OPTIONS");
        res.status(204).end();
        return;
      }
      if (req.method === "HEAD") {
        res.status(200).end();
        return;
      }
      if (req.method === "GET") {
        const serverCard = await getServerCard();
        res.json({
          name: serverCard.serverInfo?.name || "AurelianFlo",
          transport: "streamable-http",
          endpoint: `${baseUrl}/mcp`,
          serverCard: `${baseUrl}/.well-known/mcp/server-card.json`,
          docs: `${baseUrl}/mcp/docs`,
          privacy: `${baseUrl}/mcp/privacy`,
          support: `${baseUrl}/mcp/support`,
          icon: serverCard.serverInfo?.iconUrl || `${baseUrl}/aurelianflo-icon.png`,
          icons: serverCard.serverInfo?.icons || [],
          configSchema: serverCard.configSchema || {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          security: {
            userAuthenticationRequired: false,
            paymentRequired: true,
            paymentProtocol: "x402",
            paymentAsset: "USDC",
            paymentNetwork: "base",
          },
          prompts: serverCard.prompts || [],
          methods: ["POST"],
        });
        return;
      }
      const expressHandler = await getExpressMcpHandler(options);
      await expressHandler(req, res, next);
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

module.exports = {
  createAurelianFloMcpExpressBridge,
  createAurelianFloMcpServerCardHandler,
  __internal: {
    toFetchRequest,
    invokeLocalMcpTool,
  },
};
