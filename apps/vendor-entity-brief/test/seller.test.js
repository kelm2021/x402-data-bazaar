const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const fetch = require("node-fetch");
const { bazaarResourceServerExtension } = require("@x402/extensions/bazaar");

const {
  PAY_TO,
  X402_NETWORK,
  createApp,
  createPaymentResourceServer,
  sellerConfig,
} = require("../app");
const {
  GLEIF_FUZZY_COMPLETIONS_URL,
  GLEIF_LEI_RECORDS_URL,
} = require("../lib/vendor-entity-brief");
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

test("health check stays free and advertises payments MCP guidance", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, sellerConfig.serviceName);
    assert.equal(body.payment.protocol, "x402");
    assert.equal(body.payment.pricingDenomination, "USDC");
    assert.equal(body.catalog.length, getSellerRoutes().length);
    assert.match(body.catalog[0].path, /vendor-entity-brief/);
    assert.match(body.catalog[0].canonicalUrl, /vendor-entity-brief/);
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
    assert.match(body.paymentsMcp.primaryPrompt, /vendor-entity-brief/);
    assert.ok(
      body.paymentsMcp.scenarioPrompts.some((entry) => entry.id === "supplier-onboarding"),
    );
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

test("paid route only passes through the payment gate once and returns a combined brief", async () => {
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
        assert.equal(body.data.summary.status, "manual-review-required");
        assert.equal(body.data.summary.recommendedAction, "pause-and-review");
        assert.equal(body.data.bestEntityCandidate.lei, "31570010000000029583");
        assert.equal(body.data.bestEntityCandidate.countryMatch, true);
        assert.equal(body.data.screening.topMatch.primaryName, "SBERBANK CZ, A.S. V LIKVIDACI");
        assert.equal(body.data.sourceFreshness.gleifGoldenCopyPublishDate, "2026-03-18T00:00:00Z");
        assert.equal(body.data.sourceFreshness.ofac.sdnLastUpdated, "2026-03-13T00:00:00");
        assert.equal(body.source, "GLEIF API + OFAC Sanctions List Service");
      });
    },
    async (url, options = {}) => {
      if (url.startsWith(GLEIF_FUZZY_COMPLETIONS_URL)) {
        return createJsonFetchResponse(200, {
          data: [
            {
              attributes: {
                value: "Sberbank CZ, a.s. v likvidaci",
              },
              relationships: {
                "lei-records": {
                  data: {
                    id: "31570010000000029583",
                  },
                },
              },
            },
            {
              attributes: {
                value: "Joint-Stock Company \"Sberbank CIB\"",
              },
              relationships: {
                "lei-records": {
                  data: {
                    id: "253400JYF26KUD0RLW67",
                  },
                },
              },
            },
          ],
        });
      }

      if (url.startsWith(`${GLEIF_LEI_RECORDS_URL}?`)) {
        return createJsonFetchResponse(200, {
          meta: {
            goldenCopy: {
              publishDate: "2026-03-18T00:00:00Z",
            },
          },
          data: [
            {
              id: "31570010000000029583",
              attributes: {
                lei: "31570010000000029583",
                entity: {
                  legalName: {
                    name: "Sberbank CZ, a.s. v likvidaci",
                  },
                  otherNames: [
                    {
                      name: "SBERBANK CZ, A.S. V LIKVIDACI",
                    },
                  ],
                  legalAddress: {
                    addressLines: ["U Trezorky 921/2"],
                    city: "Praha 5",
                    country: "CZ",
                    postalCode: "158 00",
                  },
                  headquartersAddress: {
                    addressLines: ["U Trezorky 921/2"],
                    city: "Praha 5",
                    country: "CZ",
                    postalCode: "158 00",
                  },
                  jurisdiction: "CZ",
                  status: "ACTIVE",
                  registeredAs: "25083325",
                  registeredAt: {
                    id: "RA000163",
                  },
                  legalForm: {
                    id: "6CQN",
                  },
                  category: "GENERAL",
                },
                registration: {
                  status: "ISSUED",
                  corroborationLevel: "FULLY_CORROBORATED",
                  managingLou: "529900F6BNUR3RJ2WH29",
                  lastUpdateDate: "2025-07-11T12:04:40Z",
                  nextRenewalDate: "2026-07-11T12:04:40Z",
                },
                bic: ["VBOECZ2XXXX"],
                conformityFlag: "CONFORMING",
              },
              links: {
                self: "https://api.gleif.org/api/v1/lei-records/31570010000000029583",
              },
            },
            {
              id: "253400JYF26KUD0RLW67",
              attributes: {
                lei: "253400JYF26KUD0RLW67",
                entity: {
                  legalName: {
                    name: "Joint-Stock Company \"Sberbank CIB\"",
                  },
                  jurisdiction: "RU",
                  status: "ACTIVE",
                  registeredAs: "1027739007768",
                  registeredAt: {
                    id: "RA000499",
                  },
                  legalForm: {
                    id: "JZBN",
                  },
                  category: "GENERAL",
                },
                registration: {
                  status: "ISSUED",
                  corroborationLevel: "FULLY_CORROBORATED",
                  managingLou: "253400M18U5TB02TW421",
                  lastUpdateDate: "2025-04-10T08:22:39Z",
                  nextRenewalDate: "2026-04-10T08:21:54Z",
                },
                bic: ["TDICRUMMXXX"],
                conformityFlag: "NON_CONFORMING",
              },
              links: {
                self: "https://api.gleif.org/api/v1/lei-records/253400JYF26KUD0RLW67",
              },
            },
          ],
        });
      }

      if (url === OFAC_SEARCH_URL) {
        const requestBody = JSON.parse(options.body);

        assert.equal(requestBody.country, "CZ");

        return createJsonFetchResponse(200, [
          {
            id: 18715,
            name: "SBERBANK CZ, A.S. V LIKVIDACI",
            address: "U Trezorky 921/2, Praha 5, CZ",
            type: "Entity",
            programs: "RUSSIA-EO14024",
            lists: "SDN",
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

test("paid route tolerates null OFAC search results and returns no-potential-match", async () => {
  let paymentGateCalls = 0;
  const paymentGate = (_req, _res, next) => {
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
        assert.equal(body.data.summary.status, "entity-review-recommended");
        assert.equal(body.data.summary.screeningMatchCount, 0);
        assert.equal(body.data.screening.summary.status, "no-potential-match");
        assert.equal(body.data.screening.summary.rawResultCount, 0);
      });
    },
    async (url, options = {}) => {
      if (url.startsWith(GLEIF_FUZZY_COMPLETIONS_URL)) {
        return createJsonFetchResponse(200, {
          data: [
            {
              attributes: {
                value: "Acme Supply LLC",
              },
              relationships: {
                "lei-records": {
                  data: {
                    id: "5493001KJTIIGC8Y1R12",
                  },
                },
              },
            },
          ],
        });
      }

      if (url.startsWith(`${GLEIF_LEI_RECORDS_URL}?`)) {
        return createJsonFetchResponse(200, {
          meta: {
            goldenCopy: {
              publishDate: "2026-03-18T00:00:00Z",
            },
          },
          data: [
            {
              id: "5493001KJTIIGC8Y1R12",
              attributes: {
                lei: "5493001KJTIIGC8Y1R12",
                entity: {
                  legalName: {
                    name: "Acme Supply LLC",
                  },
                  jurisdiction: "US",
                  status: "ACTIVE",
                  registeredAs: "123456",
                  registeredAt: {
                    id: "RA000001",
                  },
                  legalForm: {
                    id: "XTIQ",
                  },
                  category: "GENERAL",
                },
                registration: {
                  status: "ISSUED",
                  corroborationLevel: "FULLY_CORROBORATED",
                  managingLou: "529900T8BM49AURSDO55",
                  lastUpdateDate: "2025-09-01T12:00:00Z",
                  nextRenewalDate: "2026-09-01T12:00:00Z",
                },
                conformityFlag: "CONFORMING",
              },
              links: {
                self: "https://api.gleif.org/api/v1/lei-records/5493001KJTIIGC8Y1R12",
              },
            },
          ],
        });
      }

      if (url === OFAC_SEARCH_URL) {
        const requestBody = JSON.parse(options.body);
        assert.equal(requestBody.nameScore, 90);
        return createJsonFetchResponse(200, null);
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

test("paid route falls back to name-only OFAC lookup when country-filtered lookup returns null", async () => {
  let paymentGateCalls = 0;
  let ofacSearchCalls = 0;
  const seenCountries = [];
  const paymentGate = (_req, _res, next) => {
    paymentGateCalls += 1;
    next();
  };

  await withPatchedGlobalFetch(
    async () => {
      const app = createApp({ paymentGate });
      const path =
        "/api/vendor-entity-brief?name=SBERBANK&country=RU&minScore=90&limit=3";

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${path}`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(paymentGateCalls, 1);
        assert.equal(ofacSearchCalls, 2);
        assert.deepEqual(seenCountries, ["RU", ""]);
        assert.equal(body.success, true);
        assert.equal(body.data.summary.recommendedAction, "pause-and-review");
        assert.equal(body.data.summary.screeningMatchCount, 1);
        assert.equal(body.data.screening.summary.status, "potential-match");
        assert.equal(body.data.screening.summary.rawResultCount, 1);
      });
    },
    async (url, options = {}) => {
      if (url.startsWith(GLEIF_FUZZY_COMPLETIONS_URL)) {
        return createJsonFetchResponse(200, {
          data: [
            {
              attributes: {
                value: "SBERBANK OF RUSSIA",
              },
              relationships: {
                "lei-records": {
                  data: {
                    id: "549300WE6TAF5EEWQS81",
                  },
                },
              },
            },
          ],
        });
      }

      if (url.startsWith(`${GLEIF_LEI_RECORDS_URL}?`)) {
        return createJsonFetchResponse(200, {
          meta: {
            goldenCopy: {
              publishDate: "2026-03-18T00:00:00Z",
            },
          },
          data: [
            {
              id: "549300WE6TAF5EEWQS81",
              attributes: {
                lei: "549300WE6TAF5EEWQS81",
                entity: {
                  legalName: {
                    name: "PUBLIC JOINT STOCK COMPANY SBERBANK OF RUSSIA",
                  },
                  jurisdiction: "RU",
                  status: "ACTIVE",
                },
                registration: {
                  status: "ISSUED",
                },
              },
              links: {
                self: "https://api.gleif.org/api/v1/lei-records/549300WE6TAF5EEWQS81",
              },
            },
          ],
        });
      }

      if (url === OFAC_SEARCH_URL) {
        ofacSearchCalls += 1;
        const requestBody = JSON.parse(options.body);
        seenCountries.push(requestBody.country);

        if (requestBody.country === "RU") {
          return createJsonFetchResponse(200, null);
        }

        return createJsonFetchResponse(200, [
          {
            id: 9991,
            name: "PUBLIC JOINT STOCK COMPANY SBERBANK OF RUSSIA",
            address: "Moscow, RU",
            type: "Entity",
            programs: "RUSSIA-EO14024",
            lists: "SDN",
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
