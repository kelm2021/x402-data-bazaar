const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} = require("@x402/extensions/bazaar");
const restrictedPartySellerConfig = require("./apps/restricted-party-screen/seller.config.json");
const restrictedPartyPrimaryHandler = require("./apps/restricted-party-screen/handlers/primary");
const restrictedPartyBatchHandler = require("./apps/restricted-party-screen/handlers/batch");
const vendorEntityBriefSellerConfig = require("./apps/vendor-entity-brief/seller.config.json");
const vendorEntityBriefPrimaryHandler = require("./apps/vendor-entity-brief/handlers/primary");
const genericSimulatorSellerConfig = require("./apps/generic-parameter-simulator/seller.config.json");
const genericSimulatorPrimaryHandler = require("./apps/generic-parameter-simulator/handlers/primary");
const {
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createRouteCatalog,
} = require("./metrics");
const {
  createBusinessDashboardHandler,
  createBusinessDataHandler,
  createBusinessProofHandler,
} = require("./business-dashboard");
const {
  annotatePaymentRequired,
  buildPaymentRequiredFromRoute,
} = require("./lib/payment-required-compat");
const { appendSimCompatible } = require("./lib/sim-compatible");
const {
  getFacilitatorCandidates,
  getConfiguredFacilitatorUrl,
  getFacilitatorMode,
  loadCoinbaseFacilitator: loadCoinbaseFacilitatorForEnv,
  loadFacilitator: loadFacilitatorForEnv,
} = require("./lib/facilitator-loader");
const {
  createMercTrustEnforcementFromEnv,
} = require("./lib/merc-trust-enforcement");
const generatedCatalogDocument = require("./routes/generated-catalog.json");
const generatedRoutes = require("./routes/generated");
const {
  DEFAULT_AUTHOR_SLUG,
  DEFAULT_SAMPLE_SLUG,
  DEFAULT_TOPIC_SLUG,
  buildPublisherStackExamples,
} = require("./lib/publisher-stack");
const createPublisherStackRouter = require("./routes/publisher-stack");
const WELL_KNOWN_X402_AURELIAN = require("./well-known-x402-aurelian.json");

const PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";
const X402_NETWORK = "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_402INDEX_VERIFICATION_HASH =
  "d7b41bc2cde9060ab7842783aa2747acb31f78c53d7d879047cf762a1a3063ea";
const CANONICAL_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || "https://x402.aurelianflo.com",
)
  .trim()
  .replace(/\/+$/, "");
const WRAPPED_PRODUCT_URL = String(
  process.env.AURELIAN_WRAPPED_URL || "https://wrap.aurelianflo.com",
)
  .trim()
  .replace(/\/+$/, "");
const DEFAULT_ORIGIN_TITLE = "AurelianFlo APIs";
const DEFAULT_ORIGIN_DESCRIPTION =
  "Curated, high-signal endpoints with x402-native access.";
const DEFAULT_FAVICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2kQAAAAASUVORK5CYII=";
const DEFAULT_FAVICON_PNG = Buffer.from(DEFAULT_FAVICON_PNG_BASE64, "base64");
const FAVICON_FILE_PATH = path.join(__dirname, "assets", "favicon.png");
const FAVICON_PNG = (() => {
  try {
    return fs.readFileSync(FAVICON_FILE_PATH);
  } catch (_error) {
    return DEFAULT_FAVICON_PNG;
  }
})();
const PRODUCTION_HIDDEN_ROUTE_KEYS = new Set([
  "GET /api/stocks/quote/*",
  "GET /api/bls/pce",
  "GET /api/fda/device-recalls",
]);
const SIM_ROUTE_ORDER = [
  "/api/sim/probability",
  "/api/sim/compare",
  "/api/sim/sensitivity",
  "/api/sim/forecast",
  "/api/sim/composed",
  "/api/sim/optimize",
];
const SIM_ENDPOINT_SUMMARIES = {
  "/api/sim/probability":
    "Single outcome probability with confidence interval and score distribution",
  "/api/sim/compare": "Compare baseline vs candidate scenario side-by-side",
  "/api/sim/sensitivity":
    "Sweep one parameter to measure its impact on outcome probability",
  "/api/sim/forecast":
    "Forward projection with drift, uncertainty growth, and period-by-period timeline",
  "/api/sim/composed":
    "Blend multiple weighted scenario components into a single outcome",
  "/api/sim/optimize": "Search bounded parameter ranges to maximize objective value",
};
const SIM_ENDPOINT_COMPOSABILITY = {
  "/api/sim/probability": {
    pattern: "data-to-simulation",
    description:
      "Parameters can be sourced from any Bazaar data endpoint. Fetch real-world data, extract numeric values, and pass them as named parameters.",
    example_sources: [
      {
        endpoint: "/api/bls/unemployment",
        extract: "data.latest.rate_pct",
        use_as: "labor_signal",
      },
      {
        endpoint: "/api/fed-funds-rate",
        extract: "data.latest.value",
        use_as: "monetary_pressure",
      },
      {
        endpoint: "/api/yield-curve",
        extract: "data.spreads.10Y-2Y",
        use_as: "yield_signal",
      },
    ],
    normalization_tip:
      "Scale raw values to roughly -1 to 1. Example: unemployment 4.4% -> (5.0 - 4.4) / 3.0 = 0.2 (positive labor signal)",
  },
  "/api/sim/compare": {
    pattern: "data-to-simulation",
    description:
      "Build baseline and candidate scenarios from real endpoint data. Example: baseline uses current economic indicators, candidate uses projected values.",
    example_sources: [
      {
        endpoint: "/api/treasury-rates",
        extract: "data.rates",
        use_as: "rate_environment",
      },
      {
        endpoint: "/api/stocks/candles/*",
        extract: "data.candles[-1].close",
        use_as: "price_signal",
      },
    ],
  },
  "/api/sim/sensitivity": {
    pattern: "data-to-simulation",
    description:
      "Use live data as the scenario baseline, then sweep one parameter to find which real-world factor has the most impact.",
    example_sources: [
      {
        endpoint: "/api/bls/cpi",
        extract: "data.latest.value",
        use_as: "inflation_signal",
      },
      {
        endpoint: "/api/exchange-rates/*",
        extract: "data.rates.EUR",
        use_as: "fx_exposure",
      },
    ],
  },
  "/api/sim/forecast": {
    pattern: "data-to-simulation",
    description:
      "Initialize forecast with current real-world values and project forward. Drift parameters can reflect trends from historical data endpoints.",
    example_sources: [
      {
        endpoint: "/api/weather/historical",
        extract: "data.daily[].temperature_max",
        use_as: "temperature_trend",
      },
      {
        endpoint: "/api/bls/jobs",
        extract: "data.latest.value",
        use_as: "employment_baseline",
      },
    ],
  },
  "/api/sim/composed": {
    pattern: "data-to-simulation",
    description:
      "Build weighted scenario components from different data domains. Example: blend a growth scenario (labor + consumer data) with a risk scenario (rates + credit data) using real Bazaar endpoint values.",
    example_sources: [
      {
        endpoint: "/api/bls/unemployment",
        extract: "data.latest.rate_pct",
        component: "growth-drivers",
      },
      {
        endpoint: "/api/fed-funds-rate",
        extract: "data.latest.value",
        component: "recession-headwinds",
      },
      {
        endpoint: "/api/yield-curve",
        extract: "data.spreads.10Y-2Y",
        component: "growth-drivers",
      },
      {
        endpoint: "/api/census/income/*",
        extract: "data.median_income",
        component: "growth-drivers",
      },
    ],
    normalization_tip:
      "Each component's scenario parameters should be normalized independently. The composed endpoint handles the weighting across components.",
  },
  "/api/sim/optimize": {
    pattern: "data-to-simulation",
    description:
      "Set scenario parameters from live data, define bounds based on realistic ranges, and find the optimal parameter values. Useful for: what economic conditions would maximize growth probability?",
    example_sources: [
      {
        endpoint: "/api/bls/unemployment",
        extract: "data.latest.rate_pct",
        bounds: { min: 3, max: 7 },
        normalize: "(5.0 - value) / 3.0",
      },
      {
        endpoint: "/api/fed-funds-rate",
        extract: "data.latest.value",
        bounds: { min: 0, max: 8 },
        normalize: "(3.0 - value) / 4.0",
      },
    ],
    normalization_tip:
      "Bounds should reflect plausible real-world ranges, not just -1 to 1.",
  },
};
const SIM_COMPOSABILITY_INSTRUCTIONS_BLOCK = `## Composable Simulations

All /api/sim/* endpoints accept arbitrary named numeric parameters. For data-driven simulations, agents can call any Bazaar data endpoint first (e.g. /api/bls/unemployment, /api/yield-curve, /api/fed-funds-rate, /api/stocks/candles/*), extract numeric values from the response, normalize them to a working range, and pass them as parameters into any simulation endpoint.

Example pipeline:
1. GET /api/bls/unemployment -> extract latest rate (e.g. 4.4%)
2. GET /api/fed-funds-rate -> extract rate (e.g. 4.33%)
3. GET /api/yield-curve -> extract 10Y-2Y spread (e.g. 0.42)
4. Normalize each value to a -1 to 1 signal
5. POST /api/sim/composed -> blend scenarios with live economic parameters

This composability pattern works across all simulation endpoints: probability, compare, sensitivity, forecast, composed, and optimize. The data endpoints provide the inputs; the simulation endpoints provide the analysis.`;
const SIM_LANDING_COMPOSABILITY = {
  overview:
    "The simulation suite is designed to consume real-world data from other Bazaar endpoints. Any numeric value from any GET endpoint can become a simulation parameter.",
  pipeline_pattern: [
    "1. Call one or more Bazaar data endpoints (GET)",
    "2. Extract numeric values from responses",
    "3. Normalize values to a working range (typically -1 to 1)",
    "4. Pass as named parameters to any POST /api/sim/* endpoint",
    "5. Receive probability, distribution, and decision-ready output",
  ],
  example_pipelines: [
    {
      name: "US Economic Health Assessment",
      steps: [
        {
          call: "GET /api/bls/unemployment",
          extract: "data.latest.rate_pct",
          normalize: "(5.0 - rate) / 3.0 -> labor_signal",
        },
        {
          call: "GET /api/fed-funds-rate",
          extract: "data.latest.value",
          normalize: "(3.0 - rate) / 4.0 -> monetary_signal",
        },
        {
          call: "GET /api/yield-curve",
          extract: "data.spreads.10Y-2Y",
          normalize: "spread / 2.0 -> yield_signal",
        },
        {
          call: "POST /api/sim/composed",
          input:
            "Two components: growth-drivers (labor + yield) weighted 60%, recession-headwinds (monetary) weighted 40%",
        },
      ],
      total_cost: "$0.114 (3 data calls + 1 simulation)",
      output: "Blended economic health probability with per-component breakdown",
    },
    {
      name: "Stock Volatility Forecast",
      steps: [
        {
          call: "GET /api/stocks/candles/AAPL",
          extract: "Calculate recent volatility from OHLCV",
        },
        {
          call: "GET /api/fed-funds-rate",
          extract: "Rate environment context",
        },
        {
          call: "POST /api/sim/forecast",
          input:
            "Initial price from candles, volatility as uncertainty, fed rate as drift modifier",
        },
      ],
      total_cost: "$0.10 (2 data calls + 1 simulation)",
      output: "30-period price forecast with probability fan and drawdown stats",
    },
    {
      name: "Vendor Risk Optimization",
      steps: [
        {
          call: "GET /api/ofac-sanctions-screening/{name}",
          extract: "Match count and risk score",
        },
        {
          call: "GET /api/sec/filings/{ticker}",
          extract: "Filing frequency and types",
        },
        {
          call: "GET /api/courts/cases?query={company}",
          extract: "Litigation count",
        },
        {
          call: "POST /api/sim/optimize",
          input:
            "Risk parameters with bounds, find threshold that balances false positives vs missed risks",
        },
      ],
      total_cost: "$0.126 (3 data calls + 1 simulation)",
      output: "Optimal risk threshold with sensitivity analysis",
    },
  ],
  normalization_guide: {
    purpose:
      "Raw API values have different scales. Normalize to a consistent range so weights and uncertainty are meaningful.",
    common_patterns: [
      {
        type: "Percentage (0-100)",
        formula: "(value - midpoint) / half_range",
        example: "Unemployment 4.4% -> (5.0 - 4.4) / 3.0 = 0.2",
      },
      {
        type: "Rate (0-10)",
        formula: "(neutral - value) / range",
        example: "Fed rate 4.33% -> (3.0 - 4.33) / 4.0 = -0.33",
      },
      {
        type: "Spread (-2 to 2)",
        formula: "value / max_expected",
        example: "Yield spread 0.42 -> 0.42 / 2.0 = 0.21",
      },
      {
        type: "Count",
        formula: "log(1 + count) / log(1 + max_expected)",
        example: "5 OFAC matches -> log(6) / log(20) = 0.60",
      },
      {
        type: "Binary signal",
        formula: "1.0 if present, -1.0 if absent",
        example: "SEC filing exists -> 1.0",
      },
    ],
  },
  suggested_data_sources: [
    {
      category: "Economic",
      endpoints: [
        "/api/bls/unemployment",
        "/api/bls/cpi",
        "/api/bls/jobs",
        "/api/bls/wages",
        "/api/fed-funds-rate",
        "/api/yield-curve",
        "/api/treasury-rates",
      ],
    },
    {
      category: "Financial",
      endpoints: [
        "/api/stocks/candles/*",
        "/api/exchange-rates/*",
        "/api/sec/filings/*",
        "/api/sec/company-facts/*",
      ],
    },
    {
      category: "Compliance",
      endpoints: [
        "/api/ofac-sanctions-screening/*",
        "/api/sanctions/*",
        "/api/vendor-entity-brief",
        "/api/courts/cases",
      ],
    },
    {
      category: "Demographic",
      endpoints: [
        "/api/census/population",
        "/api/census/income/*",
        "/api/census/housing",
        "/api/census/age-breakdown",
      ],
    },
    {
      category: "Environmental",
      endpoints: [
        "/api/weather/current/*",
        "/api/weather/forecast",
        "/api/air-quality/*",
        "/api/uv-index/*",
      ],
    },
  ],
};

function isProductionRuntime(env = process.env) {
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production";
}

function getRoutePathFromKey(routeKey) {
  const firstSpace = String(routeKey || "").indexOf(" ");
  if (firstSpace < 0) {
    return "";
  }

  return String(routeKey).slice(firstSpace + 1).trim();
}

function shouldHideRouteInProduction(routeKey, options = {}) {
  if (options.includeHiddenRoutes) {
    return false;
  }

  const env = options.env || process.env;
  return isProductionRuntime(env) && PRODUCTION_HIDDEN_ROUTE_KEYS.has(routeKey);
}

function buildHiddenRouteMatchers() {
  return Array.from(PRODUCTION_HIDDEN_ROUTE_KEYS)
    .map((key) => getRoutePathFromKey(key))
    .filter(Boolean)
    .map((routePath) => {
      if (routePath.includes("*")) {
        return {
          type: "prefix",
          value: routePath.slice(0, routePath.indexOf("*")),
        };
      }

      return {
        type: "exact",
        value: routePath,
      };
    });
}

function shouldHideResourceUrlInProduction(resourceUrl, options = {}) {
  if (options.includeHiddenRoutes) {
    return false;
  }

  const env = options.env || process.env;
  if (!isProductionRuntime(env)) {
    return false;
  }

  let resourcePath = "";
  try {
    const parsed = new URL(String(resourceUrl));
    resourcePath = parsed.pathname;
  } catch (_error) {
    resourcePath = String(resourceUrl || "");
  }

  const matchers = options.hiddenRouteMatchers || buildHiddenRouteMatchers();
  for (const matcher of matchers) {
    if (matcher.type === "prefix" && resourcePath.startsWith(matcher.value)) {
      return true;
    }
    if (matcher.type === "exact" && resourcePath === matcher.value) {
      return true;
    }
  }

  return false;
}

function matchesRoutePath(pathname, matchers) {
  const routePath = String(pathname || "");
  for (const matcher of matchers) {
    if (matcher.type === "prefix" && routePath.startsWith(matcher.value)) {
      return true;
    }

    if (matcher.type === "exact" && routePath === matcher.value) {
      return true;
    }
  }

  return false;
}

function createProductionInactiveRoutesMiddleware(options = {}) {
  const hiddenRouteMatchers = options.hiddenRouteMatchers || buildHiddenRouteMatchers();

  return function productionInactiveRoutesMiddleware(req, res, next) {
    if (!isProductionRuntime(process.env)) {
      next();
      return;
    }

    const method = String(req.method || "").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      next();
      return;
    }

    if (!matchesRoutePath(req.path, hiddenRouteMatchers)) {
      next();
      return;
    }

    res.status(503).json({
      success: false,
      error: "Endpoint temporarily unavailable",
      code: "ENDPOINT_TEMPORARILY_DISABLED",
    });
  };
}

function buildCanonicalResourceUrl(resourcePath) {
  if (!resourcePath) {
    return null;
  }

  if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
    return resourcePath;
  }

  return `${CANONICAL_BASE_URL}${resourcePath}`;
}

function createDiscoveryExtension(options = {}) {
  const {
    category,
    description,
    tags,
    price,
    queryExample,
    querySchema,
    inputExample,
    inputSchema,
    bodyType,
    outputExample,
  } = options;

  const extension = declareDiscoveryExtension({
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
    ...(Array.isArray(tags) && tags.length ? { tags } : {}),
    ...(inputExample || queryExample ? { input: inputExample || queryExample } : {}),
    ...(inputSchema || querySchema ? { inputSchema: inputSchema || querySchema } : {}),
    ...(bodyType ? { bodyType } : {}),
    ...(outputExample ? { output: { example: outputExample } } : {}),
  });

  if (extension?.bazaar?.info && typeof extension.bazaar.info === "object") {
    const info = extension.bazaar.info;

    if (category) {
      info.category = category;
    }

    if (description) {
      info.description = description;
    }

    if (Array.isArray(tags) && tags.length) {
      info.tags = [...tags];
    }

    if (price) {
      info.price = price;
    }
  }

  return extension;
}

function createPricedRoute(config, legacyDescription, legacyPayTo = PAY_TO) {
  const options =
    typeof config === "object" && config !== null
      ? { ...config }
      : {
          price: config,
          description: legacyDescription,
          payTo: legacyPayTo,
        };
  const {
    price,
    description,
    payTo = PAY_TO,
    resourcePath,
    category,
    tags,
    queryExample,
    querySchema,
    inputExample,
    inputSchema,
    bodyType,
    outputExample,
  } = options;
  const normalizedPrice = typeof price === "string" && !price.startsWith("$") ? `$${price}` : price;

  return {
    resource: buildCanonicalResourceUrl(resourcePath),
    accepts: {
      scheme: "exact",
      network: X402_NETWORK,
      payTo,
      price: normalizedPrice,
      maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    },
    description,
    mimeType: "application/json",
    ...(category ? { category } : {}),
    ...(Array.isArray(tags) ? { tags } : {}),
    extensions: createDiscoveryExtension({
      category,
      description,
      tags,
      price: normalizedPrice,
      queryExample,
      querySchema,
      inputExample,
      inputSchema,
      bodyType,
      outputExample,
    }),
  };
}

function getBundledSellerRoutes() {
  const restrictedRoutes = Array.isArray(restrictedPartySellerConfig?.routes)
    ? restrictedPartySellerConfig.routes
    : [];
  const vendorRoutes = Array.isArray(vendorEntityBriefSellerConfig?.routes)
    ? vendorEntityBriefSellerConfig.routes
    : vendorEntityBriefSellerConfig?.route
      ? [vendorEntityBriefSellerConfig.route]
      : [];
  const genericSimulatorRoutes = Array.isArray(genericSimulatorSellerConfig?.routes)
    ? genericSimulatorSellerConfig.routes
    : genericSimulatorSellerConfig?.route
      ? [genericSimulatorSellerConfig.route]
      : [];

  return [
    ...restrictedRoutes.map((route) => ({
      ...route,
      payTo: restrictedPartySellerConfig?.payTo || PAY_TO,
      seller: "restricted-party-screen",
    })),
    ...vendorRoutes.map((route) => ({
      ...route,
      payTo: vendorEntityBriefSellerConfig?.payTo || PAY_TO,
      seller: "vendor-entity-brief",
    })),
    ...genericSimulatorRoutes.map((route) => ({
      ...route,
      payTo: genericSimulatorSellerConfig?.payTo || PAY_TO,
      seller: "generic-parameter-simulator",
    })),
  ];
}

function createBundledSellerRouteConfig() {
  const entries = {};

  for (const route of getBundledSellerRoutes()) {
    const canonicalResourcePath = route?.canonicalPath || route?.resourcePath;
    if (!route?.key || !canonicalResourcePath) {
      continue;
    }

    const normalizedInputExample =
      String(route.method || "").toUpperCase() === "POST" && route.inputExample
        ? { body: route.inputExample }
        : route.inputExample;

    entries[route.key] = createPricedRoute({
      price: route.price,
      description: route.description,
      payTo: route.payTo || PAY_TO,
      resourcePath: canonicalResourcePath,
      category: route.category,
      tags: route.tags,
      queryExample: route.queryExample,
      querySchema: route.querySchema,
      inputExample: normalizedInputExample,
      inputSchema: route.inputSchema,
      bodyType: route.bodyType,
      outputExample: route.outputExample,
    });
  }

  return entries;
}

function createExpandedRouteConfig(payTo = PAY_TO) {
  return {
    "GET /api/stocks/quote/*": createPricedRoute({
      price: "0.008",
      description:
        "Real-time stock quote by ticker symbol, with automatic fallback providers when primary data is unavailable.",
      category: "data/finance",
      tags: ["stocks", "quote", "markets"],
      payTo,
      resourcePath: "/api/stocks/quote/AAPL",
      outputExample: {
        success: true,
        data: { symbol: "AAPL", price: 217.45, change: 1.24, percentChange: 0.57 },
        source: "Finnhub",
      },
    }),
    "GET /api/stocks/search": createPricedRoute({
      price: "0.008",
      description: "Search stock symbols and names.",
      category: "data/finance",
      tags: ["stocks", "search", "markets"],
      payTo,
      resourcePath: "/api/stocks/search",
      queryExample: { q: "apple" },
      querySchema: {
        properties: {
          q: { type: "string", description: "Company name or ticker query" },
          limit: { type: "string", description: "Max results to return" },
        },
        required: ["q"],
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { query: "apple", count: 1, results: [{ symbol: "AAPL", description: "Apple Inc." }] },
        source: "Finnhub",
      },
    }),
    "GET /api/stocks/candles/*": createPricedRoute({
      price: "0.012",
      description: "Historical OHLCV candles for a stock symbol.",
      category: "data/finance",
      tags: ["stocks", "candles", "ohlcv"],
      payTo,
      resourcePath: "/api/stocks/candles/AAPL",
      queryExample: { interval: "daily", limit: "30" },
      querySchema: {
        properties: {
          interval: { type: "string", description: "daily or weekly" },
          limit: { type: "string", description: "Max candles to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { symbol: "AAPL", interval: "daily", count: 2, candles: [{ date: "2026-03-26", close: 217.45 }] },
        source: "Alpha Vantage",
      },
    }),
    "GET /api/treasury-rates": createPricedRoute({
      price: "0.008",
      description: "US Treasury rates from FRED for common maturities.",
      category: "data/finance",
      tags: ["treasury", "rates", "fred"],
      payTo,
      resourcePath: "/api/treasury-rates",
      queryExample: { series: "DGS2,DGS10", limit: "10" },
      querySchema: {
        properties: {
          series: { type: "string", description: "Comma-separated FRED series ids" },
          limit: { type: "string", description: "Max observations per series" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { count: 2, series: [{ seriesId: "DGS2" }, { seriesId: "DGS10" }] },
        source: "FRED API",
      },
    }),
    "GET /api/fed-funds-rate": createPricedRoute({
      price: "0.008",
      description: "Federal Funds Effective Rate history (FRED FEDFUNDS).",
      category: "data/finance",
      tags: ["fed", "rates", "fred"],
      payTo,
      resourcePath: "/api/fed-funds-rate",
      queryExample: { limit: "24" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "FEDFUNDS", latest: { date: "2026-02-01", value: 4.33 } },
        source: "FRED API",
      },
    }),
    "GET /api/yield-curve": createPricedRoute({
      price: "0.008",
      description: "US Treasury yield curve snapshot and spread metrics.",
      category: "data/finance",
      tags: ["yield-curve", "treasury", "fred"],
      payTo,
      resourcePath: "/api/yield-curve",
      queryExample: { date: "2026-03-29" },
      querySchema: {
        properties: {
          date: { type: "string", description: "Optional as-of date (YYYY-MM-DD)" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { latestDate: "2026-03-26", rates: { DGS2: 4.08, DGS10: 4.17 }, spread_10y_2y: 0.09 },
        source: "FRED API",
      },
    }),
    "GET /api/commodities/gold": createPricedRoute({
      price: "0.008",
      description: "Gold price time series with FRED primary candidates and Yahoo fallback.",
      category: "data/finance",
      tags: ["commodities", "gold", "macro"],
      payTo,
      resourcePath: "/api/commodities/gold",
      queryExample: { limit: "30" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "GC=F", latest: { date: "2026-03-27", value: 3031.8 }, fallbackUsed: true },
        source: "Yahoo Finance API",
      },
    }),
    "GET /api/commodities/oil": createPricedRoute({
      price: "0.008",
      description: "WTI crude oil spot price series from FRED.",
      category: "data/finance",
      tags: ["commodities", "oil", "energy"],
      payTo,
      resourcePath: "/api/commodities/oil",
      queryExample: { limit: "30" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "DCOILWTICO", latest: { date: "2026-03-27", value: 80.24 } },
        source: "FRED API",
      },
    }),
    "GET /api/mortgage-rates": createPricedRoute({
      price: "0.008",
      description: "30-year fixed mortgage rate time series from FRED.",
      category: "data/finance",
      tags: ["mortgage", "housing", "rates"],
      payTo,
      resourcePath: "/api/mortgage-rates",
      queryExample: { limit: "52" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "MORTGAGE30US", latest: { date: "2026-03-26", value: 6.57 } },
        source: "FRED API",
      },
    }),
    "GET /api/sp500": createPricedRoute({
      price: "0.008",
      description: "S&P 500 index series with FRED primary and Yahoo fallback.",
      category: "data/finance",
      tags: ["sp500", "equities", "benchmark"],
      payTo,
      resourcePath: "/api/sp500",
      queryExample: { limit: "60" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "SP500", latest: { date: "2026-03-27", value: 5792.15 } },
        source: "FRED API",
      },
    }),
    "GET /api/vix": createPricedRoute({
      price: "0.008",
      description: "CBOE Volatility Index (VIX) close series from FRED.",
      category: "data/finance",
      tags: ["vix", "volatility", "risk"],
      payTo,
      resourcePath: "/api/vix",
      queryExample: { limit: "60" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "VIXCLS", latest: { date: "2026-03-27", value: 18.42 } },
        source: "FRED API",
      },
    }),
    "GET /api/dollar-index": createPricedRoute({
      price: "0.008",
      description: "Broad US dollar trade-weighted index from FRED (DTWEXBGS).",
      category: "data/finance",
      tags: ["dollar-index", "usd", "macro"],
      payTo,
      resourcePath: "/api/dollar-index",
      queryExample: { limit: "60" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { seriesId: "DTWEXBGS", latest: { date: "2026-03-27", value: 119.03 } },
        source: "FRED API",
      },
    }),
    "GET /api/credit-spreads": createPricedRoute({
      price: "0.008",
      description: "Corporate credit spreads (high yield and investment grade) from FRED.",
      category: "data/finance",
      tags: ["credit", "spreads", "risk"],
      payTo,
      resourcePath: "/api/credit-spreads",
      queryExample: { limit: "24" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { spreadGap: 2.2, latest: { BAMLH0A0HYM2: { value: 4.4 }, BAMLC0A0CM: { value: 2.2 } } },
        source: "FRED API",
      },
    }),
    "GET /api/real-rates": createPricedRoute({
      price: "0.008",
      description: "US Treasury real yields (5Y and 10Y TIPS) from FRED.",
      category: "data/finance",
      tags: ["real-rates", "tips", "macro"],
      payTo,
      resourcePath: "/api/real-rates",
      queryExample: { limit: "60" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { avgRealRate: 1.62, latest: { DFII5: { value: 1.55 }, DFII10: { value: 1.69 } } },
        source: "FRED API",
      },
    }),
    "GET /api/inflation-expectations": createPricedRoute({
      price: "0.008",
      description: "5Y and 10Y breakeven inflation expectations from FRED.",
      category: "data/finance",
      tags: ["inflation", "breakeven", "macro"],
      payTo,
      resourcePath: "/api/inflation-expectations",
      queryExample: { limit: "60" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max observations to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: { breakevenSlope: 0.15, latest: { T5YIE: { value: 2.2 }, T10YIE: { value: 2.35 } } },
        source: "FRED API",
      },
    }),
    "GET /api/bls/jobs": createPricedRoute({
      price: "0.008",
      description: "BLS jobs time series (CES0000000001).",
      category: "data/government",
      tags: ["bls", "jobs", "labor-market"],
      payTo,
      resourcePath: "/api/bls/jobs",
      queryExample: { years: "5" },
      querySchema: {
        properties: {
          years: { type: "string", description: "Years of monthly history (1-20)" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { seriesId: "CES0000000001" }, source: "Bureau of Labor Statistics" },
    }),
    "GET /api/bls/wages": createPricedRoute({
      price: "0.008",
      description: "BLS wage time series (CES0500000003).",
      category: "data/government",
      tags: ["bls", "wages", "earnings"],
      payTo,
      resourcePath: "/api/bls/wages",
      queryExample: { years: "5" },
      querySchema: {
        properties: {
          years: { type: "string", description: "Years of monthly history (1-20)" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { seriesId: "CES0500000003" }, source: "Bureau of Labor Statistics" },
    }),
    "GET /api/bls/pce": createPricedRoute({
      price: "0.008",
      description: "PCE inflation index from FRED (PCEPI).",
      category: "data/government",
      tags: ["fred", "pce", "inflation"],
      payTo,
      resourcePath: "/api/bls/pce",
      queryExample: { years: "5" },
      querySchema: {
        properties: {
          years: { type: "string", description: "Years of monthly history (1-20)" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { seriesId: "PCEPI" }, source: "FRED API" },
    }),
    "GET /api/census/housing": createPricedRoute({
      price: "0.008",
      description: "Census housing and renter/owner occupancy indicators.",
      category: "data/government",
      tags: ["census", "housing", "demographics"],
      payTo,
      resourcePath: "/api/census/housing",
      queryExample: { state: "06" },
      querySchema: {
        properties: {
          state: { type: "string", description: "2-digit state FIPS code" },
          zip: { type: "string", description: "5-digit ZIP code" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { survey: "ACS 5-Year Estimates (2022)" }, source: "US Census Bureau API" },
    }),
    "GET /api/census/income/*": createPricedRoute({
      price: "0.008",
      description: "Census income profile for a 5-digit ZIP code.",
      category: "data/government",
      tags: ["census", "income", "zip"],
      payTo,
      resourcePath: "/api/census/income/20002",
      outputExample: { success: true, data: { zip: "20002", medianHouseholdIncome: 106500 }, source: "US Census Bureau API" },
    }),
    "GET /api/census/age-breakdown": createPricedRoute({
      price: "0.008",
      description: "Census age and sex breakdown by geography.",
      category: "data/government",
      tags: ["census", "demographics", "age"],
      payTo,
      resourcePath: "/api/census/age-breakdown",
      queryExample: { state: "06" },
      querySchema: {
        properties: {
          state: { type: "string", description: "2-digit state FIPS code" },
          zip: { type: "string", description: "5-digit ZIP code" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { totalPopulation: 39356104 }, source: "US Census Bureau API" },
    }),
    "GET /api/fda/drug-labels/*": createPricedRoute({
      price: "0.008",
      description: "openFDA drug labeling and warnings by drug name.",
      category: "data/health",
      tags: ["fda", "drug-labels", "safety"],
      payTo,
      resourcePath: "/api/fda/drug-labels/aspirin",
      queryExample: { limit: "10" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max records to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { drug: "aspirin", count: 3 }, source: "openFDA Drug Label API" },
    }),
    "GET /api/fda/drug-events/*": createPricedRoute({
      price: "0.008",
      description: "Alias path for openFDA adverse event reports by drug.",
      category: "data/health",
      tags: ["fda", "drug-safety", "adverse-events"],
      payTo,
      resourcePath: "/api/fda/drug-events/aspirin",
      queryExample: { limit: "10" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max records to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { drug: "aspirin", count: 10 }, source: "openFDA Drug Adverse Events API" },
    }),
    "GET /api/fda/medical-devices": createPricedRoute({
      price: "0.008",
      description: "openFDA medical device adverse events.",
      category: "data/health",
      tags: ["fda", "medical-devices", "adverse-events"],
      payTo,
      resourcePath: "/api/fda/medical-devices",
      queryExample: { query: "pump", limit: "10" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Optional keyword filter" },
          limit: { type: "string", description: "Max records to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { count: 10 }, source: "openFDA Device Event API" },
    }),
    "GET /api/fda/device-recalls": createPricedRoute({
      price: "0.008",
      description: "openFDA device recall events.",
      category: "data/health",
      tags: ["fda", "medical-devices", "recalls"],
      payTo,
      resourcePath: "/api/fda/device-recalls",
      queryExample: { query: "pacemaker", limit: "10" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Optional keyword filter" },
          limit: { type: "string", description: "Max records to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { count: 10 }, source: "openFDA Device Recall API" },
    }),
    "GET /api/fda/ndc/*": createPricedRoute({
      price: "0.008",
      description: "Lookup drug record by National Drug Code (NDC).",
      category: "data/health",
      tags: ["fda", "ndc", "drug-directory"],
      payTo,
      resourcePath: "/api/fda/ndc/00597-0152",
      outputExample: { success: true, data: { ndc: "00597-0152", count: 1 }, source: "openFDA NDC API" },
    }),
    "GET /api/weather/historical": createPricedRoute({
      price: "0.006",
      description: "Historical weather daily series for a coordinate and date range.",
      category: "real-time-data/weather",
      tags: ["weather", "historical", "climate"],
      payTo,
      resourcePath: "/api/weather/historical",
      queryExample: { lat: "40.7128", lon: "-74.0060", start: "2026-03-01", end: "2026-03-07" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
          start: { type: "string", description: "Start date YYYY-MM-DD" },
          end: { type: "string", description: "End date YYYY-MM-DD" },
        },
        required: ["lat", "lon", "start", "end"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { startDate: "2026-03-01", endDate: "2026-03-07" }, source: "Open-Meteo Historical API" },
    }),
    "GET /api/weather/alerts/*": createPricedRoute({
      price: "0.006",
      description: "Active NWS weather alerts for a US state code.",
      category: "real-time-data/weather",
      tags: ["weather", "alerts", "noaa"],
      payTo,
      resourcePath: "/api/weather/alerts/TX",
      outputExample: { success: true, data: { state: "TX", count: 2 }, source: "NWS Alerts API" },
    }),
    "GET /api/weather/marine": createPricedRoute({
      price: "0.006",
      description: "Marine wave and swell forecast for a coordinate.",
      category: "real-time-data/weather",
      tags: ["weather", "marine", "ocean"],
      payTo,
      resourcePath: "/api/weather/marine",
      queryExample: { lat: "29.76", lon: "-95.36", hours: "24" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
          hours: { type: "string", description: "Hour count to return" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { count: 24 }, source: "Open-Meteo Marine API" },
    }),
    "GET /api/weather/air-quality": createPricedRoute({
      price: "0.008",
      description: "Alias path for AQI by ZIP. Query with ?zip=20002.",
      category: "real-time-data/weather",
      tags: ["air-quality", "aqi", "weather"],
      payTo,
      resourcePath: "/api/weather/air-quality",
      queryExample: { zip: "20002" },
      querySchema: {
        properties: {
          zip: { type: "string", description: "US ZIP code" },
        },
        required: ["zip"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { zip: "20002", overallAqi: 39 }, source: "EPA AirNow API" },
    }),
    "GET /api/uv-index/*": createPricedRoute({
      price: "0.006",
      description: "UV index forecast for exact latitude/longitude path input.",
      category: "real-time-data/weather",
      tags: ["weather", "uv-index", "forecast"],
      payTo,
      resourcePath: "/api/uv-index/40.7128/-74.0060",
      outputExample: { success: true, data: { current: { uvIndex: 4.2 } }, source: "Open-Meteo API" },
    }),
    "GET /api/weather/extremes": createPricedRoute({
      price: "0.006",
      description: "Forecasted weather extreme flags (heat, freeze, heavy rain, high wind, severe storm).",
      category: "real-time-data/weather",
      tags: ["weather", "extremes", "risk"],
      payTo,
      resourcePath: "/api/weather/extremes",
      queryExample: { lat: "40.7128", lon: "-74.0060", days: "7" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
          days: { type: "string", description: "Forecast days (1-16)" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { summary: { heatRiskDays: 1, freezeRiskDays: 0 } }, source: "Open-Meteo API" },
    }),
    "GET /api/weather/freeze-risk": createPricedRoute({
      price: "0.006",
      description: "Freeze risk scan from forecasted daily minimum temperatures.",
      category: "real-time-data/weather",
      tags: ["weather", "freeze", "agriculture"],
      payTo,
      resourcePath: "/api/weather/freeze-risk",
      queryExample: { lat: "41.25", lon: "-96.0", days: "10", threshold_f: "32" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
          days: { type: "string", description: "Forecast days (1-16)" },
          threshold_f: { type: "string", description: "Freeze threshold in Fahrenheit" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { riskLevel: "medium", firstFreezeDate: "2026-11-06" }, source: "Open-Meteo API" },
    }),
    "GET /api/geocode": createPricedRoute({
      price: "0.006",
      description: "Forward geocoding from address/query text to coordinates.",
      category: "data/location",
      tags: ["geocode", "location", "osm"],
      payTo,
      resourcePath: "/api/geocode",
      queryExample: { q: "1600 Pennsylvania Ave NW, Washington, DC", limit: "3" },
      querySchema: {
        properties: {
          q: { type: "string", description: "Address or place query" },
          limit: { type: "string", description: "Max candidates to return" },
        },
        required: ["q"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "Washington, DC", count: 1 }, source: "Nominatim" },
    }),
    "GET /api/reverse-geocode": createPricedRoute({
      price: "0.006",
      description: "Reverse geocoding from coordinates to address components.",
      category: "data/location",
      tags: ["reverse-geocode", "location", "osm"],
      payTo,
      resourcePath: "/api/reverse-geocode",
      queryExample: { lat: "40.7128", lon: "-74.0060" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { latitude: 40.7128, longitude: -74.006 }, source: "Nominatim" },
    }),
    "GET /api/timezone/*": createPricedRoute({
      price: "0.006",
      description: "Resolve timezone and local clock by coordinates with fallback providers.",
      category: "data/location",
      tags: ["timezone", "location", "time"],
      payTo,
      resourcePath: "/api/timezone/40.7128/-74.0060",
      outputExample: { success: true, data: { timezone: "America/New_York" }, source: "timeapi.io" },
    }),
    "GET /api/zipcode/*": createPricedRoute({
      price: "0.006",
      description: "Lookup ZIP code geography and coordinates.",
      category: "data/location",
      tags: ["zipcode", "location", "postal"],
      payTo,
      resourcePath: "/api/zipcode/10001",
      outputExample: { success: true, data: { zip: "10001", country: "US" }, source: "Zippopotam.us" },
    }),
    "GET /api/elevation/*": createPricedRoute({
      price: "0.006",
      description: "Lookup elevation for exact coordinate input.",
      category: "data/location",
      tags: ["elevation", "location", "terrain"],
      payTo,
      resourcePath: "/api/elevation/40.7128/-74.0060",
      outputExample: { success: true, data: { elevation_m: 10 }, source: "Open-Elevation" },
    }),
    "GET /api/whois/*": createPricedRoute({
      price: "0.006",
      description: "WHOIS/RDAP lookup for a domain.",
      category: "data/network-intelligence",
      tags: ["whois", "rdap", "domain"],
      payTo,
      resourcePath: "/api/whois/example.com",
      outputExample: { success: true, data: { domain: "example.com" }, source: "RDAP.org" },
    }),
    "GET /api/dns/*": createPricedRoute({
      price: "0.006",
      description: "DNS lookup by domain with record type option and provider fallback.",
      category: "data/network-intelligence",
      tags: ["dns", "domain", "network"],
      payTo,
      resourcePath: "/api/dns/example.com",
      queryExample: { type: "A" },
      querySchema: {
        properties: {
          type: { type: "string", description: "DNS record type (A, AAAA, MX, TXT, NS)" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { domain: "example.com", type: "A", count: 1 }, source: "Cloudflare DoH" },
    }),
    "GET /api/ssl/*": createPricedRoute({
      price: "0.006",
      description: "SSL certificate issuer and expiry inspection for a domain.",
      category: "data/network-intelligence",
      tags: ["ssl", "tls", "domain"],
      payTo,
      resourcePath: "/api/ssl/example.com",
      outputExample: { success: true, data: { domain: "example.com", validTo: "2026-11-20T00:00:00.000Z" }, source: "ssl-checker.io" },
    }),
    "GET /api/domain-availability/*": createPricedRoute({
      price: "0.012",
      description: "Domain availability estimate with paid provider and RDAP heuristic fallback.",
      category: "data/network-intelligence",
      tags: ["domain", "availability", "whois"],
      payTo,
      resourcePath: "/api/domain-availability/example.com",
      outputExample: { success: true, data: { domain: "example.com", available: false }, source: "WhoisJSON" },
    }),
    "GET /api/sec/filings/*": createPricedRoute({
      price: "0.006",
      description: "Recent SEC EDGAR filings by ticker.",
      category: "data/government",
      tags: ["sec", "edgar", "filings"],
      payTo,
      resourcePath: "/api/sec/filings/AAPL",
      queryExample: { limit: "10" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max filing rows to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { ticker: "AAPL", count: 10 }, source: "SEC EDGAR API" },
    }),
    "GET /api/sec/company-facts/*": createPricedRoute({
      price: "0.006",
      description: "SEC company facts (XBRL) by ticker.",
      category: "data/government",
      tags: ["sec", "xbrl", "financials"],
      payTo,
      resourcePath: "/api/sec/company-facts/AAPL",
      outputExample: { success: true, data: { ticker: "AAPL", cik: "0000320193" }, source: "SEC EDGAR API" },
    }),
    "GET /api/sec/insider-trades/*": createPricedRoute({
      price: "0.006",
      description: "SEC Form 4 insider trades by ticker.",
      category: "data/government",
      tags: ["sec", "insider-trading", "form-4"],
      payTo,
      resourcePath: "/api/sec/insider-trades/AAPL",
      queryExample: { limit: "10" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max rows to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { ticker: "AAPL", count: 10 }, source: "SEC EDGAR API" },
    }),
    "GET /api/sanctions/*": createPricedRoute({
      price: "0.006",
      description: "OFAC sanctions screening alias route with grouped match signals.",
      category: "data/government",
      tags: ["ofac", "sanctions", "compliance"],
      payTo,
      resourcePath: "/api/sanctions/SBERBANK",
      queryExample: { minScore: "90", limit: "5" },
      querySchema: {
        properties: {
          minScore: { type: "string", description: "Minimum OFAC name score" },
          limit: { type: "string", description: "Max grouped matches to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { summary: { matchCount: 1 } }, source: "OFAC Sanctions List Service" },
    }),
    "GET /api/courts/cases": createPricedRoute({
      price: "0.006",
      description: "CourtListener case/docket search.",
      category: "data/government",
      tags: ["courts", "cases", "legal"],
      payTo,
      resourcePath: "/api/courts/cases",
      queryExample: { query: "antitrust", limit: "20" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "string", description: "Max rows to return" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "antitrust", count: 20 }, source: "CourtListener API" },
    }),
    "GET /api/courts/opinions": createPricedRoute({
      price: "0.008",
      description: "CourtListener opinion search by query text.",
      category: "data/government",
      tags: ["courts", "opinions", "legal"],
      payTo,
      resourcePath: "/api/courts/opinions",
      queryExample: { query: "antitrust", limit: "20" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "string", description: "Max rows to return" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "antitrust", count: 20 }, source: "CourtListener API" },
    }),
    "GET /api/courts/opinions/*": createPricedRoute({
      price: "0.008",
      description: "CourtListener opinion search path alias for query-based route.",
      category: "data/government",
      tags: ["courts", "opinions", "legal"],
      payTo,
      resourcePath: "/api/courts/opinions/antitrust",
      queryExample: { limit: "20" },
      querySchema: {
        properties: {
          limit: { type: "string", description: "Max rows to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "antitrust", count: 20 }, source: "CourtListener API" },
    }),
    "GET /api/courts/citations": createPricedRoute({
      price: "0.008",
      description:
        "Resolve a legal citation (e.g. '410 U.S. 113') to its case. Returns case name, date filed, citation count, and precedential status for verification and precedent lookups.",
      category: "data/government",
      tags: ["courts", "citations", "legal"],
      payTo,
      resourcePath: "/api/courts/citations?citation=410+U.S.+113",
      queryExample: { citation: "410 U.S. 113", limit: "10" },
      querySchema: {
        properties: {
          citation: { type: "string", description: "Citation text (e.g. 410 U.S. 113)" },
          text: { type: "string", description: "Alias for citation text" },
          limit: { type: "string", description: "Max matches to return" },
        },
        required: ["citation"],
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          citation: "410 U.S. 113",
          count: 1,
          citations: [
            {
              citation: "410 U.S. 113",
              clusterCount: 1,
              clusters: [
                {
                  caseName: "Roe v. Wade",
                  dateFiled: "1973-01-22",
                  citationCount: 5572,
                  precedentialStatus: "Published",
                },
              ],
            },
          ],
        },
        source: "CourtListener API",
      },
    }),
    "GET /api/courts/court-info": createPricedRoute({
      price: "0.006",
      description: "Court metadata lookup (id, name, jurisdiction, hierarchy).",
      category: "data/government",
      tags: ["courts", "metadata", "legal"],
      payTo,
      resourcePath: "/api/courts/court-info",
      queryExample: { query: "supreme", jurisdiction: "F", limit: "20" },
      querySchema: {
        properties: {
          id: { type: "string", description: "Exact CourtListener court id (e.g. scotus)" },
          query: { type: "string", description: "Partial full-name lookup" },
          jurisdiction: { type: "string", description: "Jurisdiction code filter" },
          inUse: { type: "string", description: "true/false active-court filter" },
          limit: { type: "string", description: "Max rows to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { count: 1, courts: [{ id: "scotus" }] }, source: "CourtListener API" },
    }),
    "GET /api/courts/clusters": createPricedRoute({
      price: "0.008",
      description: "Opinion-cluster search derived from CourtListener search index.",
      category: "data/government",
      tags: ["courts", "clusters", "legal"],
      payTo,
      resourcePath: "/api/courts/clusters",
      queryExample: { query: "antitrust", limit: "20" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "string", description: "Max unique clusters to return" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "antitrust", count: 20 }, source: "CourtListener API" },
    }),
    "GET /api/sports/scores/*": createPricedRoute({
      price: "0.008",
      description:
        "Live/recent scores by sport with provider fallback. Supported sport slugs: nfl,nba,mlb,nhl,epl,ncaaf,ncaamb,mls.",
      category: "real-time-data/sports",
      tags: ["sports", "scores", "live-data"],
      payTo,
      resourcePath: "/api/sports/scores/nfl",
      queryExample: { date: "20260327", limit: "25" },
      querySchema: {
        properties: {
          date: { type: "string", description: "Date as YYYYMMDD" },
          limit: { type: "string", description: "Max games to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { sport: "nfl", count: 10 }, source: "TheSportsDB" },
    }),
    "GET /api/sports/standings/*": createPricedRoute({
      price: "0.008",
      description:
        "League standings by sport. Supported sport slugs: nfl,nba,mlb,nhl,epl,ncaaf,ncaamb,mls.",
      category: "real-time-data/sports",
      tags: ["sports", "standings", "rankings"],
      payTo,
      resourcePath: "/api/sports/standings/nfl",
      queryExample: { season: "2025" },
      querySchema: {
        properties: {
          season: { type: "string", description: "Season value, e.g. 2025" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { sport: "nfl", count: 32 }, source: "TheSportsDB" },
    }),
    "GET /api/sports/schedule/*": createPricedRoute({
      price: "0.008",
      description: "Team schedule by team path with optional sport/date filters.",
      category: "real-time-data/sports",
      tags: ["sports", "schedule", "team-data"],
      payTo,
      resourcePath: "/api/sports/schedule/Patriots",
      queryExample: { sport: "nfl", date: "20260327", limit: "25" },
      querySchema: {
        properties: {
          sport: {
            type: "string",
            description: "Sport slug: nfl,nba,mlb,nhl,epl,ncaaf,ncaamb,mls",
          },
          date: { type: "string", description: "Date as YYYYMMDD" },
          limit: { type: "string", description: "Max games to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { teamQuery: "Patriots", count: 17 }, source: "TheSportsDB" },
    }),
    "GET /api/sports/odds/*": createPricedRoute({
      price: "0.012",
      description:
        "Live sports odds by sport with bookmaker market snapshots. Supported sport slugs: nfl,nba,mlb,nhl,epl,ncaaf,ncaamb,mls.",
      category: "real-time-data/sports",
      tags: ["sports", "odds", "betting"],
      payTo,
      resourcePath: "/api/sports/odds/nfl",
      queryExample: { regions: "us", markets: "h2h,spreads,totals" },
      querySchema: {
        properties: {
          regions: { type: "string", description: "Comma-separated region codes" },
          markets: { type: "string", description: "Comma-separated market keys" },
          oddsFormat: { type: "string", description: "Odds format (american, decimal)" },
          dateFormat: { type: "string", description: "Date format (iso, unix)" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { sport: "nfl", eventCount: 12 }, source: "The Odds API" },
    }),
    "GET /api/worldbank/*": createPricedRoute({
      price: "0.006",
      description: "World Bank indicator time series by country and indicator code.",
      category: "data/world",
      tags: ["worldbank", "economics", "indicators"],
      payTo,
      resourcePath: "/api/worldbank/US/NY.GDP.MKTP.CD",
      queryExample: { date: "2018:2025", perPage: "100" },
      querySchema: {
        properties: {
          date: { type: "string", description: "Optional date range (YYYY:YYYY)" },
          perPage: { type: "string", description: "Rows per page from World Bank" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { country: "US", indicator: "NY.GDP.MKTP.CD" }, source: "World Bank API" },
    }),
    "GET /api/country/*": createPricedRoute({
      price: "0.006",
      description: "Country profile by ISO code from RestCountries.",
      category: "data/world",
      tags: ["country", "demographics", "reference"],
      payTo,
      resourcePath: "/api/country/US",
      outputExample: { success: true, data: { code: "US", name: "United States" }, source: "RestCountries" },
    }),
  };
}

function createRouteConfig(payTo = PAY_TO) {
  return {
    "GET /api/vin/*": createPricedRoute({
      price: "0.008",
      description:
        "Decode any 17-character VIN -- returns year, make, model, trim, body class, drive type, fuel type, engine specs, transmission, and plant country. e.g. GET /api/vin/1HGCM82633A004352",
      category: "data/reference",
      tags: ["vin", "vehicle", "transportation"],
      payTo,
      resourcePath: "/api/vin/1HGCM82633A004352",
      outputExample: {
        success: true,
        data: {
          vin: "1HGCM82633A004352",
          year: "2003",
          make: "HONDA",
          model: "Accord",
          trim: "EX-V6",
          bodyClass: "Coupe",
        },
        source: "NHTSA vPIC API",
      },
    }),
    "GET /api/weather/current/*": createPricedRoute({
      price: "0.005",
      description:
        "Actionable weather decision brief for exact coordinates encoded in the path -- current conditions, rain timing, outdoor score, commute risk, and what to bring. e.g. GET /api/weather/current/40.7128/-74.0060",
      category: "real-time-data/weather",
      tags: ["weather", "current-conditions", "decision-support"],
      payTo,
      resourcePath: "/api/weather/current/40.7128/-74.0060",
      outputExample: {
        success: true,
        data: {
          latitude: 40.7103,
          longitude: -74.0071,
          timezone: "America/New_York",
          temperature_f: 31.3,
          feels_like_f: 24.1,
          humidity_pct: 55,
          condition: "Overcast",
          decision: {
            summary: "Bring a coat; looks dry for the next several hours; commute conditions look manageable",
            outdoorScore: 72,
            commuteRisk: "low",
            coatRecommended: true,
            umbrellaRecommended: false,
          },
        },
        source: "Open-Meteo API",
      },
    }),
    "GET /api/weather/current": createPricedRoute({
      price: "0.005",
      description:
        "Actionable weather decision brief for query-based lat/lon input -- current conditions, rain timing, outdoor score, commute risk, and what to bring. Query: ?lat=40.7&lon=-74.0.",
      category: "real-time-data/weather",
      tags: ["weather", "current-conditions", "decision-support"],
      payTo,
      resourcePath: "/api/weather/current",
      queryExample: { lat: "40.7128", lon: "-74.0060" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          latitude: 40.7103,
          longitude: -74.0071,
          timezone: "America/New_York",
          temperature_f: 31.3,
          feels_like_f: 24.1,
          humidity_pct: 55,
          condition: "Overcast",
          decision: {
            summary: "Bring a coat; looks dry for the next several hours; commute conditions look manageable",
            outdoorScore: 72,
            commuteRisk: "low",
            coatRecommended: true,
            umbrellaRecommended: false,
          },
        },
        source: "Open-Meteo API",
      },
    }),
    "GET /api/weather/forecast": createPricedRoute({
      price: "0.008",
      description:
        "Daily weather forecast (1-16 days) for any lat/lon -- high/low temps (F), precipitation, chance of rain, max wind, condition. Query: ?lat=40.7&lon=-74.0&days=7. If omitted, defaults to a NYC sample location.",
      category: "real-time-data/weather",
      tags: ["weather", "forecast", "climate"],
      payTo,
      resourcePath: "/api/weather/forecast",
      queryExample: { lat: "40.7128", lon: "-74.0060", days: "7" },
      querySchema: {
        properties: {
          lat: { type: "string", description: "Latitude in decimal degrees" },
          lon: { type: "string", description: "Longitude in decimal degrees" },
          days: { type: "string", description: "Forecast length from 1 to 16 days" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          timezone: "America/New_York",
          forecast: [
            { date: "2026-03-13", high_f: 42, low_f: 31.2, condition: "Overcast" },
            { date: "2026-03-14", high_f: 46.2, low_f: 33.2, condition: "Overcast" },
          ],
        },
        source: "Open-Meteo API",
      },
    }),
    "GET /api/holidays/today/*": createPricedRoute({
      price: "0.008",
      description:
        "Business-day intelligence for the current local date in a country -- holiday status, weekend status, next holiday, next business day, and a decision-ready recommended action. Optional ?tz=America/New_York. e.g. GET /api/holidays/today/US",
      category: "data/government",
      tags: ["calendar", "holidays", "business-days"],
      payTo,
      resourcePath: "/api/holidays/today/US",
      queryExample: { tz: "America/New_York" },
      querySchema: {
        properties: {
          tz: { type: "string", description: "Optional IANA time zone override" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          country: "US",
          date: "2026-03-13",
          timeZone: "America/New_York",
          isHoliday: false,
          isWeekend: false,
          isBusinessDay: true,
          nextBusinessDay: { date: "2026-03-13", dayOfWeek: "Friday", daysAhead: 0 },
          nextHoliday: { date: "2026-04-03", name: "Good Friday" },
          decision: {
            status: "business-day",
            summary: "2026-03-13 is a business day in US.",
            recommendedAction: "Proceed with normal operations and same-day cutoffs if your internal deadlines are still open.",
          },
        },
        source: "Nager.Date API",
      },
    }),
    "GET /api/business-days/next/*": createPricedRoute({
      price: "0.008",
      description:
        "Find the next business day on or after a specific date for a country. Returns whether the input date is already a business day, any holiday on that date, the next business day, and an execution recommendation. Optional ?tz=America/New_York. e.g. GET /api/business-days/next/US/2026-03-15",
      category: "data/government",
      tags: ["calendar", "business-days", "operations"],
      payTo,
      resourcePath: "/api/business-days/next/US/2026-03-15",
      queryExample: { tz: "America/New_York" },
      querySchema: {
        properties: {
          tz: { type: "string", description: "Optional IANA time zone override" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          country: "US",
          inputDate: "2026-03-15",
          timeZone: "America/New_York",
          isInputBusinessDay: false,
          nextBusinessDay: { date: "2026-03-16", dayOfWeek: "Monday", daysAhead: 1 },
          decision: {
            status: "weekend",
            summary: "2026-03-15 falls on a weekend in US.",
            recommendedAction: "Shift time-sensitive processing to the next business day unless your workflow explicitly supports weekend handling.",
          },
        },
        source: "Nager.Date API",
      },
    }),
    "GET /api/holidays/*": createPricedRoute({
      price: "0.008",
      description:
        "Public holidays for any country and year. Use ISO 3166-1 alpha-2 country codes. e.g. GET /api/holidays/US/2026",
      category: "data/government",
      tags: ["calendar", "holidays", "country-data"],
      payTo,
      resourcePath: "/api/holidays/US/2026",
      outputExample: {
        success: true,
        data: {
          country: "US",
          year: 2026,
          count: 16,
          holidays: [
            { date: "2026-01-01", name: "New Year's Day", global: true },
            { date: "2026-01-19", name: "Martin Luther King, Jr. Day", global: true },
          ],
        },
        source: "Nager.Date API",
      },
    }),
    "GET /api/exchange-rates/quote/*": createPricedRoute({
      price: "0.012",
      description:
        "FX conversion quote for an explicit base/target/amount path. Returns converted total, mid-market rate, and inverse rate. e.g. GET /api/exchange-rates/quote/USD/EUR/100",
      category: "data/finance",
      tags: ["finance", "fx", "exchange-rates"],
      payTo,
      resourcePath: "/api/exchange-rates/quote/USD/EUR/100",
      outputExample: {
        success: true,
        data: {
          base: "USD",
          requestedAmount: 100,
          quoteCount: 1,
          primaryQuote: { target: "EUR", rate: 0.8672, convertedAmount: 86.72 },
          quotes: [{ target: "EUR", rate: 0.8672, convertedAmount: 86.72 }],
        },
        source: "ExchangeRate-API (open.er-api.com)",
      },
    }),
    "GET /api/exchange-rates/*": createPricedRoute({
      price: "0.012",
      description:
        "FX conversion quotes for a base currency with optional target list and amount. Query: ?to=EUR,GBP,JPY&amount=100. e.g. GET /api/exchange-rates/USD",
      category: "data/finance",
      tags: ["finance", "fx", "exchange-rates"],
      payTo,
      resourcePath: "/api/exchange-rates/USD",
      queryExample: { to: "EUR,GBP,JPY", amount: "100" },
      querySchema: {
        properties: {
          to: { type: "string", description: "Comma-separated target currency symbols" },
          symbols: { type: "string", description: "Legacy alias for target symbols" },
          amount: { type: "string", description: "Amount to convert from the base currency" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          base: "USD",
          requestedAmount: 100,
          quoteCount: 3,
          primaryQuote: { target: "EUR", rate: 0.8672, convertedAmount: 86.72 },
          quotes: [
            { target: "EUR", rate: 0.8672, convertedAmount: 86.72 },
            { target: "GBP", rate: 0.7484, convertedAmount: 74.84 },
          ],
        },
        source: "ExchangeRate-API (open.er-api.com)",
      },
    }),
    "GET /api/ip/*": createPricedRoute({
      price: "0.003",
      description:
        "IP geolocation -- country, region, city, ZIP, lat/lon, timezone, ISP, org, and ASN. e.g. GET /api/ip/8.8.8.8",
      category: "data/location",
      tags: ["ip", "geolocation", "networking"],
      payTo,
      resourcePath: "/api/ip/8.8.8.8",
      outputExample: {
        success: true,
        data: {
          ip: "8.8.8.8",
          country: "United States",
          region: "Virginia",
          city: "Ashburn",
          isp: "Google LLC",
        },
        source: "ip-api.com",
      },
    }),
    "GET /api/food/barcode/*": createPricedRoute({
      price: "0.003",
      description:
        "Product lookup by barcode/UPC -- name, brand, ingredients, nutri-score, full nutrition facts per 100g, allergens, image. e.g. GET /api/food/barcode/737628064502",
      category: "data/health",
      tags: ["food", "barcode", "nutrition"],
      payTo,
      resourcePath: "/api/food/barcode/737628064502",
      outputExample: {
        success: true,
        data: {
          barcode: "737628064502",
          name: "Thai peanut noodle kit includes stir-fry rice noodles & thai peanut seasoning",
          brand: "Simply Asia, Thai Kitchen",
          nutriscore: "d",
        },
        source: "Open Food Facts",
      },
    }),
    "GET /api/nutrition/search": createPricedRoute({
      price: "0.008",
      description:
        "Search USDA FoodData Central for nutrition data -- calories, protein, fat, carbs, fiber, sugar, sodium, cholesterol per food. Query: ?query=chicken breast&limit=5. If query is omitted, defaults to `chicken breast`.",
      category: "data/health",
      tags: ["food", "nutrition", "usda"],
      payTo,
      resourcePath: "/api/nutrition/search",
      queryExample: { query: "chicken breast", limit: "5" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Food search phrase" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          query: "chicken breast",
          count: 2,
          foods: [
            { description: "Chicken breast, rotisserie, skin not eaten", calories: { value: 144, unit: "KCAL" } },
            { description: "Chicken breast tenders, breaded, uncooked", calories: { value: 1100, unit: "kJ" } },
          ],
        },
        source: "USDA FoodData Central",
      },
    }),
    "GET /api/fda/recalls": createPricedRoute({
      price: "0.008",
      description:
        "FDA food recall enforcement actions -- product description, reason, classification, company, status, and a severity-based triage recommendation. Optional ?query=peanut&limit=10",
      category: "data/health",
      tags: ["fda", "food-safety", "recalls"],
      payTo,
      resourcePath: "/api/fda/recalls",
      queryExample: { query: "peanut", limit: "10" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Optional recall keyword" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          query: "peanut",
          count: 2,
          recalls: [
            { classification: "Class II", company: "J2C Hawaii LLC", status: "Terminated" },
            { classification: "Class II", company: "Beacon Promotions Inc", status: "Ongoing" },
          ],
          decision: {
            riskLevel: "high",
            highestClassification: "Class II",
            recommendedAction: "Place suspect items on hold and complete lot-level verification before shipping or sale.",
          },
        },
        source: "openFDA Food Enforcement API",
      },
    }),
    "GET /api/fda/adverse-events": createPricedRoute({
      price: "0.008",
      description:
        "FDA drug adverse event reports -- reactions, suspect drugs, seriousness, and a signal-based monitoring recommendation. Query: ?drug=aspirin&limit=10. If drug is omitted, defaults to `aspirin`.",
      category: "data/health",
      tags: ["fda", "drug-safety", "adverse-events"],
      payTo,
      resourcePath: "/api/fda/adverse-events",
      queryExample: { drug: "aspirin", limit: "10" },
      querySchema: {
        properties: {
          drug: { type: "string", description: "Drug brand or ingredient name" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          drug: "aspirin",
          count: 2,
          events: [
            { safetyReportId: "10003304", serious: false, reactions: ["Drug hypersensitivity"] },
            { safetyReportId: "10003310", serious: false, reactions: ["Back pain"] },
          ],
          signal: { seriousEvents: 0, totalEvents: 2, seriousEventRatePct: 0 },
          decision: {
            riskLevel: "monitor",
            seriousEventRatePct: 0,
            recommendedAction: "Continue routine monitoring and compare against baseline incidence for similar therapies.",
          },
        },
        source: "openFDA Drug Adverse Events API",
      },
    }),
    "GET /api/census/population": createPricedRoute({
      price: "0.008",
      description:
        "US Census population, median household income, and median age. Query by ZIP (?zip=20002), state FIPS (?state=06), or omit for all states. ACS 5-year estimates.",
      category: "data/government",
      tags: ["census", "demographics", "population"],
      payTo,
      resourcePath: "/api/census/population",
      queryExample: { state: "06" },
      querySchema: {
        properties: {
          state: { type: "string", description: "Two-digit US state FIPS code" },
          zip: { type: "string", description: "ZIP Code Tabulation Area" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          survey: "ACS 5-Year Estimates (2022)",
          count: 1,
          locations: [
            {
              name: "California",
              population: 39356104,
              medianHouseholdIncome: 91905,
              medianAge: 37.3,
            },
          ],
        },
        source: "US Census Bureau API",
      },
    }),
    "GET /api/bls/cpi": createPricedRoute({
      price: "0.008",
      description:
        "Consumer Price Index (CPI-U) -- All Items, US City Average. Monthly values with history. Optional ?years=10 (default 5).",
      category: "data/government",
      tags: ["bls", "cpi", "inflation"],
      payTo,
      resourcePath: "/api/bls/cpi",
      queryExample: { years: "5" },
      querySchema: {
        properties: {
          years: { type: "string", description: "How many years of monthly history to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          seriesId: "CUUR0000SA0",
          latest: { year: "2026", period: "February", value: 326.785 },
          history: [
            { year: "2026", period: "February", value: 326.785 },
            { year: "2026", period: "January", value: 325.252 },
          ],
        },
        source: "Bureau of Labor Statistics",
      },
    }),
    "GET /api/bls/unemployment": createPricedRoute({
      price: "0.008",
      description:
        "US unemployment rate (seasonally adjusted). Monthly values with history. Optional ?years=10 (default 5).",
      category: "data/government",
      tags: ["bls", "unemployment", "labor-market"],
      payTo,
      resourcePath: "/api/bls/unemployment",
      queryExample: { years: "5" },
      querySchema: {
        properties: {
          years: { type: "string", description: "How many years of monthly history to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          seriesId: "LNS14000000",
          latest: { year: "2026", period: "February", rate_pct: 4.4 },
          history: [
            { year: "2026", period: "February", rate_pct: 4.4 },
            { year: "2026", period: "January", rate_pct: 4.3 },
          ],
        },
        source: "Bureau of Labor Statistics",
      },
    }),
    "GET /api/air-quality/*": createPricedRoute({
      price: "0.008",
      description:
        "Current air quality index (AQI) by US ZIP code -- PM2.5, ozone readings, category (Good/Moderate/Unhealthy), dominant pollutant, and outdoor-activity decision guidance. e.g. GET /api/air-quality/20002",
      category: "real-time-data/weather",
      tags: ["air-quality", "aqi", "weather"],
      payTo,
      resourcePath: "/api/air-quality/20002",
      outputExample: {
        success: true,
        data: {
          zip: "20002",
          overallAqi: 39,
          overallCategory: "Good",
          dominantPollutant: "PM2.5",
          decision: {
            riskLevel: "low",
            summary: "Air quality is Good (AQI 39). Outdoor activity is generally safe for most people.",
            outdoorGuidance: "Proceed with normal outdoor plans.",
            maskRecommended: false,
          },
          readings: [
            { parameter: "O3", aqi: 18, category: "Good" },
            { parameter: "PM2.5", aqi: 39, category: "Good" },
          ],
        },
        source: "EPA AirNow API",
      },
    }),
    "GET /api/congress/bills": createPricedRoute({
      price: "0.008",
      description:
        "Recent Congressional bills -- title, latest action, origin chamber, update date. Optional ?congress=119&limit=20. From Congress.gov.",
      category: "data/government",
      tags: ["congress", "bills", "legislation"],
      payTo,
      resourcePath: "/api/congress/bills",
      queryExample: { congress: "119", limit: "20" },
      querySchema: {
        properties: {
          congress: { type: "string", description: "Congress number, e.g. 119" },
          limit: { type: "string", description: "Maximum results to return" },
          query: { type: "string", description: "Optional search keyword" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          congress: 119,
          count: 2,
          bills: [
            { type: "HR", number: "144", title: "Tennessee Valley Authority Salary Transparency Act" },
            { type: "HR", number: "134", title: "Protecting our Communities from Sexual Predators Act" },
          ],
        },
        source: "Congress.gov API",
      },
    }),
    ...createExpandedRouteConfig(payTo),
    ...createGeneratedRouteConfig(payTo),
    ...createPublisherStackRouteConfig(payTo),
    ...createBundledSellerRouteConfig(),
  };
}

function createGeneratedRouteConfig(payTo = PAY_TO) {
  const generatedRouteConfig = {};
  const generatedEntries = Array.isArray(generatedCatalogDocument?.routes)
    ? generatedCatalogDocument.routes
    : [];

  for (const entry of generatedEntries) {
    const routeKey = String(entry?.key || "").trim();
    if (!routeKey) {
      continue;
    }

    generatedRouteConfig[routeKey] = createPricedRoute({
      price: entry?.price || "0.005",
      description: entry?.description || routeKey,
      category: entry?.category || "generated",
      tags: Array.isArray(entry?.tags) ? entry.tags : ["generated"],
      payTo,
      resourcePath:
        entry?.canonicalPath
        || entry?.resourcePath
        || entry?.routePath
        || getRoutePathFromKey(routeKey),
      queryExample: isPlainObject(entry?.queryExample) ? entry.queryExample : undefined,
      outputExample: isPlainObject(entry?.outputExample) ? entry.outputExample : undefined,
    });
  }

  return generatedRouteConfig;
}

function createPublisherStackRouteConfig(payTo = PAY_TO) {
  const examples = buildPublisherStackExamples();

  return {
    "GET /api/data/content/article/*": createPricedRoute({
      price: "0.005",
      description: "Structured publisher article summary by content slug.",
      category: "data/content",
      tags: ["content", "publisher", "article"],
      payTo,
      resourcePath: `/api/data/content/article/${DEFAULT_SAMPLE_SLUG}`,
      outputExample: { success: true, data: examples.articleSummary, source: "publisher-stack" },
    }),
    "GET /api/data/content/article/*/markdown": createPricedRoute({
      price: "0.005",
      description: "Publisher article markdown and reading-time payload by content slug.",
      category: "data/content",
      tags: ["content", "publisher", "markdown"],
      payTo,
      resourcePath: `/api/data/content/article/${DEFAULT_SAMPLE_SLUG}/markdown`,
      outputExample: { success: true, data: examples.articleMarkdown, source: "publisher-stack" },
    }),
    "GET /api/data/content/article/*/structured": createPricedRoute({
      price: "0.006",
      description: "Publisher article sections and citations by content slug.",
      category: "data/content",
      tags: ["content", "publisher", "structured"],
      payTo,
      resourcePath: `/api/data/content/article/${DEFAULT_SAMPLE_SLUG}/structured`,
      outputExample: { success: true, data: examples.articleStructured, source: "publisher-stack" },
    }),
    "GET /api/data/content/article/*/citations": createPricedRoute({
      price: "0.006",
      description: "Publisher article citation bundle by content slug.",
      category: "data/content",
      tags: ["content", "publisher", "citations"],
      payTo,
      resourcePath: `/api/data/content/article/${DEFAULT_SAMPLE_SLUG}/citations`,
      outputExample: { success: true, data: examples.articleCitations, source: "publisher-stack" },
    }),
    "GET /api/data/content/article/*/entities": createPricedRoute({
      price: "0.006",
      description: "Publisher article entity extraction results by content slug.",
      category: "data/content",
      tags: ["content", "publisher", "entities"],
      payTo,
      resourcePath: `/api/data/content/article/${DEFAULT_SAMPLE_SLUG}/entities`,
      outputExample: { success: true, data: examples.articleEntities, source: "publisher-stack" },
    }),
    "GET /api/data/content/search": createPricedRoute({
      price: "0.006",
      description: "Search publisher articles by query text.",
      category: "data/content",
      tags: ["content", "publisher", "search"],
      payTo,
      resourcePath: "/api/data/content/search?q=agentic%20commerce",
      queryExample: { q: "agentic commerce", limit: "3" },
      querySchema: {
        properties: {
          q: { type: "string", description: "Search query text." },
          limit: { type: "string", description: "Maximum number of results to return." },
        },
        required: ["q"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: examples.search, source: "publisher-stack" },
    }),
    "GET /api/data/content/corpus/search": createPricedRoute({
      price: "0.006",
      description: "Search publisher corpus chunks by query text.",
      category: "data/content",
      tags: ["content", "publisher", "corpus-search"],
      payTo,
      resourcePath: "/api/data/content/corpus/search?q=wallet%20routing",
      queryExample: { q: "wallet routing", limit: "3" },
      querySchema: {
        properties: {
          q: { type: "string", description: "Search query text." },
          limit: { type: "string", description: "Maximum number of chunks to return." },
          chunkSize: { type: "string", description: "Optional approximate chunk size." },
        },
        required: ["q"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: examples.corpusSearch, source: "publisher-stack" },
    }),
    "GET /api/data/content/topic/*": createPricedRoute({
      price: "0.006",
      description: "List publisher articles grouped under a topic slug.",
      category: "data/content",
      tags: ["content", "publisher", "topic"],
      payTo,
      resourcePath: `/api/data/content/topic/${DEFAULT_TOPIC_SLUG}`,
      outputExample: { success: true, data: examples.topic, source: "publisher-stack" },
    }),
    "GET /api/data/content/author/*": createPricedRoute({
      price: "0.006",
      description: "List publisher articles grouped under an author slug.",
      category: "data/content",
      tags: ["content", "publisher", "author"],
      payTo,
      resourcePath: `/api/data/content/author/${DEFAULT_AUTHOR_SLUG}`,
      outputExample: { success: true, data: examples.author, source: "publisher-stack" },
    }),
    "POST /api/tools/content/to-dataset": createPricedRoute({
      price: "0.008",
      description: "Convert selected publisher articles into a dataset export.",
      category: "tools/content",
      tags: ["content", "publisher", "dataset"],
      payTo,
      resourcePath: "/api/tools/content/to-dataset",
      inputExample: {
        slugs: [DEFAULT_SAMPLE_SLUG, "publisher-mcp-blueprint"],
        format: "csv",
        fields: ["slug", "title", "author", "publishedAt", "summary"],
      },
      outputExample: { success: true, data: examples.dataset, source: "publisher-stack" },
    }),
    "POST /api/tools/content/extract-faq": createPricedRoute({
      price: "0.008",
      description: "Extract FAQ pairs from a publisher article or raw text.",
      category: "tools/content",
      tags: ["content", "publisher", "faq"],
      payTo,
      resourcePath: "/api/tools/content/extract-faq",
      inputExample: { slug: "publisher-mcp-blueprint", count: 4 },
      outputExample: { success: true, data: examples.faq, source: "publisher-stack" },
    }),
    "POST /api/tools/content/chunk-and-tag": createPricedRoute({
      price: "0.008",
      description: "Split publisher content into semantic chunks with tags.",
      category: "tools/content",
      tags: ["content", "publisher", "chunking"],
      payTo,
      resourcePath: "/api/tools/content/chunk-and-tag",
      inputExample: { slug: DEFAULT_SAMPLE_SLUG, chunkSize: 220 },
      outputExample: { success: true, data: examples.chunks, source: "publisher-stack" },
    }),
  };
}

const routeConfig = createRouteConfig();

function getPrimaryPaymentOption(config) {
  if (!config) {
    return null;
  }

  if (Array.isArray(config.accepts)) {
    return config.accepts[0] || null;
  }

  return config.accepts || null;
}

function formatUsdPrice(price) {
  if (price == null) {
    return null;
  }

  if (typeof price === "number") {
    return `$${price} USDC`;
  }

  const normalizedPrice = price.startsWith("$") ? price : `$${price}`;
  return `${normalizedPrice} USDC`;
}

function parseUsdPriceValue(price) {
  if (price == null) {
    return null;
  }

  if (typeof price === "number" && Number.isFinite(price)) {
    return price;
  }

  const normalized = String(price).trim().replace(/^\$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatOpenApiPriceValue(price) {
  if (price == null) {
    return null;
  }
  if (typeof price === "number" && Number.isFinite(price)) {
    return String(price);
  }
  const normalized = String(price).trim().replace(/^\$/, "");
  return normalized || null;
}

function inlineLocalSchemaRefs(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const root = JSON.parse(JSON.stringify(schema));
  const defs = root && typeof root.$defs === "object" ? root.$defs : {};

  function walk(node) {
    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry));
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
      const defKey = node.$ref.slice("#/$defs/".length);
      const target = defs?.[defKey];
      if (target && typeof target === "object") {
        const merged = { ...target, ...node };
        delete merged.$ref;
        return walk(merged);
      }
    }

    const output = {};
    for (const [key, value] of Object.entries(node)) {
      output[key] = walk(value);
    }
    return output;
  }

  const inlined = walk(root);
  if (inlined && typeof inlined === "object" && inlined.$defs) {
    delete inlined.$defs;
  }
  return inlined;
}

function getExamplePathFromResource(resourceUrl, fallbackPath = null) {
  if (resourceUrl) {
    try {
      const parsed = new URL(resourceUrl);
      return `${parsed.pathname}${parsed.search}`;
    } catch (error) {
      // Fall through to non-URL fallback below.
    }
  }

  if (fallbackPath && !fallbackPath.includes("*")) {
    return fallbackPath;
  }

  return null;
}

function buildCatalogEntries(routes = routeConfig, options = {}) {
  const includeDiscoveryFields = Boolean(options.includeDiscoveryFields);
  return Object.entries(routes)
    .filter(([key]) => !shouldHideRouteInProduction(key, options))
    .map(([key, config]) => {
    const [method, path] = key.split(" ");
    const paymentOption = getPrimaryPaymentOption(config);
    const resourceUrl = config.resource ?? paymentOption?.resource ?? null;

    const baseEntry = {
      method,
      path,
      price: getRoutePrice(config),
      description: getRouteDescription(config),
      category: config.category ?? null,
      tags: Array.isArray(config.tags) ? config.tags : [],
    };

    if (!includeDiscoveryFields) {
      return baseEntry;
    }

    return {
      ...baseEntry,
      routeKey: key,
      surface: getDiscoverySurfaceFromEntry(baseEntry),
      priceUsd: parseUsdPriceValue(paymentOption?.price ?? config.price ?? null),
      examplePath: getExamplePathFromResource(resourceUrl, path),
      exampleUrl: resourceUrl,
      payment: {
        scheme: paymentOption?.scheme ?? null,
        network: paymentOption?.network ?? null,
        asset: paymentOption?.asset ?? null,
        payTo: paymentOption?.payTo ?? null,
        amount: paymentOption?.amount ?? null,
        maxTimeoutSeconds: paymentOption?.maxTimeoutSeconds ?? null,
      },
    };
    });
}

function formatUsdRangeValue(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `$${normalized}`;
}

function getRateLimitHintForPath(path) {
  const normalizedPath = String(path || "");

  if (normalizedPath === "/api/commodities/gold") {
    return {
      provider: "FRED (primary), Yahoo Finance (fallback)",
      limit: "120 req/min primary",
      keyRequired: true,
    };
  }
  if (normalizedPath.startsWith("/api/stocks/quote") || normalizedPath === "/api/stocks/search") {
    return { provider: "Finnhub", limit: "60 req/min", keyRequired: true };
  }
  if (normalizedPath.startsWith("/api/stocks/candles")) {
    return { provider: "Alpha Vantage", limit: "25 req/day", keyRequired: true };
  }
  if (
    normalizedPath === "/api/treasury-rates"
    || normalizedPath === "/api/fed-funds-rate"
    || normalizedPath === "/api/yield-curve"
    || normalizedPath === "/api/commodities/gold"
    || normalizedPath === "/api/commodities/oil"
    || normalizedPath === "/api/mortgage-rates"
    || normalizedPath === "/api/vix"
    || normalizedPath === "/api/dollar-index"
    || normalizedPath === "/api/credit-spreads"
    || normalizedPath === "/api/real-rates"
    || normalizedPath === "/api/inflation-expectations"
    || normalizedPath === "/api/bls/pce"
  ) {
    return { provider: "FRED", limit: "120 req/min", keyRequired: true };
  }
  if (normalizedPath === "/api/sp500") {
    return { provider: "FRED (primary), Yahoo Finance (fallback)", limit: "120 req/min primary", keyRequired: true };
  }
  if (normalizedPath.startsWith("/api/fda/")) {
    return { provider: "openFDA", limit: "240 req/min", keyRequired: false };
  }
  if (normalizedPath.startsWith("/api/sec/")) {
    return { provider: "SEC EDGAR", limit: "10 req/sec", keyRequired: false };
  }
  if (normalizedPath.startsWith("/api/geocode") || normalizedPath.startsWith("/api/reverse-geocode")) {
    return { provider: "Nominatim", limit: "1 req/sec", keyRequired: false };
  }
  if (normalizedPath.startsWith("/api/sports/odds")) {
    return { provider: "The Odds API", limit: "500 req/month (free tier)", keyRequired: true };
  }
  if (normalizedPath.startsWith("/api/courts/")) {
    return { provider: "CourtListener", limit: "Provider fair use", keyRequired: false };
  }
  if (normalizedPath.startsWith("/api/worldbank")) {
    return { provider: "World Bank", limit: "Provider fair use", keyRequired: false };
  }
  if (normalizedPath.startsWith("/api/weather/alerts")) {
    return { provider: "NWS", limit: "Provider fair use", keyRequired: false };
  }
  if (normalizedPath === "/api/weather/extremes" || normalizedPath === "/api/weather/freeze-risk") {
    return { provider: "Open-Meteo", limit: "Provider fair use", keyRequired: false };
  }

  return {
    provider: "Mixed upstream providers",
    limit: "Provider-dependent",
    keyRequired: "depends",
  };
}

function getSimComposabilityForPath(pathname) {
  return SIM_ENDPOINT_COMPOSABILITY[String(pathname || "")] || null;
}

function appendSimComposabilityInstructions(instructions) {
  const base = typeof instructions === "string" ? instructions.trim() : "";
  if (base.includes("## Composable Simulations")) {
    return base;
  }

  if (!base) {
    return SIM_COMPOSABILITY_INSTRUCTIONS_BLOCK;
  }

  return `${base}\n\n${SIM_COMPOSABILITY_INSTRUCTIONS_BLOCK}`;
}

function getOrderedSimulationRouteEntries(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const preferredOrder = new Map(SIM_ROUTE_ORDER.map((path, index) => [path, index]));
  const simulationEntries = Object.entries(routes)
    .filter(([routeKey]) => routeKey.startsWith("POST /api/sim/"))
    .filter(([routeKey]) => !shouldHideRouteInProduction(routeKey, { env }))
    .map(([routeKey, config]) => {
      const [method, path] = routeKey.split(" ");
      return {
        routeKey,
        method,
        path,
        config,
      };
    });

  simulationEntries.sort((a, b) => {
    const aOrder = preferredOrder.has(a.path)
      ? preferredOrder.get(a.path)
      : Number.MAX_SAFE_INTEGER;
    const bOrder = preferredOrder.has(b.path)
      ? preferredOrder.get(b.path)
      : Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    return a.path.localeCompare(b.path);
  });

  return simulationEntries;
}

function formatSimRoutePrice(config) {
  const rawPrice = getPrimaryPaymentOption(config)?.price ?? config?.price;
  if (rawPrice == null) {
    return null;
  }

  const normalized = Number.parseFloat(String(rawPrice).replace(/^\$/, ""));
  if (Number.isFinite(normalized)) {
    return `$${normalized.toFixed(2)}`;
  }

  const fallback = String(rawPrice).trim();
  return fallback.startsWith("$") ? fallback : `$${fallback}`;
}

function buildWellKnownEndpointEntries(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const catalogEntries = buildCatalogEntries(routes, {
    includeDiscoveryFields: true,
    env,
  });
  const routeEntries = new Map(
    Object.entries(routes).filter(([key]) => !shouldHideRouteInProduction(key, { env })),
  );

  return catalogEntries.map((entry) => {
    const routeConfigEntry = routeEntries.get(entry.routeKey) || {};
    const bazaarInfo = routeConfigEntry.extensions?.bazaar?.info || {};
    const bazaarSchema = routeConfigEntry.extensions?.bazaar?.schema || {};
    const requestSchema = bazaarSchema?.properties?.input || null;
    const responseSchema = bazaarSchema?.properties?.output || null;
    const requestExample = bazaarInfo?.input || null;
    const responseExample = bazaarInfo?.output?.example || null;
    const composability = getSimComposabilityForPath(entry.path);

    return {
      routeKey: entry.routeKey,
      method: entry.method,
      path: entry.path,
      category: entry.category,
      tags: entry.tags,
      description: entry.description,
      exampleUrl: entry.exampleUrl,
      payment: {
        ...entry.payment,
        priceUsd: entry.priceUsd,
        currency: "USDC",
      },
      request: {
        example: requestExample,
        schema: requestSchema,
      },
      response: {
        mimeType: routeConfigEntry.mimeType || "application/json",
        example: responseExample,
        schema: responseSchema,
      },
      rateLimit: getRateLimitHintForPath(entry.path),
      ...(composability ? { composability } : {}),
      };
    });
}

const DEFAULT_CORE_DISCOVERY_ALLOWLIST_ROUTE_KEYS = Object.freeze([
  "POST /api/sim/probability",
  "POST /api/sim/compare",
  "POST /api/sim/sensitivity",
  "POST /api/sim/forecast",
  "POST /api/sim/composed",
  "POST /api/sim/optimize",
  "GET /api/vendor-entity-brief",
  "GET /api/ofac-sanctions-screening/*",
  "GET /api/restricted-party/screen/*",
  "GET /api/vendor-onboarding/restricted-party-batch",
  "GET /api/treasury-rates",
  "GET /api/fed-funds-rate",
  "GET /api/yield-curve",
  "GET /api/mortgage-rates",
  "GET /api/credit-spreads",
  "GET /api/real-rates",
  "GET /api/inflation-expectations",
  "GET /api/bls/cpi",
  "GET /api/bls/unemployment",
  "GET /api/weather/current/*",
  "GET /api/weather/current",
  "GET /api/weather/forecast",
  "GET /api/weather/historical",
  "GET /api/weather/alerts/*",
  "GET /api/weather/marine",
  "GET /api/weather/extremes",
  "GET /api/weather/freeze-risk",
  "GET /api/uv-index/*",
  "GET /api/whois/*",
  "GET /api/dns/*",
  "GET /api/ssl/*",
  "GET /api/domain-availability/*",
  "GET /api/courts/cases",
  "GET /api/courts/opinions",
  "GET /api/courts/citations",
  "GET /api/courts/court-info",
  "GET /api/vin/*",
  "GET /api/exchange-rates/quote/*",
  "GET /api/geocode",
  "GET /api/reverse-geocode",
]);

function getDiscoverySurfaceFromEntry(entry = {}) {
  const path = String(entry?.path || "").toLowerCase();
  if (path.startsWith("/api/sim/") || path.startsWith("/api/tools/")) {
    return "tools";
  }
  return "data";
}

function selectCoreDiscoveryRouteKeys(catalog = []) {
  const available = new Set(catalog.map((entry) => String(entry?.routeKey || "").trim()).filter(Boolean));
  const selected = DEFAULT_CORE_DISCOVERY_ALLOWLIST_ROUTE_KEYS.filter((routeKey) => available.has(routeKey));
  if (selected.length > 0) {
    return new Set(selected);
  }

  return new Set(
    catalog
      .slice(0, 40)
      .map((entry) => String(entry?.routeKey || "").trim())
      .filter(Boolean),
  );
}

function buildCoreDiscoveryNavigation(baseUrl, coreRouteCount, fullRouteCount) {
  return {
    mode: "core40",
    default: `${baseUrl}/api`,
    expand: {
      tools: `${baseUrl}/api?profile=full&surface=tools`,
      data: `${baseUrl}/api?profile=full&surface=data`,
      full: `${baseUrl}/api?profile=full`,
    },
    coreRouteCount,
    fullRouteCount,
  };
}

function buildApiDiscoveryPayload(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const req = options.req;
  const baseUrl = getRequestBaseUrl(req);
  const metadata = getOriginMetadata(env);
  const allCatalog = buildCatalogEntries(routes, { includeDiscoveryFields: true, env });
  const requestedProfile = String(req?.query?.profile || "").trim().toLowerCase();
  const requestedSurface = String(req?.query?.surface || "").trim().toLowerCase();
  const useCoreProfile = !requestedProfile || requestedProfile === "compact" || requestedProfile === "core";
  const coreRouteKeys = selectCoreDiscoveryRouteKeys(allCatalog);
  let catalog = useCoreProfile
    ? allCatalog.filter((entry) => coreRouteKeys.has(entry.routeKey))
    : allCatalog;

  if (requestedSurface === "tools" || requestedSurface === "data") {
    catalog = catalog.filter((entry) => getDiscoverySurfaceFromEntry(entry) === requestedSurface);
  }

  return {
    title: metadata.title,
    name: metadata.title,
    description: metadata.description,
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    baseUrl,
    discoveryUrl: `${baseUrl}/api`,
    healthUrl: `${baseUrl}/`,
    profile: useCoreProfile ? "compact" : "full",
    endpoints: catalog.length,
    totalEndpoints: allCatalog.length,
    filteredEndpointCount: catalog.length,
    filters: {
      surface: requestedSurface || null,
    },
    navigation: buildCoreDiscoveryNavigation(baseUrl, coreRouteKeys.size, allCatalog.length),
    catalog,
    payment: {
      protocol: "x402",
      network: "Base",
      chainId: X402_NETWORK,
      currency: "USDC",
    },
  };
}

function summarizePricing(endpoints = []) {
  const prices = endpoints
    .map((endpoint) => endpoint?.payment?.priceUsd)
    .filter((value) => Number.isFinite(value));

  if (!prices.length) {
    return {
      model: "pay-per-request",
      currency: "USDC",
      priceRange: null,
    };
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    model: "pay-per-request",
    currency: "USDC",
    priceRange: {
      min: formatUsdRangeValue(min),
      max: formatUsdRangeValue(max),
      currency: "USDC",
    },
  };
}

const OWNERSHIP_PROOF_ENV_KEYS = [
  "X402_OWNERSHIP_PROOFS",
  "OWNERSHIP_PROOFS",
  "DISCOVERY_OWNERSHIP_PROOFS",
];

function parseOwnershipProofsEnvValue(rawValue) {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) {
    return [];
  }

  if (normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed)
        ? parsed
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : [];
    } catch (_error) {
      return [];
    }
  }

  return normalized
    .split(/[,\s]+/)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function isOwnershipProof(value) {
  return /^0x[0-9a-fA-F]{130}$/.test(String(value || ""));
}

function resolveOwnershipProofs(manifest = WELL_KNOWN_X402_AURELIAN, env = process.env) {
  const staticProofs = Array.isArray(manifest?.ownershipProofs)
    ? manifest.ownershipProofs
    : [];
  const envProofs = [];

  for (const key of OWNERSHIP_PROOF_ENV_KEYS) {
    if (!env?.[key]) {
      continue;
    }
    envProofs.push(...parseOwnershipProofsEnvValue(env[key]));
  }

  return [...new Set([...staticProofs, ...envProofs])]
    .map((value) => String(value ?? "").trim())
    .filter((value) => isOwnershipProof(value));
}

function buildBundledSellerResourceUrls(options = {}) {
  const env = options.env || process.env;
  const hiddenRouteMatchers = options.hiddenRouteMatchers || buildHiddenRouteMatchers();
  const resources = [];

  for (const route of getBundledSellerRoutes()) {
    const canonicalResourcePath = route?.canonicalPath || route?.resourcePath;
    const canonicalResourceUrl = buildCanonicalResourceUrl(canonicalResourcePath);

    if (!canonicalResourceUrl) {
      continue;
    }

    if (shouldHideResourceUrlInProduction(canonicalResourceUrl, { env, hiddenRouteMatchers })) {
      continue;
    }

    resources.push(canonicalResourceUrl);
  }

  return resources;
}

function buildWellKnownManifest(manifest = WELL_KNOWN_X402_AURELIAN, routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const metadata = getOriginMetadata(env);
  const endpoints = buildWellKnownEndpointEntries(routes, { env });
  const coreRouteKeys = selectCoreDiscoveryRouteKeys(
    buildCatalogEntries(routes, { includeDiscoveryFields: true, env }),
  );
  const coreEndpoints = endpoints.filter((entry) => coreRouteKeys.has(entry.routeKey));
  const resources = [...new Set(coreEndpoints.map((entry) => entry.exampleUrl).filter(Boolean))];
  const ownershipProofs = resolveOwnershipProofs(manifest, env);

  return {
    ...manifest,
    title: metadata.title,
      name: metadata.title,
      description: metadata.description,
      icon: `${CANONICAL_BASE_URL}/favicon.ico`,
      resources,
      ownershipProofs,
      instructions: appendSimComposabilityInstructions(manifest?.instructions),
      endpointCount: coreEndpoints.length,
      fullEndpointCount: endpoints.length,
      pricing: summarizePricing(coreEndpoints),
      rateLimits: {
        policy: "Upstream provider limits apply per endpoint; see each endpoint.rateLimit entry.",
        enforcement: "Best effort",
    },
      sla: {
        availability: "Best effort",
        notes: "No formal uptime SLA is guaranteed.",
      },
      discovery: buildCoreDiscoveryNavigation(CANONICAL_BASE_URL, coreEndpoints.length, endpoints.length),
      endpoints: coreEndpoints,
    };
}

function getRequestBaseUrl(req) {
  // Always emit canonical discovery URLs so external indexers cannot
  // reintroduce legacy hostnames by probing alternate deployment domains.
  if (CANONICAL_BASE_URL) {
    return CANONICAL_BASE_URL;
  }

  const forwardedHost = req.get("x-forwarded-host");
  const host = String(forwardedHost ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = String(forwardedProto ?? req.protocol ?? "https")
    .split(",")[0]
    .trim();

  if (!host) {
    return CANONICAL_BASE_URL;
  }

  return `${protocol}://${host}`;
}

function getOriginMetadata(env = process.env) {
  const title = String(env.X402_ORIGIN_TITLE || env.X402_SITE_TITLE || DEFAULT_ORIGIN_TITLE).trim();
  const description = String(
    env.X402_ORIGIN_DESCRIPTION || env.X402_SITE_DESCRIPTION || DEFAULT_ORIGIN_DESCRIPTION,
  ).trim();

  return {
    title: title || DEFAULT_ORIGIN_TITLE,
    description: description || DEFAULT_ORIGIN_DESCRIPTION,
  };
}

function shouldRenderHealthHtml(req) {
  const forceFormat = String(req.query?.format || "").toLowerCase().trim();
  if (forceFormat === "json") {
    return false;
  }
  if (forceFormat === "html") {
    return true;
  }

  const accept = String(req.get("accept") || "").toLowerCase();
  const acceptsHtml =
    !accept
    || accept.includes("text/html")
    || accept.includes("application/xhtml+xml")
    || accept.includes("*/*");

  if (acceptsHtml) {
    return true;
  }

  const acceptsJson = accept.includes("application/json") || accept.includes("text/json");
  return !acceptsJson;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[char] || char;
  });
}

function buildOriginLandingHtml(options = {}) {
  const title = escapeHtml(options.title || DEFAULT_ORIGIN_TITLE);
  const description = escapeHtml(options.description || DEFAULT_ORIGIN_DESCRIPTION);
  const baseUrl = String(options.baseUrl || CANONICAL_BASE_URL).replace(/\/+$/, "");
  const wrappedUrl = escapeHtml(String(options.wrappedUrl || WRAPPED_PRODUCT_URL).replace(/\/+$/, ""));
  const endpointCount = Number(options.endpointCount || 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${baseUrl}/" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${baseUrl}/icon.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${baseUrl}/" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${baseUrl}/icon.png" />
  <link rel="alternate" type="application/json" href="${baseUrl}/api" />
  <link rel="icon" href="${baseUrl}/favicon.ico" />
  <style>
    body {font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #fafafa; color: #111;}
    main {text-align: center; padding: 2rem;}
    h1 {margin: 0 0 1rem; font-size: 2.5rem;}
    p {max-width: 42ch; margin: 0 auto 1.5rem; line-height: 1.4;}
    .cta {display: inline-flex; gap: .75rem; flex-wrap: wrap; justify-content: center;}
    a.btn {display: inline-block; padding: .75rem 1.5rem; background: #111; color: #fff; text-decoration: none; border-radius: 4px;}
    a.btn.secondary {background: #fff; color: #111; border: 1px solid #d0d0d0;}
    .meta {margin-top: 1rem; color: #666; font-size: .95rem;}
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <div class="cta">
      <a class="btn" href="${baseUrl}/api" rel="nofollow">View Endpoint Catalog</a>
      <a class="btn secondary" href="${wrappedUrl}" rel="nofollow">Explore AurelianFlo Wrapped</a>
    </div>
    <p class="meta">Endpoints indexed: ${endpointCount}</p>
  </main>
</body>
</html>`;
}

function getRouteDescription(config) {
  return config.description ?? config.config?.description ?? null;
}

function getRoutePrice(config) {
  const paymentOption = getPrimaryPaymentOption(config);
  return formatUsdPrice(paymentOption?.price ?? config.price ?? null);
}

function createRouteMatcher(routes = routeConfig) {
  const exactMatches = new Map();
  const wildcardMatches = [];

  for (const [key, config] of Object.entries(routes)) {
    const [method, routePath] = key.split(" ");
    const entry = {
      key,
      config,
      method: String(method || "").toUpperCase(),
      routePath,
    };

    if (routePath.includes("*")) {
      wildcardMatches.push(entry);
    } else {
      exactMatches.set(`${entry.method} ${routePath}`, entry);
    }
  }

  return function matchRoute(method, requestPath) {
    const normalizedMethod = String(method || "").toUpperCase();
    const exactKey = `${normalizedMethod} ${requestPath}`;
    if (exactMatches.has(exactKey)) {
      return exactMatches.get(exactKey);
    }

    for (const route of wildcardMatches) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const prefix = route.routePath.slice(0, route.routePath.indexOf("*"));
      if (requestPath.startsWith(prefix)) {
        return route;
      }
    }

    return null;
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAcceptedRequirements(accepted) {
  if (!isPlainObject(accepted)) {
    return accepted;
  }

  const allowedKeys = [
    "scheme",
    "network",
    "amount",
    "asset",
    "payTo",
    "maxTimeoutSeconds",
    "extra",
  ];
  const sanitized = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(accepted, key)) {
      sanitized[key] = accepted[key];
    }
  }

  return sanitized;
}

function sanitizePaymentPayloadForMatching(payload) {
  if (!isPlainObject(payload) || Number(payload.x402Version) !== 2) {
    return payload;
  }

  const originalAccepted = payload.accepted;
  const sanitizedAccepted = sanitizeAcceptedRequirements(originalAccepted);

  if (!isPlainObject(originalAccepted) || !isPlainObject(sanitizedAccepted)) {
    return payload;
  }

  const originalKeys = Object.keys(originalAccepted);
  const sanitizedKeys = Object.keys(sanitizedAccepted);
  const changed =
    originalKeys.length !== sanitizedKeys.length ||
    originalKeys.some((key) => !Object.prototype.hasOwnProperty.call(sanitizedAccepted, key));

  if (!changed) {
    return payload;
  }

  return {
    ...payload,
    accepted: sanitizedAccepted,
  };
}

async function loadCoinbaseFacilitator(env = process.env) {
  return loadCoinbaseFacilitatorForEnv(env);
}

async function loadFacilitator(env = process.env) {
  return loadFacilitatorForEnv(env);
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
  const {
    facilitator,
    logger = console,
    resourceServerClass,
    resourceServerExtension = bazaarResourceServerExtension,
    schemeFactory = () => {
      const { ExactEvmScheme } = require("@x402/evm/exact/server");
      return new ExactEvmScheme();
    },
  } = options;

  const { x402ResourceServer } = require("@x402/core/server");
  const ResourceServerClass = resourceServerClass || x402ResourceServer;
  const resourceServer = new ResourceServerClass(
    createFacilitatorClient(facilitator),
  );
  resourceServer.register(X402_NETWORK, schemeFactory());
  resourceServer.registerExtension(resourceServerExtension);

  resourceServer.onVerifyFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 verify failure:",
      JSON.stringify({
        name: error?.name || "Error",
        message: error?.message || "Verification failed",
        network: requirements.network,
      }),
    );
  });

  resourceServer.onSettleFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 settle failure:",
      JSON.stringify({
        name: error?.name || "Error",
        message: error?.message || "Settlement failed",
        network: requirements.network,
        errorReason: error?.errorReason || null,
        errorMessage: error?.errorMessage || null,
        transaction: error?.transaction || null,
      }),
    );
  });

  return resourceServer;
}

function createPaymentGate(options = {}) {
  const payTo = options.payTo ?? PAY_TO;
  const routes = options.routes ?? createRouteConfig(payTo);
  const matchRoute = createRouteMatcher(routes);
  const paymentEnv = options.env ?? process.env;
  const hasCustomFacilitatorLoader = typeof options.facilitatorLoader === "function";
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadFacilitator(paymentEnv));
  const initRetryCount = Math.max(1, Number(options.paymentInitRetryCount ?? 2));
  const extractFacilitatorUrl = (value) => {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized ? normalized : null;
    }

    if (typeof value.url === "string") {
      const normalized = value.url.trim();
      return normalized ? normalized : null;
    }

    return null;
  };
  const normalizeUrlForCompare = (value) => {
    const normalized = extractFacilitatorUrl(value);
    if (!normalized) {
      return null;
    }
    return normalized.replace(/\/+$/, "").toLowerCase();
  };
  const extractAcceptedFacilitatorUrl = (decodedPayment) => {
    if (!isPlainObject(decodedPayment)) {
      return null;
    }

    const accepted = decodedPayment.accepted;
    if (isPlainObject(accepted)) {
      return extractFacilitatorUrl(accepted.facilitator);
    }

    if (Array.isArray(accepted)) {
      for (const entry of accepted) {
        if (isPlainObject(entry) && entry.facilitator) {
          const extracted = extractFacilitatorUrl(entry.facilitator);
          if (extracted) {
            return extracted;
          }
        }
      }
    }

    return null;
  };
  const paymentMiddlewareFactory =
    options.paymentMiddlewareFactory ??
    ((middlewareRoutes, resourceServer) => {
      const { paymentMiddleware } = require("@x402/express");
      return paymentMiddleware(middlewareRoutes, resourceServer);
    });
  const resourceServerFactory =
    options.resourceServerFactory ??
    ((factoryOptions) => createPaymentResourceServer(factoryOptions));
  const logger = options.logger ?? console;
  // Use a single canonical requirements shape from @x402/express for both
  // unpaid discovery and paid verification/settlement paths.
  const fastUnpaidResponse = options.fastUnpaidResponse ?? false;
  const facilitatorMode = hasCustomFacilitatorLoader
    ? "failover"
    : getFacilitatorMode(paymentEnv);
  const facilitatorCandidates = hasCustomFacilitatorLoader
    ? []
    : getFacilitatorCandidates(paymentEnv);
  let facilitatorRoundRobinOffset = 0;
  const providerUrlHints = new Map();

  const buildProviderEnv = (provider) => ({
    ...paymentEnv,
    X402_FACILITATOR: provider,
    X402_FACILITATOR_FALLBACKS: "",
    X402_FACILITATOR_MODE: "failover",
  });

  if (!hasCustomFacilitatorLoader) {
    for (const provider of facilitatorCandidates) {
      const providerUrl = extractFacilitatorUrl(
        getConfiguredFacilitatorUrl(buildProviderEnv(provider)),
      );
      if (providerUrl) {
        providerUrlHints.set(provider, providerUrl);
      }
    }
  }

  const resolveProviderFromFacilitatorUrl = (inputUrl) => {
    const normalizedInput = normalizeUrlForCompare(inputUrl);
    if (!normalizedInput) {
      return null;
    }

    for (const [provider, hintedUrl] of providerUrlHints.entries()) {
      if (normalizeUrlForCompare(hintedUrl) === normalizedInput) {
        return provider;
      }
    }

    return null;
  };
  const attachRequestFacilitator = (req, context = {}) => {
    const current = isPlainObject(req.x402Facilitator) ? req.x402Facilitator : {};
    const normalizedProvider =
      typeof context.provider === "string" && context.provider.trim()
        ? context.provider.trim().toLowerCase()
        : typeof current.provider === "string" && current.provider.trim()
          ? current.provider.trim().toLowerCase()
          : null;
    const normalizedUrl = extractFacilitatorUrl(
      context.facilitatorUrl ?? context.url ?? current.facilitatorUrl ?? current.url,
    );
    const normalizedMode =
      typeof context.mode === "string" && context.mode.trim()
        ? context.mode.trim().toLowerCase()
        : typeof current.mode === "string" && current.mode.trim()
          ? current.mode.trim().toLowerCase()
          : facilitatorMode;
    const fallbackUsed =
      context.fallbackUsed == null ? Boolean(current.fallbackUsed) : Boolean(context.fallbackUsed);
    const payload = {
      provider: normalizedProvider,
      facilitatorUrl: normalizedUrl,
      mode: normalizedMode,
      fallbackUsed,
    };
    req.x402Facilitator = payload;
    return payload;
  };

  const getProviderOrderForRequest = (
    { hasPaymentSignature, requestedFacilitatorUrl },
    options = {},
  ) => {
    if (!facilitatorCandidates.length) {
      return [];
    }

    const ordered = [...facilitatorCandidates];
    if (!hasPaymentSignature && facilitatorMode === "round_robin" && ordered.length > 1) {
      const start = facilitatorRoundRobinOffset % ordered.length;
      if (!options.peek) {
        facilitatorRoundRobinOffset += 1;
      }
      ordered.push(...ordered.splice(0, start));
    }

    const preferredProvider = resolveProviderFromFacilitatorUrl(requestedFacilitatorUrl);
    if (preferredProvider) {
      const index = ordered.indexOf(preferredProvider);
      if (index > 0) {
        ordered.unshift(...ordered.splice(index, 1));
      }
    }

    return ordered;
  };

  let facilitatorUrl = extractFacilitatorUrl(
    options.facilitatorUrl ?? getConfiguredFacilitatorUrl(paymentEnv),
  );

  let paymentReady = null;
  const providerPaymentReady = new Map();
  const isFacilitatorInitFailure = (error) =>
    typeof error?.message === "string" &&
    error.message.includes(
      "Failed to initialize: no supported payment kinds loaded from any facilitator.",
    );

  async function initializePaymentMiddleware(activeLoader) {
    let lastError = null;

    for (let attempt = 1; attempt <= initRetryCount; attempt += 1) {
      try {
        const facilitator = await activeLoader();
        const discoveredFacilitatorUrl = extractFacilitatorUrl(facilitator);
        if (discoveredFacilitatorUrl) {
          facilitatorUrl = discoveredFacilitatorUrl;
        }

        const resourceServer = await resourceServerFactory({
          facilitator,
          logger,
        });
        const middleware = await paymentMiddlewareFactory(routes, resourceServer);
        return {
          middleware,
          facilitatorUrl: discoveredFacilitatorUrl ?? facilitatorUrl,
        };
      } catch (error) {
        lastError = error;
        if (!isFacilitatorInitFailure(error) || attempt >= initRetryCount) {
          throw error;
        }

        logger.warn(
          "x402 middleware init failed; retrying facilitator bootstrap",
          JSON.stringify({
            attempt,
            retryCount: initRetryCount,
            message: error?.message || String(error),
          }),
        );
      }
    }

    throw lastError ?? new Error("Payment middleware initialization failed");
  }

  async function getSinglePaymentMiddleware() {
    if (!paymentReady) {
      paymentReady = initializePaymentMiddleware(facilitatorLoader)
        .catch((error) => {
          // Avoid pinning the process into a permanent 500 state after one
          // transient facilitator initialization failure.
          paymentReady = null;
          throw error;
        });
    }

    return paymentReady;
  }

  async function getProviderPaymentMiddleware(provider) {
    if (!providerPaymentReady.has(provider)) {
      const providerEnv = buildProviderEnv(provider);
      providerPaymentReady.set(
        provider,
        initializePaymentMiddleware(() => loadFacilitator(providerEnv))
          .then((entry) => {
            if (entry?.facilitatorUrl) {
              providerUrlHints.set(provider, entry.facilitatorUrl);
            }
            return {
              provider,
              ...entry,
            };
          })
          .catch((error) => {
            providerPaymentReady.delete(provider);
            throw error;
          }),
      );
    }

    return providerPaymentReady.get(provider);
  }

  async function getSelectedMiddleware(context) {
    if (hasCustomFacilitatorLoader || !facilitatorCandidates.length) {
      const single = await getSinglePaymentMiddleware();
      return {
        ...single,
        provider: resolveProviderFromFacilitatorUrl(single?.facilitatorUrl ?? facilitatorUrl),
        fallbackUsed: false,
      };
    }

    const providers = getProviderOrderForRequest(context);
    let lastError = null;

    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      try {
        const selected = await getProviderPaymentMiddleware(provider);
        return {
          ...selected,
          provider,
          fallbackUsed: index > 0,
        };
      } catch (error) {
        lastError = error;
        logger.warn(
          "x402 provider unavailable; trying next facilitator",
          JSON.stringify({
            provider,
            message: error?.message || String(error),
          }),
        );
      }
    }

    throw lastError ?? new Error("Payment middleware initialization failed");
  }

  return async function paymentGate(req, res, next) {
    const routeEntry = matchRoute(req.method, req.path);
    let hasPaymentSignature = false;
    let requestedFacilitatorUrl = null;

    try {
      if (!req.headers["payment-signature"] && req.headers["x-payment"]) {
        req.headers["payment-signature"] = req.headers["x-payment"];
      }

      hasPaymentSignature = Boolean(req.headers["payment-signature"]);

      if (req.headers["payment-signature"]) {
        try {
          const { decodePaymentSignatureHeader, encodePaymentSignatureHeader } = require("@x402/core/http");
          const decodedPayment = decodePaymentSignatureHeader(String(req.headers["payment-signature"]));
          requestedFacilitatorUrl = extractAcceptedFacilitatorUrl(decodedPayment);
          const sanitizedPayment = sanitizePaymentPayloadForMatching(decodedPayment);

          if (sanitizedPayment !== decodedPayment) {
            const normalizedHeader = encodePaymentSignatureHeader(sanitizedPayment);
            req.headers["payment-signature"] = normalizedHeader;
            req.headers["x-payment"] = normalizedHeader;
          }
        } catch (sanitizeError) {
          logger.warn(
            "x402 payment header normalization failed:",
            JSON.stringify({
              path: req.path,
              method: req.method,
              message:
                sanitizeError instanceof Error
                  ? sanitizeError.message
                  : String(sanitizeError),
            }),
          );
        }
      }

      if (!hasPaymentSignature && !hasCustomFacilitatorLoader && facilitatorCandidates.length) {
        const preferredProviders = getProviderOrderForRequest({
          hasPaymentSignature,
          requestedFacilitatorUrl,
        }, { peek: true });
        const hintedUrl = preferredProviders.length
          ? providerUrlHints.get(preferredProviders[0])
          : null;
        if (hintedUrl) {
          facilitatorUrl = hintedUrl;
        }
        if (preferredProviders.length) {
          attachRequestFacilitator(req, {
            provider: preferredProviders[0],
            facilitatorUrl:
              hintedUrl ??
              providerUrlHints.get(preferredProviders[0]) ??
              facilitatorUrl,
            fallbackUsed: false,
          });
        }
      }

      if (fastUnpaidResponse && routeEntry && !hasPaymentSignature) {
        const { encodePaymentRequiredHeader } = require("@x402/core/http");
        const paymentRequired = buildPaymentRequiredFromRoute(routeEntry, {
          errorMessage: "Payment required",
          facilitatorUrl,
        });

        if (paymentRequired) {
          res.set(
            "PAYMENT-REQUIRED",
            encodePaymentRequiredHeader(paymentRequired),
          );
          return res.status(402).json(paymentRequired);
        }
      }

      const originalJson = res.json.bind(res);
      res.json = function patchedJson(body) {
        const paymentRequiredHeader = res.getHeader("PAYMENT-REQUIRED");
        const paymentResponseHeader = res.getHeader("PAYMENT-RESPONSE");
        const isEmptyObject =
          body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          Object.keys(body).length === 0;

        if (res.statusCode === 402 && paymentResponseHeader && isEmptyObject) {
          let decodedPaymentResponse = null;
          try {
            const { decodePaymentResponseHeader } = require("@x402/core/http");
            decodedPaymentResponse = decodePaymentResponseHeader(
              String(paymentResponseHeader),
            );
          } catch (decodeError) {
            logger.error(
              "x402 settlement failure: unable to decode PAYMENT-RESPONSE header",
              JSON.stringify({
                path: req.path,
                method: req.method,
                message:
                  decodeError instanceof Error
                    ? decodeError.message
                    : String(decodeError),
              }),
            );
          }

          logger.error(
            "x402 settlement failure:",
            JSON.stringify({
              path: req.path,
              method: req.method,
              routeKey: routeEntry?.key ?? null,
              paymentResponse: decodedPaymentResponse,
            }),
          );

          res.statusCode = 500;
          return originalJson({
            error: "Payment settlement failed",
            paymentResponse: decodedPaymentResponse,
          });
        }

        if (res.statusCode === 402 && paymentRequiredHeader && isEmptyObject) {
          const { decodePaymentRequiredHeader, encodePaymentRequiredHeader } = require("@x402/core/http");
          const decoded = decodePaymentRequiredHeader(
            String(paymentRequiredHeader),
          );
          const enriched = annotatePaymentRequired(decoded, {
            routeConfig: routeEntry?.config,
            method: req.method,
            facilitatorUrl,
          });

          if (enriched) {
            res.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(enriched));
          }

          return originalJson(enriched || decoded);
        }

        return originalJson(body);
      };

      const selected = await getSelectedMiddleware({
        hasPaymentSignature,
        requestedFacilitatorUrl,
      });
      if (selected?.facilitatorUrl) {
        facilitatorUrl = selected.facilitatorUrl;
      }
      attachRequestFacilitator(req, {
        provider:
          selected?.provider ??
          resolveProviderFromFacilitatorUrl(selected?.facilitatorUrl ?? facilitatorUrl),
        facilitatorUrl: selected?.facilitatorUrl ?? facilitatorUrl,
        fallbackUsed: selected?.fallbackUsed,
      });

      return await selected.middleware(req, res, next);
    } catch (err) {
      if (isFacilitatorInitFailure(err) && routeEntry && !hasPaymentSignature) {
        logger.warn(
          "x402 middleware init failed; returning route-configured unpaid 402 fallback",
          JSON.stringify({
            path: req.path,
            method: req.method,
            routeKey: routeEntry.key,
          }),
        );
        const { encodePaymentRequiredHeader } = require("@x402/core/http");
        const paymentRequired = buildPaymentRequiredFromRoute(routeEntry, {
          errorMessage: "Payment required",
          facilitatorUrl,
        });
        const enriched = annotatePaymentRequired(paymentRequired, {
          routeConfig: routeEntry.config,
          method: req.method,
          facilitatorUrl,
        });
        const fallbackPayload = enriched || paymentRequired;
        attachRequestFacilitator(req, {
          provider: resolveProviderFromFacilitatorUrl(facilitatorUrl),
          facilitatorUrl,
          fallbackUsed: false,
        });
        res.set(
          "PAYMENT-REQUIRED",
          encodePaymentRequiredHeader(fallbackPayload),
        );
        return res.status(402).json(fallbackPayload);
      }

      attachRequestFacilitator(req, {
        provider: resolveProviderFromFacilitatorUrl(facilitatorUrl),
        facilitatorUrl,
      });
      return res.status(500).json({
        error: "Payment middleware init failed",
        details: err?.message || String(err),
      });
    }
  };
}

function createSettleTestHandler(options = {}) {
  const paymentEnv = options.env ?? process.env;
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadFacilitator(paymentEnv));
  const facilitatorMode = getFacilitatorMode(paymentEnv);
  const facilitatorCandidates = getFacilitatorCandidates(paymentEnv);

  return async function settleTestHandler(req, res) {
    try {
      const facilitatorConfig = await facilitatorLoader();
      const facilitator = createFacilitatorClient(facilitatorConfig);
      const authHeaders =
        typeof facilitator.createAuthHeaders === "function"
          ? await facilitator.createAuthHeaders("supported")
          : { headers: {} };
      const supportedKinds = await facilitator.getSupported();
      const baseKinds = supportedKinds.kinds.filter(
        (kind) => kind.network === X402_NETWORK || kind.network === "base",
      );

      res.json({
        facilitatorMode,
        facilitatorCandidates,
        facilitatorUrl: facilitator.url,
        hasAuthorizationHeader: Boolean(authHeaders.headers?.Authorization),
        supportedKinds: supportedKinds.kinds.map(
          (kind) => `${kind.network} (v${kind.x402Version})`,
        ),
        baseMainnetSupported: baseKinds,
        totalKinds: supportedKinds.kinds.length,
      });
    } catch (err) {
      res.json({ error: err.message, stack: err.stack?.substring(0, 500) });
    }
  };
}

function createHealthHandler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  return function healthHandler(req, res) {
    const payload = buildApiDiscoveryPayload(routes, { env, req });
    const metadata = getOriginMetadata(env);
    if (shouldRenderHealthHtml(req)) {
      const html = buildOriginLandingHtml({
        title: metadata.title,
        description: metadata.description,
        baseUrl: getRequestBaseUrl(req),
        endpointCount: payload.endpoints,
      });
      return res.type("text/html; charset=utf-8").send(html);
    }

    res.json({
      title: metadata.title,
      name: metadata.title,
      description: metadata.description,
      version: "1.0.0",
      profile: payload.profile,
      endpoints: payload.endpoints,
      totalEndpoints: payload.totalEndpoints,
      catalog: payload.catalog,
      discovery: {
        core: `${payload.baseUrl}/api`,
        full: `${payload.baseUrl}/api?profile=full`,
      },
      navigation: payload.navigation,
      payment: { network: "Base", currency: "USDC", protocol: "x402" },
    });
  };
}

function createApiDiscoveryHandler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  return function apiDiscoveryHandler(req, res) {
    res.json(buildApiDiscoveryPayload(routes, { env, req }));
  };
}

function buildOpenApiPathTemplate(routePath) {
  const normalizedPath = String(routePath || "");
  let wildcardIndex = 0;
  return normalizedPath.replace(/\*/g, () => `{param${++wildcardIndex}}`);
}

function getOpenApiPathParameters(pathTemplate) {
  const matches = String(pathTemplate || "").match(/\{[^}]+\}/g) || [];
  return matches.map((rawToken) => {
    const name = rawToken.slice(1, -1);
    return {
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    };
  });
}

function getOpenApiQueryParameters(inputSchema = null) {
  const queryParamsSchema = inputSchema?.properties?.queryParams;
  if (!queryParamsSchema || typeof queryParamsSchema !== "object") {
    return [];
  }

  const properties = queryParamsSchema.properties || {};
  const required = new Set(Array.isArray(queryParamsSchema.required) ? queryParamsSchema.required : []);

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: schema || { type: "string" },
    ...(schema?.description ? { description: schema.description } : {}),
  }));
}

function createOpenApiOperationId(method, pathTemplate) {
  const normalizedMethod = String(method || "").toLowerCase();
  const normalizedPath = String(pathTemplate || "")
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${normalizedMethod}_${normalizedPath || "root"}`;
}

function buildOpenApiDocument(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const metadata = getOriginMetadata(env);
  const paths = {};
  const catalog = buildCatalogEntries(routes, { includeDiscoveryFields: true, env });
  const coreRouteKeys = selectCoreDiscoveryRouteKeys(catalog);
  const profile = String(options.profile || "compact").trim().toLowerCase();
  const includeFullProfile = profile === "full";
  const routeEntries = Object.entries(routes)
    .filter(([routeKey]) => !shouldHideRouteInProduction(routeKey, { env }))
    .filter(([routeKey]) => includeFullProfile || coreRouteKeys.has(routeKey));

  for (const [routeKey, config] of routeEntries) {
    const [method = "GET", routePath = "/"] = String(routeKey).split(" ");
    const normalizedMethod = method.toLowerCase();
    const pathTemplate = buildOpenApiPathTemplate(routePath);
    const inputSchema = config?.extensions?.bazaar?.schema?.properties?.input || null;
    const outputSchema = config?.extensions?.bazaar?.schema?.properties?.output || { type: "object" };
    const parameters = [
      ...getOpenApiPathParameters(pathTemplate),
      ...getOpenApiQueryParameters(inputSchema),
    ];
    const paymentOption = getPrimaryPaymentOption(config);
    const rawPrice = paymentOption?.price ?? null;
    const parsedPrice = parseUsdPriceValue(rawPrice);
    const openApiPrice = formatOpenApiPriceValue(parsedPrice);

    const operation = {
      operationId: createOpenApiOperationId(normalizedMethod, pathTemplate),
      summary: getRouteDescription(config) || `${method} ${routePath}`,
      description: getRouteDescription(config) || undefined,
      tags:
        Array.isArray(config?.tags) && config.tags.length
          ? config.tags
          : config?.category
            ? [config.category]
            : undefined,
      parameters: parameters.length ? parameters : undefined,
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: outputSchema,
            },
          },
        },
        "402": {
          description: "Payment Required",
        },
      },
      "x-payment-info":
        openApiPrice == null
          ? undefined
          : {
              protocols: ["x402"],
              pricingMode: "fixed",
              price: openApiPrice,
              currency: "USDC",
              network: paymentOption?.network || X402_NETWORK,
              payTo: paymentOption?.payTo || PAY_TO,
            },
    };

    if (["post", "put", "patch"].includes(normalizedMethod) && inputSchema?.properties?.body) {
      operation.requestBody = {
        required: Array.isArray(inputSchema.required) ? inputSchema.required.includes("body") : false,
        content: {
          "application/json": {
            schema: inlineLocalSchemaRefs(inputSchema.properties.body),
          },
        },
      };
    }

    if (!paths[pathTemplate]) {
      paths[pathTemplate] = {};
    }
    paths[pathTemplate][normalizedMethod] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: metadata.title,
      description: metadata.description,
      version: "1.0.0",
      "x-guidance":
        "Use OpenAPI as canonical discovery. Paid endpoints return 402 until settled. For each route, pass required path/query/body fields exactly as documented and include payment settlement before retrying.",
      "x-logo": {
        url: `${CANONICAL_BASE_URL}/favicon.ico`,
        altText: metadata.title,
      },
    },
    servers: [
      {
        url: CANONICAL_BASE_URL,
        description: "Production",
      },
    ],
    paths,
  };
}

function createOpenApiHandler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const profile = options.profile || "compact";
  return function openApiHandler(_req, res) {
    res.json(buildOpenApiDocument(routes, { env, profile }));
  };
}

function createFaviconHandler() {
  return function faviconHandler(_req, res) {
    res.set("Cache-Control", "public, max-age=3600");
    res.type("image/png").send(FAVICON_PNG);
  };
}

function createSimCompatibleResponseMiddleware() {
  return function simCompatibleResponseMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(appendSimCompatible(req.path, payload));
    next();
  };
}

function createSimLandingHandler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const simRoutes = getOrderedSimulationRouteEntries(routes, { env });

  return function simLandingHandler(_req, res) {
    res.json({
      name: "Bazaar Simulation Suite",
      description:
        "Monte Carlo simulation endpoints for decision modeling. All endpoints accept arbitrary numeric parameters that can be sourced from any Bazaar data endpoint.",
      version: "1.0.0",
      endpoints: simRoutes.map((entry) => ({
        path: entry.path,
        method: entry.method,
        price: formatSimRoutePrice(entry.config),
        summary: SIM_ENDPOINT_SUMMARIES[entry.path] || getRouteDescription(entry.config),
      })),
      composability: SIM_LANDING_COMPOSABILITY,
    });
  };
}

function createWellKnownX402AurelianHandler(
  manifest = WELL_KNOWN_X402_AURELIAN,
  routes = routeConfig,
  options = {},
) {
  const env = options.env || process.env;
  return function wellKnownX402AurelianHandler(_req, res) {
    res.json(buildWellKnownManifest(manifest, routes, { env }));
  };
}

function buildWellKnownX402V1Manifest(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const catalog = buildCatalogEntries(routes, { includeDiscoveryFields: true, env });
  const coreRouteKeys = selectCoreDiscoveryRouteKeys(catalog);
  const resources = catalog
    .filter((entry) => coreRouteKeys.has(entry.routeKey))
    .map((entry) => {
      const examplePath = getExamplePathFromResource(entry.exampleUrl, entry.path);
      return `${String(entry.method || "GET").toUpperCase()} ${examplePath}`;
    });

  return {
    version: 1,
    resources,
    discovery: buildCoreDiscoveryNavigation(CANONICAL_BASE_URL, resources.length, catalog.length),
  };
}

function createWellKnownX402Handler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  return function wellKnownX402Handler(_req, res) {
    res.json(buildWellKnownX402V1Manifest(routes, { env }));
  };
}

function createHeadProtectedPaymentGate(paymentGate, routes = routeConfig) {
  const matchRoute = createRouteMatcher(routes);

  return async function headProtectedPaymentGate(req, res, next) {
    if (String(req.method || "").toUpperCase() !== "HEAD") {
      return paymentGate(req, res, next);
    }

    const matchedGetRoute = matchRoute("GET", req.path);
    if (!matchedGetRoute) {
      return paymentGate(req, res, next);
    }

    const originalMethod = req.method;
    let nextCalled = false;

    req.method = "GET";

    try {
      await paymentGate(req, res, (error) => {
        nextCalled = true;
        req.method = originalMethod;

        if (error) {
          next(error);
          return;
        }

        res.set("Allow", "GET");
        res.status(405).end();
      });
    } finally {
      req.method = originalMethod;
    }

    if (!nextCalled) {
      return;
    }
  };
}

function mountPaidRoutes(target, options = {}) {
  target.use(require("./routes/vin"));
  target.use(require("./routes/stocks"));
  target.use(require("./routes/weather"));
  target.use(require("./routes/holidays"));
  target.use(require("./routes/exchange-rates"));
  target.use(require("./routes/ip"));
  target.use(require("./routes/food"));
  target.use(require("./routes/nutrition"));
  target.use(require("./routes/fda"));
  target.use(require("./routes/census"));
  target.use(require("./routes/bls"));
  target.use(require("./routes/air-quality"));
  target.use(require("./routes/congress"));
  target.use(require("./routes/location"));
  target.use(require("./routes/domain-intel"));
  target.use(require("./routes/legal"));
  target.use(require("./routes/sports"));
  target.use(require("./routes/world-data"));
  target.use(generatedRoutes);
  target.use(createPublisherStackRouter({ env: options.env }));

  for (const route of getBundledSellerRoutes()) {
    const method = String(route?.method || "").toLowerCase();
    if (!method || typeof target[method] !== "function" || !route?.expressPath) {
      continue;
    }

    let handler = restrictedPartyPrimaryHandler;
    if (route.seller === "vendor-entity-brief") {
      handler = vendorEntityBriefPrimaryHandler;
    } else if (route.seller === "generic-parameter-simulator") {
      handler = genericSimulatorPrimaryHandler;
    } else if (route.handlerId === "batch") {
      handler = restrictedPartyBatchHandler;
    }

    target[method](route.expressPath, handler);
  }
}

function createApp(options = {}) {
  const env = options.env ?? process.env;
  const index402VerificationHash = String(
    options.index402VerificationHash
    || env.INDEX402_VERIFICATION_HASH
    || DEFAULT_402INDEX_VERIFICATION_HASH,
  ).trim();
  const payTo = options.payTo ?? PAY_TO;
  const routes = options.routes ?? createRouteConfig(payTo);
  const metricsRouteCatalog = options.metricsRouteCatalog ?? createRouteCatalog(routes);
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
  const paymentGate =
    options.paymentGate ??
    createPaymentGate({
      ...options,
      payTo,
      routes,
    });
  const protectedPaymentGate =
    options.protectedPaymentGate ?? createHeadProtectedPaymentGate(paymentGate, routes);
  const mercTrustEnforcementOptions = options.mercTrustEnforcementOptions ?? {};
  const productionInactiveRoutesMiddleware =
    options.productionInactiveRoutesMiddleware ?? createProductionInactiveRoutesMiddleware();
  const mercTrustMiddleware =
    options.mercTrustMiddleware ??
    createMercTrustEnforcementFromEnv({
      ...mercTrustEnforcementOptions,
      env,
      logger: options.logger ?? console,
      trustClient: options.mercTrustClient ?? mercTrustEnforcementOptions.trustClient,
      enabled:
        options.enableMercTrustEnforcement !== undefined
          ? options.enableMercTrustEnforcement
          : mercTrustEnforcementOptions.enabled,
      onResult: options.mercTrustOnResult ?? mercTrustEnforcementOptions.onResult,
    });
  const enableDebugRoutes = options.enableDebugRoutes ?? true;
  const wellKnownX402Aurelian = options.wellKnownX402Aurelian ?? WELL_KNOWN_X402_AURELIAN;

  const app = express();
  app.use(express.json());
  app.use(createSimCompatibleResponseMiddleware());

  // Trust Vercel's proxy so req.protocol returns "https" instead of "http".
  app.set("trust proxy", 1);

  if (enableDebugRoutes) {
    app.get("/debug/settle-test", createSettleTestHandler(options));
  }

  if (productionInactiveRoutesMiddleware) {
    app.use(productionInactiveRoutesMiddleware);
  }

  app.get("/", createHealthHandler(routes, { env }));
  app.get("/api/system", (_req, res) => {
    res.redirect(308, "/api/system/discovery");
  });
  app.get("/api/system/health", createHealthHandler(routes, { env }));
  app.get("/api/system/discovery", createApiDiscoveryHandler(routes, { env }));
  app.get("/api/system/discovery/full", (req, res) => {
    return res.json(buildApiDiscoveryPayload(routes, {
      env,
      req: {
        ...req,
        query: { ...req.query, profile: "full" },
      },
    }));
  });
  app.get("/api", createApiDiscoveryHandler(routes, { env }));
  app.get("/openapi", (_req, res) => {
    res.redirect(308, "/openapi.json");
  });
  app.get("/openapi.json", createOpenApiHandler(routes, { env, profile: "compact" }));
  app.get("/openapi-full.json", createOpenApiHandler(routes, { env, profile: "full" }));
  app.get("/favicon.ico", createFaviconHandler());
  app.get("/icon.png", createFaviconHandler());
  app.get("/api/sim", createSimLandingHandler(routes, { env }));
  app.get("/.well-known/x402", createWellKnownX402Handler(routes, { env }));
  app.get("/.well-known/x402.json", createWellKnownX402Handler(routes, { env }));
  app.get("/.well-known/402index-verify.txt", (_req, res) => {
    if (!index402VerificationHash) {
      return res.status(404).type("text/plain").send("");
    }
    return res.type("text/plain").send(index402VerificationHash);
  });
  app.get("/well-known/x402-aurelian.json", (_req, res) => {
    res.redirect(308, "/.well-known/x402-aurelian.json");
  });
  app.get(
    "/.well-known/x402-aurelian.json",
    createWellKnownX402AurelianHandler(wellKnownX402Aurelian, routes, { env }),
  );
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
  app.get(
    "/ops/business",
    createBusinessDashboardHandler({
      password:
        options.businessDashboardPassword ??
        env.BUSINESS_DASHBOARD_PASSWORD ??
        env.METRICS_DASHBOARD_PASSWORD,
      snapshotPath: options.businessDashboardSnapshotPath,
      proofPath: options.businessDashboardProofPath,
    }),
  );
  app.get(
    "/ops/business/data",
    createBusinessDataHandler({
      password:
        options.businessDashboardPassword ??
        env.BUSINESS_DASHBOARD_PASSWORD ??
        env.METRICS_DASHBOARD_PASSWORD,
      snapshotPath: options.businessDashboardSnapshotPath,
    }),
  );
  app.get(
    "/ops/business/proof",
    createBusinessProofHandler({
      password:
        options.businessDashboardPassword ??
        env.BUSINESS_DASHBOARD_PASSWORD ??
        env.METRICS_DASHBOARD_PASSWORD,
      proofPath: options.businessDashboardProofPath,
    }),
  );

  app.use(
    createMetricsMiddleware({
      attribution: metricsAttribution,
      logger: options.logger ?? console,
      routeCatalog: metricsRouteCatalog,
      routes,
      store: metricsStore,
    }),
  );

  const paidRouter = express.Router();
  mountPaidRoutes(paidRouter, { env });
  if (mercTrustMiddleware) {
    app.use(protectedPaymentGate, mercTrustMiddleware, paidRouter);
  } else {
    app.use(protectedPaymentGate, paidRouter);
  }

  return app;
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  PAY_TO,
  X402_NETWORK,
  createApp,
  createBusinessDashboardHandler,
  createBusinessDataHandler,
  createBusinessProofHandler,
  createFacilitatorClient,
  createApiDiscoveryHandler,
  createSimLandingHandler,
  createWellKnownX402AurelianHandler,
  createHealthHandler,
  createMercTrustEnforcementFromEnv,
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createOpenApiHandler,
  createPaymentGate,
  createPaymentResourceServer,
  createPricedRoute,
  createRouteMatcher,
  createRouteCatalog,
  createRouteConfig,
  createSettleTestHandler,
  createHeadProtectedPaymentGate,
  getRouteDescription,
  getRoutePrice,
  loadFacilitator,
  loadCoinbaseFacilitator,
  mountPaidRoutes,
  routeConfig,
  sanitizeAcceptedRequirements,
  sanitizePaymentPayloadForMatching,
};

