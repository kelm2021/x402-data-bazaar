const SELLER_BLUEPRINTS = [
  {
    id: "restricted-party-screen",
    serviceName: "Restricted Party Screen",
    serviceDescription:
      "Paid x402 API for OFAC sanctions and restricted-party screening in agentic commerce, vendor onboarding, payouts, cross-border trade, and compliance workflows.",
    category: "Trade & Compliance",
    launchTier: "P1",
    heroRouteKey: "GET /api/ofac-sanctions-screening/*",
    surfaceHeroRouteKey: "GET /api/ofac-sanctions-screening/*",
    heroExpressPath: "/api/ofac-sanctions-screening/:name",
    routeKeys: [
      "GET /api/ofac-sanctions-screening/*",
      "GET /api/restricted-party/screen/*",
    ],
    bazaarSearchTerms: [
      "sanctions screening api",
      "restricted party screening",
      "ofac api",
      "ofac sanctions api",
      "denied party screening",
      "vendor compliance api",
    ],
    upstreams: ["OFAC Sanctions List Service"],
    why:
      "First focused wedge in the rebuild. It gives agents a clear transaction gate: pause, review, or proceed.",
    surfaceRoutes: [
      {
        key: "GET /api/ofac-sanctions-screening/*",
        method: "GET",
        routePath: "/api/ofac-sanctions-screening/*",
        expressPath: "/api/ofac-sanctions-screening/:name",
        resourcePath: "/api/ofac-sanctions-screening/SBERBANK",
        canonicalPath: "/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5",
        price: "0.005",
        description:
          "OFAC sanctions and restricted-party screening for a person or entity name. Returns grouped potential matches, aliases, denied-party and sanctions-list context, source lists, sanctions programs, and a manual-review recommendation for vendor onboarding, payout checks, and cross-border compliance. Optional query params: minScore, type, country, program, list, limit.",
        queryExample: { minScore: "90", limit: "5" },
        outputExample: {
          success: true,
          data: {
            query: {
              name: "SBERBANK",
              minScore: 90,
              limit: 5,
            },
            summary: {
              matchCount: 1,
              exactMatchCount: 1,
              manualReviewRecommended: true,
            },
            matches: [
              {
                id: 18715,
                primaryName: "AKTSIONERNE TOVARYSTVO SBERBANK",
                aliases: ["JOINT STOCK COMPANY SBERBANK", "JSC SBERBANK"],
                type: "Entity",
                programs: ["RUSSIA-EO14024", "UKRAINE-EO13662"],
                lists: ["SDN", "Non-SDN"],
                addresses: ["46 Volodymyrska street"],
                bestNameScore: 100,
                manualReviewRecommended: true,
              },
            ],
            sourceFreshness: {
              sdnLastUpdated: "2026-03-13T00:00:00",
              consolidatedLastUpdated: "2026-01-08T00:00:00",
            },
            screeningOnly: true,
          },
          source: "OFAC Sanctions List Service",
        },
      },
      {
        key: "GET /api/restricted-party/screen/*",
        method: "GET",
        routePath: "/api/restricted-party/screen/*",
        expressPath: "/api/restricted-party/screen/:name",
        resourcePath: "/api/restricted-party/screen/SBERBANK",
        canonicalPath: "/api/restricted-party/screen/SBERBANK?minScore=90&limit=5",
        price: "0.005",
        description:
          "Legacy alias for OFAC sanctions and restricted-party screening. Returns grouped potential matches, aliases, source lists, sanctions programs, and a manual-review recommendation. Optional query params: minScore, type, country, program, list, limit.",
        queryExample: { minScore: "90", limit: "5" },
        outputExample: {
          success: true,
          data: {
            query: {
              name: "SBERBANK",
              minScore: 90,
              limit: 5,
            },
            summary: {
              matchCount: 1,
              exactMatchCount: 1,
              manualReviewRecommended: true,
            },
            matches: [
              {
                id: 18715,
                primaryName: "AKTSIONERNE TOVARYSTVO SBERBANK",
                aliases: ["JOINT STOCK COMPANY SBERBANK", "JSC SBERBANK"],
                type: "Entity",
                programs: ["RUSSIA-EO14024", "UKRAINE-EO13662"],
                lists: ["SDN", "Non-SDN"],
                addresses: ["46 Volodymyrska street"],
                bestNameScore: 100,
                manualReviewRecommended: true,
              },
            ],
            sourceFreshness: {
              sdnLastUpdated: "2026-03-13T00:00:00",
              consolidatedLastUpdated: "2026-01-08T00:00:00",
            },
            screeningOnly: true,
          },
          source: "OFAC Sanctions List Service",
        },
      },
    ],
  },
  {
    id: "weather-decision",
    serviceName: "Weather Decision Brief",
    serviceDescription:
      "Paid x402 API for actionable weather decisions and short-horizon forecast planning.",
    category: "Weather & Environment",
    launchTier: "P1",
    heroRouteKey: "GET /api/weather/current/*",
    surfaceHeroRouteKey: "GET /api/weather/current",
    heroExpressPath: "/api/weather/current/:lat/:lon",
    routeKeys: [
      "GET /api/weather/current/*",
      "GET /api/weather/current",
      "GET /api/weather/forecast",
    ],
    bazaarSearchTerms: ["weather api", "forecast api", "commute weather", "outdoor planning"],
    upstreams: ["Open-Meteo API"],
    why:
      "Strongest live weather demand in the warehouse, with the path-form route serving as the clean Bazaar canonical.",
    surfaceRoutes: [
      {
        key: "GET /api/weather/current",
        method: "GET",
        routePath: "/api/weather/current",
        expressPath: "/api/weather/current",
        resourcePath: "/api/weather/current",
        canonicalPath: "/api/weather/current?lat=40.7128&lon=-74.0060",
        price: "0.003",
        description:
          "Actionable current weather decision brief for any lat/lon -- current conditions, rain timing, outdoor score, commute risk, and what to bring. Query: ?lat=40.7&lon=-74.0. Path form also available at /api/weather/current/40.7128/-74.0060",
        queryExample: { lat: "40.7128", lon: "-74.0060" },
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
              summary:
                "Bring a coat; looks dry for the next several hours; commute conditions look manageable",
              outdoorScore: 72,
              commuteRisk: "low",
              coatRecommended: true,
              umbrellaRecommended: false,
            },
          },
          source: "Open-Meteo API",
        },
      },
      {
        key: "GET /api/weather/current/*",
        method: "GET",
        routePath: "/api/weather/current/*",
        expressPath: "/api/weather/current/:lat/:lon",
        resourcePath: "/api/weather/current/40.7128/-74.0060",
        canonicalPath: "/api/weather/current/40.7128/-74.0060",
        price: "0.003",
        description:
          "Actionable weather decision brief for exact coordinates encoded in the path -- current conditions, rain timing, outdoor score, commute risk, and what to bring. e.g. GET /api/weather/current/40.7128/-74.0060",
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
              summary:
                "Bring a coat; looks dry for the next several hours; commute conditions look manageable",
              outdoorScore: 72,
              commuteRisk: "low",
              coatRecommended: true,
              umbrellaRecommended: false,
            },
          },
          source: "Open-Meteo API",
        },
      },
      {
        key: "GET /api/weather/forecast",
        method: "GET",
        routePath: "/api/weather/forecast",
        expressPath: "/api/weather/forecast",
        resourcePath: "/api/weather/forecast",
        canonicalPath: "/api/weather/forecast?lat=40.7128&lon=-74.0060&days=7",
        price: "0.005",
        description:
          "Daily weather forecast (1-16 days) for any lat/lon -- high/low temps (F), precipitation, chance of rain, max wind, condition. Query: ?lat=40.7&lon=-74.0&days=7",
        queryExample: { lat: "40.7128", lon: "-74.0060", days: "7" },
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
      },
    ],
  },
  {
    id: "calendar-business-days",
    serviceName: "Business Day Planner",
    serviceDescription:
      "Paid x402 API for next-business-day planning, holiday checks, and calendar scheduling intelligence.",
    category: "Calendar & Scheduling",
    launchTier: "P1",
    heroRouteKey: "GET /api/business-days/next/*",
    surfaceHeroRouteKey: "GET /api/holidays/today/*",
    heroExpressPath: "/api/business-days/next/:country/:date",
    routeKeys: [
      "GET /api/business-days/next/*",
      "GET /api/holidays/today/*",
      "GET /api/holidays/*",
    ],
    bazaarSearchTerms: [
      "business day api",
      "holiday api",
      "next business day",
      "calendar planning",
    ],
    upstreams: ["Nager.Date API"],
    why:
      "Holiday probes are already strong, and the next-business-day route is the better planning product for agents.",
    surfaceRoutes: [
      {
        key: "GET /api/holidays/today/*",
        method: "GET",
        routePath: "/api/holidays/today/*",
        expressPath: "/api/holidays/today/:country",
        resourcePath: "/api/holidays/today/US",
        canonicalPath: "/api/holidays/today/US",
        price: "0.002",
        description:
          "Business-day intelligence for the current local date in a country -- holiday status, weekend status, next holiday, and next business day. Optional ?tz=America/New_York. e.g. GET /api/holidays/today/US",
        queryExample: { tz: "America/New_York" },
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
      },
      {
        key: "GET /api/business-days/next/*",
        method: "GET",
        routePath: "/api/business-days/next/*",
        expressPath: "/api/business-days/next/:country/:date",
        resourcePath: "/api/business-days/next/US/2026-03-15",
        canonicalPath: "/api/business-days/next/US/2026-03-15?tz=America/New_York",
        price: "0.002",
        description:
          "Find the next business day on or after a specific date for a country. Returns whether the input date is already a business day, any holiday on that date, and the next business day. Optional ?tz=America/New_York. e.g. GET /api/business-days/next/US/2026-03-15",
        queryExample: { tz: "America/New_York" },
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
      },
      {
        key: "GET /api/holidays/*",
        method: "GET",
        routePath: "/api/holidays/*",
        expressPath: "/api/holidays/:country/:year",
        resourcePath: "/api/holidays/US/2026",
        canonicalPath: "/api/holidays/US/2026",
        price: "0.002",
        description:
          "Public holidays for any country and year. Use ISO 3166-1 alpha-2 country codes. e.g. GET /api/holidays/US/2026",
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
      },
    ],
  },
  {
    id: "fx-conversion-quotes",
    serviceName: "FX Conversion Quotes",
    serviceDescription:
      "Paid x402 API for amount-aware currency conversion quotes and fast multi-target FX comparisons.",
    category: "Finance & Markets",
    launchTier: "P1",
    heroRouteKey: "GET /api/exchange-rates/*",
    surfaceHeroRouteKey: "GET /api/exchange-rates/*",
    heroExpressPath: "/api/exchange-rates/quote/:base/:target/:amount",
    routeKeys: ["GET /api/exchange-rates/*"],
    bazaarSearchTerms: ["exchange rates api", "currency conversion api", "fx quote api"],
    upstreams: ["ExchangeRate-API (open.er-api.com)"],
    why:
      "One of the clearest high-demand routes already, with a very simple buyer story and cheap per-call economics.",
    surfaceRoutes: [
      {
        key: "GET /api/exchange-rates/*",
        method: "GET",
        routePath: "/api/exchange-rates/*",
        expressPath: "/api/exchange-rates/:base",
        resourcePath: "/api/exchange-rates/USD",
        canonicalPath: "/api/exchange-rates/USD?to=EUR,GBP,JPY&amount=100",
        price: "0.003",
        description:
          "Currency conversion quotes from a base currency. Returns multi-target rates, converted totals, and a primary quote. Query: ?to=EUR,GBP,JPY&amount=100. Direct path form also available at /api/exchange-rates/quote/USD/EUR/100.",
        queryExample: { to: "EUR,GBP,JPY", amount: "100" },
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
      },
      {
        key: "GET /api/exchange-rates/quote/*",
        method: "GET",
        routePath: "/api/exchange-rates/quote/*",
        expressPath: "/api/exchange-rates/quote/:base/:target/:amount",
        resourcePath: "/api/exchange-rates/quote/USD/EUR/100",
        canonicalPath: "/api/exchange-rates/quote/USD/EUR/100",
        price: "0.003",
        description:
          "Direct FX quote path for a specific base, target, and amount. Returns converted total, rate, inverse rate, and a one-line quote summary. e.g. GET /api/exchange-rates/quote/USD/EUR/100",
        outputExample: {
          success: true,
          data: {
            base: "USD",
            target: "EUR",
            requestedAmount: 100,
            rate: 0.8672,
            inverseRate: 1.1531,
            convertedAmount: 86.72,
            summary: "100 USD = 86.72 EUR",
          },
          source: "ExchangeRate-API (open.er-api.com)",
        },
      },
    ],
  },
  {
    id: "vehicle-vin",
    serviceName: "VIN Decoder",
    serviceDescription:
      "Paid x402 API for decoding vehicle VINs into make, model, trim, drivetrain, engine, and production metadata.",
    category: "Vehicles & Mobility",
    launchTier: "P1",
    heroRouteKey: "GET /api/vin/*",
    heroExpressPath: "/api/vin/:vin",
    routeKeys: ["GET /api/vin/*"],
    bazaarSearchTerms: ["vin decoder api", "vehicle lookup api", "car vin api"],
    upstreams: ["NHTSA vPIC API"],
    why:
      "Simple exact-input lookup with proven paid success and broad applicability across insurance, logistics, and commerce agents.",
  },
  {
    id: "nutrition-search",
    serviceName: "Nutrition Search",
    serviceDescription:
      "Paid x402 API for searching USDA nutrition data by food name and returning clean macros per result.",
    category: "Food & Nutrition",
    launchTier: "P2",
    heroRouteKey: "GET /api/nutrition/search",
    routeKeys: ["GET /api/nutrition/search"],
    bazaarSearchTerms: ["nutrition api", "food macros api", "usda food data api"],
    upstreams: ["USDA FoodData Central"],
    why:
      "The route has meaningful paid usage already, but reliability needs to be stabilized before it becomes a scale candidate.",
  },
  {
    id: "food-barcode",
    serviceName: "Barcode Food Lookup",
    serviceDescription:
      "Paid x402 API for barcode-based packaged food lookup, nutrition facts, ingredients, and allergen signals.",
    category: "Food & Nutrition",
    launchTier: "P2",
    heroRouteKey: "GET /api/food/barcode/*",
    heroExpressPath: "/api/food/barcode/:code",
    routeKeys: ["GET /api/food/barcode/*"],
    bazaarSearchTerms: ["barcode api", "food barcode api", "upc product lookup"],
    upstreams: ["Open Food Facts"],
    why:
      "Low-friction SKU lookup route that complements nutrition search without sharing the same upstream risk.",
  },
  {
    id: "public-health-recalls",
    serviceName: "FDA Recall Monitor",
    serviceDescription:
      "Paid x402 API for FDA food recall lookup, enforcement actions, and recall reason summaries.",
    category: "Government & Civic Data",
    launchTier: "P2",
    heroRouteKey: "GET /api/fda/recalls",
    routeKeys: ["GET /api/fda/recalls"],
    bazaarSearchTerms: ["fda recall api", "food recall api", "product recall monitor"],
    upstreams: ["openFDA"],
    why:
      "Useful operational data for commerce and compliance agents with already-proven paid route traffic.",
  },
  {
    id: "drug-safety-events",
    serviceName: "Drug Safety Events",
    serviceDescription:
      "Paid x402 API for recent FDA adverse event search by drug name with reaction and seriousness summaries.",
    category: "Government & Civic Data",
    launchTier: "P3",
    heroRouteKey: "GET /api/fda/adverse-events",
    routeKeys: ["GET /api/fda/adverse-events"],
    bazaarSearchTerms: ["drug adverse event api", "fda adverse events", "drug safety api"],
    upstreams: ["openFDA"],
    why:
      "Valuable niche dataset, but so far it looks more like supporting inventory than a breakout discovery winner.",
  },
  {
    id: "census-demographics",
    serviceName: "Census Demographics",
    serviceDescription:
      "Paid x402 API for US population, income, and age snapshots by ZIP, state, or nationwide view.",
    category: "Government & Civic Data",
    launchTier: "P2",
    heroRouteKey: "GET /api/census/population",
    routeKeys: ["GET /api/census/population"],
    bazaarSearchTerms: ["census api", "population api", "demographics api"],
    upstreams: ["US Census Bureau ACS"],
    why:
      "Broadly useful decision-support data with proven paid verification and straightforward positioning.",
  },
  {
    id: "economic-inflation",
    serviceName: "Inflation History",
    serviceDescription:
      "Paid x402 API for CPI history and inflation trend snapshots from the Bureau of Labor Statistics.",
    category: "Finance & Markets",
    launchTier: "P3",
    heroRouteKey: "GET /api/bls/cpi",
    routeKeys: ["GET /api/bls/cpi"],
    bazaarSearchTerms: ["cpi api", "inflation api", "bls cpi api"],
    upstreams: ["Bureau of Labor Statistics"],
    why:
      "Solid long-tail business data route with paid proof, but less obvious marketplace demand than FX or weather.",
  },
  {
    id: "economic-unemployment",
    serviceName: "Unemployment History",
    serviceDescription:
      "Paid x402 API for US unemployment history and recent labor-market trend snapshots.",
    category: "Finance & Markets",
    launchTier: "P3",
    heroRouteKey: "GET /api/bls/unemployment",
    routeKeys: ["GET /api/bls/unemployment"],
    bazaarSearchTerms: ["unemployment api", "bls unemployment api", "labor market api"],
    upstreams: ["Bureau of Labor Statistics"],
    why:
      "Useful macro signal, but better treated as catalog breadth after the top-money routes are indexed cleanly.",
  },
  {
    id: "air-quality-zip",
    serviceName: "Air Quality by ZIP",
    serviceDescription:
      "Paid x402 API for current AQI, pollutant details, and category labels by US ZIP code.",
    category: "Weather & Environment",
    launchTier: "P3",
    heroRouteKey: "GET /api/air-quality/*",
    heroExpressPath: "/api/air-quality/:zip",
    routeKeys: ["GET /api/air-quality/*"],
    bazaarSearchTerms: ["air quality api", "aqi api", "pollution api"],
    upstreams: ["AirNow"],
    why:
      "A clear and useful environmental lookup, but live demand has not yet separated it from verification traffic.",
  },
  {
    id: "ip-geolocation",
    serviceName: "IP Geolocation",
    serviceDescription:
      "Paid x402 API for IP-to-location resolution, timezone, ISP, ASN, and coarse network context.",
    category: "Identity & Location",
    launchTier: "P2",
    heroRouteKey: "GET /api/ip/*",
    heroExpressPath: "/api/ip/:ip",
    routeKeys: ["GET /api/ip/*"],
    bazaarSearchTerms: ["ip geolocation api", "ip lookup api", "geoip api"],
    upstreams: ["ip-api.com"],
    why:
      "Commodity but still useful; worth listing once the highest-signal unique routes are already in market.",
  },
  {
    id: "congress-bills",
    serviceName: "Congress Bill Tracker",
    serviceDescription:
      "Paid x402 API for recent congressional bill search, titles, and latest-action snapshots.",
    category: "Government & Civic Data",
    launchTier: "P3",
    heroRouteKey: "GET /api/congress/bills",
    routeKeys: ["GET /api/congress/bills"],
    bazaarSearchTerms: ["congress api", "bill tracker api", "legislation api"],
    upstreams: ["Congress.gov"],
    why:
      "Strong data quality and verification, but likely a niche research route rather than a broad passive-income leader.",
  },
];

module.exports = {
  SELLER_BLUEPRINTS,
};
