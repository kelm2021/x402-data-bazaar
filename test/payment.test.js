const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const fetch = require("node-fetch");
const { decodePaymentRequiredHeader } = require("@x402/core/http");
const { bazaarResourceServerExtension } = require("@x402/extensions/bazaar");

const {
  PAY_TO,
  X402_NETWORK,
  createApp,
  createPaymentResourceServer,
  sanitizeAcceptedRequirements,
  sanitizePaymentPayloadForMatching,
} = require("../app");

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
    const response = await fetch(`${baseUrl}/`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, "x402 Data Bazaar");
    assert.equal(body.payment.protocol, "x402");
    assert.ok(body.catalog.length > 0);
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
    assert.equal(body.name, "x402 Data Bazaar API Discovery");
    assert.equal(body.payment.protocol, "x402");
    assert.ok(Array.isArray(body.catalog));
    assert.ok(body.catalog.length > 0);
    assert.ok(weatherEntry);
    assert.equal(weatherEntry.category, "real-time-data/weather");
    assert.equal(weatherEntry.priceUsd, 0.005);
    assert.equal(
      weatherEntry.exampleUrl,
      "https://x402-data-bazaar.vercel.app/api/weather/current/40.7128/-74.0060",
    );
    assert.equal(weatherEntry.payment.network, X402_NETWORK);
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

    assert.equal(firstAccept.category, "real-time-data/weather");
    assert.equal(firstAccept.maxAmountRequiredUSD, "$0.005");
    assert.equal(firstAccept.facilitator, "https://api.cdp.coinbase.com/platform/v2/x402");
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
      "https://x402-data-bazaar.vercel.app/api/exchange-rates/USD",
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
      "https://x402-data-bazaar.vercel.app/api/exchange-rates/quote/USD/EUR/100",
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
      "https://x402-data-bazaar.vercel.app/api/weather/current",
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
      "https://x402-data-bazaar.vercel.app/api/business-days/next/US/2026-03-15",
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
        "https://x402-data-bazaar.vercel.app/api/weather/forecast",
    },
    {
      path: "/api/nutrition/search?query=chicken%20breast&limit=5",
      expectedResource:
        "https://x402-data-bazaar.vercel.app/api/nutrition/search",
    },
    {
      path: "/api/fda/recalls?query=peanut&limit=10",
      expectedResource:
        "https://x402-data-bazaar.vercel.app/api/fda/recalls",
    },
    {
      path: "/api/census/population?state=06",
      expectedResource:
        "https://x402-data-bazaar.vercel.app/api/census/population",
    },
    {
      path: "/api/bls/cpi?years=5",
      expectedResource:
        "https://x402-data-bazaar.vercel.app/api/bls/cpi",
    },
    {
      path: "/api/congress/bills?congress=119&limit=20",
      expectedResource:
        "https://x402-data-bazaar.vercel.app/api/congress/bills",
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
