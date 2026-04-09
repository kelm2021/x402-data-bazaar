const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const fetch = require("node-fetch");

const { createApp } = require("../app");
const { __internal } = require("../lib/aurelianflo-mcp-bridge");
const {
  OFAC_SDN_ADVANCED_XML_URL,
  resetDatasetCache,
} = require("../apps/restricted-party-screen/lib/ofac");
const { OFAC_WALLET_XML } = require("../apps/restricted-party-screen/test/fixtures/ofac-wallet-xml");

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(result);
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

async function withMockedOfacDataset(run) {
  const originalFetch = global.fetch;
  resetDatasetCache();
  global.fetch = async (url, options) => {
    if (String(url || "") === OFAC_SDN_ADVANCED_XML_URL) {
      return {
        ok: true,
        status: 200,
        text: async () => OFAC_WALLET_XML,
        headers: {
          get(name) {
            return String(name || "").toLowerCase() === "last-modified"
              ? "Mon, 07 Apr 2026 00:00:00 GMT"
              : null;
          },
        },
      };
    }

    if (typeof originalFetch === "function") {
      return originalFetch(url, options);
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };

  try {
    return await run();
  } finally {
    resetDatasetCache();
    global.fetch = originalFetch;
  }
}
test("root app serves the AurelianFlo server card", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/mcp/server-card.json`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.serverInfo.name, "AurelianFlo");
    assert.deepEqual(
      payload.tools.map((tool) => tool.name),
      [
        "server_capabilities",
        "ofac_wallet_report",
        "ofac_wallet_screen",
        "batch_wallet_screen",
        "edd_report",
        "monte_carlo_report",
        "monte_carlo_decision_report",
        "report_pdf_generate",
        "report_docx_generate",
      ],
    );
  });
});

test("root app mounts the /mcp route", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  const mountedPaths = (app.router?.stack || [])
    .map((layer) => layer?.route?.path)
    .filter(Boolean);

  assert.ok(mountedPaths.includes("/mcp"));
});

test("root app exposes MCP info and public docs pages", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const mcpResponse = await fetch(`${baseUrl}/mcp`);
    const mcpPayload = await mcpResponse.json();

    assert.equal(mcpResponse.status, 200);
    assert.equal(mcpPayload.name, "AurelianFlo");
    assert.equal(mcpPayload.transport, "streamable-http");
    assert.match(mcpPayload.docs, /\/mcp\/docs$/);
    assert.match(mcpPayload.privacy, /\/mcp\/privacy$/);
    assert.match(mcpPayload.support, /\/mcp\/support$/);
    assert.equal(mcpPayload.prompts.length, 4);
    assert.equal(mcpPayload.icons[0].src.endsWith("/aurelianflo-icon.png"), true);

    const docsResponse = await fetch(`${baseUrl}/mcp/docs`);
    const docsHtml = await docsResponse.text();
    assert.equal(docsResponse.status, 200);
    assert.match(docsHtml, /<title>AurelianFlo<\/title>/);
    assert.match(docsHtml, /codex mcp add aurelianflo --url https:\/\/api\.aurelianflo\.com\/mcp/);
    assert.match(docsHtml, /aurelianflo-core/);
    assert.match(docsHtml, /batch_wallet_screen/);
    assert.match(docsHtml, /edd_report/);
    assert.match(docsHtml, /monte_carlo_report/);
    assert.match(docsHtml, /Proof/);
    assert.match(docsHtml, /Lazarus Group/);
    assert.match(docsHtml, /candidate outperformance 0\.5903/i);

    const privacyResponse = await fetch(`${baseUrl}/mcp/privacy`);
    assert.equal(privacyResponse.status, 200);

    const supportResponse = await fetch(`${baseUrl}/mcp/support`);
    const supportHtml = await supportResponse.text();
    assert.equal(supportResponse.status, 200);
    assert.match(supportHtml, /support@aurelianflo\.com/);
  });
});

test("root app accepts streamable HTTP initialize requests on /mcp", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
        },
      }),
    });

    const payload = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^text\/event-stream/i);
    assert.match(payload, /"jsonrpc":"2\.0"/);
    assert.match(payload, /"id":1/);
    assert.match(payload, /"name":"AurelianFlo"/);
  });
});

test("root app serves a core-only x402 well-known manifest", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/x402`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.version, 1);
    assert.equal(payload.website, "https://aurelianflo.com");
    assert.ok(Array.isArray(payload.resources));
    assert.deepEqual(
      payload.resources.map((resource) => new URL(resource).pathname),
      [
        "/api/workflows/compliance/edd-report",
        "/api/workflows/compliance/batch-wallet-screen",
        "/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "/api/tools/report/pdf/generate",
        "/api/tools/report/docx/generate",
        "/api/tools/report/xlsx/generate",
      ],
    );
    assert.ok(Array.isArray(payload.endpoints));
    assert.deepEqual(
      payload.endpoints.map((endpoint) => endpoint.path),
      [
        "/api/workflows/compliance/edd-report",
        "/api/workflows/compliance/batch-wallet-screen",
        "/api/ofac-wallet-screen/:address",
        "/api/tools/report/pdf/generate",
        "/api/tools/report/docx/generate",
        "/api/tools/report/xlsx/generate",
      ],
    );
    assert.equal(payload.endpointCount, 6);
    assert.equal(payload.endpoints.some((endpoint) => endpoint.path === "/api/weather/current/*"), false);
  });
});

test("root app serves MCP registry auth proof when configured", async () => {
  const proof = "v=MCPv1; k=ed25519; p=test-public-key";
  const app = createApp({
    env: {
      MCP_REGISTRY_AUTH_PROOF: proof,
    },
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/mcp-registry-auth`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body, proof);
  });
});

test("root app hides MCP registry auth proof when unconfigured", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/mcp-registry-auth`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body, "");
  });
});

test("MCP bridge rebuilds POST JSON bodies instead of reusing consumed request streams", async () => {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  };

  const request = await __internal.toFetchRequest({
    protocol: "http",
    method: "POST",
    originalUrl: "/mcp",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      "content-length": "999",
    },
    body: payload,
    get(headerName) {
      return this.headers[String(headerName).toLowerCase()];
    },
  });

  assert.equal(request.headers.get("content-type"), "application/json");
  assert.equal(request.headers.get("content-length"), null);
  assert.equal(await request.text(), JSON.stringify(payload));
});

test("MCP bridge executes batch wallet screening through the local restricted-party handler", async () => {
  const payload = await withMockedOfacDataset(() => __internal.invokeLocalMcpTool(
    { name: "batch_wallet_screen" },
    {
      addresses: [
        "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "0x1111111111111111111111111111111111111111",
      ],
      asset: "ETH",
    },
  ));

  assert.equal(payload.success, true);
  assert.equal(payload.data.summary.totalScreened, 2);
  assert.equal(payload.data.summary.matchCount, 1);
  assert.equal(payload.data.summary.clearCount, 1);
  assert.equal(payload.data.summary.workflowStatus, "manual_review_required");
  assert.match(payload.report.executive_summary[0], /found 1 exact sanctioned wallet match/i);
});

test("MCP bridge executes EDD reporting through the local restricted-party handler", async () => {
  const payload = await withMockedOfacDataset(() => __internal.invokeLocalMcpTool(
    { name: "edd_report" },
    {
      subject_name: "Northwind Treasury Counterparty",
      case_name: "Counterparty onboarding review",
      review_reason: "Treasury payout review",
      jurisdiction: "US",
      requested_by: "ops@northwind.example",
      reference_id: "case-2026-04-07-001",
      output_format: "json",
      addresses: [
        "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "0x1111111111111111111111111111111111111111",
      ],
      asset: "ETH",
    },
  ));

  assert.equal(payload.success, true);
  assert.equal(payload.data.case.subjectName, "Northwind Treasury Counterparty");
  assert.equal(payload.data.workflowStatus, "manual_review_required");
  assert.equal(payload.data.screening.summary.matchCount, 1);
  assert.equal(payload.report.report_meta.report_type, "enhanced-due-diligence");
  assert.equal(payload.report.tables.screening_results.rows.length, 2);
});
test("MCP bridge uses deploy-traceable module imports", () => {
  const bridgeSource = fs.readFileSync(require.resolve("../lib/aurelianflo-mcp-bridge"), "utf8");

  assert.equal(
    bridgeSource.includes("pathToFileURL"),
    false,
    "bridge should use literal import specifiers so deployment bundlers can trace MCP dependencies",
  );
  assert.equal(
    bridgeSource.includes("express-handler.js"),
    false,
    "bridge should not rely on the nested express handler import, which can miss MCP SDK files in serverless bundles",
  );
});
