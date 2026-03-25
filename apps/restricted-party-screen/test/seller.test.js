const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const fetch = require("node-fetch");
const { bazaarResourceServerExtension } = require("@x402/extensions/bazaar");
const { siwxResourceServerExtension } = require("@x402/extensions/sign-in-with-x");

const {
  PAY_TO,
  X402_NETWORK,
  createApp,
  createPaymentResourceServer,
  sellerConfig,
} = require("../app");
const {
  OFAC_CONSOLIDATED_LIST_URL,
  OFAC_SDN_LIST_URL,
  OFAC_SEARCH_URL,
  resetFreshnessCache,
} = require("../lib/ofac");

function getSellerRoutes() {
  if (Array.isArray(sellerConfig.routes) && sellerConfig.routes.length) {
    return sellerConfig.routes;
  }

  return sellerConfig.route ? [sellerConfig.route] : [];
}

function getPrimaryRoute() {
  return getSellerRoutes()[0];
}

function getVendorBatchRoute() {
  return getSellerRoutes().find(
    (route) => route.routePath === "/api/vendor-onboarding/restricted-party-batch",
  );
}

function buildRouteRequestPath(route, options = {}) {
  const basePath = route.canonicalPath || route.resourcePath || route.routePath;
  const includeQuery = Boolean(options.includeQuery);
  const queryExample =
    route && route.queryExample && typeof route.queryExample === "object"
      ? route.queryExample
      : null;

  if (!includeQuery || !queryExample || !Object.keys(queryExample).length) {
    return basePath;
  }

  const params = new URLSearchParams(
    Object.entries(queryExample).map(([key, value]) => [key, String(value)]),
  );
  return `${basePath}?${params.toString()}`;
}

function createStubFacilitator() {
  return {
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

function createJsonFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function withPatchedGlobalFetch(run, responder) {
  const originalFetch = global.fetch;
  resetFreshnessCache();
  global.fetch = responder;

  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = originalFetch;
      resetFreshnessCache();
    });
}

test("requiring index.js does not start the server", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./index'); console.log('loaded');"],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 5000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded/);
  assert.doesNotMatch(result.stdout, /running on port/i);
});

test("health check stays free", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, sellerConfig.serviceName);
    assert.equal(body.payment.protocol, "x402");
    assert.equal(body.payment.pricingDenomination, "USDC");
    assert.equal(body.catalog.length, getSellerRoutes().length);
    assert.match(body.catalog[0].path, /ofac-sanctions-screening/);
    assert.match(body.catalog[0].canonicalUrl, /ofac-sanctions-screening/);
    assert.equal(body.extensions.signInWithX.enabled, true);
    assert.equal(body.integrations.paymentsMcp.installerPackage, "@coinbase/payments-mcp");
    assert.ok(body.integrations.paymentsMcp.scenarioPrompts.length >= 3);
  });
});

test("payments MCP integration endpoint stays free", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/integrations/payments-mcp`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, sellerConfig.serviceName);
    assert.equal(body.paymentsMcp.installerPackage, "@coinbase/payments-mcp");
    assert.match(body.paymentsMcp.installCommands.codex, /payments-mcp/);
    assert.match(body.paymentsMcp.primaryPrompt, /ofac-sanctions-screening/);
    assert.ok(
      body.paymentsMcp.scenarioPrompts.some((entry) => entry.id === "vendor-batch-screening"),
    );
    assert.ok(body.paymentsMcp.shareCopy.shortPost.includes("restricted-party-screen"));
    assert.equal(body.signInWithX.enabled, true);
  });
});

test("protected route returns payment requirements without a payment header", async () => {
  const app = createApp({
    env: {},
    facilitatorLoader: async () => createStubFacilitator(),
  });
  const primaryRoute = getPrimaryRoute();
  const canonicalPath = buildRouteRequestPath(primaryRoute);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${canonicalPath}`);
    const body = await response.json();
    const paymentRequiredHeader = response.headers.get("payment-required");
    const expectedAmount = String(Math.round(Number(primaryRoute.price) * 1000000));

    assert.equal(response.status, 402);
    assert.ok(paymentRequiredHeader);
    assert.equal(body.x402Version, 2);
    assert.equal(body.error, "Payment required");
    assert.equal(body.accepts[0].payTo, PAY_TO);
    assert.equal(body.accepts[0].network, X402_NETWORK);
    assert.equal(body.accepts[0].amount, expectedAmount);
    assert.ok(body.extensions["sign-in-with-x"]);
  });
});

test("batch vendor route returns payment requirements without a payment header", async () => {
  const app = createApp({
    env: {},
    facilitatorLoader: async () => createStubFacilitator(),
  });
  const vendorBatchRoute = getVendorBatchRoute();
  const canonicalPath = buildRouteRequestPath(vendorBatchRoute);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${canonicalPath}`);
    const body = await response.json();
    const expectedAmount = String(Math.round(Number(vendorBatchRoute.price) * 1000000));

    assert.equal(response.status, 402);
    assert.equal(body.accepts[0].amount, expectedAmount);
    assert.equal(body.x402Version, 2);
    assert.equal(body.error, "Payment required");
  });
});

test("facilitator init failures retry within the same unpaid request", async () => {
  let middlewareFactoryCalls = 0;
  const primaryRoute = getPrimaryRoute();
  const canonicalPath = buildRouteRequestPath(primaryRoute);
  const app = createApp({
    env: {},
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
    const response = await fetch(`${baseUrl}${canonicalPath}`);
    const body = await response.json();

    assert.equal(response.status, 418);
    assert.deepEqual(body, { ok: true });
    assert.equal(middlewareFactoryCalls, 2);
  });
});

test("facilitator init failures retry within the same paid request", async () => {
  let middlewareFactoryCalls = 0;
  const primaryRoute = getPrimaryRoute();
  const canonicalPath = buildRouteRequestPath(primaryRoute);
  const app = createApp({
    env: {},
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
    const response = await fetch(`${baseUrl}${canonicalPath}`, {
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

test("metrics feed records the generated route for the shared dashboard", async () => {
  const app = createApp({
    env: {},
    facilitatorLoader: async () => createStubFacilitator(),
  });
  const primaryRoute = getPrimaryRoute();
  const canonicalPath = buildRouteRequestPath(primaryRoute);

  await withServer(app, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}${canonicalPath}`);
    assert.equal(apiResponse.status, 402);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const route = summary.routes.find((entry) => entry.key === primaryRoute.key);

    assert.equal(metricsResponse.status, 200);
    assert.ok(route, `Expected metrics for route ${primaryRoute.key}`);
    assert.equal(route.paymentRequired, 1);
    assert.equal(route.description, primaryRoute.description);
    assert.equal(route.priceLabel, `$${primaryRoute.price} USDC`);
  });
});

test("payment resource server registers the Bazaar discovery extension", () => {
  const recorded = {
    extensions: [],
    registerCalls: [],
  };
  const stubFacilitator = createStubFacilitator();
  const stubScheme = { scheme: "exact" };
  const afterSettleHook = () => {};

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

    onAfterSettle(handler) {
      recorded.afterSettleHandler = handler;
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
    afterSettleHooks: [afterSettleHook],
    facilitator: stubFacilitator,
    resourceServerClass: StubResourceServer,
    schemeFactory: () => stubScheme,
  });

  assert.ok(resourceServer instanceof StubResourceServer);
  assert.deepEqual(recorded.registerCalls, [
    { network: X402_NETWORK, scheme: stubScheme },
  ]);
  assert.deepEqual(recorded.extensions, [
    bazaarResourceServerExtension,
    siwxResourceServerExtension,
  ]);
  assert.equal(recorded.afterSettleHandler, afterSettleHook);
  assert.equal(typeof recorded.verifyFailureHandler, "function");
  assert.equal(typeof recorded.settleFailureHandler, "function");
});

test("paid route only passes through the payment gate once", async () => {
  let paymentGateCalls = 0;
  const paymentGate = (req, res, next) => {
    paymentGateCalls += 1;
    next();
  };

  await withPatchedGlobalFetch(
    async () => {
      const app = createApp({ paymentGate });
      const primaryRoute = getPrimaryRoute();
      const canonicalPath = buildRouteRequestPath(primaryRoute, { includeQuery: true });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${canonicalPath}`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(paymentGateCalls, 1);
        assert.equal(body.success, true);
        assert.equal(body.data.summary.status, "potential-match");
        assert.equal(body.data.matches[0].primaryName, "AKTSIONERNE TOVARYSTVO SBERBANK");
        assert.equal(body.data.sourceFreshness.sdnLastUpdated, "2026-03-13T00:00:00");
        assert.equal(body.source, "OFAC Sanctions List Service");
      });
    },
    async (url) => {
      if (url === OFAC_SEARCH_URL) {
        return createJsonFetchResponse(200, [
          {
            id: 18715,
            name: "AKTSIONERNE TOVARYSTVO SBERBANK",
            address: "46 Volodymyrska street",
            type: "Entity",
            programs: "RUSSIA-EO14024; UKRAINE-EO13662",
            lists: "SDN; Non-SDN",
            nameScore: 100,
          },
          {
            id: 18715,
            name: "JSC SBERBANK",
            address: "46 Volodymyrska street",
            type: "Entity",
            programs: "RUSSIA-EO14024; UKRAINE-EO13662",
            lists: "SDN; Non-SDN",
            nameScore: 100,
          },
        ]);
      }

      if (url === OFAC_SDN_LIST_URL) {
        return createJsonFetchResponse(200, [
          { fileName: "SDN_ENHANCED.XML", lastUpdated: "2026-03-13T00:00:00" },
        ]);
      }

      if (url === OFAC_CONSOLIDATED_LIST_URL) {
        return createJsonFetchResponse(200, [
          { fileName: "CONS_ENHANCED.XML", lastUpdated: "2026-01-08T00:00:00" },
        ]);
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    },
  );
});

test("vendor batch route summarizes multiple counterparties", async () => {
  const paymentGate = (req, res, next) => next();

  await withPatchedGlobalFetch(
    async () => {
      const app = createApp({ paymentGate });
      const vendorBatchRoute = getVendorBatchRoute();
      const canonicalPath = buildRouteRequestPath(vendorBatchRoute, { includeQuery: true });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${canonicalPath}`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.workflow, "vendor-onboarding");
        assert.equal(body.data.summary.screenedCount, 3);
        assert.equal(body.data.summary.flaggedCount, 3);
        assert.equal(body.data.summary.recommendedAction, "pause-and-review");
        assert.equal(body.data.counterparties[0].name, "SBERBANK");
      });
    },
    async (url, options = {}) => {
      if (url === OFAC_SEARCH_URL) {
        const queryName = JSON.parse(options.body).name;
        return createJsonFetchResponse(200, [
          {
            id: queryName.length,
            name: queryName,
            address: "123 Example Street",
            type: "Entity",
            programs: "RUSSIA-EO14024",
            lists: "SDN",
            nameScore: 100,
          },
        ]);
      }

      if (url === OFAC_SDN_LIST_URL || url === OFAC_CONSOLIDATED_LIST_URL) {
        return createJsonFetchResponse(200, [{ lastUpdated: "2026-03-13T00:00:00" }]);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  );
});
