const express = require("express");
const sellerConfig = require("./seller.config.json");
const primaryHandler = require("./handlers/primary");
const {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} = require("@x402/extensions/bazaar");
const {
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createRouteCatalog,
} = require("./metrics");
const {
  loadCoinbaseFacilitator: loadCoinbaseFacilitatorForEnv,
  loadFacilitator: loadFacilitatorForEnv,
} = require("../../lib/facilitator-loader");
const {
  DEFAULT_SIMS,
  MIN_SIMS,
  MAX_SIMS,
  parseSimParams,
} = require("./lib/sim-params");

const PAY_TO = sellerConfig.payTo;
const X402_NETWORK = sellerConfig.network || "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = sellerConfig.maxTimeoutSeconds || 60;
const CANONICAL_BASE_URL =
  process.env.PUBLIC_BASE_URL || sellerConfig.baseUrl || "https://x402.aurelianflo.com";

const DEFAULT_INPUT_EXAMPLE = {
  parameters: {
    demand_signal: 0.72,
    execution_quality: 0.65,
    pricing_pressure: -0.35,
  },
  weights: {
    demand_signal: 1.2,
    execution_quality: 1,
    pricing_pressure: 0.9,
  },
  uncertainty: {
    demand_signal: 0.12,
    execution_quality: 0.1,
    pricing_pressure: 0.2,
  },
  bias: 0,
  threshold: 0.25,
};

const DEFAULT_OUTPUT_EXAMPLE = {
  simulation_meta: {
    simulations_run: 10000,
    model_version: "3.0.0",
    success_rule: "score >= threshold",
  },
  outcome_probability: 0.6743,
  confidence_interval_95: {
    low: 0.665,
    high: 0.6835,
  },
  score_distribution: {
    mean: 0.3921,
    stddev: 0.245,
    min: -0.4821,
    p10: 0.0783,
    p50: 0.3915,
    p90: 0.704,
    max: 1.2364,
  },
};

const SIMULATION_REQUEST_SCHEMA = {
  type: "object",
  required: ["parameters"],
  properties: {
    parameters: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        type: "number",
      },
      description: "Named parameter means used by the Monte Carlo simulation",
    },
    weights: {
      type: "object",
      additionalProperties: {
        type: "number",
      },
      description: "Optional per-parameter multipliers. Defaults to 1.0.",
    },
    uncertainty: {
      type: "object",
      additionalProperties: {
        type: "number",
        minimum: 0,
      },
      description: "Optional per-parameter standard deviation. Defaults to 0.1.",
    },
    bias: {
      type: "number",
      description: "Constant term added to the simulated score.",
    },
    threshold: {
      type: "number",
      description: "Success condition is score >= threshold.",
    },
  },
  additionalProperties: false,
};

const DEFAULT_ENDPOINT_GUIDE = {
  name: "Generic probability simulation",
  returns: "Outcome probability, confidence interval, and score distribution",
  bestFor: "Any decision model where agents need parameter-driven probability output.",
  tips: [],
};

const ENDPOINT_GUIDE_BY_PATH = {
  "/api/sim/probability": {
    name: "Probability simulation",
    returns: "Outcome probability, confidence interval, and score distribution",
    bestFor: "Single-scenario probability checks.",
    tips: ["Use this as the baseline route for one-scenario risk estimates."],
  },
  "/api/sim/compare": {
    name: "Scenario comparison simulation",
    returns: "Baseline vs candidate probability and uplift deltas",
    bestFor: "A/B scenario decisions and uplift checks.",
    tips: ["Provide baseline and candidate scenarios in the request body."],
  },
  "/api/sim/sensitivity": {
    name: "Sensitivity simulation",
    returns: "Baseline and plus/minus variants with probability gradient for one parameter",
    bestFor: "Measuring local sensitivity around a selected input parameter.",
    tips: ["Provide `parameter`, `delta`, and optional `mode` (`absolute` or `relative`)."],
  },
  "/api/sim/forecast": {
    name: "Forecast simulation",
    returns: "Forward period-by-period probability path",
    bestFor: "Time-stepped planning and near-term trajectory analysis.",
    tips: ["Set periods and drift assumptions to model expected directional changes."],
  },
  "/api/sim/composed": {
    name: "Composed simulation",
    returns: "Weighted blended probability plus per-component simulation results",
    bestFor: "Portfolio-style or ensemble scenario synthesis.",
    tips: ["Each component accepts `label`, `weight`, and a `scenario` (or direct scenario fields)."],
  },
  "/api/sim/optimize": {
    name: "Optimization simulation",
    returns: "Best parameter set by objective with baseline-vs-optimum delta",
    bestFor: "Decision-variable tuning under bounds.",
    tips: ["Define `bounds`, set `iterations`, and choose objective `outcome_probability` or `mean_score`."],
  },
};

function normalizeEnvValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().replace(/^['\"]|['\"]$/g, "");
}

function normalizePrivateKey(privateKey) {
  const trimmed = normalizeEnvValue(privateKey);
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

function getSellerRoutes() {
  if (Array.isArray(sellerConfig.routes) && sellerConfig.routes.length) {
    return sellerConfig.routes;
  }

  return sellerConfig.route ? [sellerConfig.route] : [];
}

function getCanonicalRoutePath(route) {
  return route.canonicalPath || route.resourcePath;
}

function buildCanonicalResourceUrl(resourcePath) {
  if (!resourcePath) {
    return null;
  }

  if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
    return resourcePath;
  }

  return `${String(CANONICAL_BASE_URL).replace(/\/+$/, "")}${resourcePath}`;
}

function createDiscoveryExtension(route) {
  return declareDiscoveryExtension({
    category: route.category,
    description: route.description,
    tags: Array.isArray(route.tags) ? route.tags : [],
    input: {
      body: route.inputExample || DEFAULT_INPUT_EXAMPLE,
    },
    inputSchema: route.inputSchema || SIMULATION_REQUEST_SCHEMA,
    bodyType: route.bodyType || "json",
    output: {
      example: route.outputExample || DEFAULT_OUTPUT_EXAMPLE,
    },
  });
}

function createPricedRoute(route) {
  const normalizedPrice =
    typeof route.price === "string" && !route.price.startsWith("$")
      ? `$${route.price}`
      : route.price;

  return {
    resource: buildCanonicalResourceUrl(getCanonicalRoutePath(route)),
    accepts: {
      scheme: "exact",
      network: X402_NETWORK,
      payTo: route.payTo || PAY_TO,
      price: normalizedPrice,
      maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    },
    description: route.description,
    mimeType: "application/json",
    ...(route.category ? { category: route.category } : {}),
    ...(Array.isArray(route.tags) ? { tags: route.tags } : {}),
    extensions: createDiscoveryExtension(route),
  };
}

function createRouteConfig() {
  return Object.fromEntries(
    getSellerRoutes().map((route) => [
      route.key,
      createPricedRoute({
        ...route,
        inputExample: route.inputExample || DEFAULT_INPUT_EXAMPLE,
        inputSchema: route.inputSchema || SIMULATION_REQUEST_SCHEMA,
        bodyType: route.bodyType || "json",
        outputExample: route.outputExample || DEFAULT_OUTPUT_EXAMPLE,
      }),
    ]),
  );
}

const routeConfig = createRouteConfig();

function formatUsdPrice(price) {
  if (price == null) {
    return null;
  }

  if (typeof price === "number") {
    return `$${price} USDC`;
  }

  return `${price.startsWith("$") ? price : `$${price}`} USDC`;
}

function parseUsdPriceValue(price) {
  if (price == null) {
    return null;
  }

  const numeric = Number(String(price).replace("$", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function getPrimaryPaymentOption(config) {
  if (!config) {
    return null;
  }

  if (Array.isArray(config.accepts)) {
    return config.accepts[0] || null;
  }

  return config.accepts || null;
}

function getExamplePathFromResource(resourceUrl, fallbackPath) {
  if (!resourceUrl) {
    return fallbackPath;
  }

  try {
    return new URL(resourceUrl).pathname;
  } catch (_error) {
    return fallbackPath;
  }
}

function buildCatalogEntries(routes = routeConfig) {
  return Object.entries(routes).map(([routeKey, config]) => {
    const [method, path] = routeKey.split(" ");
    const paymentOption = getPrimaryPaymentOption(config);

    return {
      method,
      path,
      routeKey,
      price: formatUsdPrice(paymentOption?.price ?? null),
      priceUsd: parseUsdPriceValue(paymentOption?.price ?? null),
      description: config.description ?? null,
      category: config.category ?? null,
      tags: Array.isArray(config.tags) ? config.tags : [],
      examplePath: getExamplePathFromResource(config.resource, path),
      exampleUrl: config.resource,
      payment: {
        scheme: paymentOption?.scheme ?? null,
        network: paymentOption?.network ?? null,
        asset: paymentOption?.asset ?? null,
        payTo: paymentOption?.payTo ?? null,
        amount: paymentOption?.amount ?? null,
        maxTimeoutSeconds: paymentOption?.maxTimeoutSeconds ?? null,
      },
      request: {
        example: config.extensions?.bazaar?.info?.input ?? null,
        schema: config.extensions?.bazaar?.schema?.properties?.input ?? null,
      },
      response: {
        mimeType: config.mimeType || "application/json",
        example: config.extensions?.bazaar?.info?.output?.example ?? null,
        schema: config.extensions?.bazaar?.schema?.properties?.output ?? null,
      },
    };
  });
}

function getEndpointGuide(path) {
  if (!path) {
    return DEFAULT_ENDPOINT_GUIDE;
  }

  return ENDPOINT_GUIDE_BY_PATH[path] || DEFAULT_ENDPOINT_GUIDE;
}

function getEndpointId(path) {
  if (typeof path !== "string") {
    return "";
  }

  return path.replace(/^\/api\/sim\//, "");
}

function createHealthHandler(routes = routeConfig) {
  return function healthHandler(_req, res) {
    const catalog = buildCatalogEntries(routes);

    res.json({
      name: sellerConfig.serviceName,
      description: sellerConfig.serviceDescription,
      version: "3.0.0",
      endpoints: catalog.length,
      catalog,
      payment: {
        network: "Base",
        currency: "USDC",
        protocol: "x402",
      },
    });
  };
}

function createApiDiscoveryHandler(routes = routeConfig) {
  return function apiDiscoveryHandler(req, res) {
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    const baseUrl = host ? `${proto}://${host}` : String(CANONICAL_BASE_URL).replace(/\/+$/, "");
    const catalog = buildCatalogEntries(routes);
    const endpointNames = catalog.map((entry) => getEndpointId(entry.path)).filter(Boolean);
    const endpointSummary = endpointNames.length
      ? ` Available simulation endpoints: ${endpointNames.join(", ")}.`
      : "";

    res.json({
      name: `${sellerConfig.serviceName} API Discovery`,
      description:
        `Machine-readable endpoint catalog for indexing and health probes.${endpointSummary} Use \`exampleUrl\` for concrete checks.`,
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      baseUrl,
      discoveryUrl: `${baseUrl}/api`,
      healthUrl: `${baseUrl}/`,
      endpoints: catalog.length,
      catalog,
      payment: {
        protocol: "x402",
        network: "Base",
        chainId: X402_NETWORK,
        currency: "USDC",
      },
    });
  };
}

function createPaymentsMcpIntegration(routes = routeConfig) {
  const catalog = buildCatalogEntries(routes);
  const primary = catalog[0] || null;
  const canonicalTemplateUrl = `${String(CANONICAL_BASE_URL).replace(/\/+$/, "")}/api/sim/probability`;

  return {
    integrationName: "Payments MCP",
    installerNote:
      "Use the package name exactly as shown for installation compatibility.",
    installerPackage: "@coinbase/payments-mcp",
    installCommands: {
      codex: "npx @coinbase/payments-mcp --client codex --auto-config",
      claudeCode: "npx @coinbase/payments-mcp --client claude-code --auto-config",
      gemini: "npx @coinbase/payments-mcp --client gemini --auto-config",
    },
    primaryPrompt: primary
      ? `Use payments-mcp to pay ${primary.exampleUrl} and return the JSON response.`
      : `Use payments-mcp to pay ${canonicalTemplateUrl} and return the JSON response.`,
    routePrompts: catalog.map((entry) => ({
      method: entry.method,
      path: entry.path,
      canonicalUrl: entry.exampleUrl,
      prompt: `Use payments-mcp to pay ${entry.exampleUrl} and return the JSON response.`,
    })),
  };
}

function createPaymentsMcpIntegrationHandler(routes = routeConfig) {
  return function paymentsMcpIntegrationHandler(_req, res) {
    res.json({
      service: sellerConfig.serviceName,
      protocol: "x402",
      integration: createPaymentsMcpIntegration(routes),
    });
  };
}

function createMethodologyHandler(routes = routeConfig) {
  return function methodologyHandler(_req, res) {
    const catalog = buildCatalogEntries(routes);
    const quickStartEntry =
      catalog.find((entry) => entry.path === "/api/sim/probability") || catalog[0] || null;
    const quickStartRoute = quickStartEntry ? routes[quickStartEntry.routeKey] : null;
    const quickStartBody =
      quickStartRoute?.extensions?.bazaar?.info?.input?.body || DEFAULT_INPUT_EXAMPLE;

    res.json({
      service: "Generic Parameter Monte Carlo Simulator",
      version: "3.0.0",
      quick_start: quickStartEntry
        ? {
            method: quickStartEntry.method,
            path: quickStartEntry.path,
            price: quickStartEntry.price,
            query: {
              sims: `Optional integer from ${MIN_SIMS} to ${MAX_SIMS}. Defaults to ${DEFAULT_SIMS}.`,
            },
            body: quickStartBody,
          }
        : null,
      endpoints: catalog.map((entry) => {
        const guide = getEndpointGuide(entry.path);
        return {
          method: entry.method,
          path: entry.path,
          price: entry.price,
          name: guide.name,
          best_for: guide.bestFor,
          returns: guide.returns,
        };
      }),
      model: {
        score_formula: "score = bias + sum(sampled_parameter_value * weight)",
        sampling: "Each parameter is sampled from Normal(mean=parameter value, stddev=uncertainty).",
        success_rule: "A simulation run is successful when score >= threshold.",
        route_family:
          "POST /api/sim/{probability|compare|sensitivity|forecast|composed|optimize}",
        outputs: [
          "outcome_probability",
          "confidence_interval_95",
          "score_distribution",
          "parameter contribution summary",
        ],
      },
      request_schema: SIMULATION_REQUEST_SCHEMA,
    });
  };
}

function createPaidEndpointGuideHandler(routeKey, routes = routeConfig) {
  const route = routes[routeKey];
  const [method, path] = routeKey.split(" ");
  const paymentOption = getPrimaryPaymentOption(route);
  const sampleBody = route.extensions?.bazaar?.info?.input?.body || DEFAULT_INPUT_EXAMPLE;
  const sampleOutput = route.extensions?.bazaar?.info?.output?.example || DEFAULT_OUTPUT_EXAMPLE;
  const endpointGuide = getEndpointGuide(path);
  const routeName = endpointGuide.name;
  const routeReturns = endpointGuide.returns;
  const routeBestFor = endpointGuide.bestFor;
  const endpointTips = Array.isArray(endpointGuide.tips) ? endpointGuide.tips : [];

  return function paidEndpointGuideHandler(_req, res) {
    res.set("Cache-Control", "no-store");
    res.json({
      endpoint_type: "paid-post-route",
      message:
        "This route is paid and requires POST. This free GET response shows the exact request shape.",
      canonical_request: {
        method,
        url: route.resource,
        headers: {
          "content-type": "application/json",
        },
        body: sampleBody,
      },
      route: {
        name: routeName,
        path,
        price: formatUsdPrice(paymentOption?.price ?? null),
        returns: routeReturns,
        best_for: routeBestFor,
      },
      quick_tips: [
        "Use POST, not GET.",
        "parameters is required and must be an object of numeric values.",
        `Use ?sims=${MIN_SIMS}..${MAX_SIMS} to tune simulation count.`,
        ...endpointTips,
      ],
      sample_output: sampleOutput,
      free_resources: [`${String(CANONICAL_BASE_URL).replace(/\/+$/, "")}/methodology`],
    });
  };
}

async function loadCoinbaseFacilitator(env = process.env) {
  return loadCoinbaseFacilitatorForEnv(env, {
    normalizeCredential: normalizeEnvValue,
    normalizeSecret: normalizePrivateKey,
  });
}

async function loadFacilitator(env = process.env) {
  return loadFacilitatorForEnv(env, {
    normalizeCredential: normalizeEnvValue,
    normalizeSecret: normalizePrivateKey,
  });
}

function createFacilitatorClient(facilitator) {
  if (
    facilitator &&
    typeof facilitator.verify === "function" &&
    typeof facilitator.settle === "function" &&
    typeof facilitator.getSupported === "function"
  ) {
    return facilitator;
  }

  const { HTTPFacilitatorClient } = require("@x402/core/server");
  return new HTTPFacilitatorClient(facilitator);
}

function createPaymentResourceServer(options = {}) {
  const { facilitator, logger = console } = options;
  const { x402ResourceServer } = require("@x402/core/server");
  const { ExactEvmScheme } = require("@x402/evm/exact/server");

  const resourceServer = new x402ResourceServer(createFacilitatorClient(facilitator));
  resourceServer.register(X402_NETWORK, new ExactEvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  resourceServer.onVerifyFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 verify failure:",
      JSON.stringify({
        message: error?.message || "Verification failed",
        network: requirements.network,
      }),
    );
  });

  resourceServer.onSettleFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 settle failure:",
      JSON.stringify({
        message: error?.message || "Settlement failed",
        network: requirements.network,
      }),
    );
  });

  return resourceServer;
}

function createPaymentGate(options = {}) {
  const routes = options.routes ?? routeConfig;
  const paymentEnv = options.env ?? process.env;
  const facilitatorLoader =
    options.facilitatorLoader ?? (() => loadFacilitator(paymentEnv));
  const paymentMiddlewareFactory = options.paymentMiddlewareFactory;

  let paymentReady = null;

  async function getPaymentMiddleware() {
    if (!paymentReady) {
      paymentReady = Promise.resolve(facilitatorLoader(options.env ?? process.env))
        .then((facilitator) => createPaymentResourceServer({ facilitator, logger: options.logger ?? console }))
        .then((resourceServer) => {
          if (paymentMiddlewareFactory) {
            return paymentMiddlewareFactory(routes, resourceServer);
          }

          const { paymentMiddleware } = require("@x402/express");
          return paymentMiddleware(routes, resourceServer);
        });
    }

    return paymentReady;
  }

  return async function paymentGate(req, res, next) {
    try {
      const middleware = await getPaymentMiddleware();
      return await middleware(req, res, next);
    } catch (err) {
      return res.status(500).json({
        error: "Payment middleware init failed",
        details: err?.message || String(err),
      });
    }
  };
}

function mountPaidRoutes(target) {
  for (const route of getSellerRoutes()) {
    const method = String(route.method || "").toLowerCase();
    if (!method || typeof target[method] !== "function") {
      continue;
    }

    target[method](route.expressPath, primaryHandler);
  }
}

function createApp(options = {}) {
  const env = options.env ?? process.env;
  const routes = options.routes ?? routeConfig;
  const metricsRouteCatalog = options.metricsRouteCatalog ?? [
    ...createRouteCatalog(routes),
    ...Object.keys(routes).map((routeKey) => {
      const [, routePath] = routeKey.split(" ");
      return {
        key: `GET ${routePath}`,
        method: "GET",
        routePath,
        description: "Free guide for a paid POST endpoint",
        priceLabel: "Free",
        priceUsdMicros: 0,
      };
    }),
    {
      key: "GET /",
      method: "GET",
      routePath: "/",
      description: "Health summary",
      priceLabel: "Free",
      priceUsdMicros: 0,
    },
    {
      key: "GET /health",
      method: "GET",
      routePath: "/health",
      description: "Health alias",
      priceLabel: "Free",
      priceUsdMicros: 0,
    },
    {
      key: "GET /api",
      method: "GET",
      routePath: "/api",
      description: "Discovery endpoint",
      priceLabel: "Free",
      priceUsdMicros: 0,
    },
    {
      key: "GET /methodology",
      method: "GET",
      routePath: "/methodology",
      description: "Methodology",
      priceLabel: "Free",
      priceUsdMicros: 0,
    },
    {
      key: "GET /integrations/payments-mcp",
      method: "GET",
      routePath: "/integrations/payments-mcp",
      description: "Payments MCP integration guide",
      priceLabel: "Free",
      priceUsdMicros: 0,
    },
  ];

  const metricsAttribution =
    options.metricsAttribution ??
    createMetricsAttribution({
      env,
      sourceSalt: options.metricsSourceSalt,
    });

  const metricsStore =
    options.metricsStore ??
    createMetricsStore({
      env,
      routes,
      routeCatalog: metricsRouteCatalog,
    });

  const paymentGate = options.paymentGate ?? createPaymentGate({ ...options, routes, env });

  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);

  app.get("/", createHealthHandler(routes));
  app.get("/health", createHealthHandler(routes));
  app.get("/api", createApiDiscoveryHandler(routes));
  app.get("/methodology", createMethodologyHandler(routes));
  app.get(
    "/integrations/payments-mcp",
    createPaymentsMcpIntegrationHandler(routes),
  );

  for (const routeKey of Object.keys(routes)) {
    const [, routePath] = routeKey.split(" ");
    app.get(routePath, createPaidEndpointGuideHandler(routeKey, routes));
  }

  app.get(
    "/ops/metrics",
    createMetricsDashboardHandler({
      password: options.metricsPassword ?? env.METRICS_DASHBOARD_PASSWORD,
      attribution: metricsAttribution,
      store: metricsStore,
    }),
  );

  app.get(
    "/ops/metrics/data",
    createMetricsDataHandler({
      password: options.metricsPassword ?? env.METRICS_DASHBOARD_PASSWORD,
      attribution: metricsAttribution,
      store: metricsStore,
    }),
  );

  app.use(
    createMetricsMiddleware({
      attribution: metricsAttribution,
      logger: options.logger ?? console,
      routeCatalog: metricsRouteCatalog,
      routes,
      store: metricsStore,
      shouldTrackRequest: options.shouldTrackRequest,
    }),
  );

  const paidRouter = express.Router();
  mountPaidRoutes(paidRouter);
  app.use(paymentGate, paidRouter);

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || sellerConfig.port || 4020);

  app.listen(port, () => {
    console.log(`\n  ${sellerConfig.serviceName} API v3.0.0`);
    console.log(`  Running on http://localhost:${port}`);
    console.log(`  Payment: ${PAY_TO} on Base (${X402_NETWORK})`);
    console.log(`  Canonical base URL: ${CANONICAL_BASE_URL}`);
    console.log(
      `  Facilitator: ${String(process.env.X402_FACILITATOR || "auto").toLowerCase()}\n`,
    );
  });
}

module.exports = {
  PAY_TO,
  X402_NETWORK,
  CANONICAL_BASE_URL,
  sellerConfig,
  createApp,
  createApiDiscoveryHandler,
  createHealthHandler,
  createPaymentGate,
  createPaymentResourceServer,
  createPaymentsMcpIntegration,
  createPaymentsMcpIntegrationHandler,
  createRouteConfig,
  loadFacilitator,
  loadCoinbaseFacilitator,
  routeConfig,
  buildCanonicalResourceUrl,
  normalizeEnvValue,
  normalizePrivateKey,
  simulationRequestSchema: SIMULATION_REQUEST_SCHEMA,
  parseSimParams,
};
