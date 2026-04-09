const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const fetch = require("node-fetch");
const { decodePaymentRequiredHeader } = require("@x402/core/http");
const { bazaarResourceServerExtension } = require("@x402/extensions/bazaar");
const genericSimulatorSellerConfig = require("../apps/generic-parameter-simulator/seller.config.json");

const {
  PAY_TO,
  X402_NETWORK,
  createApp,
  createPaymentResourceServer,
  sanitizeAcceptedRequirements,
  sanitizePaymentPayloadForMatching,
} = require("../app");

function getSellerRoutes(config) {
  if (Array.isArray(config?.routes) && config.routes.length) {
    return config.routes;
  }

  return config?.route ? [config.route] : [];
}

function buildCanonicalResourceUrl(baseUrl, resourcePath) {
  if (!resourcePath) {
    return null;
  }

  if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
    return resourcePath;
  }

  return `${String(baseUrl || "").replace(/\/+$/, "")}${resourcePath}`;
}

function getCanonicalSellerResources(config) {
  const baseUrl = config?.baseUrl || "https://api.aurelianflo.com";
  return getSellerRoutes(config)
    .map((route) => buildCanonicalResourceUrl(baseUrl, route.canonicalPath || route.resourcePath))
    .filter(Boolean);
}

function createStubFacilitator() {
  return {
    url: "https://api.cdp.coinbase.com/platform/v2/x402",
    verify: async () => ({ isValid: true }),
    settle: async () => ({
      success: true,
      transaction: "0x123",
      network: X402_NETWORK,
    }),
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }],
      extensions: [],
      signers: {},
    }),
  };
}

function decodeRawPaymentRequiredHeader(headerValue) {
  return JSON.parse(Buffer.from(String(headerValue), "base64").toString("utf8"));
}

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
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("requiring index.js does not start the server", (t) => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./index'); console.log('loaded');"],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 10000,
    },
  );

  if (result.error?.code === "EPERM") {
    t.skip("spawnSync is blocked in this execution environment");
    return;
  }

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded/);
  assert.doesNotMatch(result.stdout, /running on port/i);
});

test("health check stays free", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/?format=json`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, "AurelianFlo");
    assert.equal(body.payment.protocol, "x402");
    assert.ok(body.catalog.length > 0);
  });
});

test("health root serves title/description metadata when HTML is requested", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { Accept: "text/html" },
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(String(response.headers.get("content-type") || ""), /text\/html/i);
    assert.match(body, /<title>AurelianFlo<\/title>/i);
    assert.match(body, /<meta name="description" content="AurelianFlo is a pay-per-call API for enhanced due diligence memos/i);
    assert.match(body, /OFAC wallet screening/i);
    assert.match(body, /audit-ready document output \(PDF, DOCX, XLSX\)/i);
    assert.doesNotMatch(body, /finance scenario workflows|vendor due diligence|Monte Carlo/i);
  });
});

test("api discovery endpoint lists the compliance-first public surface without payment", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api?format=json`, {
      headers: { Accept: "application/json" },
    });
    const body = await response.json();
    const routeKeys = new Set(body.catalog.map((entry) => entry.routeKey));
    const eddEntry = body.catalog.find((entry) => entry.routeKey === "POST /api/workflows/compliance/edd-report");
    const reportPdfEntry = body.catalog.find((entry) => entry.routeKey === "POST /api/tools/report/pdf/generate");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body.name, "AurelianFlo");
    assert.equal(body.payment.protocol, "x402");
    assert.ok(Array.isArray(body.catalog));
    assert.equal(body.catalog.length, 8);
    assert.ok(eddEntry);
    assert.equal(eddEntry.category, "workflows/compliance");
    assert.equal(eddEntry.priceUsd, 0.25);
    assert.equal(
      eddEntry.exampleUrl,
      "https://api.aurelianflo.com/api/workflows/compliance/edd-report",
    );
    assert.ok(reportPdfEntry);
    assert.equal(reportPdfEntry.category, "generated/document");
    assert.ok(routeKeys.has("GET /api/ofac-wallet-screen/:address"));
    assert.ok(routeKeys.has("POST /api/workflows/compliance/batch-wallet-screen"));
    assert.ok(!routeKeys.has("POST /api/workflows/vendor/risk-assessment"));
    assert.ok(!routeKeys.has("POST /api/workflows/finance/cash-runway-forecast"));
    assert.ok(!routeKeys.has("POST /api/sim/report"));
    assert.equal(eddEntry.payment.network, X402_NETWORK);
  });
});

test("openapi document is publicly reachable with title and icon metadata", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    const body = await response.json();
    const fullResponse = await fetch(`${baseUrl}/openapi-full.json`);
    const fullBody = await fullResponse.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body.openapi, "3.1.0");
    assert.equal(body.info.title, "AurelianFlo");
    assert.equal(body.info.version, "1.0.0");
    assert.equal(body.info["x-logo"].url, "https://api.aurelianflo.com/favicon.ico");
    assert.equal(body.servers[0].url, "https://api.aurelianflo.com");
    assert.match(body.info.description, /enhanced due diligence memos/i);
    assert.match(body.info.description, /OFAC wallet screening/i);
    assert.match(body.info.description, /audit-ready document output \(PDF, DOCX, XLSX\)/i);
    assert.ok(body.paths["/api/workflows/compliance/edd-report"]?.post);
    assert.ok(body.paths["/api/tools/report/pdf/generate"]?.post);
    assert.ok(!body.paths["/api/stocks/search"]?.get);
    assert.ok(!body.paths["/api/workflows/vendor/risk-assessment"]?.post);
    assert.ok(!body.paths["/api/workflows/finance/cash-runway-forecast"]?.post);
    assert.ok(!body.paths["/api/sim/report"]?.post);
    assert.equal(fullResponse.status, 200);
    assert.ok(!fullBody.paths["/api/stocks/search"]?.get);
  });
});

test("favicon endpoint is publicly reachable", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/favicon.ico`);
    const payload = await response.buffer();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.match(String(response.headers.get("content-type") || ""), /image\/png/i);
    assert.ok(payload.length > 0);
  });
});

test("simulation landing endpoint is free and exposes composability guide", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sim`);
    const body = await response.json();
    const endpointPaths = body.endpoints.map((endpoint) => endpoint.path);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body.name, "Bazaar Simulation Suite");
    assert.equal(body.version, "1.0.0");
    assert.equal(Array.isArray(body.endpoints), true);
    assert.equal(body.endpoints.length, 8);
    assert.deepEqual(endpointPaths, [
      "/api/sim/probability",
      "/api/sim/batch-probability",
      "/api/sim/compare",
      "/api/sim/sensitivity",
      "/api/sim/forecast",
      "/api/sim/composed",
      "/api/sim/optimize",
      "/api/sim/report",
    ]);
    assert.equal(body.endpoints[0].price, "$0.05");
    assert.equal(body.endpoints[7].price, "$0.09");
    assert.ok(Array.isArray(body.composability?.pipeline_pattern));
    assert.ok(Array.isArray(body.composability?.example_pipelines));
  });
});

test("well-known x402 manifest is publicly reachable", async () => {
  const app = createApp({ enableDebugRoutes: false });
  const genericSimulatorResources = getCanonicalSellerResources(genericSimulatorSellerConfig);
  const genericSimulatorBaseUrl = String(
    genericSimulatorSellerConfig?.baseUrl || "https://api.aurelianflo.com",
  ).replace(/\/+$/, "");

  await withServer(app, async (baseUrl) => {
    const standardPathResponse = await fetch(`${baseUrl}/.well-known/x402`);
    const standardPathBody = await standardPathResponse.json();
    const dotWellKnownResponse = await fetch(`${baseUrl}/.well-known/x402-aurelian.json`);
    const dotWellKnownBody = await dotWellKnownResponse.json();

    assert.equal(standardPathResponse.status, 200);
    assert.equal(standardPathBody.version, 1);
    assert.ok(Array.isArray(standardPathBody.resources));
    assert.deepEqual(standardPathBody.resources, [
      "https://api.aurelianflo.com/api/workflows/compliance/edd-report",
      "https://api.aurelianflo.com/api/workflows/compliance/batch-wallet-screen",
      "https://api.aurelianflo.com/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96?asset=ETH",
      "https://api.aurelianflo.com/api/tools/report/pdf/generate",
      "https://api.aurelianflo.com/api/tools/report/docx/generate",
      "https://api.aurelianflo.com/api/tools/report/xlsx/generate",
    ]);
    assert.equal(standardPathBody.endpointCount, 6);
    assert.equal(dotWellKnownResponse.status, 200);
    assert.equal(dotWellKnownBody.name, "AurelianFlo");
    assert.equal(dotWellKnownBody.website, "https://aurelianflo.com");
    assert.ok(Array.isArray(dotWellKnownBody.resources));
    assert.ok(dotWellKnownBody.resources.length <= 8);
    assert.match(String(dotWellKnownBody.instructions || ""), /## Primary Surface/);
    assert.doesNotMatch(String(dotWellKnownBody.instructions || ""), /vendor due diligence|Monte Carlo|finance scenario/i);
    assert.ok(Array.isArray(dotWellKnownBody.endpoints));
    assert.ok(dotWellKnownBody.endpoints.every((endpoint) => String(endpoint.path || "").startsWith("/api/workflows/compliance/") || String(endpoint.path || "").startsWith("/api/tools/report/") || String(endpoint.path || "") === "/api/ofac-wallet-screen/:address"));
    assert.ok(!dotWellKnownBody.resources.includes(`${genericSimulatorBaseUrl}/methodology`));
    assert.ok(!dotWellKnownBody.resources.includes(`${genericSimulatorBaseUrl}/integrations/payments-mcp`));
  });
});

test("well-known x402 manifest includes env-driven ownership proofs", async () => {
  const proofA = `0x${"a".repeat(130)}`;
  const proofB = `0x${"b".repeat(130)}`;
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      ...process.env,
      X402_OWNERSHIP_PROOFS: JSON.stringify([proofA, proofB, "not-a-signature"]),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/x402-aurelian.json`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.ownershipProofs, [proofA, proofB]);
  });
});

test("402index verification file is publicly reachable", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    index402VerificationHash: "test-verification-hash",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/402index-verify.txt`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body, "test-verification-hash");
  });
});

test("main app bucket exposes only the compliance-first public surface", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api?format=json`, {
      headers: { Accept: "application/json" },
    });
    const discoveryBody = await discoveryResponse.json();
    const routeKeys = new Set(discoveryBody.catalog.map((entry) => entry.routeKey));

    assert.equal(discoveryResponse.status, 200);
    assert.ok(routeKeys.has("GET /api/ofac-wallet-screen/:address"));
    assert.ok(routeKeys.has("POST /api/workflows/compliance/edd-report"));
    assert.ok(routeKeys.has("POST /api/tools/report/pdf/generate"));
    assert.ok(!routeKeys.has("GET /api/vendor-entity-brief"));
    assert.ok(!routeKeys.has("POST /api/sim/report"));
    assert.ok(!routeKeys.has("POST /api/workflows/finance/cash-runway-forecast"));

    const cases = [
      {
        path: "/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96?asset=ETH",
        expectedAmount: "10000",
        expectedCategory: "compliance",
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}${testCase.path}`);
      const paymentRequired = decodePaymentRequiredHeader(response.headers.get("payment-required"));

      assert.equal(response.status, 402, testCase.path);
      assert.equal(paymentRequired.accepts[0].amount, testCase.expectedAmount, testCase.path);
      assert.equal(paymentRequired.accepts[0].category, testCase.expectedCategory, testCase.path);
    }
  });
});

test("full discovery keeps only the curated AurelianFlo route inventory", async () => {
  const app = createApp({
    env: { NODE_ENV: "production" },
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/discovery/full?limit=500`, {
      headers: { Accept: "application/json" },
    });
    const body = await response.json();
    const routeKeys = new Set(body.catalog.map((entry) => entry.routeKey));

    assert.equal(response.status, 200);
    assert.ok(routeKeys.has("POST /api/workflows/compliance/edd-report"));
    assert.ok(routeKeys.has("POST /api/tools/report/xlsx/generate"));
    assert.ok(routeKeys.has("POST /api/tools/report/generate"));
    assert.ok(!routeKeys.has("GET /api/stocks/quote/*"));
    assert.ok(!routeKeys.has("GET /api/treasury-rates"));
    assert.ok(!routeKeys.has("GET /api/weather/historical"));
    assert.ok(!routeKeys.has("GET /api/sec/filings/*"));
    assert.ok(!routeKeys.has("GET /api/sports/odds/*"));
    assert.ok(!routeKeys.has("GET /api/courts/opinions"));
    assert.ok(!routeKeys.has("POST /api/tools/contract/generate"));
    assert.ok(!routeKeys.has("POST /api/tools/password/generate"));
    assert.ok(!routeKeys.has("GET /api/vendor-entity-brief"));
    assert.ok(!routeKeys.has("POST /api/sim/report"));
    assert.ok(!routeKeys.has("POST /api/workflows/finance/pricing-scenario-forecast"));
    assert.ok(!routeKeys.has("POST /api/workflows/vendor/risk-forecast"));
  });
});

test("non-whitelisted endpoints are removed from serving, not just discovery", async () => {
  const app = createApp({
    env: { NODE_ENV: "production" },
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const removedGet = await fetch(`${baseUrl}/api/weather/current/40.7128/-74.0060`, {
      headers: { Accept: "application/json" },
    });
    assert.equal(removedGet.status, 404);

    const removedPost = await fetch(`${baseUrl}/api/tools/password/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ length: 20 }),
    });
    assert.equal(removedPost.status, 404);

    const keptRoute = await fetch(`${baseUrl}/api/workflows/compliance/edd-report`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: { name: "Canary" },
        wallets: ["0x098B716B8Aaf21512996dC57EB0615e2383E2f96"],
      }),
    });
    assert.equal(keptRoute.status, 402);
  });
});

test("protected routes return x402 payment requirements without a payment header", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vin/1HGCM82633A004352`);
    const body = await response.json();
    const paymentRequiredHeader = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    assert.deepEqual(body, paymentRequired);
    assert.equal(paymentRequired.x402Version, 2);
    assert.equal(paymentRequired.error, "Payment required");
    assert.equal(paymentRequired.accepts[0].network, X402_NETWORK);
    assert.equal(paymentRequired.accepts[0].scheme, "exact");
    assert.equal(paymentRequired.accepts[0].amount, "8000");
    assert.equal(paymentRequired.accepts[0].payTo, PAY_TO);
  });
});

test("payment-required header includes route metadata and facilitator for indexers", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/current/40.7128/-74.0060`);
    const paymentRequiredHeader = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);

    const rawPaymentRequired = decodeRawPaymentRequiredHeader(paymentRequiredHeader);
    const firstAccept = rawPaymentRequired.accepts[0];
    const bazaarInfo = rawPaymentRequired.extensions?.bazaar?.info;

    assert.equal(bazaarInfo?.category, "real-time-data/weather");
    assert.equal(bazaarInfo?.price, "$0.005");
    assert.deepEqual(bazaarInfo?.tags, ["weather", "current-conditions", "decision-support"]);
    assert.match(
      String(bazaarInfo?.description || ""),
      /Actionable weather decision brief/i,
    );
    assert.equal(firstAccept.network, X402_NETWORK);
    assert.equal(firstAccept.scheme, "exact");
  });
});

test("flagship OFAC route advertises the canonical public resource path", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96?asset=ETH`,
    );
    const paymentRequiredHeader = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);

    const rawPaymentRequired = decodeRawPaymentRequiredHeader(paymentRequiredHeader);
    const firstAccept = rawPaymentRequired.accepts[0];

    assert.equal(
      firstAccept.resource,
      "https://api.aurelianflo.com/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    );
  });
});

test.skip("path-based weather route returns x402 payment requirements without a payment header", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/current/40.7128/-74.0060`);
    const body = await response.json();
    const paymentRequiredHeader = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    assert.deepEqual(body, paymentRequired);
    assert.equal(paymentRequired.accepts[0].amount, "5000");
    assert.equal(paymentRequired.accepts[0].payTo, PAY_TO);
  });
});

test.skip("exchange base route advertises its own canonical resource", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/exchange-rates/USD`);
    const paymentRequired = decodePaymentRequiredHeader(
      response.headers.get("payment-required"),
    );

    assert.equal(response.status, 402);
    assert.equal(
      paymentRequired.resource.url,
      "https://x402.aurelianflo.com/api/exchange-rates/USD",
    );
    assert.equal(paymentRequired.accepts[0].amount, "12000");
  });
});

test.skip("exchange quote route advertises quote canonical resource", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/exchange-rates/quote/USD/EUR/100`);
    const paymentRequired = decodePaymentRequiredHeader(
      response.headers.get("payment-required"),
    );

    assert.equal(response.status, 402);
    assert.equal(
      paymentRequired.resource.url,
      "https://x402.aurelianflo.com/api/exchange-rates/quote/USD/EUR/100",
    );
    assert.equal(paymentRequired.accepts[0].amount, "12000");
  });
});

test.skip("weather current query route advertises its own canonical resource", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/current`);
    const paymentRequired = decodePaymentRequiredHeader(
      response.headers.get("payment-required"),
    );

    assert.equal(response.status, 402);
    assert.equal(
      paymentRequired.resource.url,
      "https://x402.aurelianflo.com/api/weather/current",
    );
    assert.equal(paymentRequired.accepts[0].amount, "5000");
  });
});

test.skip("head requests to paid holiday routes return payment requirements instead of a free 200", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/holidays/today/US`, { method: "HEAD" });
    const paymentRequiredHeader = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    assert.equal(paymentRequired.accepts[0].amount, "8000");
    assert.equal(paymentRequired.accepts[0].payTo, PAY_TO);
  });
});

test.skip("next business day route returns x402 payment requirements without a payment header", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/business-days/next/US/2026-03-15?tz=America/New_York`,
    );
    const paymentRequired = decodePaymentRequiredHeader(
      response.headers.get("payment-required"),
    );

    assert.equal(response.status, 402);
    assert.equal(
      paymentRequired.resource.url,
      "https://x402.aurelianflo.com/api/business-days/next/US/2026-03-15",
    );
    assert.equal(paymentRequired.accepts[0].amount, "8000");
  });
});

test.skip("query-driven routes advertise stable canonical resource URLs", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  const cases = [
    {
      path: "/api/weather/forecast?lat=40.7128&lon=-74.0060&days=7",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/forecast",
    },
    {
      path: "/api/nutrition/search?query=chicken%20breast&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/nutrition/search",
    },
    {
      path: "/api/fda/recalls?query=peanut&limit=10",
      expectedResource:
        "https://x402.aurelianflo.com/api/fda/recalls",
    },
    {
      path: "/api/census/population?state=06",
      expectedResource:
        "https://x402.aurelianflo.com/api/census/population",
    },
    {
      path: "/api/bls/cpi?years=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/bls/cpi",
    },
    {
      path: "/api/congress/bills?congress=119&limit=20",
      expectedResource:
        "https://x402.aurelianflo.com/api/congress/bills",
    },
    {
      path: "/api/stocks/search?q=apple&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/stocks/search",
    },
    {
      path: "/api/stocks/candles/AAPL?interval=daily&limit=10",
      expectedResource:
        "https://x402.aurelianflo.com/api/stocks/candles/AAPL",
    },
    {
      path: "/api/commodities/gold?limit=30",
      expectedResource:
        "https://x402.aurelianflo.com/api/commodities/gold",
    },
    {
      path: "/api/commodities/oil?limit=30",
      expectedResource:
        "https://x402.aurelianflo.com/api/commodities/oil",
    },
    {
      path: "/api/mortgage-rates?limit=52",
      expectedResource:
        "https://x402.aurelianflo.com/api/mortgage-rates",
    },
    {
      path: "/api/sp500?limit=60",
      expectedResource:
        "https://x402.aurelianflo.com/api/sp500",
    },
    {
      path: "/api/vix?limit=60",
      expectedResource:
        "https://x402.aurelianflo.com/api/vix",
    },
    {
      path: "/api/dollar-index?limit=60",
      expectedResource:
        "https://x402.aurelianflo.com/api/dollar-index",
    },
    {
      path: "/api/credit-spreads?limit=24",
      expectedResource:
        "https://x402.aurelianflo.com/api/credit-spreads",
    },
    {
      path: "/api/real-rates?limit=60",
      expectedResource:
        "https://x402.aurelianflo.com/api/real-rates",
    },
    {
      path: "/api/inflation-expectations?limit=60",
      expectedResource:
        "https://x402.aurelianflo.com/api/inflation-expectations",
    },
    {
      path: "/api/weather/historical?lat=40.7128&lon=-74.0060&start=2026-03-01&end=2026-03-07",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/historical",
    },
    {
      path: "/api/weather/marine?lat=40.7128&lon=-74.0060&hours=24",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/marine",
    },
    {
      path: "/api/weather/air-quality?zip=20002",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/air-quality",
    },
    {
      path: "/api/weather/extremes?lat=40.7128&lon=-74.0060&days=7",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/extremes",
    },
    {
      path: "/api/weather/freeze-risk?lat=40.7128&lon=-74.0060&days=10&threshold_f=32",
      expectedResource:
        "https://x402.aurelianflo.com/api/weather/freeze-risk",
    },
    {
      path: "/api/census/housing?state=06",
      expectedResource:
        "https://x402.aurelianflo.com/api/census/housing",
    },
    {
      path: "/api/census/age-breakdown?state=06",
      expectedResource:
        "https://x402.aurelianflo.com/api/census/age-breakdown",
    },
    {
      path: "/api/fda/medical-devices?query=pump&limit=10",
      expectedResource:
        "https://x402.aurelianflo.com/api/fda/medical-devices",
    },
    {
      path: "/api/fda/device-recalls?query=pacemaker&limit=10",
      expectedResource:
        "https://x402.aurelianflo.com/api/fda/device-recalls",
    },
    {
      path: "/api/geocode?q=Chicago&limit=3",
      expectedResource:
        "https://x402.aurelianflo.com/api/geocode",
    },
    {
      path: "/api/courts/cases?query=antitrust&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/courts/cases",
    },
    {
      path: "/api/courts/opinions?query=antitrust&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/courts/opinions",
    },
    {
      path: "/api/courts/citations?citation=410%20U.S.%20113&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/courts/citations?citation=410+U.S.+113",
    },
    {
      path: "/api/courts/court-info?id=scotus&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/courts/court-info",
    },
    {
      path: "/api/courts/clusters?query=antitrust&limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/courts/clusters",
    },
  ];

  await withServer(app, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}${testCase.path}`);
      const paymentRequired = decodePaymentRequiredHeader(
        response.headers.get("payment-required"),
      );

      assert.equal(response.status, 402);
      assert.equal(paymentRequired.resource.url, testCase.expectedResource);
    }
  });
});

test.skip("path aliases and new path routes advertise stable canonical resource URLs", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  const cases = [
    {
      path: "/api/fda/drug-events/aspirin?limit=5",
      expectedResource:
        "https://x402.aurelianflo.com/api/fda/drug-events/aspirin",
    },
    {
      path: "/api/census/income/20002",
      expectedResource:
        "https://x402.aurelianflo.com/api/census/income/20002",
    },
    {
      path: "/api/uv-index/40.7128/-74.0060",
      expectedResource:
        "https://x402.aurelianflo.com/api/uv-index/40.7128/-74.0060",
    },
    {
      path: "/api/sec/filings/AAPL",
      expectedResource:
        "https://x402.aurelianflo.com/api/sec/filings/AAPL",
    },
    {
      path: "/api/dns/example.com",
      expectedResource:
        "https://x402.aurelianflo.com/api/dns/example.com",
    },
    {
      path: "/api/sports/odds/nfl?regions=us",
      expectedResource:
        "https://x402.aurelianflo.com/api/sports/odds/nfl",
    },
    {
      path: "/api/worldbank/US/NY.GDP.MKTP.CD?date=2020:2025",
      expectedResource:
        "https://x402.aurelianflo.com/api/worldbank/US/NY.GDP.MKTP.CD",
    },
  ];

  await withServer(app, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}${testCase.path}`);
      const paymentRequired = decodePaymentRequiredHeader(
        response.headers.get("payment-required"),
      );

      assert.equal(response.status, 402);
      assert.equal(paymentRequired.resource.url, testCase.expectedResource);
    }
  });
});

test("async payment middleware failures are caught and returned as 500 responses", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => ({}),
    paymentMiddlewareFactory: () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("boom");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vin/1HGCM82633A004352`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, "Payment middleware init failed");
    assert.equal(body.details, "boom");
  });
});

test("facilitator init failures retry within the same unpaid request", async () => {
  let middlewareFactoryCalls = 0;
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
    paymentMiddlewareFactory: () => {
      middlewareFactoryCalls += 1;
      if (middlewareFactoryCalls === 1) {
        throw new Error(
          "Failed to initialize: no supported payment kinds loaded from any facilitator.",
        );
      }

      return async (_req, res) => {
        res.status(418).json({ ok: true });
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vin/1HGCM82633A004352`);
    const body = await response.json();

    assert.equal(response.status, 418);
    assert.deepEqual(body, { ok: true });
    assert.equal(middlewareFactoryCalls, 2);
  });
});

test("facilitator init failures retry within the same paid request", async () => {
  let middlewareFactoryCalls = 0;
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
    paymentMiddlewareFactory: () => {
      middlewareFactoryCalls += 1;
      if (middlewareFactoryCalls === 1) {
        throw new Error(
          "Failed to initialize: no supported payment kinds loaded from any facilitator.",
        );
      }

      return async (_req, res) => {
        res.status(418).json({ ok: true });
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vin/1HGCM82633A004352`, {
      headers: {
        "x-payment": "test",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 418);
    assert.deepEqual(body, { ok: true });
    assert.equal(middlewareFactoryCalls, 2);
  });
});

test("payment resource server registers the Bazaar discovery extension", () => {
  const recorded = {
    extensions: [],
    registerCalls: [],
  };
  const stubFacilitator = createStubFacilitator();
  const stubScheme = { scheme: "exact" };

  class StubResourceServer {
    constructor(facilitatorClient) {
      recorded.facilitatorClient = facilitatorClient;
    }

    register(network, scheme) {
      recorded.registerCalls.push({ network, scheme });
      return this;
    }

    registerExtension(extension) {
      recorded.extensions.push(extension);
      return this;
    }

    onVerifyFailure(handler) {
      recorded.verifyFailureHandler = handler;
      return this;
    }

    onSettleFailure(handler) {
      recorded.settleFailureHandler = handler;
      return this;
    }
  }

  const resourceServer = createPaymentResourceServer({
    facilitator: stubFacilitator,
    resourceServerClass: StubResourceServer,
    schemeFactory: () => stubScheme,
  });

  assert.ok(resourceServer instanceof StubResourceServer);
  assert.deepEqual(recorded.registerCalls, [
    { network: X402_NETWORK, scheme: stubScheme },
  ]);
  assert.deepEqual(recorded.extensions, [bazaarResourceServerExtension]);
  assert.equal(typeof recorded.verifyFailureHandler, "function");
  assert.equal(typeof recorded.settleFailureHandler, "function");
});

test("accepted requirement sanitizer keeps x402 core fields only", () => {
  const sanitized = sanitizeAcceptedRequirements({
    scheme: "exact",
    network: X402_NETWORK,
    amount: "3000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
    category: "real-time-data/weather",
    facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
    tags: ["weather"],
  });

  assert.deepEqual(sanitized, {
    scheme: "exact",
    network: X402_NETWORK,
    amount: "3000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
  });
});

test("payment payload sanitizer strips extended accepted metadata for v2 matching", () => {
  const paymentPayload = {
    x402Version: 2,
    payload: { foo: "bar" },
    accepted: {
      scheme: "exact",
      network: X402_NETWORK,
      amount: "3000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
      category: "real-time-data/weather",
      facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
      tags: ["weather"],
    },
  };

  const sanitized = sanitizePaymentPayloadForMatching(paymentPayload);

  assert.deepEqual(sanitized.accepted, {
    scheme: "exact",
    network: X402_NETWORK,
    amount: "3000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
  });
});

test("paid routes only pass through the payment gate once per request", async () => {
  let paymentGateCalls = 0;
  const paymentGate = (req, res, next) => {
    paymentGateCalls += 1;
    next();
  };

  const app = createApp({
    enableDebugRoutes: false,
    paymentGate,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/holidays/today/US`);

    assert.equal(response.status, 200);
    assert.equal(paymentGateCalls, 1);
  });
});

