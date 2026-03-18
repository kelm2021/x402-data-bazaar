const express = require("express");
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
  createBusinessDashboardHandler,
  createBusinessDataHandler,
  createBusinessProofHandler,
} = require("./business-dashboard");

const PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";
const X402_NETWORK = "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = 60;
const CANONICAL_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://x402-data-bazaar.vercel.app";

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
  const { queryExample, querySchema, outputExample } = options;

  return declareDiscoveryExtension({
    ...(queryExample ? { input: queryExample } : {}),
    ...(querySchema ? { inputSchema: querySchema } : {}),
    ...(outputExample ? { output: { example: outputExample } } : {}),
  });
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
    queryExample,
    querySchema,
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
    extensions: createDiscoveryExtension({
      queryExample,
      querySchema,
      outputExample,
    }),
  };
}

function createRouteConfig(payTo = PAY_TO) {
  return {
    "GET /api/vin/*": createPricedRoute({
      price: "0.005",
      description:
        "Decode any 17-character VIN -- returns year, make, model, trim, body class, drive type, fuel type, engine specs, transmission, and plant country. e.g. GET /api/vin/1HGCM82633A004352",
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
      price: "0.003",
      description:
        "Actionable weather decision brief for exact coordinates encoded in the path -- current conditions, rain timing, outdoor score, commute risk, and what to bring. e.g. GET /api/weather/current/40.7128/-74.0060",
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
      price: "0.003",
      description:
        "Actionable current weather decision brief for any lat/lon -- current conditions, rain timing, outdoor score, commute risk, and what to bring. Query: ?lat=40.7&lon=-74.0. Bazaar buyers should prefer the path form: /api/weather/current/40.7128/-74.0060",
      payTo,
      resourcePath: "/api/weather/current/40.7128/-74.0060",
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
      price: "0.005",
      description:
        "Daily weather forecast (1-16 days) for any lat/lon -- high/low temps (F), precipitation, chance of rain, max wind, condition. Query: ?lat=40.7&lon=-74.0&days=7",
      payTo,
      resourcePath: "/api/weather/forecast?lat=40.7128&lon=-74.0060&days=7",
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
      price: "0.002",
      description:
        "Business-day intelligence for the current local date in a country -- holiday status, weekend status, next holiday, and next business day. Optional ?tz=America/New_York. e.g. GET /api/holidays/today/US",
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
        },
        source: "Nager.Date API",
      },
    }),
    "GET /api/business-days/next/*": createPricedRoute({
      price: "0.002",
      description:
        "Find the next business day on or after a specific date for a country. Returns whether the input date is already a business day, any holiday on that date, and the next business day. Optional ?tz=America/New_York. e.g. GET /api/business-days/next/US/2026-03-15",
      payTo,
      resourcePath: "/api/business-days/next/US/2026-03-15?tz=America/New_York",
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
        },
        source: "Nager.Date API",
      },
    }),
    "GET /api/holidays/*": createPricedRoute({
      price: "0.002",
      description:
        "Public holidays for any country and year. Use ISO 3166-1 alpha-2 country codes. e.g. GET /api/holidays/US/2026",
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
    "GET /api/exchange-rates/*": createPricedRoute({
      price: "0.003",
      description:
        "FX conversion quotes for a specific amount. Returns converted totals, mid-market rate, inverse rate, and multiple targets. Query: ?to=EUR,GBP,JPY&amount=100 or use the direct path form /api/exchange-rates/quote/USD/EUR/100.",
      payTo,
      resourcePath: "/api/exchange-rates/quote/USD/EUR/100",
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
      price: "0.005",
      description:
        "Search USDA FoodData Central for nutrition data -- calories, protein, fat, carbs, fiber, sugar, sodium, cholesterol per food. Query: ?query=chicken breast&limit=5",
      payTo,
      resourcePath: "/api/nutrition/search?query=chicken%20breast&limit=5",
      queryExample: { query: "chicken breast", limit: "5" },
      querySchema: {
        properties: {
          query: { type: "string", description: "Food search phrase" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        required: ["query"],
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
      price: "0.005",
      description:
        "FDA food recall enforcement actions -- product description, reason, classification, company, status. Optional ?query=peanut&limit=10",
      payTo,
      resourcePath: "/api/fda/recalls?query=peanut&limit=10",
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
        },
        source: "openFDA Food Enforcement API",
      },
    }),
    "GET /api/fda/adverse-events": createPricedRoute({
      price: "0.005",
      description:
        "FDA drug adverse event reports -- reactions, suspect drugs, seriousness. Query: ?drug=aspirin&limit=10",
      payTo,
      resourcePath: "/api/fda/adverse-events?drug=aspirin&limit=10",
      queryExample: { drug: "aspirin", limit: "10" },
      querySchema: {
        properties: {
          drug: { type: "string", description: "Drug brand or ingredient name" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        required: ["drug"],
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
        },
        source: "openFDA Drug Adverse Events API",
      },
    }),
    "GET /api/census/population": createPricedRoute({
      price: "0.005",
      description:
        "US Census population, median household income, and median age. Query by ZIP (?zip=20002), state FIPS (?state=06), or omit for all states. ACS 5-year estimates.",
      payTo,
      resourcePath: "/api/census/population?state=06",
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
      price: "0.005",
      description:
        "Consumer Price Index (CPI-U) -- All Items, US City Average. Monthly values with history. Optional ?years=10 (default 5).",
      payTo,
      resourcePath: "/api/bls/cpi?years=5",
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
      price: "0.005",
      description:
        "US unemployment rate (seasonally adjusted). Monthly values with history. Optional ?years=10 (default 5).",
      payTo,
      resourcePath: "/api/bls/unemployment?years=5",
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
      price: "0.005",
      description:
        "Current air quality index (AQI) by US ZIP code -- PM2.5, ozone readings, category (Good/Moderate/Unhealthy), reporting area. e.g. GET /api/air-quality/20002",
      payTo,
      resourcePath: "/api/air-quality/20002",
      outputExample: {
        success: true,
        data: {
          zip: "20002",
          overallAqi: 39,
          overallCategory: "Good",
          readings: [
            { parameter: "O3", aqi: 18, category: "Good" },
            { parameter: "PM2.5", aqi: 39, category: "Good" },
          ],
        },
        source: "EPA AirNow API",
      },
    }),
    "GET /api/congress/bills": createPricedRoute({
      price: "0.005",
      description:
        "Recent Congressional bills -- title, latest action, origin chamber, update date. Optional ?congress=119&limit=20. From Congress.gov.",
      payTo,
      resourcePath: "/api/congress/bills?congress=119&limit=20",
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
    "GET /api/fec/candidates": createPricedRoute({
      price: "0.005",
      description:
        "FEC candidate search -- name, party, office, state, district, incumbent status, election cycles. Query: ?name=smith&office=S&state=CA",
      payTo,
      resourcePath: "/api/fec/candidates?name=smith&office=S&state=CA&limit=20",
      queryExample: { name: "smith", office: "S", state: "CA", limit: "20" },
      querySchema: {
        properties: {
          name: { type: "string", description: "Candidate name search string" },
          office: { type: "string", description: "Office code: H, S, or P" },
          state: { type: "string", description: "Two-letter state code" },
          party: { type: "string", description: "Party code filter" },
          cycle: { type: "string", description: "Election cycle year" },
          limit: { type: "string", description: "Maximum results to return" },
        },
        additionalProperties: false,
      },
      outputExample: {
        success: true,
        data: {
          count: 1,
          candidates: [
            { name: "Smith, John", office: "Senate", state: "CA", party: "Democratic Party" },
          ],
        },
        source: "Federal Election Commission API",
      },
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

async function loadCoinbaseFacilitator(env = process.env) {
  const { createFacilitatorConfig } = await import("@coinbase/x402");
  return createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
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
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadCoinbaseFacilitator());
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

  let paymentReady = null;

  async function getPaymentMiddleware() {
    if (!paymentReady) {
      paymentReady = Promise.resolve(facilitatorLoader())
        .then((facilitator) =>
          resourceServerFactory({
            facilitator,
            logger,
          }),
        )
        .then((resourceServer) => paymentMiddlewareFactory(routes, resourceServer));
    }

    return paymentReady;
  }

  return async function paymentGate(req, res, next) {
    try {
      if (!req.headers["payment-signature"] && req.headers["x-payment"]) {
        req.headers["payment-signature"] = req.headers["x-payment"];
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
          res.statusCode = 500;
          return originalJson({
            error: "Payment settlement failed",
          });
        }

        if (res.statusCode === 402 && paymentRequiredHeader && isEmptyObject) {
          const { decodePaymentRequiredHeader } = require("@x402/core/http");
          return originalJson(
            decodePaymentRequiredHeader(String(paymentRequiredHeader)),
          );
        }

        return originalJson(body);
      };

      const middleware = await getPaymentMiddleware();
      return await middleware(req, res, next);
    } catch (err) {
      return res.status(500).json({
        error: "Payment middleware init failed",
        details: err.message,
      });
    }
  };
}

function createSettleTestHandler(options = {}) {
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadCoinbaseFacilitator());

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

function createHealthHandler(routes = routeConfig) {
  return function healthHandler(req, res) {
    const catalog = Object.keys(routes).map((key) => {
      const [method, path] = key.split(" ");
      const config = routes[key];

      return {
        method,
        path,
        price: getRoutePrice(config),
        description: getRouteDescription(config),
      };
    });

    res.json({
      name: "x402 Data Bazaar",
      description:
        "Real-world data APIs for AI agents -- weather, nutrition, VIN, census, FDA, and more. Pay per request with USDC on Base.",
      version: "1.0.0",
      endpoints: catalog.length,
      catalog,
      payment: { network: "Base", currency: "USDC", protocol: "x402" },
    });
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
  target.use(require("./routes/fec"));
}

function createApp(options = {}) {
  const env = options.env ?? process.env;
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
  const enableDebugRoutes = options.enableDebugRoutes ?? true;

  const app = express();
  app.use(express.json());

  // Trust Vercel's proxy so req.protocol returns "https" instead of "http".
  app.set("trust proxy", 1);

  if (enableDebugRoutes) {
    app.get("/debug/settle-test", createSettleTestHandler(options));
  }

  app.get("/", createHealthHandler(routes));
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
  mountPaidRoutes(paidRouter);
  app.use(protectedPaymentGate, paidRouter);

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
  createHealthHandler,
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
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
  loadCoinbaseFacilitator,
  mountPaidRoutes,
  routeConfig,
};
