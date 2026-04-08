const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} = require("@x402/extensions/bazaar");
const restrictedPartySellerConfig = require("./apps/restricted-party-screen/seller.config.json");
const restrictedPartyPrimaryHandler = require("./apps/restricted-party-screen/handlers/primary");
const {
  createPaymentsMcpIntegrationHandler: createRestrictedPartyPaymentsMcpIntegrationHandler,
  createRouteConfig: createRestrictedPartyRouteConfig,
} = require("./apps/restricted-party-screen/app");
const vendorEntityBriefSellerConfig = require("./apps/vendor-entity-brief/seller.config.json");
const vendorEntityBriefPrimaryHandler = require("./apps/vendor-entity-brief/handlers/primary");
const genericSimulatorSellerConfig = require("./apps/generic-parameter-simulator/seller.config.json");
const genericSimulatorPrimaryHandler = require("./apps/generic-parameter-simulator/handlers/primary");
const sportsWorkflowSellerConfig = require("./apps/sports-workflows/seller.config.json");
const sportsWorkflowPrimaryHandler = require("./apps/sports-workflows/handlers/primary");
const vendorWorkflowSellerConfig = require("./apps/vendor-workflows/seller.config.json");
const vendorWorkflowPrimaryHandler = require("./apps/vendor-workflows/handlers/primary");
const financeWorkflowSellerConfig = require("./apps/finance-workflows/seller.config.json");
const financeWorkflowPrimaryHandler = require("./apps/finance-workflows/handlers/primary");
const generatedCatalog = require("./routes/generated-catalog.json");
const generatedRoutesRouter = require("./routes/generated");
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
const {
  createAurelianFloMcpExpressBridge,
  createAurelianFloMcpServerCardHandler,
} = require("./lib/aurelianflo-mcp-bridge");
const {
  DEFAULT_ORIGIN_TITLE,
  DESCRIPTION_FULL: DEFAULT_ORIGIN_DESCRIPTION,
  DESCRIPTION_MEDIUM,
  HEALTH_PAGE_LEDE,
  CATALOG_PAGE_LEDE,
  HOME_PAGE_AUDIENCE,
  HOME_PAGE_VALUE_PROP,
  PRIMARY_NAV_ITEMS,
} = require("./lib/aurelianflo-profile");
const {
  AURELIANFLO_ALLOWED_ROUTE_KEYS,
  PUBLIC_CORE_DISCOVERY_ROUTE_KEYS,
  buildAllowedRouteKeySet,
  buildPublicCoreRouteKeySet,
} = require("./lib/aurelianflo-surface");
const WELL_KNOWN_X402_AURELIAN = require("./well-known-x402-aurelian.json");

const PAY_TO = "0x35D5C3C750712A63e5c64f83042566df5D8EF751";
const X402_NETWORK = "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_402INDEX_VERIFICATION_HASH =
  "d7b41bc2cde9060ab7842783aa2747acb31f78c53d7d879047cf762a1a3063ea";
const CANONICAL_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || "https://x402.aurelianflo.com",
)
  .trim()
  .replace(/\/+$/, "");
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
  "/api/sim/batch-probability",
  "/api/sim/compare",
  "/api/sim/sensitivity",
  "/api/sim/forecast",
  "/api/sim/composed",
  "/api/sim/optimize",
  "/api/sim/report",
];
const SIM_ENDPOINT_SUMMARIES = {
  "/api/sim/probability":
    "Calibrated single-scenario probability with confidence interval, raw/effective score distributions, risk metrics, and diagnostics",
  "/api/sim/batch-probability":
    "Run many scenarios in one call and return calibrated ranked probabilities with per-scenario distributions, risk metrics, and diagnostics",
  "/api/sim/compare":
    "Compare baseline vs candidate scenarios with calibrated deltas, paired score-gap distribution, and decision summary",
  "/api/sim/sensitivity":
    "Sweep one parameter to measure local impact on calibrated probability with elasticity and response-curve diagnostics",
  "/api/sim/forecast":
    "Forward projection with drift, uncertainty growth, and period-by-period calibrated timeline including effective distributions and risk metrics",
  "/api/sim/composed":
    "Blend multiple weighted scenario components into a single outcome",
  "/api/sim/optimize": "Search bounded parameter ranges to maximize objective value",
  "/api/sim/report":
    "Wrap any simulation result in a structured decision report with executive summary, headline metrics, spreadsheet-friendly tables, and the raw result payload",
};
const SIM_ENDPOINT_COMPOSABILITY = {
  "/api/sim/probability": {
    pattern: "data-to-simulation",
    description:
      "Parameters can be sourced from any Bazaar data endpoint. Fetch real-world data, extract numeric values, and pass them as named parameters. The simulator applies a calibrated outcome-noise layer and returns both raw/effective score distributions plus threshold-aware risk metrics.",
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
      "Scale raw values to roughly -1 to 1. Example: unemployment 4.4% -> (5.0 - 4.4) / 3.0 = 0.2 (positive labor signal). Override outcome_noise only when you need deterministic behavior or strict custom calibration.",
  },
  "/api/sim/batch-probability": {
    pattern: "portfolio-or-screening",
    description:
      "Bundle many labeled scenarios into one request to score, calibrate, rank, and shortlist options before deeper analysis. Each scenario result includes calibrated distributions and risk metrics for side-by-side risk ranking.",
    example_sources: [
      {
        endpoint: "/api/stocks/screener",
        extract: "data.results[*]",
        use_as: "candidate scenarios with normalized factor inputs",
      },
      {
        endpoint: "/api/bls/unemployment",
        extract: "data.latest.rate_pct",
        use_as: "shared macro input applied across scenarios",
      },
    ],
    normalization_tip:
      "Pre-normalize scenario factors onto a consistent scale and keep threshold plus outcome_noise consistent across scenarios when you want rankings to be directly comparable.",
  },
  "/api/sim/compare": {
    pattern: "data-to-simulation",
    description:
      "Build baseline and candidate scenarios from real endpoint data. Example: baseline uses current economic indicators, candidate uses projected values. Keep calibration settings aligned to make deltas meaningful, and use paired score-gap plus decision summary fields to judge practical lift.",
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
      "Use live data as the scenario baseline, then sweep one parameter to find which real-world factor has the most impact under calibrated probability assumptions. Use direction, midpoint elasticity, and response-curve span to quantify local effect size.",
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
      "Initialize forecast with current real-world values and project forward. Drift parameters can reflect trends from historical data endpoints, while each timeline point includes effective score distribution and threshold risk metrics.",
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
  "/api/sim/report": {
    pattern: "simulation-to-report",
    description:
      "Run any supported simulation workflow and immediately transform the result into a reusable analyst payload. The report response includes an executive summary, headline metrics, spreadsheet-friendly tables, and the underlying raw result for downstream export or audit.",
    example_sources: [
      {
        endpoint: "/api/sim/compare",
        extract: "baseline, candidate, deltas, and decision_summary",
        use_as: "decision memo source",
      },
      {
        endpoint: "/api/sim/forecast",
        extract: "timeline and summary",
        use_as: "trend tab or planning brief source",
      },
    ],
    normalization_tip:
      "Keep the underlying simulation payload under `request` and set `analysis_type` to the source endpoint you want summarized.",
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

This composability pattern works across all simulation endpoints: probability, batch-probability, compare, sensitivity, forecast, composed, and optimize. The data endpoints provide the inputs; the simulation endpoints provide calibrated probability analysis with distributions, risk metrics, and diagnostics.`;
const SIM_LANDING_COMPOSABILITY = {
  overview:
    "The simulation suite is designed to consume real-world data from other Bazaar endpoints. Any numeric value from any GET endpoint can become a simulation parameter.",
  pipeline_pattern: [
    "1. Call one or more Bazaar data endpoints (GET)",
    "2. Extract numeric values from responses",
    "3. Normalize values to a working range (typically -1 to 1)",
    "4. Pass as named parameters to any POST /api/sim/* endpoint",
    "5. Receive calibrated probability plus distributions, risk metrics, ranking/diagnostics, and decision-ready output",
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
          call: "GET /api/ofac-wallet-screen/{address}",
          extract: "Wallet sanctions hit or clear status",
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
        "/api/ofac-wallet-screen/:address",
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
    outputSchema,
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

  if (outputSchema && extension?.bazaar?.schema?.properties && typeof extension.bazaar.schema.properties === "object") {
    extension.bazaar.schema.properties.output = outputSchema;
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
    outputSchema,
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
      outputSchema,
    }),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const JSON_PRIMITIVE_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "integer" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const FLEXIBLE_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: true,
};

const REPORT_META_SCHEMA = {
  type: "object",
  properties: {
    report_type: { type: "string" },
    title: { type: "string" },
    report_title: { type: "string" },
    name: { type: "string" },
    author: { type: "string" },
    owner: { type: "string" },
    date: { type: "string" },
    version: { type: "string" },
  },
  additionalProperties: true,
};

const REPORT_TABLE_ROW_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: JSON_PRIMITIVE_SCHEMA },
    { type: "array", items: JSON_PRIMITIVE_SCHEMA },
  ],
};

const REPORT_TABLE_SCHEMA = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      items: { type: "string" },
    },
    rows: {
      type: "array",
      items: REPORT_TABLE_ROW_SCHEMA,
    },
  },
  additionalProperties: true,
};

const HEADLINE_METRIC_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    value: JSON_PRIMITIVE_SCHEMA,
    unit: { type: "string" },
  },
  required: ["label"],
  additionalProperties: true,
};

const SHARED_REPORT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    report_meta: REPORT_META_SCHEMA,
    executive_summary: {
      type: "array",
      items: { type: "string" },
    },
    headline_metrics: {
      type: "array",
      items: HEADLINE_METRIC_SCHEMA,
    },
    tables: {
      type: "object",
      additionalProperties: REPORT_TABLE_SCHEMA,
    },
    export_artifacts: {
      type: "object",
      properties: {
        workbook_rows: {
          type: "object",
          additionalProperties: {
            type: "array",
            items: REPORT_TABLE_ROW_SCHEMA,
          },
        },
      },
      additionalProperties: true,
    },
    chart_hints: {
      type: "array",
      items: FLEXIBLE_OBJECT_SCHEMA,
    },
    result: FLEXIBLE_OBJECT_SCHEMA,
  },
  required: ["report_meta"],
  additionalProperties: true,
};

const LEGACY_DOCX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    metadata: FLEXIBLE_OBJECT_SCHEMA,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" },
          },
          table: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
        additionalProperties: true,
      },
    },
  },
  required: ["title", "sections"],
  additionalProperties: true,
};

const PREMIUM_SIMPLE_DOCX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    markdown: { type: "string" },
    html: { type: "string" },
    metadata: FLEXIBLE_OBJECT_SCHEMA,
    sections: LEGACY_DOCX_INPUT_SCHEMA.properties.sections,
  },
  anyOf: [
    { required: ["title", "sections"] },
    { required: ["markdown"] },
    { required: ["html"] },
  ],
  additionalProperties: true,
};

const MAX_FIDELITY_DOCX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    metadata: FLEXIBLE_OBJECT_SCHEMA,
    variables: FLEXIBLE_OBJECT_SCHEMA,
    data: FLEXIBLE_OBJECT_SCHEMA,
    sections: LEGACY_DOCX_INPUT_SCHEMA.properties.sections,
  },
  required: ["template"],
  additionalProperties: true,
};

const LEGACY_XLSX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    sheets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          headers: {
            type: "array",
            items: { type: "string" },
          },
          columns: {
            type: "array",
            items: { type: "string" },
          },
          rows: {
            type: "array",
            items: REPORT_TABLE_ROW_SCHEMA,
          },
          formulas: {
            type: "array",
            items: FLEXIBLE_OBJECT_SCHEMA,
          },
        },
        required: ["name", "rows"],
        additionalProperties: true,
      },
    },
  },
  required: ["title", "sheets"],
  additionalProperties: true,
};

const PREMIUM_SIMPLE_XLSX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    markdown: { type: "string" },
    html: { type: "string" },
    metadata: FLEXIBLE_OBJECT_SCHEMA,
    sheets: LEGACY_XLSX_INPUT_SCHEMA.properties.sheets,
    tables: {
      type: "array",
      items: REPORT_TABLE_SCHEMA,
    },
  },
  anyOf: [
    { required: ["title", "sheets"] },
    { required: ["html"] },
    { required: ["markdown"] },
    { required: ["tables"] },
  ],
  additionalProperties: true,
};

const MAX_FIDELITY_XLSX_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    template: { type: "string" },
    metadata: FLEXIBLE_OBJECT_SCHEMA,
    variables: FLEXIBLE_OBJECT_SCHEMA,
    data: FLEXIBLE_OBJECT_SCHEMA,
    sheets: LEGACY_XLSX_INPUT_SCHEMA.properties.sheets,
  },
  required: ["template"],
  additionalProperties: true,
};

const LEGACY_PDF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    format: { type: "string", enum: ["markdown", "html"] },
    content: { type: "string" },
    markdown: { type: "string" },
    html: { type: "string" },
    note: { type: "string" },
    lines: {
      type: "array",
      items: { type: "string" },
    },
    sections: {
      type: "array",
      items: FLEXIBLE_OBJECT_SCHEMA,
    },
    data: FLEXIBLE_OBJECT_SCHEMA,
  },
  additionalProperties: true,
};

const MAX_FIDELITY_PDF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    html: { type: "string" },
    css: { type: "string" },
    headerHtml: { type: "string" },
    footerHtml: { type: "string" },
    printBackground: { type: "boolean" },
    page: {
      type: "object",
      properties: {
        format: { type: "string" },
        margin: FLEXIBLE_OBJECT_SCHEMA,
        landscape: { type: "boolean" },
      },
      additionalProperties: true,
    },
  },
  required: ["html"],
  additionalProperties: true,
};

const LEGACY_REPORT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          text: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" },
          },
          table: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: JSON_PRIMITIVE_SCHEMA,
            },
          },
        },
        additionalProperties: true,
      },
    },
  },
  required: ["title"],
  additionalProperties: true,
};

const DOCUMENT_ARTIFACT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    data: {
      type: "object",
      properties: {
        documentType: { type: "string" },
        fileName: { type: "string" },
        mimeType: { type: "string" },
        artifact: {
          type: "object",
          properties: {
            type: { type: "string" },
            name: { type: "string" },
            sizeBytes: { type: "integer" },
            contentBase64: { type: "string" },
          },
          required: ["type", "name", "sizeBytes", "contentBase64"],
          additionalProperties: true,
        },
        preview: {
          type: "array",
          items: { type: "string" },
        },
        capabilities: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["documentType", "fileName", "mimeType", "artifact"],
      additionalProperties: true,
    },
    source: { type: "string" },
  },
  required: ["success", "data", "source"],
  additionalProperties: true,
};

const GENERATED_DOCUMENT_ROUTE_OVERRIDES = {
  "POST /api/tools/report/generate": {
    price: "0.05",
    description: "Generate a styled report PDF from the shared report model or a legacy report payload with title, summary, sections, and headline metrics.",
    inputExample: {
      report_meta: { report_type: "ops-brief", title: "Weekly Ops Brief", author: "AurelianFlo" },
      executive_summary: [
        "Core routes stayed available through the reporting window.",
        "Manual review remains recommended for billing anomalies.",
      ],
      headline_metrics: [
        { label: "Uptime", value: "99.9%", unit: "percent" },
        { label: "Incidents", value: 1, unit: "count" },
      ],
      tables: {
        route_health: {
          columns: ["route", "status"],
          rows: [{ route: "/api/tools/report/generate", status: "healthy" }],
        },
      },
    },
    inputSchema: {
      oneOf: [SHARED_REPORT_INPUT_SCHEMA, LEGACY_REPORT_INPUT_SCHEMA],
    },
    outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
  },
  "POST /api/tools/docx/generate": {
    description: "Generate a DOCX from structured sections, markdown, or HTML content, or from the shared report model.",
    inputExample: {
      report_meta: { report_type: "partner-brief", title: "Partner Brief", author: "AurelianFlo" },
      executive_summary: ["Partner scope is defined and ready for review."],
      tables: {
        timeline: {
          columns: ["phase", "status"],
          rows: [
            { phase: "Summary", status: "complete" },
            { phase: "Scope", status: "complete" },
            { phase: "Timeline", status: "draft" },
          ],
        },
      },
    },
    inputSchema: {
      oneOf: [SHARED_REPORT_INPUT_SCHEMA, PREMIUM_SIMPLE_DOCX_INPUT_SCHEMA],
    },
    outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
  },
  "POST /api/tools/xlsx/generate": {
    description: "Generate an XLSX workbook from structured sheets, markdown tables, HTML tables, or the shared report model.",
    inputExample: {
      report_meta: { report_type: "data-workbook", title: "Weekly Ops Workbook", author: "AurelianFlo" },
      executive_summary: ["Workbook rows are generated from the shared report model."],
      tables: {
        data: {
          columns: ["name", "value"],
          rows: [{ name: "a", value: 1 }, { name: "b", value: 2 }],
        },
      },
    },
    inputSchema: {
      oneOf: [SHARED_REPORT_INPUT_SCHEMA, PREMIUM_SIMPLE_XLSX_INPUT_SCHEMA],
    },
    outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
  },
  "POST /api/tools/pdf/generate": {
    description:
      "Generate a PDF from markdown, HTML, or structured report content for polished exports, client deliverables, internal memos, and report distribution.",
    inputExample: {
      title: "Q2 Planning Memo",
      format: "markdown",
      content: "# Q2 Planning Memo\n\n- Launch core routes\n- Verify monitoring\n",
    },
    inputSchema: LEGACY_PDF_INPUT_SCHEMA,
    outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
  },
};

const GENERATED_DOCUMENT_ROUTE_ALIASES = [
  {
    sourceKey: "POST /api/tools/report/generate",
    aliasKey: "POST /api/tools/report/pdf/generate",
    aliasPath: "/api/tools/report/pdf/generate",
    override: {
      price: "0.05",
      description: "Generate a styled PDF report from the shared report model or a legacy report payload.",
      inputExample: GENERATED_DOCUMENT_ROUTE_OVERRIDES["POST /api/tools/report/generate"].inputExample,
      inputSchema: GENERATED_DOCUMENT_ROUTE_OVERRIDES["POST /api/tools/report/generate"].inputSchema,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "pdf", "report", "formatted"],
    },
  },
  {
    sourceKey: "POST /api/tools/docx/generate",
    aliasKey: "POST /api/tools/report/docx/generate",
    aliasPath: "/api/tools/report/docx/generate",
    override: {
      price: "0.06",
      description: "Generate a report DOCX from the shared report model with report-aware structure and styling.",
      inputExample: {
        report_meta: { report_type: "board-update", title: "Board Update", author: "AurelianFlo" },
        executive_summary: ["Highlights are ready for review."],
        headline_metrics: [{ label: "Revenue", value: "$42k" }],
        tables: {
          pipeline: {
            columns: ["stage", "status"],
            rows: [{ stage: "Draft", status: "complete" }],
          },
        },
      },
      inputSchema: SHARED_REPORT_INPUT_SCHEMA,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "docx", "report", "formatted"],
    },
  },
  {
    sourceKey: "POST /api/tools/xlsx/generate",
    aliasKey: "POST /api/tools/report/xlsx/generate",
    aliasPath: "/api/tools/report/xlsx/generate",
    override: {
      price: "0.07",
      description: "Generate a report XLSX workbook from the shared report model with spreadsheet-friendly tabs and tables.",
      inputExample: {
        report_meta: { report_type: "ops-workbook", title: "Ops Workbook", author: "AurelianFlo" },
        executive_summary: ["Workbook rows are derived from the shared report model."],
        tables: {
          metrics: {
            columns: ["metric", "value"],
            rows: [{ metric: "availability", value: "99.9%" }],
          },
        },
      },
      inputSchema: SHARED_REPORT_INPUT_SCHEMA,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "xlsx", "report", "formatted"],
    },
  },
  {
    sourceKey: "POST /api/tools/pdf/generate",
    aliasKey: "POST /api/tools/pdf/render-html",
    aliasPath: "/api/tools/pdf/render-html",
    override: {
      price: "0.18",
      description: "Generate a max-fidelity PDF from HTML using the strongest available render engine for layout, CSS, and tables.",
      inputExample: {
        title: "Branded HTML Brief",
        html: "<html><body><h1>Quarterly Brief</h1><table><tr><th>Metric</th><th>Value</th></tr><tr><td>ARR</td><td>$42k</td></tr></table></body></html>",
        css: "table{border-collapse:collapse}th,td{border:1px solid #333;padding:6px}",
      },
      inputSchema: MAX_FIDELITY_PDF_INPUT_SCHEMA,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "pdf", "html", "formatted", "max-fidelity"],
    },
  },
  {
    sourceKey: "POST /api/tools/docx/generate",
    aliasKey: "POST /api/tools/docx/render-template",
    aliasPath: "/api/tools/docx/render-template",
    override: {
      price: "0.18",
      description: "Generate a max-fidelity DOCX from a named template with structured variables and sections.",
      inputExample: {
        title: "Mutual NDA",
        template: "nda",
        variables: {
          disclosingParty: "AurelianFlo",
          receivingParty: "Acme Co",
        },
      },
      inputSchema: MAX_FIDELITY_DOCX_INPUT_SCHEMA,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "docx", "template", "formatted", "max-fidelity"],
    },
  },
  {
    sourceKey: "POST /api/tools/xlsx/generate",
    aliasKey: "POST /api/tools/xlsx/render-template",
    aliasPath: "/api/tools/xlsx/render-template",
    override: {
      price: "0.18",
      description: "Generate a max-fidelity XLSX workbook from a named template with structured variables and workbook data.",
      inputExample: {
        title: "Revenue Tracker",
        template: "tracker",
        data: {
          rows: [
            { month: "Jan", revenue: 12000 },
            { month: "Feb", revenue: 13500 },
          ],
        },
      },
      inputSchema: MAX_FIDELITY_XLSX_INPUT_SCHEMA,
      outputSchema: DOCUMENT_ARTIFACT_RESPONSE_SCHEMA,
      tags: ["documents", "xlsx", "template", "formatted", "max-fidelity"],
    },
  },
];
const FULL_DISCOVERY_ROUTE_KEYS = buildPublicCoreRouteKeySet();
const PUBLIC_CORE_DISCOVERY_ROUTE_KEYS_SET = buildPublicCoreRouteKeySet();
const FLAGSHIP_ROUTE_ORDER = [
  "POST /api/workflows/compliance/edd-report",
  "POST /api/workflows/compliance/batch-wallet-screen",
  "GET /api/ofac-wallet-screen/:address",
  "POST /api/tools/report/pdf/generate",
  "POST /api/tools/report/docx/generate",
  "POST /api/tools/report/xlsx/generate",
];
const FLAGSHIP_ROUTE_KEYS = new Set(FLAGSHIP_ROUTE_ORDER);
const FLAGSHIP_ROUTE_EDITORIAL = {
  "POST /api/workflows/compliance/edd-report": {
    discipline: "Compliance",
    sequence: "01",
    title: "EDD memo",
    summary:
      "Turn a wallet set plus case metadata into an enhanced due diligence memo with evidence, follow-up, and reviewer handoff fields.",
    proof:
      "Best when operations or compliance needs an audit-ready memo without pretending the system is providing legal approval or denial.",
  },
  "POST /api/workflows/compliance/batch-wallet-screen": {
    discipline: "Compliance",
    sequence: "02A",
    title: "Batch wallet screening",
    summary:
      "Screen a wallet set in one request, then hand the result to operations or compliance as a single review packet.",
    proof:
      "Returns matched and clear wallet counts, per-wallet results, source freshness, and a structured report payload for audit-ready PDF or DOCX rendering.",
  },
  "GET /api/ofac-wallet-screen/:address": {
    discipline: "Compliance",
    sequence: "02B",
    title: "OFAC wallet screening",
    summary:
      "Screen a wallet address before funds move. This is the fastest exact-match OFAC check when operations needs a clear review signal on one address.",
    proof:
      "Returns exact hit or clear status, sanctioned entity metadata, source freshness, and a structured report payload ready for PDF or DOCX rendering.",
  },
  "POST /api/tools/report/pdf/generate": {
    discipline: "Documents",
    sequence: "03A",
    title: "Report PDF generation",
    summary:
      "Render the wallet-screening report payload into a formatted PDF artifact for circulation, approvals, and audit handoff.",
    proof:
      "Best for final distribution when the report needs a fixed layout and a clean presentation layer.",
  },
  "POST /api/tools/report/docx/generate": {
    discipline: "Documents",
    sequence: "03B",
    title: "Report DOCX generation",
    summary:
      "Render the same wallet-screening report payload into a Word-native deliverable for editing, markup, and client-side revision.",
    proof:
      "Best when the report needs editing, markup, or revision in a standard document workflow.",
  },
  "POST /api/tools/report/xlsx/generate": {
    discipline: "Documents",
    sequence: "03C",
    title: "Report XLSX generation",
    summary:
      "Render the shared report payload into a workbook for spreadsheet handoff, tracking, and downstream analysis.",
    proof:
      "Best when the compliance workflow needs tabular review, evidence packing, or workbook-native handoff.",
  },
};
const ROUTE_DOC_RELATED_LINKS = {
  "POST /api/workflows/compliance/edd-report": [
    {
      label: "Batch screening",
      href: "/api/workflows/compliance/batch-wallet-screen",
      description: "Lower-priced wallet-set screening primitive underneath the EDD workflow.",
    },
    {
      label: "Single-wallet screen",
      href: "/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
      description: "Concrete exact-match OFAC example for one wallet address.",
    },
    {
      label: "Payments MCP",
      href: "/integrations/payments-mcp",
      description: "Install and prompt templates for agent-first access to the compliance routes.",
    },
  ],
  "POST /api/workflows/compliance/batch-wallet-screen": [
    {
      label: "EDD memo",
      href: "/api/workflows/compliance/edd-report",
      description: "Primary buyer-facing workflow when the screening result needs memo output.",
    },
    {
      label: "Single-wallet screen",
      href: "/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
      description: "Concrete exact-match OFAC example for a single address check.",
    },
  ],
};
const WORKFLOW_COMPATIBILITY_ALIASES = [
  {
    seller: "sports-workflows",
    sourceKey: "POST /api/workflows/sports/nba/championship-forecast",
    aliasPath: "/api/workflows/sports/nba/playoff-forecast",
  },
  {
    seller: "sports-workflows",
    sourceKey: "POST /api/workflows/sports/nfl/championship-forecast",
    aliasPath: "/api/workflows/sports/nfl/playoff-forecast",
  },
  {
    seller: "sports-workflows",
    sourceKey: "POST /api/workflows/sports/mlb/championship-forecast",
    aliasPath: "/api/workflows/sports/mlb/playoff-forecast",
  },
  {
    seller: "sports-workflows",
    sourceKey: "POST /api/workflows/sports/nhl/championship-forecast",
    aliasPath: "/api/workflows/sports/nhl/playoff-forecast",
  },
  {
    seller: "vendor-workflows",
    sourceKey: "POST /api/workflows/vendor/risk-assessment",
    aliasPath: "/api/workflows/vendor/risk-forecast",
  },
  {
    seller: "vendor-workflows",
    sourceKey: "POST /api/workflows/vendor/risk-assessment",
    aliasPath: "/api/workflows/vendor/due-diligence-report",
    canonicalPath: "/api/workflows/vendor/due-diligence-report",
    description:
      "Run a vendor due diligence workflow that combines entity matching, registration review, sanctions screening, and decision-ready reporting for supplier onboarding.",
    tags: ["vendor", "due-diligence", "supplier-onboarding", "kyb", "compliance", "workflow"],
  },
  {
    seller: "finance-workflows",
    sourceKey: "POST /api/workflows/finance/pricing-plan-compare",
    aliasPath: "/api/workflows/finance/pricing-scenario-forecast",
  },
  {
    seller: "finance-workflows",
    sourceKey: "POST /api/workflows/finance/cash-runway-forecast",
    aliasPath: "/api/workflows/finance/startup-runway-forecast",
    canonicalPath: "/api/workflows/finance/startup-runway-forecast",
    description:
      "Run a startup runway forecast under uncertain revenue and burn assumptions and return a founder- and investor-ready decision payload with risk bands and runway estimates.",
    tags: ["finance", "startup", "runway", "forecast", "founder", "investor", "workflow"],
  },
  {
    seller: "finance-workflows",
    sourceKey: "POST /api/workflows/finance/pricing-plan-compare",
    aliasPath: "/api/workflows/finance/pricing-sensitivity-report",
    canonicalPath: "/api/workflows/finance/pricing-sensitivity-report",
    description:
      "Run pricing sensitivity analysis across multiple plans and assumptions and return a decision-ready report on expected profit, downside risk, and plan ranking.",
    tags: ["finance", "pricing", "sensitivity", "plan-ranking", "profitability", "workflow"],
  },
];

const ROUTE_DISCOVERY_OVERRIDES = {
  "GET /api/ofac-wallet-screen/:address": {
    description:
      "Screen a crypto wallet for OFAC sanctions exposure and return a wallet compliance result, including hit or clear status, sanctioned entity details, covered assets, sanctions programs, and a manual-review flag for AML, treasury, and onchain payment controls.",
    tags: ["compliance", "ofac", "wallet-screening", "aml", "treasury", "onchain", "sanctions"],
  },
  "GET /api/vendor-entity-brief": {
    description:
      "Generate a vendor due diligence brief for supplier onboarding, procurement review, KYB-style entity checks, and restricted-party screening, with legal entity match candidates, jurisdiction and registration details, OFAC screening signals, and a proceed-or-pause recommendation.",
    tags: ["vendor-due-diligence", "supplier-onboarding", "kyb", "ofac", "restricted-party", "compliance"],
  },
  "POST /api/sim/probability": {
    description:
      "Run a Monte Carlo probability simulation for a single scenario and estimate the likelihood of an outcome under uncertain inputs such as conversion, churn, pricing, cost, or demand assumptions.",
    tags: ["monte-carlo", "probability", "forecasting", "decision-analysis", "scenario-modeling"],
  },
  "POST /api/sim/batch-probability": {
    description:
      "Run Monte Carlo simulations across multiple scenarios in one call and return ranked probabilities for decision-making, option screening, and scenario comparison.",
    tags: ["monte-carlo", "batch-simulation", "scenario-ranking", "decision-analysis"],
  },
  "POST /api/sim/compare": {
    description:
      "Compare a baseline and proposed scenario with Monte Carlo simulation and return uplift, downside, and decision-oriented guidance for pricing, growth, product, or operating-plan changes.",
    tags: ["monte-carlo", "scenario-compare", "pricing", "growth", "decision-analysis"],
  },
  "POST /api/sim/sensitivity": {
    description:
      "Measure which input variables matter most in a Monte Carlo model by perturbing a selected parameter and reporting outcome sensitivity, response curves, and decision impact.",
    tags: ["monte-carlo", "sensitivity-analysis", "decision-impact", "response-curves"],
  },
  "POST /api/sim/forecast": {
    description:
      "Generate a probabilistic forecast across future periods under uncertainty, useful for runway planning, growth projections, demand forecasts, revenue outlooks, and risk-adjusted planning.",
    tags: ["monte-carlo", "forecast", "runway-planning", "revenue-forecast", "growth-projections"],
  },
  "POST /api/sim/composed": {
    description:
      "Blend multiple weighted scenarios into a single Monte Carlo outcome model and return component-level traces for portfolio, plan-mix, or strategy-combination analysis.",
    tags: ["monte-carlo", "scenario-composition", "portfolio-analysis", "strategy-analysis"],
  },
  "POST /api/sim/optimize": {
    description:
      "Search bounded parameter ranges to find the scenario that maximizes a target objective, useful for pricing optimization, budget allocation, or decision tuning under uncertainty.",
    tags: ["monte-carlo", "optimization", "pricing-optimization", "budget-allocation", "decision-tuning"],
  },
  "POST /api/sim/report": {
    description:
      "Generate a structured Monte Carlo decision report with executive summary, headline metrics, ranked scenarios, and spreadsheet-friendly tables for finance, strategy, or operations review.",
    tags: ["monte-carlo", "decision-report", "finance", "strategy", "operations", "reporting"],
  },
  "POST /api/workflows/vendor/risk-assessment": {
    description:
      "Assess vendor onboarding risk for one vendor or a vendor batch and return a report-ready payload for procurement, compliance, finance, and cross-border payout review.",
    tags: ["vendor-risk", "procurement", "compliance", "finance", "cross-border", "workflow"],
  },
  "POST /api/workflows/finance/cash-runway-forecast": {
    description:
      "Simulate startup cash runway under burn and revenue uncertainty to estimate when the company runs out of cash, downside risk bands, and likely runway under multiple assumptions.",
    tags: ["cash-runway", "startup-finance", "forecast", "burn-rate", "revenue", "workflow"],
  },
  "POST /api/workflows/finance/pricing-plan-compare": {
    description:
      "Compare pricing plans under uncertainty and rank expected profitability, downside risk, and expected outcomes for pricing experiments, packaging changes, and monetization decisions.",
    tags: ["pricing", "plan-compare", "profitability", "monetization", "workflow"],
  },
  "POST /api/tools/docx/generate": {
    description:
      "Generate a DOCX file from structured sections, markdown, HTML, or report payloads for client-ready memos, reports, proposals, and decision documents.",
    tags: ["docx", "document-generation", "proposal", "memo", "reporting"],
  },
  "POST /api/tools/pdf/generate": {
    description:
      "Generate a PDF from markdown, HTML, or structured report content for polished exports, client deliverables, internal memos, and report distribution.",
    tags: ["pdf", "document-generation", "client-deliverable", "reporting", "export"],
  },
  "POST /api/tools/xlsx/generate": {
    description:
      "Generate an XLSX workbook from structured sheets, markdown tables, HTML tables, or report payloads for workbook exports, analysis packs, and finance-ready handoffs.",
    tags: ["xlsx", "workbook", "analysis-pack", "finance", "export"],
  },
  "POST /api/tools/report/pdf/generate": {
    description:
      "Generate a styled PDF report from a shared report model with executive summary, metrics, sections, and tables for client delivery or internal decision review.",
    tags: ["pdf-report", "executive-summary", "decision-review", "client-delivery"],
  },
  "POST /api/tools/report/docx/generate": {
    description:
      "Generate a styled DOCX report from a shared report model for editable decision memos, diligence reports, and client-facing documents.",
    tags: ["docx-report", "decision-memo", "diligence-report", "client-document"],
  },
  "POST /api/tools/report/xlsx/generate": {
    description:
      "Generate a report-oriented XLSX workbook from a shared report model with tabs and tables for analysis handoff, finance modeling, and spreadsheet-friendly exports.",
    tags: ["xlsx-report", "finance-modeling", "analysis-handoff", "workbook-export"],
  },
};

function inferSchemaFromExample(value) {
  if (Array.isArray(value)) {
    const itemSchema = value.length ? inferSchemaFromExample(value[0]) : { type: "string" };
    return {
      type: "array",
      items: itemSchema,
    };
  }

  if (isPlainObject(value)) {
    const properties = {};
    const required = [];

    for (const [key, child] of Object.entries(value)) {
      properties[key] = inferSchemaFromExample(child);
      required.push(key);
    }

    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }

  if (typeof value === "number") {
    return {
      type: Number.isInteger(value) ? "integer" : "number",
    };
  }

  if (typeof value === "boolean") {
    return { type: "boolean" };
  }

  if (value == null) {
    return { type: "string", nullable: true };
  }

  return { type: "string" };
}

function normalizeGeneratedInputExample(route = {}) {
  if (isPlainObject(route.inputExample) && isPlainObject(route.inputExample.input)) {
    return route.inputExample.input;
  }
  return route.inputExample ?? null;
}

function createGeneratedCatalogRouteConfig(payTo = PAY_TO, options = {}) {
  const existingRouteKeys = options.existingRouteKeys instanceof Set
    ? options.existingRouteKeys
    : new Set();
  const generatedRoutes = Array.isArray(generatedCatalog?.routes)
    ? generatedCatalog.routes
    : [];
  const entries = {};

  for (const route of generatedRoutes) {
    const routeKey = String(route?.key || "").trim();
    if (!routeKey || existingRouteKeys.has(routeKey) || entries[routeKey]) {
      continue;
    }

    const method = String(route?.method || routeKey.split(" ")[0] || "GET").toUpperCase();
    const routePath =
      route?.canonicalPath ||
      route?.resourcePath ||
      route?.expressPath ||
      route?.routePath ||
      "";

    if (!routePath) {
      continue;
    }

    const inputExample = normalizeGeneratedInputExample(route);
    const queryExample = method === "GET" && isPlainObject(route?.queryExample)
      ? route.queryExample
      : undefined;
    const routeOptions = {
      price: route?.price || "0.01",
      description: route?.description || `${routeKey} generated endpoint`,
      payTo,
      resourcePath: routePath,
      category: route?.category,
      tags: Array.isArray(route?.tags) ? route.tags : [],
      bodyType: route?.bodyType || (method === "GET" ? undefined : "json"),
      outputExample: route?.outputExample,
    };
    const override = GENERATED_DOCUMENT_ROUTE_OVERRIDES[routeKey];

    if (queryExample) {
      routeOptions.queryExample = queryExample;
      routeOptions.querySchema = inferSchemaFromExample(queryExample);
    }

    if (method !== "GET" && inputExample !== null && inputExample !== undefined) {
      routeOptions.inputExample = inputExample;
      routeOptions.inputSchema = inferSchemaFromExample(inputExample);
    }

    if (override) {
      Object.assign(routeOptions, override);
    }

    entries[routeKey] = createPricedRoute(routeOptions);
  }

  const generatedRoutesByKey = new Map(generatedRoutes.map((route) => [String(route?.key || "").trim(), route]));
  for (const alias of GENERATED_DOCUMENT_ROUTE_ALIASES) {
    const sourceRoute = generatedRoutesByKey.get(alias.sourceKey);
    if (!sourceRoute || existingRouteKeys.has(alias.aliasKey) || entries[alias.aliasKey]) {
      continue;
    }

    const method = String(sourceRoute?.method || alias.aliasKey.split(" ")[0] || "POST").toUpperCase();
    const inputExample = alias.override?.inputExample ?? normalizeGeneratedInputExample(sourceRoute);
    const routeOptions = {
      price: alias.override?.price || sourceRoute?.price || "0.01",
      description: alias.override?.description || sourceRoute?.description || `${alias.aliasKey} generated endpoint`,
      payTo,
      resourcePath: alias.aliasPath,
      category: alias.override?.category || sourceRoute?.category,
      tags: Array.isArray(alias.override?.tags)
        ? alias.override.tags
        : Array.isArray(sourceRoute?.tags)
          ? sourceRoute.tags
          : [],
      bodyType: alias.override?.bodyType || sourceRoute?.bodyType || (method === "GET" ? undefined : "json"),
      outputExample: alias.override?.outputExample || sourceRoute?.outputExample,
      outputSchema: alias.override?.outputSchema,
    };

    if (method !== "GET" && inputExample !== null && inputExample !== undefined) {
      routeOptions.inputExample = inputExample;
      routeOptions.inputSchema = alias.override?.inputSchema || inferSchemaFromExample(inputExample);
    }

    entries[alias.aliasKey] = createPricedRoute(routeOptions);
  }

  return entries;
}

function shouldIncludeRouteInDiscovery(routeKey, options = {}) {
  const scope = String(options.discoveryScope || "full").toLowerCase();
  if (scope === "public") {
    return PUBLIC_CORE_DISCOVERY_ROUTE_KEYS_SET.has(routeKey);
  }

  return FULL_DISCOVERY_ROUTE_KEYS.has(routeKey);
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
  const sportsWorkflowRoutes = Array.isArray(sportsWorkflowSellerConfig?.routes)
    ? sportsWorkflowSellerConfig.routes
    : sportsWorkflowSellerConfig?.route
      ? [sportsWorkflowSellerConfig.route]
      : [];
  const vendorWorkflowRoutes = Array.isArray(vendorWorkflowSellerConfig?.routes)
    ? vendorWorkflowSellerConfig.routes
    : vendorWorkflowSellerConfig?.route
      ? [vendorWorkflowSellerConfig.route]
      : [];
  const financeWorkflowRoutes = Array.isArray(financeWorkflowSellerConfig?.routes)
    ? financeWorkflowSellerConfig.routes
    : financeWorkflowSellerConfig?.route
      ? [financeWorkflowSellerConfig.route]
      : [];

  const bundledRoutes = [
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
    ...sportsWorkflowRoutes.map((route) => ({
      ...route,
      payTo: sportsWorkflowSellerConfig?.payTo || PAY_TO,
      seller: "sports-workflows",
    })),
    ...vendorWorkflowRoutes.map((route) => ({
      ...route,
      payTo: vendorWorkflowSellerConfig?.payTo || PAY_TO,
      seller: "vendor-workflows",
    })),
    ...financeWorkflowRoutes.map((route) => ({
      ...route,
      payTo: financeWorkflowSellerConfig?.payTo || PAY_TO,
      seller: "finance-workflows",
    })),
  ];

  const routesByKey = new Map(bundledRoutes.map((route) => [route.key, route]));
  const compatibilityAliases = WORKFLOW_COMPATIBILITY_ALIASES.flatMap((alias) => {
    const sourceRoute = routesByKey.get(alias.sourceKey);
    if (!sourceRoute || sourceRoute.seller !== alias.seller) {
      return [];
    }

    return [{
      ...sourceRoute,
      key: `${String(sourceRoute.method || "POST").toUpperCase()} ${alias.aliasPath}`,
      routePath: alias.aliasPath,
      expressPath: alias.aliasPath,
      resourcePath: alias.aliasPath,
      canonicalPath: alias.canonicalPath || sourceRoute.canonicalPath || sourceRoute.routePath || alias.aliasPath,
      description: alias.description || sourceRoute.description,
      tags: Array.isArray(alias.tags) ? alias.tags : sourceRoute.tags,
      compatibilityAlias: true,
    }];
  });

  return [...bundledRoutes, ...compatibilityAliases];
}

function getPaymentRouteKey(route) {
  return route?.paymentRouteKey || route?.key;
}

function getDisplayRouteKey(routeKey, config) {
  return config?.displayRouteKey || routeKey;
}

function getDisplayRoutePath(routeKey, config) {
  if (config?.displayPath) {
    return config.displayPath;
  }

  const [, routePath = "/"] = String(getDisplayRouteKey(routeKey, config) || "").split(" ");
  return routePath;
}

function createBundledSellerRouteConfig() {
  const entries = {};

  for (const route of getBundledSellerRoutes()) {
    const canonicalResourcePath = route?.canonicalPath || route?.resourcePath;
    const paymentRouteKey = getPaymentRouteKey(route);
    if (!paymentRouteKey || !canonicalResourcePath) {
      continue;
    }

    const normalizedInputExample =
      String(route.method || "").toUpperCase() === "POST" && route.inputExample
        ? { body: route.inputExample }
        : route.inputExample;

    const pricedRoute = createPricedRoute({
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
      outputSchema: route.outputSchema,
    });

    if (paymentRouteKey !== route.key) {
      pricedRoute.displayRouteKey = route.key;
      pricedRoute.displayPath = route.routePath;
    }

    entries[paymentRouteKey] = pricedRoute;
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
  const bundledSellerRoutes = createBundledSellerRouteConfig();
  const expandedRoutes = createExpandedRouteConfig(payTo);
  const routeEntries = {
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
    ...expandedRoutes,
    ...bundledSellerRoutes,
  };

  return {
    ...routeEntries,
    ...createGeneratedCatalogRouteConfig(payTo, {
      existingRouteKeys: new Set(Object.keys(routeEntries)),
    }),
  };
}

function createAllowedApiRoutesMiddleware(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const matchRoute = createRouteMatcher(routes);
  const systemPrefixes = [
    "/api/system/",
  ];
  const exactPaths = new Set([
    "/api",
    "/api/sim",
  ]);

  return function allowedApiRoutesMiddleware(req, res, next) {
    if (!isProductionRuntime(env)) {
      next();
      return;
    }

    if (!String(req.path || "").startsWith("/api")) {
      next();
      return;
    }

    if (exactPaths.has(req.path) || systemPrefixes.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }

    const method = String(req.method || "").toUpperCase();
    const matchesAllowedRoute =
      Boolean(matchRoute(method, req.path))
      || (method === "HEAD" && Boolean(matchRoute("GET", req.path)))
      || ((method === "GET" || method === "HEAD") && Boolean(matchRoute("POST", req.path)));

    if (matchesAllowedRoute) {
      next();
      return;
    }

    res.status(404).json({
      success: false,
      error: "Not Found",
      code: "ENDPOINT_NOT_FOUND",
    });
  };
}

function applyRouteDiscoveryOverrides(routes = {}) {
  const entries = Object.entries(routes).map(([routeKey, config]) => {
    const override = ROUTE_DISCOVERY_OVERRIDES[routeKey];
    if (!override) {
      return [routeKey, config];
    }

    return [
      routeKey,
      {
        ...config,
        ...(override.description ? { description: override.description } : {}),
        ...(Array.isArray(override.tags) ? { tags: override.tags } : {}),
      },
    ];
  });

  return Object.fromEntries(entries);
}

const routeConfig = applyRouteDiscoveryOverrides(createRouteConfig());

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
    .filter(([key, config]) => !shouldHideRouteInProduction(getDisplayRouteKey(key, config), options))
    .filter(([key, config]) => shouldIncludeRouteInDiscovery(getDisplayRouteKey(key, config), options))
    .map(([key, config]) => {
    const displayRouteKey = getDisplayRouteKey(key, config);
    const [method, path] = String(displayRouteKey).split(" ");
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
      routeKey: displayRouteKey,
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
  const routes = options.routes || routeConfig;
  const resources = [];

  for (const [routeKey, config] of Object.entries(routes)) {
    const canonicalResourcePath =
      config?.canonicalPath
      || config?.resource
      || getPrimaryPaymentOption(config)?.resource
      || getDisplayRoutePath(routeKey, config);
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

function selectRoutes(routeKeys = [], routes = routeConfig) {
  const selected = {};

  for (const requestedRouteKey of routeKeys) {
    for (const [actualRouteKey, config] of Object.entries(routes)) {
      if (
        actualRouteKey === requestedRouteKey
        || getDisplayRouteKey(actualRouteKey, config) === requestedRouteKey
      ) {
        selected[actualRouteKey] = config;
      }
    }
  }

  return selected;
}

function getDefaultAppRoutes(payTo = PAY_TO, env = process.env) {
  const allRoutes = applyRouteDiscoveryOverrides(createRouteConfig(payTo));
  if (!isProductionRuntime(env)) {
    return allRoutes;
  }

  return selectRoutes(AURELIANFLO_ALLOWED_ROUTE_KEYS, allRoutes);
}

function buildWellKnownManifest(manifest = WELL_KNOWN_X402_AURELIAN, routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const metadata = getOriginMetadata(env);
  const hiddenRouteMatchers = options.hiddenRouteMatchers || buildHiddenRouteMatchers();
  const includeBundledSellerResources = options.includeBundledSellerResources !== false;
  const appendSimInstructions = options.appendSimInstructions !== false;
  const staticResources = Array.isArray(manifest?.resources)
    ? manifest.resources.filter(
        (resourceUrl) => !shouldHideResourceUrlInProduction(resourceUrl, { env, hiddenRouteMatchers }),
      )
    : [];
  const bundledSellerResources = includeBundledSellerResources
    ? buildBundledSellerResourceUrls({ env, hiddenRouteMatchers, routes })
    : [];
  const resources = [...new Set([...staticResources, ...bundledSellerResources])];
  const endpoints = Array.isArray(options.precomputedEndpoints)
    ? options.precomputedEndpoints
    : buildWellKnownEndpointEntries(routes, { env });
  const ownershipProofs = resolveOwnershipProofs(manifest, env);

  return {
    ...manifest,
    title: metadata.title,
    name: metadata.title,
    description: metadata.description,
    icon: `${CANONICAL_BASE_URL}/favicon.ico`,
    resources,
    ownershipProofs,
    instructions: appendSimInstructions
      ? appendSimComposabilityInstructions(manifest?.instructions)
      : String(manifest?.instructions || ""),
    endpointCount: endpoints.length,
    pricing: summarizePricing(endpoints),
    rateLimits: {
      policy: "Upstream provider limits apply per endpoint; see each endpoint.rateLimit entry.",
      enforcement: "Best effort",
    },
    sla: {
      availability: "Best effort",
      notes: "No formal uptime SLA is guaranteed.",
    },
    endpoints,
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
  const legacyTitlePattern = /^AurelianFlo$/i;
  const legacyDescriptionPattern =
    /^Professional document generation \(DOCX, XLSX, PDF\), Monte Carlo simulation, and compliance screening \(OFAC\/sanctions\/vendor due diligence\).*x402-paid$/i;
  const sanitizeMetadataValue = (value) =>
    String(value || "")
      .replace(/\uFEFF/g, "")
      .replace(/ï»¿/g, "")
      .replace(/\r?\n/g, " ")
      .trim();
  const configuredTitle = sanitizeMetadataValue(env.X402_ORIGIN_TITLE || env.X402_SITE_TITLE);
  const configuredDescription = sanitizeMetadataValue(
    env.X402_ORIGIN_DESCRIPTION || env.X402_SITE_DESCRIPTION,
  );
  const title = configuredTitle && !legacyTitlePattern.test(configuredTitle)
    ? configuredTitle
    : DEFAULT_ORIGIN_TITLE;
  const description = configuredDescription && !legacyDescriptionPattern.test(configuredDescription)
    ? configuredDescription
    : DEFAULT_ORIGIN_DESCRIPTION;

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

function getFlagshipCatalogEntries(catalog = []) {
  const byRouteKey = new Map(
    catalog
      .filter((entry) => FLAGSHIP_ROUTE_KEYS.has(entry.routeKey))
      .map((entry) => [entry.routeKey, entry]),
  );

  return FLAGSHIP_ROUTE_ORDER
    .map((routeKey) => byRouteKey.get(routeKey))
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      editorial: FLAGSHIP_ROUTE_EDITORIAL[entry.routeKey] || null,
    }));
}

function getRouteDocRequestExample(config) {
  const inputInfo = config?.extensions?.bazaar?.info?.input;
  const bodyPayload = inputInfo?.body?.body;
  if (isPlainObject(bodyPayload)) {
    return bodyPayload;
  }

  if (isPlainObject(inputInfo?.body)) {
    return inputInfo.body;
  }

  return null;
}

function getRouteDocRequestSchema(config) {
  const inputSchema = config?.extensions?.bazaar?.schema?.properties?.input;
  if (isPlainObject(inputSchema?.properties?.body)) {
    return inlineLocalSchemaRefs(inputSchema.properties.body);
  }

  if (isPlainObject(inputSchema)) {
    return inlineLocalSchemaRefs(inputSchema);
  }

  return null;
}

function getRouteDocOutputExample(config) {
  return config?.extensions?.bazaar?.info?.output?.example || null;
}

function getRouteDocOutputKind(config) {
  const outputFormatSchema =
    config?.extensions?.bazaar?.schema?.properties?.input?.properties?.body?.properties?.output_format;
  if (Array.isArray(outputFormatSchema?.enum) && outputFormatSchema.enum.length) {
    return outputFormatSchema.enum.join(" | ");
  }

  return config?.extensions?.bazaar?.info?.output?.type || "json";
}

function formatRouteDocJson(value) {
  if (value == null) {
    return "{}";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function buildRouteDocCurlExample(options = {}) {
  const method = String(options.method || "POST").toUpperCase();
  const baseUrl = String(options.baseUrl || CANONICAL_BASE_URL).replace(/\/+$/, "");
  const path = String(options.path || "/");
  const requestExample = options.requestExample ?? {};
  const lines = [
    `curl -X ${method} "${baseUrl}${path}"`,
    '  -H "Accept: application/json"',
    '  -H "Content-Type: application/json"',
    "  # include x402 settlement headers after the initial 402 challenge",
    `  -d '${JSON.stringify(requestExample, null, 2)}'`,
  ];
  return lines.join(" \\\n");
}

function buildRouteDocHtml(options = {}) {
  const baseUrl = String(options.baseUrl || CANONICAL_BASE_URL).replace(/\/+$/, "");
  const title = escapeHtml(options.title || options.path || "Endpoint");
  const description = escapeHtml(options.description || "");
  const proof = escapeHtml(options.proof || "");
  const method = escapeHtml(options.method || "POST");
  const path = escapeHtml(options.path || "/");
  const price = escapeHtml(options.price || "$0.00");
  const discipline = escapeHtml(options.discipline || options.category || "workflow");
  const outputKind = escapeHtml(options.outputKind || "json");
  const requestExample = escapeHtml(formatRouteDocJson(options.requestExample));
  const requestSchema = escapeHtml(formatRouteDocJson(options.requestSchema));
  const outputExample = escapeHtml(formatRouteDocJson(options.outputExample));
  const curlExample = escapeHtml(options.curlExample || "");
  const safeBaseUrl = escapeHtml(baseUrl);
  const jsonDocUrl = `${safeBaseUrl}${path}?format=json`;
  const apiCatalogUrl = `${safeBaseUrl}/api`;
  const openApiUrl = `${safeBaseUrl}/openapi.json`;
  const mcpDocsUrl = `${safeBaseUrl}/mcp/docs`;
  const relatedLinks = Array.isArray(options.relatedLinks) ? options.relatedLinks : [];
  const relatedLinksMarkup = relatedLinks.length
    ? relatedLinks
        .map(
          (link) => `
          <a class="link-card" href="${escapeHtml(`${safeBaseUrl}${link.href}`)}" rel="nofollow">
            <small>${escapeHtml(link.label)}</small>
            <span>${escapeHtml(link.description || "")}</span>
          </a>`,
        )
        .join("")
    : '<p class="callout">This route is documented as a standalone endpoint. Use the service catalog for adjacent workflows.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} / Endpoint Docs</title>
  <meta name="description" content="${description}" />
  <link rel="icon" href="${safeBaseUrl}/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --gold: #C8942A;
      --bright-gold: #D4A84B;
      --foundry-black: #1A1A1A;
      --deep-charcoal: #121210;
      --parchment: #F5F0E8;
      --line: rgba(212, 168, 75, 0.24);
      --panel: rgba(245, 240, 232, 0.055);
      --panel-strong: rgba(245, 240, 232, 0.08);
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
      --max-width: 1240px;
    }

    * { box-sizing: border-box; }

    html {
      background:
        radial-gradient(circle at top left, rgba(212, 168, 75, 0.18), transparent 30%),
        linear-gradient(180deg, #181816 0%, #121210 60%, #151410 100%);
      color: var(--parchment);
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--parchment);
      background:
        linear-gradient(135deg, rgba(200, 148, 42, 0.045) 0%, transparent 24%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, transparent 100%);
    }

    a { color: inherit; }

    .page {
      width: min(var(--max-width), calc(100vw - 36px));
      margin: 0 auto;
      padding: 34px 0 72px;
    }

    .rule {
      height: 1px;
      width: 100%;
      background: linear-gradient(90deg, transparent 0%, var(--bright-gold) 16%, var(--bright-gold) 84%, transparent 100%);
      margin: 20px 0 30px;
    }

    .hero,
    .section-head,
    .rail-grid {
      display: grid;
      gap: 28px;
    }

    .hero {
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      align-items: end;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: var(--bright-gold);
      font-size: 0.78rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      margin-bottom: 20px;
    }

    .eyebrow::before {
      content: "";
      width: 52px;
      height: 1px;
      background: currentColor;
    }

    h1,
    h2,
    h3 {
      margin: 0;
      font-family: "Cormorant Garamond", Georgia, serif;
      letter-spacing: -0.02em;
      font-weight: 600;
    }

    h1 {
      font-size: clamp(3.4rem, 8vw, 5.9rem);
      line-height: 0.95;
    }

    h2 {
      font-size: clamp(1.8rem, 3vw, 2.5rem);
      margin-bottom: 16px;
    }

    p {
      margin: 0;
      color: rgba(245, 240, 232, 0.8);
      line-height: 1.72;
    }

    .lede {
      margin-top: 24px;
      max-width: 760px;
      font-size: 1.05rem;
    }

    .meta-card,
    .section,
    .note-card,
    .link-card {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(0, 0, 0, 0.04));
      box-shadow: var(--shadow);
    }

    .meta-card {
      padding: 28px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 16px;
      margin-top: 16px;
    }

    .meta-item small,
    .link-card small {
      display: block;
      color: rgba(245, 240, 232, 0.5);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 0.68rem;
      margin-bottom: 8px;
    }

    .meta-item b {
      color: var(--bright-gold);
      font-size: 1rem;
      font-weight: 700;
    }

    .meta-item span,
    .link-card span {
      display: block;
      color: rgba(245, 240, 232, 0.82);
      line-height: 1.55;
    }

    .section {
      padding: 28px;
      margin-top: 30px;
    }

    .section-head p {
      max-width: 760px;
    }

    .rail-grid {
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      align-items: start;
    }

    .callout {
      border-left: 2px solid var(--bright-gold);
      padding-left: 16px;
      margin-top: 18px;
      color: rgba(245, 240, 232, 0.78);
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      color: rgba(245, 240, 232, 0.9);
    }

    .code-block {
      padding: 18px;
      background: rgba(12, 12, 10, 0.72);
      border: 1px solid rgba(245, 240, 232, 0.08);
      overflow: auto;
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .link-stack {
      display: grid;
      gap: 12px;
    }

    .link-card {
      padding: 18px;
      text-decoration: none;
      transition: transform 180ms ease, border-color 180ms ease;
    }

    .link-card:hover {
      transform: translateX(4px);
      border-color: rgba(212, 168, 75, 0.4);
    }

    .footer-note {
      margin-top: 40px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      color: rgba(245, 240, 232, 0.58);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.82rem;
    }

    @media (max-width: 1040px) {
      .hero,
      .rail-grid,
      .section-head {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .page {
        width: min(100vw - 22px, var(--max-width));
        padding: 22px 0 50px;
      }

      h1 {
        font-size: clamp(3rem, 15vw, 4.8rem);
      }

      .meta-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="rule"></div>

    <section class="hero">
      <div>
        <div class="eyebrow">${discipline}</div>
        <h1>${title}</h1>
        <p class="lede">${description}</p>
        <p class="callout">Browser note: GET on this URL serves human-readable docs. Paid execution still requires <strong>${method}</strong> with x402 settlement.</p>
        ${proof ? `<p class="callout">${proof}</p>` : ""}
      </div>

      <aside class="meta-card">
        <h3>Route summary</h3>
        <div class="meta-grid">
          <div class="meta-item">
            <small>Method</small>
            <b>${method}</b>
            <span>${path}</span>
          </div>
          <div class="meta-item">
            <small>Price</small>
            <b>${price}</b>
            <span>x402 on Base</span>
          </div>
          <div class="meta-item">
            <small>Category</small>
            <b>${discipline}</b>
            <span>Public discovery route</span>
          </div>
          <div class="meta-item">
            <small>Output</small>
            <b>${outputKind}</b>
            <span>See example below</span>
          </div>
        </div>
      </aside>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2>Example request body</h2>
          <p>Use this payload shape for the paid ${method} call.</p>
        </div>
      </div>
      <div class="code-block"><pre>${requestExample}</pre></div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2>Request schema</h2>
          <p>The canonical body contract as exposed through discovery and OpenAPI.</p>
        </div>
      </div>
      <div class="code-block"><pre>${requestSchema}</pre></div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2>Example response</h2>
          <p>A representative output payload for the route.</p>
        </div>
      </div>
      <div class="code-block"><pre>${outputExample}</pre></div>
    </section>

    <section class="section rail-grid">
      <div class="stack">
        <div>
          <h2>cURL</h2>
          <p>Use this as the starting point for HTTP execution after the initial 402 challenge.</p>
        </div>
        <div class="code-block"><pre>${curlExample}</pre></div>
      </div>

      <aside class="stack">
        <div>
          <h2>Links</h2>
          <p>Canonical docs and machine-readable surfaces for this route.</p>
        </div>
        <div class="link-stack">
          <a class="link-card" href="${jsonDocUrl}" rel="nofollow">
            <small>JSON docs</small>
            <span>Route-level machine-readable docs.</span>
          </a>
          <a class="link-card" href="${apiCatalogUrl}" rel="nofollow">
            <small>Service catalog</small>
            <span>Featured public routes at <code>/api</code>.</span>
          </a>
          <a class="link-card" href="${openApiUrl}" rel="nofollow">
            <small>OpenAPI</small>
            <span>Canonical OpenAPI contract for HTTP clients.</span>
          </a>
          <a class="link-card" href="${mcpDocsUrl}" rel="nofollow">
            <small>MCP docs</small>
            <span>Remote MCP surface for agent-first access.</span>
          </a>
        </div>
      </aside>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2>Related routes</h2>
          <p>Use these when you want the lower-level primitive, the buyer-facing memo workflow, or the agent install surface around this endpoint.</p>
        </div>
      </div>
      <div class="link-stack">
        ${relatedLinksMarkup}
      </div>
    </section>

    <footer class="footer-note">
      <span>${method} docs page</span>
      <span>${path}</span>
      <span>${price}</span>
      <span>x402 / Base / USDC</span>
    </footer>
  </main>
</body>
</html>`;
}

function createRouteDocsHandler(routeKey, config, options = {}) {
  return function routeDocsHandler(req, res) {
    const env = options.env || process.env;
    const baseUrl = getRequestBaseUrl(req);
    const catalogEntry = buildCatalogEntries(
      { [routeKey]: config },
      {
        includeDiscoveryFields: true,
        env,
        discoveryScope: "full",
      },
    )[0];

    if (!catalogEntry) {
      return res.status(404).json({
        success: false,
        error: "Route docs unavailable",
      });
    }

    const requestExample = getRouteDocRequestExample(config);
    const requestSchema = getRouteDocRequestSchema(config);
    const outputExample = getRouteDocOutputExample(config);
    const editorial = FLAGSHIP_ROUTE_EDITORIAL[catalogEntry.routeKey] || null;
    const payload = {
      title: editorial?.title || catalogEntry.path,
      routeKey: catalogEntry.routeKey,
      method: catalogEntry.method,
      path: catalogEntry.path,
      description: catalogEntry.description,
      proof: editorial?.proof || "",
      discipline: editorial?.discipline || catalogEntry.category,
      category: catalogEntry.category,
      price: catalogEntry.price,
      outputKind: getRouteDocOutputKind(config),
      docsOnlyGet: true,
      requestExample,
      requestSchema,
      outputExample,
      relatedLinks: ROUTE_DOC_RELATED_LINKS[catalogEntry.routeKey] || [],
      curlExample: buildRouteDocCurlExample({
        method: catalogEntry.method,
        baseUrl,
        path: catalogEntry.path,
        requestExample,
      }),
      links: {
        apiCatalog: `${baseUrl}/api`,
        openApi: `${baseUrl}/openapi.json`,
        mcpDocs: `${baseUrl}/mcp/docs`,
      },
    };

    if (String(req.query?.format || "").toLowerCase() === "json" || !shouldRenderHealthHtml(req)) {
      return res.json(payload);
    }

    const html = buildRouteDocHtml({
      ...payload,
      baseUrl,
    });
    return res.type("text/html; charset=utf-8").send(html);
  };
}

function mountPublicPostRouteDocs(target, routes = routeConfig, options = {}) {
  for (const [routeKey, config] of Object.entries(routes)) {
    const displayRouteKey = getDisplayRouteKey(routeKey, config);
    const [method = "GET"] = String(displayRouteKey).split(" ");
    if (method.toUpperCase() !== "POST") {
      continue;
    }

    if (
      shouldHideRouteInProduction(displayRouteKey, options)
      || !shouldIncludeRouteInDiscovery(displayRouteKey, {
        ...options,
        discoveryScope: "public",
      })
    ) {
      continue;
    }

    const routePath = getDisplayRoutePath(routeKey, config);
    if (
      !routePath
      || routePath.includes("*")
      || Object.prototype.hasOwnProperty.call(routes, `GET ${routePath}`)
    ) {
      continue;
    }

    target.get(routePath, createRouteDocsHandler(routeKey, config, options));
  }
}

function buildMcpDocHtml({ title, summary, sections = [], links = [] }) {
  const safeTitle = escapeHtml(title || "AurelianFlo");
  const safeSummary = escapeHtml(summary || "");
  const sectionsMarkup = sections
    .map((section) => {
      const heading = escapeHtml(section.heading || "");
      const items = Array.isArray(section.items) ? section.items : [];
      const itemsMarkup = items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<section class="doc-section"><h2>${heading}</h2><ul>${itemsMarkup}</ul></section>`;
    })
    .join("");
  const linksMarkup = links
    .map(
      (link) => `
        <a href="${escapeHtml(link.href || "#")}" rel="nofollow">
          <small>${escapeHtml(link.label || "")}</small>
          <span>${escapeHtml(link.value || "")}</span>
        </a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --gold: #C8942A;
      --bright-gold: #D4A84B;
      --parchment: #F5F0E8;
      --bg: #121210;
      --panel: rgba(245, 240, 232, 0.05);
      --line: rgba(212, 168, 75, 0.28);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: linear-gradient(180deg, #181816 0%, #121210 100%); color: var(--parchment); font-family: "Manrope", "Segoe UI", sans-serif; }
    body { padding: 28px 18px 56px; }
    .page { width: min(980px, 100%); margin: 0 auto; }
    .rule { height: 1px; background: linear-gradient(90deg, transparent 0%, var(--bright-gold) 18%, var(--bright-gold) 82%, transparent 100%); margin: 18px 0 26px; }
    h1, h2 { font-family: "Georgia", serif; font-weight: 600; letter-spacing: -0.02em; }
    h1 { margin: 0 0 10px; font-size: clamp(2.4rem, 6vw, 3.6rem); }
    h2 { margin: 0 0 14px; font-size: 1.5rem; }
    .summary { margin: 0 0 28px; color: rgba(245, 240, 232, 0.74); line-height: 1.7; max-width: 52rem; }
    .link-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .link-grid a { text-decoration: none; color: inherit; border: 1px solid rgba(245, 240, 232, 0.08); background: var(--panel); padding: 15px 16px; }
    .link-grid small { display: block; color: var(--bright-gold); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.68rem; margin-bottom: 6px; }
    .link-grid span { font-size: 0.92rem; line-height: 1.5; word-break: break-word; }
    .doc-section { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 22px; }
    ul { margin: 0; padding-left: 18px; color: rgba(245, 240, 232, 0.86); line-height: 1.7; }
    li + li { margin-top: 8px; }
  </style>
</head>
<body>
  <main class="page">
    <div class="rule"></div>
    <h1>${safeTitle}</h1>
    <p class="summary">${safeSummary}</p>
    <div class="link-grid">${linksMarkup}</div>
    ${sectionsMarkup}
  </main>
</body>
</html>`;
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
  const safeBaseUrl = escapeHtml(baseUrl);
  const endpointCount = Number(options.endpointCount || 0);
  const catalogUrl = `${safeBaseUrl}/api`;
  const openApiUrl = `${safeBaseUrl}/openapi.json`;
  const mcpUrl = `${safeBaseUrl}/mcp`;
  const serverCardUrl = `${safeBaseUrl}/.well-known/mcp/server-card.json`;
  const ctaMarkup = PRIMARY_NAV_ITEMS.map((item) => {
    const href = item.href === "catalog"
      ? catalogUrl
      : item.href === "openapi"
        ? openApiUrl
        : escapeHtml(String(item.href || "").replace(/\/+$/, ""));
    const variant = String(item.variant || "secondary");
    return `<a class="btn btn-${variant}" href="${href}" rel="nofollow">${escapeHtml(item.label || "")}</a>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${safeBaseUrl}/" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${safeBaseUrl}/icon.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${safeBaseUrl}/" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${safeBaseUrl}/icon.png" />
  <link rel="alternate" type="application/json" href="${catalogUrl}" />
  <link rel="icon" href="${safeBaseUrl}/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --gold: #C8942A;
      --bright-gold: #D4A84B;
      --foundry-black: #1A1A1A;
      --deep-charcoal: #121210;
      --parchment: #F5F0E8;
      --slate: #4A4A4A;
      --warm-gray: #8C857A;
      --light-slate: #A8A29E;
      --signal-red: #C44536;
      --forge-green: #3D7A4A;
      --line: rgba(212, 168, 75, 0.45);
      --panel: rgba(245, 240, 232, 0.055);
      --panel-strong: rgba(245, 240, 232, 0.08);
      --shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
      --max-width: 1220px;
    }

    * { box-sizing: border-box; }

    html {
      background:
        radial-gradient(circle at top left, rgba(212, 168, 75, 0.18), transparent 30%),
        radial-gradient(circle at 82% 12%, rgba(245, 240, 232, 0.09), transparent 26%),
        linear-gradient(180deg, #181816 0%, #121210 56%, #161512 100%);
      color: var(--parchment);
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--parchment);
      background:
        linear-gradient(135deg, rgba(200, 148, 42, 0.04) 0%, transparent 24%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, transparent 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.085;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.2) 1px, transparent 1px);
      background-size: 120px 120px;
      mask-image: radial-gradient(circle at center, black 34%, transparent 100%);
    }

    a { color: inherit; }

    .page {
      width: min(var(--max-width), calc(100vw - 40px));
      margin: 0 auto;
      padding: 42px 0 80px;
      position: relative;
    }

    .topline,
    .section-rule {
      height: 1px;
      width: 100%;
      background: linear-gradient(90deg, transparent 0%, var(--bright-gold) 18%, var(--bright-gold) 82%, transparent 100%);
      opacity: 0.95;
    }

    .topline {
      margin: 24px 0 34px;
      animation: revealRule 1.2s ease forwards;
      transform-origin: left center;
      transform: scaleX(0.2);
    }

    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
      gap: 34px;
      align-items: end;
      padding: 18px 0 26px;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: var(--bright-gold);
      font-size: 0.78rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      margin-bottom: 22px;
    }

    .eyebrow::before {
      content: "";
      width: 52px;
      height: 1px;
      background: currentColor;
      opacity: 0.7;
    }

    .headline {
      margin: 0;
      max-width: 12ch;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-weight: 600;
      font-size: clamp(4rem, 9vw, 6.75rem);
      line-height: 0.92;
      letter-spacing: -0.04em;
      text-wrap: balance;
      animation: riseIn 0.95s ease forwards;
    }

    .lede {
      margin: 24px 0 0;
      max-width: 44rem;
      color: rgba(245, 240, 232, 0.78);
      font-size: clamp(1.08rem, 1.8vw, 1.22rem);
      line-height: 1.72;
      animation: riseIn 1.1s ease forwards;
    }

    .signal-panel {
      padding: 26px 24px;
      border: 1px solid rgba(212, 168, 75, 0.28);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.01)),
        rgba(18, 18, 16, 0.72);
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
      animation: riseIn 1.2s ease forwards;
    }

    .signal-panel::after {
      content: "";
      position: absolute;
      inset: auto -40px -42px auto;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(212, 168, 75, 0.2), transparent 68%);
    }

    .signal-label {
      color: var(--bright-gold);
      font-size: 0.76rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }

    .signal-value {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: clamp(2.4rem, 4.2vw, 3.2rem);
      line-height: 1;
      margin: 0 0 10px;
    }

    .signal-copy {
      margin: 0;
      color: rgba(245, 240, 232, 0.68);
      line-height: 1.7;
      font-size: 0.98rem;
    }

    .signal-grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .signal-stat {
      padding-top: 14px;
      border-top: 1px solid rgba(245, 240, 232, 0.12);
    }

    .signal-stat strong {
      display: block;
      color: var(--parchment);
      font-size: 0.94rem;
      margin-bottom: 4px;
    }

    .signal-stat span {
      color: rgba(245, 240, 232, 0.6);
      font-size: 0.88rem;
    }

    .cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin: 30px 0 0;
      animation: riseIn 1.25s ease forwards;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 15px 22px;
      min-height: 52px;
      border: 1px solid transparent;
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.76rem;
      font-weight: 700;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease, color 180ms ease;
    }

    .btn:hover {
      transform: translateY(-2px);
    }

    .btn-primary {
      background: var(--bright-gold);
      color: var(--deep-charcoal);
      box-shadow: 0 14px 30px rgba(212, 168, 75, 0.18);
    }

    .btn-secondary {
      background: transparent;
      border-color: rgba(245, 240, 232, 0.18);
      color: var(--parchment);
    }

    .btn-tertiary {
      background: rgba(245, 240, 232, 0.05);
      border-color: rgba(212, 168, 75, 0.22);
      color: var(--bright-gold);
    }

    .kicker-row {
      margin-top: 22px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      color: rgba(245, 240, 232, 0.6);
      font-size: 0.88rem;
    }

    .kicker-pill {
      border: 1px solid rgba(245, 240, 232, 0.1);
      padding: 10px 12px;
      background: rgba(245, 240, 232, 0.03);
    }

    .section {
      margin-top: 58px;
      padding-top: 30px;
    }

    .section-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 0.7fr);
      gap: 24px;
      align-items: end;
      margin-bottom: 26px;
    }

    .section-title {
      margin: 0;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: clamp(2.3rem, 4vw, 3.4rem);
      line-height: 0.98;
      letter-spacing: -0.03em;
    }

    .section-copy {
      margin: 0;
      color: rgba(245, 240, 232, 0.7);
      line-height: 1.75;
      font-size: 1rem;
    }

    .discipline-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.95fr 0.9fr;
      gap: 18px;
    }

    .discipline {
      min-height: 260px;
      padding: 22px 22px 20px;
      border: 1px solid rgba(245, 240, 232, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
        var(--panel);
      position: relative;
      overflow: hidden;
    }

    .discipline:nth-child(1) { transform: translateY(0); }
    .discipline:nth-child(2) { transform: translateY(28px); }
    .discipline:nth-child(3) { transform: translateY(56px); }

    .discipline::before {
      content: "";
      position: absolute;
      inset: 0 auto auto 0;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, var(--bright-gold), transparent);
      opacity: 0.88;
    }

    .discipline-label {
      color: var(--bright-gold);
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 0.74rem;
      margin-bottom: 18px;
    }

    .discipline h3 {
      margin: 0 0 14px;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 2.1rem;
      line-height: 0.96;
    }

    .discipline p {
      margin: 0 0 20px;
      color: rgba(245, 240, 232, 0.74);
      line-height: 1.74;
      font-size: 0.98rem;
      max-width: 28rem;
    }

    .discipline ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }

    .discipline li {
      color: rgba(245, 240, 232, 0.84);
      font-size: 0.92rem;
      padding-left: 15px;
      position: relative;
    }

    .discipline li::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0.62em;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--bright-gold);
    }

    .split-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
      gap: 22px;
      align-items: stretch;
    }

    .editorial-panel,
    .link-panel {
      border: 1px solid rgba(245, 240, 232, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
        var(--panel-strong);
      padding: 24px;
      box-shadow: var(--shadow);
    }

    .editorial-panel h3,
    .link-panel h3 {
      margin: 0 0 16px;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 2rem;
      line-height: 1;
    }

    .editorial-panel p,
    .link-panel p {
      margin: 0 0 18px;
      color: rgba(245, 240, 232, 0.72);
      line-height: 1.75;
    }

    .list-grid {
      display: grid;
      gap: 14px;
    }

    .list-row {
      display: grid;
      grid-template-columns: 118px minmax(0, 1fr);
      gap: 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(245, 240, 232, 0.08);
    }

    .list-row strong {
      color: var(--bright-gold);
      text-transform: uppercase;
      font-size: 0.72rem;
      letter-spacing: 0.16em;
      line-height: 1.5;
    }

    .list-row span {
      color: rgba(245, 240, 232, 0.82);
      line-height: 1.65;
      font-size: 0.94rem;
    }

    .link-stack {
      display: grid;
      gap: 12px;
      margin-top: 10px;
    }

    .link-stack a {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 16px 18px;
      text-decoration: none;
      border: 1px solid rgba(245, 240, 232, 0.08);
      background: rgba(18, 18, 16, 0.54);
      transition: border-color 180ms ease, transform 180ms ease, color 180ms ease;
    }

    .link-stack a:hover {
      border-color: rgba(212, 168, 75, 0.4);
      transform: translateX(4px);
      color: var(--bright-gold);
    }

    .link-stack small {
      display: block;
      color: rgba(245, 240, 232, 0.5);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .link-stack span {
      font-size: 0.98rem;
      line-height: 1.4;
      text-wrap: balance;
    }

    .link-stack b {
      font-size: 1.1rem;
      font-weight: 500;
    }

    .footer-note {
      margin-top: 58px;
      padding-top: 26px;
      border-top: 1px solid rgba(212, 168, 75, 0.24);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px 24px;
      color: rgba(245, 240, 232, 0.56);
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    @keyframes riseIn {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes revealRule {
      from { transform: scaleX(0.2); opacity: 0.2; }
      to { transform: scaleX(1); opacity: 1; }
    }

    @media (max-width: 1040px) {
      .masthead,
      .section-header,
      .split-layout,
      .discipline-grid {
        grid-template-columns: 1fr;
      }

      .discipline:nth-child(1),
      .discipline:nth-child(2),
      .discipline:nth-child(3) {
        transform: none;
      }

      .headline {
        max-width: 14ch;
      }
    }

    @media (max-width: 720px) {
      .page {
        width: min(100vw - 24px, var(--max-width));
        padding: 24px 0 52px;
      }

      .headline {
        font-size: clamp(3.1rem, 15vw, 4.8rem);
      }

      .signal-grid,
      .list-row {
        grid-template-columns: 1fr;
      }

      .btn {
        width: 100%;
      }

      .footer-note {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="topline"></div>

    <section class="masthead">
      <div>
        <div class="eyebrow">AurelianFlo</div>
        <h1 class="headline">${title}</h1>
        <p class="lede">${escapeHtml(HEALTH_PAGE_LEDE)}</p>
        <p class="section-copy">${escapeHtml(HOME_PAGE_AUDIENCE)}</p>
        <p class="section-copy">${escapeHtml(HOME_PAGE_VALUE_PROP)}</p>
        <div class="cta-row">${ctaMarkup}</div>
        <div class="kicker-row">
          <div class="kicker-pill">USDC on Base</div>
          <div class="kicker-pill">Works with AI agents via MCP</div>
          <div class="kicker-pill">No API keys required</div>
        </div>
      </div>

      <aside class="signal-panel">
        <div class="signal-label">Service</div>
        <p class="signal-value">${endpointCount}</p>
        <p class="signal-copy">Primary public surface.</p>
        <div class="signal-grid">
          <div class="signal-stat">
            <strong>Compliance</strong>
            <span>EDD memos and OFAC wallet screening.</span>
          </div>
          <div class="signal-stat">
            <strong>Reports</strong>
            <span>EDD memos, screening packets, and review-ready report artifacts.</span>
          </div>
          <div class="signal-stat">
            <strong>Documents</strong>
            <span>PDF, DOCX, and XLSX document output for review and handoff.</span>
          </div>
          <div class="signal-stat">
            <strong>Protocol</strong>
            <span>x402 over HTTP and MCP.</span>
          </div>
        </div>
      </aside>
    </section>

    <section class="section">
      <div class="section-rule"></div>
      <div class="section-header">
        <h2 class="section-title">Core services.</h2>
        <p class="section-copy">Compliance review, wallet screening, and document output.</p>
      </div>
      <div class="discipline-grid">
        <article class="discipline">
          <div class="discipline-label">01 / Compliance</div>
          <h3>EDD memo.</h3>
          <ul>
            <li>Lead endpoint: POST /api/workflows/compliance/edd-report</li>
            <li>Status labels, evidence summary, and required follow-up</li>
            <li>One-call JSON, PDF, or DOCX output for audit handoff</li>
          </ul>
        </article>
        <article class="discipline">
          <div class="discipline-label">02 / Compliance</div>
          <h3>Wallet screening primitives.</h3>
          <ul>
            <li>Lead endpoints: POST /api/workflows/compliance/batch-wallet-screen and GET /api/ofac-wallet-screen/:address</li>
            <li>Low-cost checks for agent and operations workflows</li>
            <li>Best used directly or underneath the EDD memo workflow</li>
          </ul>
        </article>
        <article class="discipline">
          <div class="discipline-label">03 / Compliance</div>
          <h3>Single-wallet report bundle.</h3>
          <ul>
            <li>Lead endpoint: POST /api/workflows/compliance/wallet-sanctions-report</li>
            <li>One-wallet screening with a reusable report payload underneath</li>
            <li>Useful when you want a screening packet before final artifact rendering</li>
          </ul>
        </article>
        <article class="discipline">
          <div class="discipline-label">04 / Documents</div>
          <h3>Report artifacts.</h3>
          <ul>
            <li>Lead endpoints: POST /api/tools/report/pdf/generate, POST /api/tools/report/docx/generate, and POST /api/tools/report/xlsx/generate</li>
            <li>Fixed-layout, editable, and workbook handoff artifacts</li>
            <li>Used directly for compliance workflows and retained report payloads</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="section">
      <div class="section-rule"></div>
      <div class="split-layout">
        <article class="editorial-panel">
          <h3>Sequence.</h3>
          <div class="list-grid">
            <div class="list-row">
              <strong>Scope</strong>
              <span>EDD memos, wallet screening, and document generation.</span>
            </div>
            <div class="list-row">
              <strong>Flow</strong>
              <span>Review, screen, document, deliver.</span>
            </div>
            <div class="list-row">
              <strong>Output</strong>
              <span>JSON, PDF, DOCX, and XLSX.</span>
            </div>
          </div>
        </article>

        <aside class="link-panel">
          <h3>Discovery rails</h3>
          <div class="link-stack">
            <a href="${catalogUrl}" rel="nofollow">
              <div>
                <small>Catalog</small>
                <span>Browser catalog for core services.</span>
              </div>
              <b>API</b>
            </a>
            <a href="${openApiUrl}" rel="nofollow">
              <div>
                <small>Schema</small>
                <span>Canonical OpenAPI contract for HTTP clients and discovery tools.</span>
              </div>
              <b>JSON</b>
            </a>
            <a href="${mcpUrl}" rel="nofollow">
              <div>
                <small>Remote MCP</small>
                <span>Streamable MCP endpoint for Claude-compatible tool access.</span>
              </div>
              <b>/mcp</b>
            </a>
            <a href="${serverCardUrl}" rel="nofollow">
              <div>
                <small>Server Card</small>
                <span>Static MCP metadata for review, scanning, and connector setup.</span>
              </div>
              <b>MCP</b>
            </a>
          </div>
        </aside>
      </div>
    </section>

    <footer class="footer-note">
      <span>${endpointCount} public routes</span>
      <span>Base / USDC / x402</span>
      <span>AurelianFlo</span>
    </footer>
  </main>
</body>
</html>`;
}

function buildApiDiscoveryHtml(options = {}) {
  const title = escapeHtml(options.title || DEFAULT_ORIGIN_TITLE);
  const description = escapeHtml(options.description || DESCRIPTION_MEDIUM);
  const baseUrl = String(options.baseUrl || CANONICAL_BASE_URL).replace(/\/+$/, "");
  const safeBaseUrl = escapeHtml(baseUrl);
  const openApiUrl = `${safeBaseUrl}/openapi.json`;
  const jsonCatalogUrl = `${safeBaseUrl}/api?format=json`;
  const fullDiscoveryUrl = `${safeBaseUrl}/api/system/discovery/full?format=json`;
  const mcpUrl = `${safeBaseUrl}/mcp`;
  const serverCardUrl = `${safeBaseUrl}/.well-known/mcp/server-card.json`;
  const flagshipEntries = Array.isArray(options.flagshipEntries) ? options.flagshipEntries : [];
  const endpointCount = Number(options.endpointCount || 0);
  const featuredCount = flagshipEntries.length;
  const cardsMarkup = flagshipEntries
    .map((entry) => {
      const editorial = entry.editorial || {};
      const titleText = escapeHtml(editorial.title || entry.path);
      const discipline = escapeHtml(editorial.discipline || entry.category || "Flagship");
      const sequence = escapeHtml(editorial.sequence || "");
      const summary = escapeHtml(editorial.summary || entry.description || "");
      const method = escapeHtml(entry.method || "");
      const routePath = escapeHtml(entry.path || "");
      const price = escapeHtml(entry.price || "$0.00");
      const examplePath = escapeHtml(entry.examplePath || entry.path || "");
      const exampleUrl = escapeHtml(entry.exampleUrl || `${safeBaseUrl}${entry.examplePath || entry.path || ""}`);
      const routeActionLabel = entry.method === "GET" ? "Inspect example" : "Open docs";
      const routePathLabel = entry.method === "GET" ? "Example path" : "Docs path";

      return `
        <article class="flagship-card">
          <div class="flagship-topline">
            <span>${sequence}</span>
            <strong>${discipline}</strong>
          </div>
          <h2>${titleText}</h2>
          <p class="flagship-summary">${summary}</p>
          <div class="route-meta">
            <span class="method">${method}</span>
            <code>${routePath}</code>
            <b>${price}</b>
          </div>
          <div class="route-foot">
            <div>
              <small>${routePathLabel}</small>
              <span>${examplePath}</span>
            </div>
            <a href="${exampleUrl}" rel="nofollow">${routeActionLabel}</a>
          </div>
        </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} / Flagship Catalog</title>
  <meta name="description" content="${description}" />
  <link rel="icon" href="${safeBaseUrl}/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --gold: #C8942A;
      --bright-gold: #D4A84B;
      --foundry-black: #1A1A1A;
      --deep-charcoal: #121210;
      --parchment: #F5F0E8;
      --slate: #4A4A4A;
      --warm-gray: #8C857A;
      --line: rgba(212, 168, 75, 0.3);
      --panel: rgba(245, 240, 232, 0.055);
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
      --max-width: 1220px;
    }

    * { box-sizing: border-box; }

    html {
      background:
        radial-gradient(circle at top left, rgba(212, 168, 75, 0.18), transparent 30%),
        linear-gradient(180deg, #181816 0%, #121210 60%, #151410 100%);
      color: var(--parchment);
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--parchment);
      background:
        linear-gradient(135deg, rgba(200, 148, 42, 0.045) 0%, transparent 24%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, transparent 100%);
    }

    a { color: inherit; }

    .page {
      width: min(var(--max-width), calc(100vw - 36px));
      margin: 0 auto;
      padding: 34px 0 72px;
    }

    .rule {
      height: 1px;
      width: 100%;
      background: linear-gradient(90deg, transparent 0%, var(--bright-gold) 16%, var(--bright-gold) 84%, transparent 100%);
      margin: 20px 0 30px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 28px;
      align-items: end;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: var(--bright-gold);
      font-size: 0.78rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      margin-bottom: 20px;
    }

    .eyebrow::before {
      content: "";
      width: 52px;
      height: 1px;
      background: currentColor;
      opacity: 0.7;
    }

    h1 {
      margin: 0;
      max-width: 10ch;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-weight: 600;
      font-size: clamp(3.5rem, 8vw, 5.6rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
    }

    .lede {
      margin: 22px 0 0;
      max-width: 44rem;
      color: rgba(245, 240, 232, 0.76);
      font-size: clamp(1.02rem, 1.8vw, 1.18rem);
      line-height: 1.76;
    }

    .hero-panel,
    .context-panel,
    .rail-panel {
      border: 1px solid rgba(245, 240, 232, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
        var(--panel);
      box-shadow: var(--shadow);
    }

    .hero-panel {
      padding: 24px;
    }

    .hero-panel strong {
      display: block;
      color: var(--bright-gold);
      text-transform: uppercase;
      letter-spacing: 0.2em;
      font-size: 0.74rem;
      margin-bottom: 14px;
    }

    .hero-panel p {
      margin: 0;
      color: rgba(245, 240, 232, 0.72);
      line-height: 1.74;
    }

    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 18px;
    }

    .hero-metrics div {
      padding-top: 14px;
      border-top: 1px solid rgba(245, 240, 232, 0.1);
    }

    .hero-metrics b {
      display: block;
      font-size: 1.05rem;
      margin-bottom: 4px;
    }

    .hero-metrics span {
      color: rgba(245, 240, 232, 0.56);
      font-size: 0.86rem;
    }

    .cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 28px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 50px;
      padding: 14px 20px;
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.74rem;
      font-weight: 800;
      border: 1px solid transparent;
      transition: transform 180ms ease, border-color 180ms ease, color 180ms ease;
    }

    .btn:hover { transform: translateY(-2px); }

    .btn-primary {
      background: var(--bright-gold);
      color: var(--deep-charcoal);
      box-shadow: 0 14px 30px rgba(212, 168, 75, 0.18);
    }

    .btn-secondary {
      border-color: rgba(245, 240, 232, 0.16);
      background: transparent;
    }

    .section {
      margin-top: 54px;
    }

    .section-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 0.76fr);
      gap: 24px;
      align-items: end;
      margin-bottom: 24px;
    }

    .section-head h2 {
      margin: 0;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: clamp(2.2rem, 4vw, 3.4rem);
      line-height: 0.98;
      letter-spacing: -0.03em;
    }

    .section-head p {
      margin: 0;
      color: rgba(245, 240, 232, 0.68);
      line-height: 1.74;
    }

    .flagship-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }

    .flagship-card {
      padding: 24px;
      border: 1px solid rgba(245, 240, 232, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
        rgba(18, 18, 16, 0.72);
      position: relative;
      overflow: hidden;
    }

    .flagship-card::before {
      content: "";
      position: absolute;
      inset: 0 auto auto 0;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, var(--bright-gold), transparent);
    }

    .flagship-topline {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
      margin-bottom: 16px;
      color: var(--bright-gold);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 0.72rem;
    }

    .flagship-card h2 {
      margin: 0 0 14px;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 2rem;
      line-height: 0.98;
    }

    .flagship-summary,
    .flagship-proof {
      margin: 0;
      color: rgba(245, 240, 232, 0.74);
      line-height: 1.72;
      font-size: 0.96rem;
    }

    .flagship-proof {
      margin-top: 16px;
      color: rgba(245, 240, 232, 0.62);
    }

    .route-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 12px;
      align-items: center;
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(245, 240, 232, 0.08);
    }

    .method,
    .route-meta b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid rgba(212, 168, 75, 0.2);
      background: rgba(212, 168, 75, 0.09);
      color: var(--bright-gold);
      font-size: 0.74rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .route-meta code {
      color: var(--parchment);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
      word-break: break-word;
    }

    .route-foot {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(245, 240, 232, 0.08);
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
    }

    .route-foot small {
      display: block;
      color: rgba(245, 240, 232, 0.48);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 0.68rem;
      margin-bottom: 6px;
    }

    .route-foot span {
      color: rgba(245, 240, 232, 0.82);
      font-size: 0.9rem;
      word-break: break-word;
    }

    .route-foot a {
      white-space: nowrap;
      text-decoration: none;
      color: var(--bright-gold);
      font-size: 0.84rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .lower-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 0.8fr);
      gap: 20px;
    }

    .context-panel,
    .rail-panel {
      padding: 24px;
    }

    .context-panel h3,
    .rail-panel h3 {
      margin: 0 0 16px;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 2rem;
      line-height: 1;
    }

    .context-panel p,
    .rail-panel p {
      margin: 0 0 18px;
      color: rgba(245, 240, 232, 0.7);
      line-height: 1.74;
    }

    .bullet-list {
      display: grid;
      gap: 14px;
    }

    .bullet {
      padding-top: 14px;
      border-top: 1px solid rgba(245, 240, 232, 0.08);
    }

    .bullet strong {
      display: block;
      color: var(--bright-gold);
      font-size: 0.76rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .bullet span {
      color: rgba(245, 240, 232, 0.82);
      line-height: 1.68;
      font-size: 0.94rem;
    }

    .rail-stack {
      display: grid;
      gap: 12px;
      margin-top: 10px;
    }

    .rail-stack a {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      padding: 16px 18px;
      border: 1px solid rgba(245, 240, 232, 0.08);
      background: rgba(18, 18, 16, 0.56);
      text-decoration: none;
      transition: transform 180ms ease, border-color 180ms ease;
    }

    .rail-stack a:hover {
      transform: translateX(4px);
      border-color: rgba(212, 168, 75, 0.4);
    }

    .rail-stack small {
      display: block;
      color: rgba(245, 240, 232, 0.48);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.68rem;
      margin-bottom: 5px;
    }

    .rail-stack span {
      color: rgba(245, 240, 232, 0.84);
      line-height: 1.45;
    }

    .rail-stack b {
      color: var(--bright-gold);
      font-weight: 600;
    }

    .footer-note {
      margin-top: 54px;
      padding-top: 24px;
      border-top: 1px solid var(--line);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px 20px;
      color: rgba(245, 240, 232, 0.58);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.83rem;
    }

    @media (max-width: 1040px) {
      .hero,
      .section-head,
      .lower-grid,
      .flagship-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .page {
        width: min(100vw - 22px, var(--max-width));
        padding: 22px 0 50px;
      }

      h1 {
        font-size: clamp(3rem, 15vw, 4.6rem);
      }

      .cta-row,
      .route-foot,
      .hero-metrics {
        grid-template-columns: 1fr;
      }

      .btn {
        width: 100%;
      }

      .hero-metrics {
        display: grid;
      }

      .route-foot {
        align-items: start;
        flex-direction: column;
      }

      .footer-note {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="rule"></div>

    <section class="hero">
      <div>
        <div class="eyebrow">AurelianFlo</div>
        <h1>Service catalog.</h1>
        <p class="lede">${escapeHtml(CATALOG_PAGE_LEDE)}</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="${jsonCatalogUrl}" rel="nofollow">JSON</a>
          <a class="btn btn-secondary" href="${openApiUrl}" rel="nofollow">OpenAPI</a>
        </div>
      </div>

      <aside class="hero-panel">
        <strong>Summary</strong>
        <div class="hero-metrics">
          <div>
            <b>${featuredCount}</b>
            <span>Featured routes</span>
          </div>
          <div>
            <b>${endpointCount}</b>
            <span>Public routes in discovery</span>
          </div>
          <div>
            <b>x402</b>
            <span>USDC on Base</span>
          </div>
          <div>
            <b>MCP</b>
            <span>Remote access</span>
          </div>
        </div>
      </aside>
    </section>

    <section class="section">
      <div class="rule"></div>
      <div class="section-head">
        <h2>Featured routes</h2>
        <p>Primary routes for the current product surface.</p>
      </div>
      <div class="flagship-grid">${cardsMarkup}</div>
    </section>

    <section class="section">
      <div class="rule"></div>
      <div class="lower-grid">
        <article class="context-panel">
          <h3>Included here</h3>
          <div class="bullet-list">
            <div class="bullet">
              <strong>Compliance</strong>
              <span>EDD memos for compliance review handoff, with OFAC wallet screening underneath.</span>
            </div>
            <div class="bullet">
              <strong>Flagship workflow</strong>
              <span><code>/api/workflows/compliance/edd-report</code> returns a reviewable memo as JSON, PDF, or DOCX.</span>
            </div>
            <div class="bullet">
              <strong>Screening reports</strong>
              <span><code>/api/workflows/compliance/wallet-sanctions-report</code> bundles one-wallet screening into a report-ready payload.</span>
            </div>
            <div class="bullet">
              <strong>Document output</strong>
              <span>PDF, DOCX, and XLSX generation return the final document.</span>
            </div>
          </div>
        </article>

        <aside class="rail-panel">
          <h3>Machine rails</h3>
          <div class="rail-stack">
            <a href="${jsonCatalogUrl}" rel="nofollow">
              <div>
                <small>Public JSON</small>
                <span>Public discovery payload.</span>
              </div>
              <b>API</b>
            </a>
            <a href="${fullDiscoveryUrl}" rel="nofollow">
              <div>
                <small>Full JSON</small>
                <span>Machine-readable inventory for the current public surface.</span>
              </div>
              <b>FULL</b>
            </a>
            <a href="${mcpUrl}" rel="nofollow">
              <div>
                <small>Remote MCP</small>
                <span>Remote MCP endpoint.</span>
              </div>
              <b>/mcp</b>
            </a>
            <a href="${serverCardUrl}" rel="nofollow">
              <div>
                <small>Server Card</small>
                <span>Static MCP metadata.</span>
              </div>
              <b>MCP</b>
            </a>
          </div>
        </aside>
      </div>
    </section>

    <footer class="footer-note">
      <span>${title}</span>
      <span>${featuredCount} featured routes</span>
      <span>${endpointCount} routes in discovery</span>
    </footer>
  </main>
</body>
</html>`;
}

function createAurelianFloMcpDocsHandler() {
  return function aurelianFloMcpDocsHandler(req, res) {
    const baseUrl = getRequestBaseUrl(req);
    const html = buildMcpDocHtml({
      title: "AurelianFlo",
      summary:
        "Pay-per-call MCP tools anchored around EDD memos, OFAC screening, and document output. Retained Monte Carlo tools remain callable directly. Start with server_capabilities and use the direct origin for paid execution.",
      links: [
        { label: "MCP Endpoint", value: `${baseUrl}/mcp`, href: `${baseUrl}/mcp` },
        {
          label: "Server Card",
          value: `${baseUrl}/.well-known/mcp/server-card.json`,
          href: `${baseUrl}/.well-known/mcp/server-card.json`,
        },
        { label: "Privacy", value: `${baseUrl}/mcp/privacy`, href: `${baseUrl}/mcp/privacy` },
        { label: "Support", value: `${baseUrl}/mcp/support`, href: `${baseUrl}/mcp/support` },
      ],
      sections: [
        {
          heading: "Tools",
          items: [
            "server_capabilities: Free connection and capability check with direct and Smithery-hosted modes.",
            "edd_report: Enhanced due diligence memo with status labels, evidence summary, required follow-up, and json, pdf, or docx output.",
            "batch_wallet_screen: Batch OFAC wallet screening with structured JSON output for a whole wallet set.",
            "ofac_wallet_report: One-call OFAC wallet screening with json, pdf, or docx output.",
            "ofac_wallet_screen: Exact-match OFAC wallet screening with the structured report payload returned in JSON.",
            "monte_carlo_report: One-call Monte Carlo report with json, pdf, or docx output.",
            "monte_carlo_decision_report: Structured decision report from supported simulation workflows.",
            "report_pdf_generate: Generate a PDF from a structured report payload.",
            "report_docx_generate: Generate a DOCX document from a structured report payload.",
          ],
        },
        {
          heading: "Bundles",
          items: [
            "Compliance bundle: edd_report turns a wallet set plus case metadata into a reviewable memo with json, pdf, or docx output, and batch_wallet_screen handles the lower-level batch screening pass.",
            "Building blocks: edd_report or batch_wallet_screen plus report_pdf_generate or report_docx_generate remains available for compliance clients that want to control the artifact step.",
            "Retained decision-analysis bundle: monte_carlo_report still returns the simulation report plus json, pdf, or docx output for callers that already know that lane.",
            "Retained simulation building blocks: monte_carlo_decision_report plus report_pdf_generate or report_docx_generate remains available for clients that want to control each step.",
          ],
        },
        {
          heading: "Proof",
          items: [
            "Compliance canary: edd_report screened a two-wallet counterparty set, flagged Lazarus Group exposure, returned workflow_status manual_review_required, and generated a paid PDF artifact on Base.",
            "Simulation canary: monte_carlo_report preferred candidate, returned candidate outperformance 0.5903, expected score gap 0.2831, and probability uplift 0.0753, then generated a paid PDF artifact on Base.",
            "Both bundled tools have been exercised against the production MCP endpoint with settled transactions.",
          ],
        },
        {
          heading: "Example prompts",
          items: [
            "Call server_capabilities to verify the server, payment model, and connection modes without paying first.",
            "Prepare an enhanced due diligence memo for a counterparty wallet set with edd_report.",
            "Screen a batch of treasury or counterparty wallets with batch_wallet_screen and return the review signal.",
            "Screen 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 and return a PDF with ofac_wallet_report.",
            "Screen 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 and return the JSON report only with ofac_wallet_screen.",
            "Generate a compare-style simulation report and return a PDF with monte_carlo_report.",
            "Generate a forecast-style simulation report and return the JSON payload with monte_carlo_report.",
            "Render the current Monte Carlo report payload to DOCX with report_docx_generate.",
          ],
        },
        {
          heading: "Connection modes",
          items: [
            "Direct origin: https://x402.aurelianflo.com/mcp",
            "Smithery-hosted gateway: https://core--aurelianflo.run.tools",
            "Transport: streamable HTTP MCP.",
            "Payment: x402 with USDC on Base.",
          ],
        },
        {
          heading: "Direct origin",
          items: [
            "Direct origin: codex mcp add aurelianflo --url https://x402.aurelianflo.com/mcp",
            "Use the origin directly for paid execution.",
            "Use the origin directly when the client does not implement Smithery's hosted OAuth flow.",
          ],
        },
        {
          heading: "Smithery hosted",
          items: [
            "Smithery listing: aurelianflo/core",
            "CLI connection: smithery mcp add aurelianflo/core",
            "Hosted gateway: codex mcp add aurelianflo-core --url https://core--aurelianflo.run.tools",
            "Use server_capabilities first on the Smithery-hosted connection.",
            "The bundled compliance workflows are exposed as edd_report, batch_wallet_screen, and ofac_wallet_report.",
            "The bundled simulation workflow is exposed as monte_carlo_report.",
            "Paid execution is currently available through the direct origin at https://x402.aurelianflo.com/mcp.",
            "OAuth-capable clients should follow the Smithery authorization URL when the hosted gateway returns auth_required.",
            "If Smithery's Windows client installer handoff fails, add the hosted gateway or the direct origin with codex mcp add ... --url ... instead of relying on --client codex.",
          ],
        },
      ],
    });
    res.type("text/html; charset=utf-8").send(html);
  };
}

function createAurelianFloMcpPrivacyHandler() {
  return function aurelianFloMcpPrivacyHandler(req, res) {
    const baseUrl = getRequestBaseUrl(req);
    const html = buildMcpDocHtml({
      title: "AurelianFlo",
      summary: "Privacy information for the AurelianFlo remote MCP server.",
      links: [
        { label: "Docs", value: `${baseUrl}/mcp/docs`, href: `${baseUrl}/mcp/docs` },
        { label: "Support", value: `${baseUrl}/mcp/support`, href: `${baseUrl}/mcp/support` },
      ],
      sections: [
        {
          heading: "Data collected",
          items: [
            "Tool input payloads required to execute OFAC wallet screening, simulation reporting, and document generation.",
            "Operational logs required for uptime, debugging, abuse prevention, and billing reconciliation.",
            "Payment metadata required by x402 settlement flows.",
          ],
        },
        {
          heading: "Use",
          items: [
            "Execute the requested MCP tool call.",
            "Return structured results and document artifacts.",
            "Monitor reliability, prevent abuse, and investigate failures.",
            "Reconcile paid usage and settlement events.",
          ],
        },
        {
          heading: "Retention and sharing",
          items: [
            "Data is retained only as needed for reliability, billing, fraud prevention, and compliance.",
            "Data may be processed by infrastructure and payment providers required to execute the service.",
            "Data is not sold for advertising purposes.",
          ],
        },
      ],
    });
    res.type("text/html; charset=utf-8").send(html);
  };
}

function createAurelianFloMcpSupportHandler() {
  return function aurelianFloMcpSupportHandler(req, res) {
    const baseUrl = getRequestBaseUrl(req);
    const html = buildMcpDocHtml({
      title: "AurelianFlo",
      summary: "Support information for the AurelianFlo remote MCP server.",
      links: [
        { label: "Support Email", value: "support@aurelianflo.com", href: "mailto:support@aurelianflo.com" },
        { label: "Docs", value: `${baseUrl}/mcp/docs`, href: `${baseUrl}/mcp/docs` },
        { label: "Privacy", value: `${baseUrl}/mcp/privacy`, href: `${baseUrl}/mcp/privacy` },
      ],
      sections: [
        {
          heading: "Support scope",
          items: [
            "Connection and configuration issues.",
            "Payment and settlement issues related to x402 tool calls.",
            "Unexpected tool failures or invalid responses.",
            "Questions about supported inputs for screening, reporting, and document generation.",
          ],
        },
        {
          heading: "Channels",
          items: [
            "General support: support@aurelianflo.com",
            "Documentation: public MCP docs at /mcp/docs",
            "Security issues should be reported separately through the support channel until a dedicated address is published.",
          ],
        },
      ],
    });
    res.type("text/html; charset=utf-8").send(html);
  };
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
  const patternMatches = [];

  for (const [key, config] of Object.entries(routes)) {
    const [method, routePath] = key.split(" ");
    const entry = {
      key,
      config,
      method: String(method || "").toUpperCase(),
      routePath,
    };

    if (routePath.includes("*") || routePath.includes(":") || routePath.includes("[")) {
      patternMatches.push(entry);
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

    const requestSegments = requestPath.split("/").filter(Boolean);
    for (const route of patternMatches) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const routeSegments = String(route.routePath).split("/").filter(Boolean);
      if (routeSegments.length !== requestSegments.length) {
        continue;
      }

      const matched = routeSegments.every((segment, index) => {
        if (segment === "*") {
          return true;
        }
        if (segment.startsWith(":") || /^\[[^\]]+\]$/.test(segment)) {
          return Boolean(requestSegments[index]);
        }
        return segment === requestSegments[index];
      });

      if (matched) {
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
  const routes = options.routes ?? applyRouteDiscoveryOverrides(createRouteConfig(payTo));
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
    const catalog = buildCatalogEntries(routes);
    const metadata = getOriginMetadata(env);
    if (shouldRenderHealthHtml(req)) {
      const host = String(req.get("x-forwarded-host") || req.get("host") || "")
        .split(",")[0]
        .trim()
        .toLowerCase();

      if (host === "x402.aurelianflo.com") {
        return res.redirect(307, "https://aurelianflo.com");
      }

      const html = buildOriginLandingHtml({
        title: metadata.title,
        description: metadata.description,
        baseUrl: getRequestBaseUrl(req),
        endpointCount: catalog.length,
      });
      return res.type("text/html; charset=utf-8").send(html);
    }

    res.json({
      title: metadata.title,
      name: metadata.title,
      description: metadata.description,
      version: "1.0.0",
      endpoints: catalog.length,
      catalog,
      payment: { network: "Base", currency: "USDC", protocol: "x402" },
    });
  };
}

function createApiDiscoveryHandler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const discoveryScope = options.discoveryScope || "full";
  return function apiDiscoveryHandler(req, res) {
    const baseUrl = getRequestBaseUrl(req);
    const metadata = getOriginMetadata(env);
    const catalog = buildCatalogEntries(routes, {
      includeDiscoveryFields: true,
      env,
      discoveryScope,
    });

    if (shouldRenderHealthHtml(req)) {
      const flagshipEntries = getFlagshipCatalogEntries(catalog);
      const html = buildApiDiscoveryHtml({
        title: metadata.title,
        description: metadata.description,
        baseUrl,
        endpointCount: catalog.length,
        flagshipEntries,
      });
      return res.type("text/html; charset=utf-8").send(html);
    }

    res.json({
      title: metadata.title,
      name: metadata.title,
      description: metadata.description,
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
  const routeEntries = Object.entries(routes)
    .filter(([routeKey, config]) => !shouldHideRouteInProduction(getDisplayRouteKey(routeKey, config), { env }))
    .filter(([routeKey, config]) => shouldIncludeRouteInDiscovery(getDisplayRouteKey(routeKey, config), options));

  for (const [routeKey, config] of routeEntries) {
    const displayRouteKey = getDisplayRouteKey(routeKey, config);
    const [method = "GET", routePath = "/"] = String(displayRouteKey).split(" ");
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
  const discoveryScope = options.discoveryScope || "full";
  return function openApiHandler(_req, res) {
    res.json(buildOpenApiDocument(routes, { env, discoveryScope }));
  };
}

function createFaviconHandler() {
  return function faviconHandler(_req, res) {
    res.set("Cache-Control", "public, max-age=3600");
    res.type("image/png").send(FAVICON_PNG);
  };
}

function createMcpRegistryAuthHandler(proof) {
  const normalizedProof = typeof proof === "string" ? proof.trim() : "";
  return function mcpRegistryAuthHandler(_req, res) {
    if (!normalizedProof) {
      return res.status(404).type("text/plain").send("");
    }
    res.set("Cache-Control", "no-store, max-age=0");
    return res.type("text/plain").send(normalizedProof);
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
  const publicRoutes = selectRoutes(PUBLIC_CORE_DISCOVERY_ROUTE_KEYS, routes);
  return function wellKnownX402AurelianHandler(_req, res) {
    res.json(buildWellKnownManifest(manifest, publicRoutes, {
      env,
      includeBundledSellerResources: false,
      appendSimInstructions: false,
    }));
  };
}

function buildWellKnownX402V1Manifest(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const resources = Object.entries(routes)
    .filter(([routeKey, config]) => !shouldHideRouteInProduction(getDisplayRouteKey(routeKey, config), { env }))
    .map(([routeKey, config]) => {
      const displayRouteKey = getDisplayRouteKey(routeKey, config);
      const [method = "GET", routePath = "/"] = String(displayRouteKey).split(" ");
      return `${String(method).toUpperCase()} ${buildOpenApiPathTemplate(routePath)}`;
    });

  return {
    version: 1,
    resources,
  };
}

function buildCoreWellKnownX402Manifest(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  const coreRoutes = selectRoutes(FLAGSHIP_ROUTE_ORDER, routes);
  const endpoints = buildWellKnownEndpointEntries(coreRoutes, { env });
  const resources = endpoints
    .map((endpoint) => {
      if (endpoint.routeKey === "GET /api/ofac-wallet-screen/:address") {
        return `${CANONICAL_BASE_URL}/api/ofac-wallet-screen/0x098B716B8Aaf21512996dC57EB0615e2383E2f96?asset=ETH`;
      }

      return endpoint.path ? `${CANONICAL_BASE_URL}${endpoint.path}` : endpoint.exampleUrl;
    })
    .filter(Boolean);

  return buildWellKnownManifest(
    {
      ...WELL_KNOWN_X402_AURELIAN,
      description: "Core AurelianFlo tools for EDD memos, OFAC screening, and document output.",
      resources,
      instructions: [
        "# AurelianFlo Core Tools",
        "",
        "- Enhanced due diligence memos",
        "- Batch and single-wallet OFAC screening",
        "- Report PDF, DOCX, and XLSX generation",
        "",
        "For the current buyer-facing machine-readable inventory, use GET /api or /.well-known/x402-aurelian.json.",
      ].join("\n"),
    },
    coreRoutes,
    {
      env,
      includeBundledSellerResources: false,
      precomputedEndpoints: endpoints,
      appendSimInstructions: false,
    },
  );
}

function createWellKnownX402Handler(routes = routeConfig, options = {}) {
  const env = options.env || process.env;
  return function wellKnownX402Handler(_req, res) {
    res.json(buildCoreWellKnownX402Manifest(routes, { env }));
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

function mountPaidRoutes(target) {
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
    } else if (route.seller === "sports-workflows") {
      handler = sportsWorkflowPrimaryHandler;
    } else if (route.seller === "vendor-workflows") {
      handler = vendorWorkflowPrimaryHandler;
    } else if (route.seller === "finance-workflows") {
      handler = financeWorkflowPrimaryHandler;
    }

    target[method](route.expressPath, handler);
  }

  target.use(generatedRoutesRouter);
}

function createApp(options = {}) {
  const env = options.env ?? process.env;
  const index402VerificationHash = String(
    options.index402VerificationHash
    || env.INDEX402_VERIFICATION_HASH
    || DEFAULT_402INDEX_VERIFICATION_HASH,
  ).trim();
  const payTo = options.payTo ?? PAY_TO;
  const routes = options.routes ?? getDefaultAppRoutes(payTo, env);
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
  const enableOpsDashboards = options.enableOpsDashboards === true;
  const wellKnownX402Aurelian = options.wellKnownX402Aurelian ?? WELL_KNOWN_X402_AURELIAN;
  const mcpRegistryAuthProof = options.mcpRegistryAuthProof ?? env.MCP_REGISTRY_AUTH_PROOF;

  const app = express();
  const apiDiscoveryHandler = createApiDiscoveryHandler(routes, { env, discoveryScope: "public" });
  const fullApiDiscoveryHandler = createApiDiscoveryHandler(routes, { env, discoveryScope: "full" });
  const openApiHandler = createOpenApiHandler(routes, { env, discoveryScope: "public" });
  const fullOpenApiHandler = createOpenApiHandler(routes, { env, discoveryScope: "full" });
  const restrictedPartyPaymentsMcpIntegrationHandler =
    options.restrictedPartyPaymentsMcpIntegrationHandler
    || createRestrictedPartyPaymentsMcpIntegrationHandler(createRestrictedPartyRouteConfig(payTo));

  // Trust Vercel's proxy so req.protocol returns "https" instead of "http".
  app.set("trust proxy", 1);

  if (enableDebugRoutes) {
    app.get("/debug/settle-test", createSettleTestHandler(options));
  }

  if (productionInactiveRoutesMiddleware) {
    app.use(productionInactiveRoutesMiddleware);
  }

  app.use(createAllowedApiRoutesMiddleware(routes, { env }));

  app.get("/", createHealthHandler(routes, { env }));
  app.get("/api", apiDiscoveryHandler);
  app.get("/api/system/discovery/core", apiDiscoveryHandler);
  app.get("/api/system/discovery/full", fullApiDiscoveryHandler);
  app.get("/openapi", (_req, res) => {
    res.redirect(308, "/openapi.json");
  });
  app.get("/openapi.json", openApiHandler);
  app.get("/openapi-full.json", fullOpenApiHandler);
  app.get("/api/system/openapi.json", fullOpenApiHandler);
  app.get("/favicon.ico", createFaviconHandler());
  app.get("/icon.png", createFaviconHandler());
  app.get("/mcp/docs", createAurelianFloMcpDocsHandler());
  app.get("/mcp/privacy", createAurelianFloMcpPrivacyHandler());
  app.get("/mcp/support", createAurelianFloMcpSupportHandler());
  app.get("/api/sim", createSimLandingHandler(routes, { env }));
  app.get("/integrations/payments-mcp", restrictedPartyPaymentsMcpIntegrationHandler);
  app.get("/.well-known/x402", createWellKnownX402Handler(routes, { env }));
  app.get("/.well-known/x402.json", createWellKnownX402Handler(routes, { env }));
  mountPublicPostRouteDocs(app, routes, { env });
  app.get("/.well-known/402index-verify.txt", (_req, res) => {
    if (!index402VerificationHash) {
      return res.status(404).type("text/plain").send("");
    }
    return res.type("text/plain").send(index402VerificationHash);
  });
  app.get("/.well-known/mcp-registry-auth", createMcpRegistryAuthHandler(mcpRegistryAuthProof));
  app.get("/well-known/x402-aurelian.json", (_req, res) => {
    res.redirect(308, "/.well-known/x402-aurelian.json");
  });
  app.get(
    "/.well-known/x402-aurelian.json",
    createWellKnownX402AurelianHandler(wellKnownX402Aurelian, routes, { env }),
  );
  app.get("/.well-known/mcp/server-card.json", createAurelianFloMcpServerCardHandler());
  app.all(
    "/mcp",
    createAurelianFloMcpExpressBridge({
      recipient: payTo,
      facilitatorUrl: options.facilitatorUrl ?? env.X402_FACILITATOR_URL,
      network: "base",
    }),
  );
  app.use(express.json());
  app.use(createSimCompatibleResponseMiddleware());
  if (enableOpsDashboards) {
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
  }

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
  mountPaidRoutes(paidRouter);
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

