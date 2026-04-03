const express = require("express");
const {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} = require("@x402/extensions/bazaar");
const restrictedPartySellerConfig = require("./apps/restricted-party-screen/seller.config.json");
const restrictedPartyPrimaryHandler = require("./apps/restricted-party-screen/handlers/primary");
const restrictedPartyBatchHandler = require("./apps/restricted-party-screen/handlers/batch");
const vendorEntityBriefSellerConfig = require("./apps/vendor-entity-brief/seller.config.json");
const vendorEntityBriefPrimaryHandler = require("./apps/vendor-entity-brief/handlers/primary");
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
const {
  createMercTrustEnforcementFromEnv,
} = require("./lib/merc-trust-enforcement");
const WELL_KNOWN_X402_AURELIAN = require("./well-known-x402-aurelian.json");

const PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";
const X402_NETWORK = "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = 60;
const CANONICAL_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || "https://x402-data-bazaar.vercel.app",
)
  .trim()
  .replace(/\/+$/, "");

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
  const { category, description, tags, price, queryExample, querySchema, outputExample } = options;

  const extension = declareDiscoveryExtension({
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
    ...(Array.isArray(tags) && tags.length ? { tags } : {}),
    ...(queryExample ? { input: queryExample } : {}),
    ...(querySchema ? { inputSchema: querySchema } : {}),
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
  ];
}

function createBundledSellerRouteConfig() {
  const entries = {};

  for (const route of getBundledSellerRoutes()) {
    if (!route?.key || !route?.resourcePath) {
      continue;
    }

    const canonicalResourcePath = route.canonicalPath || route.resourcePath;
    entries[route.key] = createPricedRoute({
      price: route.price,
      description: route.description,
      payTo: route.payTo || PAY_TO,
      resourcePath: canonicalResourcePath,
      category: route.category,
      tags: route.tags,
      queryExample: route.queryExample,
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
      outputExample: {
        success: true,
        data: { latestDate: "2026-03-26", rates: { DGS2: 4.08, DGS10: 4.17 }, spread_10y_2y: 0.09 },
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
      description: "CourtListener docket/case search.",
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
    "GET /api/courts/opinions/*": createPricedRoute({
      price: "0.006",
      description: "CourtListener opinion search by path query.",
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
    "GET /api/sports/scores/*": createPricedRoute({
      price: "0.008",
      description: "Live/recent scores by sport with provider fallback.",
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
      description: "League standings by sport.",
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
          sport: { type: "string", description: "Sport slug (nfl, nba, mlb, ...)" },
          date: { type: "string", description: "Date as YYYYMMDD" },
          limit: { type: "string", description: "Max games to return" },
        },
        additionalProperties: false,
      },
      outputExample: { success: true, data: { teamQuery: "Patriots", count: 17 }, source: "TheSportsDB" },
    }),
    "GET /api/sports/odds/*": createPricedRoute({
      price: "0.012",
      description: "Live sports odds by sport with bookmaker market snapshots.",
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
    "GET /api/patents/search": createPricedRoute({
      price: "0.006",
      description: "Patent search endpoint with optional EPO fallback when configured.",
      category: "data/world",
      tags: ["patents", "innovation", "research"],
      payTo,
      resourcePath: "/api/patents/search",
      queryExample: { q: "battery", page: "1", perPage: "20" },
      querySchema: {
        properties: {
          q: { type: "string", description: "Search phrase" },
          page: { type: "string", description: "Page number" },
          perPage: { type: "string", description: "Rows per page" },
          fromDate: { type: "string", description: "Start date YYYY-MM-DD" },
          toDate: { type: "string", description: "End date YYYY-MM-DD" },
        },
        required: ["q"],
        additionalProperties: false,
      },
      outputExample: { success: true, data: { query: "battery", count: 20 }, source: "PatentsView API" },
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
    ...createBundledSellerRouteConfig(),

    // ─── Simulation Routes ──────────────────────────────────
    "POST /api/sim/probability": createPricedRoute({ price: "0.05", description: "Monte Carlo probability estimation", category: "simulation", tags: ["simulation", "monte-carlo"], payTo }),
    "POST /api/sim/compare": createPricedRoute({ price: "0.06", description: "Scenario comparison with uplift deltas", category: "simulation", tags: ["simulation", "scenario-compare"], payTo }),
    "POST /api/sim/sensitivity": createPricedRoute({ price: "0.07", description: "Parameter sensitivity analysis", category: "simulation", tags: ["simulation", "sensitivity"], payTo }),
    "POST /api/sim/forecast": createPricedRoute({ price: "0.08", description: "Forward probability path forecast", category: "simulation", tags: ["simulation", "forecast"], payTo }),
    "POST /api/sim/composed": createPricedRoute({ price: "0.09", description: "Weighted scenario composition", category: "simulation", tags: ["simulation", "ensemble"], payTo }),
    "POST /api/sim/optimize": createPricedRoute({ price: "0.10", description: "Parameter optimization search", category: "simulation", tags: ["simulation", "optimization"], payTo }),

    // ─── Document Generation Routes ─────────────────────────
    "POST /api/tools/docx/generate": createPricedRoute({ price: "0.015", description: "Generate DOCX documents", category: "document-generation", tags: ["docx"], payTo }),
    "POST /api/tools/xlsx/generate": createPricedRoute({ price: "0.015", description: "Generate XLSX spreadsheets", category: "document-generation", tags: ["xlsx"], payTo }),
    "POST /api/tools/invoice/generate": createPricedRoute({ price: "0.015", description: "Generate PDF invoices", category: "document-generation", tags: ["pdf", "invoice"], payTo }),
    "POST /api/tools/contract/generate": createPricedRoute({ price: "0.020", description: "Generate PDF contracts/NDAs", category: "document-generation", tags: ["pdf", "legal"], payTo }),
    "POST /api/tools/proposal/generate": createPricedRoute({ price: "0.020", description: "Generate PDF proposals", category: "document-generation", tags: ["pdf", "business"], payTo }),
    "POST /api/tools/markdown-to-pdf": createPricedRoute({ price: "0.010", description: "Convert markdown to PDF", category: "document-generation", tags: ["pdf", "markdown"], payTo }),
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
  return Object.entries(routes).map(([key, config]) => {
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

function getRequestBaseUrl(req) {
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
  const matchRoute = createRouteMatcher(routes);
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadCoinbaseFacilitator());
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
  let facilitatorUrl = extractFacilitatorUrl(options.facilitatorUrl);

  let paymentReady = null;
  const isFacilitatorInitFailure = (error) =>
    typeof error?.message === "string" &&
    error.message.includes(
      "Failed to initialize: no supported payment kinds loaded from any facilitator.",
    );

  async function initializePaymentMiddleware() {
    let lastError = null;

    for (let attempt = 1; attempt <= initRetryCount; attempt += 1) {
      try {
        const facilitator = await facilitatorLoader();
        if (!facilitatorUrl) {
          facilitatorUrl = extractFacilitatorUrl(facilitator);
        }

        const resourceServer = await resourceServerFactory({
          facilitator,
          logger,
        });
        return await paymentMiddlewareFactory(routes, resourceServer);
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

  async function getPaymentMiddleware() {
    if (!paymentReady) {
      paymentReady = initializePaymentMiddleware()
        .catch((error) => {
          // Avoid pinning the process into a permanent 500 state after one
          // transient facilitator initialization failure.
          paymentReady = null;
          throw error;
        });
    }

    return paymentReady;
  }

  return async function paymentGate(req, res, next) {
    const routeEntry = matchRoute(req.method, req.path);
    let hasPaymentSignature = false;

    try {
      if (!req.headers["payment-signature"] && req.headers["x-payment"]) {
        req.headers["payment-signature"] = req.headers["x-payment"];
      }

      hasPaymentSignature = Boolean(req.headers["payment-signature"]);

      if (req.headers["payment-signature"]) {
        try {
          const { decodePaymentSignatureHeader, encodePaymentSignatureHeader } = require("@x402/core/http");
          const decodedPayment = decodePaymentSignatureHeader(String(req.headers["payment-signature"]));
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

      const middleware = await getPaymentMiddleware();
      return await middleware(req, res, next);
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
        res.set(
          "PAYMENT-REQUIRED",
          encodePaymentRequiredHeader(fallbackPayload),
        );
        return res.status(402).json(fallbackPayload);
      }

      return res.status(500).json({
        error: "Payment middleware init failed",
        details: err?.message || String(err),
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
    const catalog = buildCatalogEntries(routes);

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

function createApiDiscoveryHandler(routes = routeConfig) {
  return function apiDiscoveryHandler(req, res) {
    const baseUrl = getRequestBaseUrl(req);
    const catalog = buildCatalogEntries(routes, { includeDiscoveryFields: true });

    res.json({
      name: "x402 Data Bazaar API Discovery",
      description:
        "Machine-readable endpoint catalog for indexing and health probes. Use `exampleUrl` for concrete checks.",
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

function createWellKnownX402AurelianHandler(manifest = WELL_KNOWN_X402_AURELIAN) {
  return function wellKnownX402AurelianHandler(_req, res) {
    res.json(manifest);
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
  target.use(require("./routes/sim"));
  target.use(require("./routes/docgen"));

  for (const route of getBundledSellerRoutes()) {
    const method = String(route?.method || "").toLowerCase();
    if (!method || typeof target[method] !== "function" || !route?.expressPath) {
      continue;
    }

    let handler = restrictedPartyPrimaryHandler;
    if (route.seller === "vendor-entity-brief") {
      handler = vendorEntityBriefPrimaryHandler;
    } else if (route.handlerId === "batch") {
      handler = restrictedPartyBatchHandler;
    }

    target[method](route.expressPath, handler);
  }
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
  const mercTrustEnforcementOptions = options.mercTrustEnforcementOptions ?? {};
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

  // Trust Vercel's proxy so req.protocol returns "https" instead of "http".
  app.set("trust proxy", 1);

  if (enableDebugRoutes) {
    app.get("/debug/settle-test", createSettleTestHandler(options));
  }

  app.get("/", createHealthHandler(routes));
  app.get("/api", createApiDiscoveryHandler(routes));
  app.get("/openapi.json", (_req, res) => {
    res.sendFile(require("path").join(__dirname, "openapi.json"));
  });
  app.get("/favicon.ico", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.sendFile(require("path").join(__dirname, "favicon.png"));
  });
  app.get("/favicon.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.sendFile(require("path").join(__dirname, "favicon.png"));
  });
  app.get("/.well-known/x402", (_req, res) => {
    res.redirect(308, "/.well-known/x402-aurelian.json");
  });
  app.get(
    "/.well-known/x402-aurelian.json",
    createWellKnownX402AurelianHandler(wellKnownX402Aurelian),
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
  createWellKnownX402AurelianHandler,
  createHealthHandler,
  createMercTrustEnforcementFromEnv,
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
  sanitizeAcceptedRequirements,
  sanitizePaymentPayloadForMatching,
};
