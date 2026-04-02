const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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
  const baseUrl = config?.baseUrl || "https://x402.aurelianflo.com";
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

test("requiring index.js does not start the server", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./index'); console.log('loaded');"],
    {
      cwd: __dirname + "\\..",
      encoding: "utf8",
      timeout: 5000,
    },
  );

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
    assert.equal(body.name, "AurelianFlo APIs");
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
    assert.match(body, /<title>AurelianFlo APIs<\/title>/i);
    assert.match(
      body,
      /<meta name="description" content="Curated, high-signal endpoints with x402-native access\."/i,
    );
    assert.match(body, /Endpoints indexed: 40/i);
  });
});

test("api discovery endpoint lists concrete endpoint metadata without payment", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api`);
    const body = await response.json();
    const weatherEntry = body.catalog.find((entry) => entry.routeKey === "GET /api/weather/current/*");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body.name, "AurelianFlo APIs");
    assert.equal(body.payment.protocol, "x402");
    assert.equal(body.profile, "compact");
    assert.equal(body.endpoints, 40);
    assert.equal(body.totalEndpoints > body.endpoints, true);
    assert.equal(body.navigation?.mode, "core40");
    assert.ok(Array.isArray(body.catalog));
    assert.ok(body.catalog.length > 0);
    assert.ok(weatherEntry);
    assert.equal(weatherEntry.category, "real-time-data/weather");
    assert.equal(weatherEntry.priceUsd, 0.005);
    assert.equal(
      weatherEntry.exampleUrl,
      "https://x402.aurelianflo.com/api/weather/current/40.7128/-74.0060",
    );
    assert.equal(weatherEntry.payment.network, X402_NETWORK);
  });
});

test("system discovery alias exposes the same core-first contract", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/discovery`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.profile, "compact");
    assert.equal(body.endpoints, 40);
    assert.equal(body.navigation?.mode, "core40");
    assert.equal(String(body.navigation?.expand?.full || "").includes("?profile=full"), true);
  });
});

test("openapi document is publicly reachable with title and icon metadata", async () => {
  const app = createApp({ enableDebugRoutes: false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(body.openapi, "3.1.0");
    assert.equal(body.info.title, "AurelianFlo APIs");
    assert.equal(body.info.version, "1.0.0");
    assert.equal(body.info["x-logo"].url, "https://x402.aurelianflo.com/favicon.ico");
    assert.equal(body.servers[0].url, "https://x402.aurelianflo.com");
    assert.ok(body.paths["/api/stocks/search"]?.get);
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
    assert.equal(body.endpoints.length, 6);
    assert.deepEqual(endpointPaths, [
      "/api/sim/probability",
      "/api/sim/compare",
      "/api/sim/sensitivity",
      "/api/sim/forecast",
      "/api/sim/composed",
      "/api/sim/optimize",
    ]);
    assert.equal(body.endpoints[0].price, "$0.05");
    assert.equal(body.endpoints[5].price, "$0.10");
    assert.ok(Array.isArray(body.composability?.pipeline_pattern));
    assert.ok(Array.isArray(body.composability?.example_pipelines));
  });
});

test("well-known x402 manifest is publicly reachable", async () => {
  const app = createApp({ enableDebugRoutes: false });
  const genericSimulatorResources = getCanonicalSellerResources(genericSimulatorSellerConfig);
  const genericSimulatorBaseUrl = String(
    genericSimulatorSellerConfig?.baseUrl || "https://x402.aurelianflo.com",
  ).replace(/\/+$/, "");

  await withServer(app, async (baseUrl) => {
    const standardPathResponse = await fetch(`${baseUrl}/.well-known/x402`);
    const standardPathBody = await standardPathResponse.json();
    const dotWellKnownResponse = await fetch(`${baseUrl}/.well-known/x402-aurelian.json`);
    const dotWellKnownBody = await dotWellKnownResponse.json();

    assert.equal(standardPathResponse.status, 200);
    assert.equal(standardPathBody.version, 1);
    assert.ok(Array.isArray(standardPathBody.resources));
    assert.equal(standardPathBody.resources.length, 40);
    assert.equal(standardPathBody.discovery?.mode, "core40");
    assert.equal(dotWellKnownResponse.status, 200);
    assert.equal(dotWellKnownBody.name, "AurelianFlo APIs");
    assert.equal(dotWellKnownBody.website, "https://x402.aurelianflo.com");
    assert.ok(Array.isArray(dotWellKnownBody.resources));
    assert.equal(dotWellKnownBody.resources.length, 40);
    assert.match(String(dotWellKnownBody.instructions || ""), /## Composable Simulations/);
    assert.ok(Array.isArray(dotWellKnownBody.endpoints));
    assert.equal(dotWellKnownBody.endpoints.length, 40);
    assert.equal(dotWellKnownBody.discovery?.mode, "core40");
    assert.equal(dotWellKnownBody.fullEndpointCount > dotWellKnownBody.endpointCount, true);

    const simulationEndpoints = dotWellKnownBody.endpoints.filter(
      (endpoint) =>
        endpoint.method === "POST" && String(endpoint.path || "").startsWith("/api/sim/"),
    );
    assert.equal(simulationEndpoints.length, 6);
    for (const endpoint of simulationEndpoints) {
      assert.equal(endpoint.composability?.pattern, "data-to-simulation", endpoint.path);
      assert.ok(typeof endpoint.composability?.description === "string", endpoint.path);
    }

    assert.ok(dotWellKnownBody.resources.includes(`${genericSimulatorBaseUrl}/api/sim/probability`));

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

test("main app bucket includes bundled seller routes including generic-parameter-simulator", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });
  const genericSimulatorRoutes = getSellerRoutes(genericSimulatorSellerConfig);

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api`);
    const discoveryBody = await discoveryResponse.json();
    const routeKeys = new Set(discoveryBody.catalog.map((entry) => entry.routeKey));

    assert.equal(discoveryResponse.status, 200);
    assert.ok(routeKeys.has("GET /api/ofac-sanctions-screening/*"));
    assert.ok(routeKeys.has("GET /api/vendor-onboarding/restricted-party-batch"));
    assert.ok(routeKeys.has("GET /api/restricted-party/screen/*"));
    assert.ok(routeKeys.has("GET /api/vendor-entity-brief"));

    for (const route of genericSimulatorRoutes) {
      assert.ok(routeKeys.has(route.key), route.key);
    }

    const cases = [
      {
        path: "/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5",
        expectedAmount: "5000",
      },
      {
        path: "/api/vendor-onboarding/restricted-party-batch?names=SBERBANK%7CVTB%20BANK%20PJSC&workflow=vendor-onboarding&minScore=90&limit=3",
        expectedAmount: "150000",
      },
      {
        path: "/api/restricted-party/screen/SBERBANK?minScore=90&limit=5",
        expectedAmount: "5000",
      },
      {
        path: "/api/vendor-entity-brief?name=SBERBANK&country=CZ&minScore=90&limit=3",
        expectedAmount: "250000",
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}${testCase.path}`);
      const paymentRequired = decodePaymentRequiredHeader(response.headers.get("payment-required"));

      assert.equal(response.status, 402, testCase.path);
      assert.equal(paymentRequired.accepts[0].amount, testCase.expectedAmount, testCase.path);
      assert.equal(paymentRequired.accepts[0].category, "identity", testCase.path);
    }
  });
});

test("api discovery includes representative all-tier expansion endpoints", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api?profile=full`);
    const body = await response.json();
    const routeKeys = new Set(body.catalog.map((entry) => entry.routeKey));

    assert.equal(response.status, 200);
    assert.equal(body.profile, "full");
    assert.ok(routeKeys.has("GET /api/stocks/quote/*"));
    assert.ok(routeKeys.has("GET /api/stocks/search"));
    assert.ok(routeKeys.has("GET /api/treasury-rates"));
    assert.ok(routeKeys.has("GET /api/commodities/gold"));
    assert.ok(routeKeys.has("GET /api/commodities/oil"));
    assert.ok(routeKeys.has("GET /api/mortgage-rates"));
    assert.ok(routeKeys.has("GET /api/sp500"));
    assert.ok(routeKeys.has("GET /api/vix"));
    assert.ok(routeKeys.has("GET /api/dollar-index"));
    assert.ok(routeKeys.has("GET /api/credit-spreads"));
    assert.ok(routeKeys.has("GET /api/real-rates"));
    assert.ok(routeKeys.has("GET /api/inflation-expectations"));
    assert.ok(routeKeys.has("GET /api/weather/historical"));
    assert.ok(routeKeys.has("GET /api/weather/air-quality"));
    assert.ok(routeKeys.has("GET /api/weather/extremes"));
    assert.ok(routeKeys.has("GET /api/weather/freeze-risk"));
    assert.ok(routeKeys.has("GET /api/census/income/*"));
    assert.ok(routeKeys.has("GET /api/fda/drug-events/*"));
    assert.ok(routeKeys.has("GET /api/geocode"));
    assert.ok(routeKeys.has("GET /api/dns/*"));
    assert.ok(routeKeys.has("GET /api/sec/filings/*"));
    assert.ok(routeKeys.has("GET /api/sports/odds/*"));
    assert.ok(routeKeys.has("GET /api/worldbank/*"));
    assert.ok(routeKeys.has("GET /api/courts/opinions"));
    assert.ok(routeKeys.has("GET /api/courts/citations"));
    assert.ok(routeKeys.has("GET /api/courts/court-info"));
    assert.ok(routeKeys.has("GET /api/courts/clusters"));
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

    assert.equal(firstAccept.category, "real-time-data/weather");
    assert.equal(firstAccept.maxAmountRequiredUSD, "$0.005");
    assert.equal(firstAccept.facilitator, "https://api.cdp.coinbase.com/platform/v2/x402");
    assert.equal(bazaarInfo?.category, "real-time-data/weather");
    assert.equal(bazaarInfo?.price, "$0.005");
    assert.deepEqual(bazaarInfo?.tags, ["weather", "current-conditions", "decision-support"]);
    assert.match(
      String(bazaarInfo?.description || ""),
      /Actionable weather decision brief/i,
    );
  });
});

test("path-based weather route returns x402 payment requirements without a payment header", async () => {
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

test("exchange base route advertises its own canonical resource", async () => {
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

test("exchange quote route advertises quote canonical resource", async () => {
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

test("weather current query route advertises its own canonical resource", async () => {
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

test("head requests to paid holiday routes return payment requirements instead of a free 200", async () => {
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

test("next business day route returns x402 payment requirements without a payment header", async () => {
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

test("query-driven routes advertise stable canonical resource URLs", async () => {
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

test("path aliases and new path routes advertise stable canonical resource URLs", async () => {
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

