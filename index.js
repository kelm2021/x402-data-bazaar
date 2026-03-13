const express = require("express");
const { paymentMiddleware } = require("x402-express");

const app = express();
app.use(express.json());

// Trust Vercel's proxy so req.protocol returns "https" instead of "http"
app.set("trust proxy", 1);

const PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";

// --- x402 route pricing & schemas ---
const routeConfig = {
  // No-key APIs — use * wildcards for x402 route matching (not Express :params)
  "GET /api/vin/*": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Decode any 17-character VIN — returns year, make, model, trim, body class, drive type, fuel type, engine specs, transmission, and plant country. e.g. GET /api/vin/1HGCM82633A004352",
    },
  },
  "GET /api/weather/current": {
    price: ".003",
    network: "base",
    config: {
      description:
        "Current weather for any lat/lon — temperature (°F), feels-like, humidity, precipitation, wind speed/direction, and condition text. Query: ?lat=40.7&lon=-74.0",
    },
  },
  "GET /api/weather/forecast": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Daily weather forecast (1-16 days) for any lat/lon — high/low temps (°F), precipitation, chance of rain, max wind, condition. Query: ?lat=40.7&lon=-74.0&days=7",
    },
  },
  "GET /api/holidays/today/*": {
    price: ".002",
    network: "base",
    config: {
      description:
        "Is today a business day? Returns holiday status, weekend status, isBusinessDay flag, current holiday details, and next upcoming holiday. e.g. GET /api/holidays/today/US",
    },
  },
  "GET /api/holidays/*": {
    price: ".002",
    network: "base",
    config: {
      description:
        "Public holidays for any country and year. Use ISO 3166-1 alpha-2 country codes. e.g. GET /api/holidays/US/2026",
    },
  },
  "GET /api/exchange-rates/*": {
    price: ".003",
    network: "base",
    config: {
      description:
        "Currency exchange rates for 150+ currencies. e.g. GET /api/exchange-rates/USD?symbols=EUR,GBP,JPY. Updated daily.",
    },
  },
  "GET /api/ip/*": {
    price: ".003",
    network: "base",
    config: {
      description:
        "IP geolocation — country, region, city, ZIP, lat/lon, timezone, ISP, org, and ASN. e.g. GET /api/ip/8.8.8.8",
    },
  },
  "GET /api/food/barcode/*": {
    price: ".003",
    network: "base",
    config: {
      description:
        "Product lookup by barcode/UPC — name, brand, ingredients, nutri-score, full nutrition facts per 100g, allergens, image. e.g. GET /api/food/barcode/737628064502",
    },
  },

  // Keyed APIs
  "GET /api/nutrition/search": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Search USDA FoodData Central for nutrition data — calories, protein, fat, carbs, fiber, sugar, sodium, cholesterol per food. Query: ?query=chicken breast&limit=5",
    },
  },
  "GET /api/fda/recalls": {
    price: ".005",
    network: "base",
    config: {
      description:
        "FDA food recall enforcement actions — product description, reason, classification, company, status. Optional ?query=peanut&limit=10",
    },
  },
  "GET /api/fda/adverse-events": {
    price: ".005",
    network: "base",
    config: {
      description:
        "FDA drug adverse event reports — reactions, suspect drugs, seriousness. Query: ?drug=aspirin&limit=10",
    },
  },
  "GET /api/census/population": {
    price: ".005",
    network: "base",
    config: {
      description:
        "US Census population, median household income, and median age. Query by ZIP (?zip=20002), state FIPS (?state=06), or omit for all states. ACS 5-year estimates.",
    },
  },
  "GET /api/bls/cpi": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Consumer Price Index (CPI-U) — All Items, US City Average. Monthly values with history. Optional ?years=10 (default 5).",
    },
  },
  "GET /api/bls/unemployment": {
    price: ".005",
    network: "base",
    config: {
      description:
        "US unemployment rate (seasonally adjusted). Monthly values with history. Optional ?years=10 (default 5).",
    },
  },
  "GET /api/air-quality/*": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Current air quality index (AQI) by US ZIP code — PM2.5, ozone readings, category (Good/Moderate/Unhealthy), reporting area. e.g. GET /api/air-quality/20002",
    },
  },
  "GET /api/congress/bills": {
    price: ".005",
    network: "base",
    config: {
      description:
        "Recent Congressional bills — title, latest action, origin chamber, update date. Optional ?congress=119&limit=20. From Congress.gov.",
    },
  },
  "GET /api/fec/candidates": {
    price: ".005",
    network: "base",
    config: {
      description:
        "FEC candidate search — name, party, office, state, district, incumbent status, election cycles. Query: ?name=smith&office=S&state=CA",
    },
  },
};

const payment = paymentMiddleware(PAY_TO, routeConfig);

// --- Health check (free) ---
app.get("/", (req, res) => {
  const endpoints = Object.keys(routeConfig).map((key) => {
    const [method, path] = key.split(" ");
    return {
      method,
      path,
      price: routeConfig[key].price ? `$${routeConfig[key].price} USDC` : routeConfig[key],
      description: routeConfig[key].config?.description || null,
    };
  });

  res.json({
    name: "x402 Data Bazaar",
    description: "Real-world data APIs for AI agents — weather, nutrition, VIN, census, FDA, and more. Pay per request with USDC on Base.",
    version: "1.0.0",
    endpoints: endpoints.length,
    catalog: endpoints,
    payment: { network: "Base", currency: "USDC", protocol: "x402" },
  });
});

// --- Mount routes with payment middleware ---
app.use(payment, require("./routes/vin"));
app.use(payment, require("./routes/weather"));
app.use(payment, require("./routes/holidays"));
app.use(payment, require("./routes/exchange-rates"));
app.use(payment, require("./routes/ip"));
app.use(payment, require("./routes/food"));
app.use(payment, require("./routes/nutrition"));
app.use(payment, require("./routes/fda"));
app.use(payment, require("./routes/census"));
app.use(payment, require("./routes/bls"));
app.use(payment, require("./routes/air-quality"));
app.use(payment, require("./routes/congress"));
app.use(payment, require("./routes/fec"));

const PORT = process.env.PORT || 4402;
app.listen(PORT, () => console.log(`x402 Data Bazaar running on port ${PORT}`));

module.exports = app;
