const express = require("express");
const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
const { HTTPFacilitatorClient } = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");

const app = express();
app.use(express.json());

// Trust Vercel's proxy so req.protocol returns "https" instead of "http"
app.set("trust proxy", 1);

const PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";
const NETWORK = "eip155:8453"; // Base mainnet (CAIP-2)

// --- Helper to build a route config entry ---
const route = (price, description) => ({
  accepts: [{ scheme: "exact", price, network: NETWORK, payTo: PAY_TO }],
  description,
  mimeType: "application/json",
});

// --- x402 route pricing & schemas ---
const routeConfig = {
  // No-key APIs
  "GET /api/vin/*": route("$0.005",
    "Decode any 17-character VIN — returns year, make, model, trim, body class, drive type, fuel type, engine specs, transmission, and plant country. e.g. GET /api/vin/1HGCM82633A004352"),
  "GET /api/weather/current": route("$0.003",
    "Current weather for any lat/lon — temperature (°F), feels-like, humidity, precipitation, wind speed/direction, and condition text. Query: ?lat=40.7&lon=-74.0"),
  "GET /api/weather/forecast": route("$0.005",
    "Daily weather forecast (1-16 days) for any lat/lon — high/low temps (°F), precipitation, chance of rain, max wind, condition. Query: ?lat=40.7&lon=-74.0&days=7"),
  "GET /api/holidays/today/*": route("$0.002",
    "Is today a business day? Returns holiday status, weekend status, isBusinessDay flag, current holiday details, and next upcoming holiday. e.g. GET /api/holidays/today/US"),
  "GET /api/holidays/*": route("$0.002",
    "Public holidays for any country and year. Use ISO 3166-1 alpha-2 country codes. e.g. GET /api/holidays/US/2026"),
  "GET /api/exchange-rates/*": route("$0.003",
    "Currency exchange rates for 150+ currencies. e.g. GET /api/exchange-rates/USD?symbols=EUR,GBP,JPY. Updated daily."),
  "GET /api/ip/*": route("$0.003",
    "IP geolocation — country, region, city, ZIP, lat/lon, timezone, ISP, org, and ASN. e.g. GET /api/ip/8.8.8.8"),
  "GET /api/food/barcode/*": route("$0.003",
    "Product lookup by barcode/UPC — name, brand, ingredients, nutri-score, full nutrition facts per 100g, allergens, image. e.g. GET /api/food/barcode/737628064502"),

  // Keyed APIs
  "GET /api/nutrition/search": route("$0.005",
    "Search USDA FoodData Central for nutrition data — calories, protein, fat, carbs, fiber, sugar, sodium, cholesterol per food. Query: ?query=chicken breast&limit=5"),
  "GET /api/fda/recalls": route("$0.005",
    "FDA food recall enforcement actions — product description, reason, classification, company, status. Optional ?query=peanut&limit=10"),
  "GET /api/fda/adverse-events": route("$0.005",
    "FDA drug adverse event reports — reactions, suspect drugs, seriousness. Query: ?drug=aspirin&limit=10"),
  "GET /api/census/population": route("$0.005",
    "US Census population, median household income, and median age. Query by ZIP (?zip=20002), state FIPS (?state=06), or omit for all states. ACS 5-year estimates."),
  "GET /api/bls/cpi": route("$0.005",
    "Consumer Price Index (CPI-U) — All Items, US City Average. Monthly values with history. Optional ?years=10 (default 5)."),
  "GET /api/bls/unemployment": route("$0.005",
    "US unemployment rate (seasonally adjusted). Monthly values with history. Optional ?years=10 (default 5)."),
  "GET /api/air-quality/*": route("$0.005",
    "Current air quality index (AQI) by US ZIP code — PM2.5, ozone readings, category (Good/Moderate/Unhealthy), reporting area. e.g. GET /api/air-quality/20002"),
  "GET /api/congress/bills": route("$0.005",
    "Recent Congressional bills — title, latest action, origin chamber, update date. Optional ?congress=119&limit=20. From Congress.gov."),
  "GET /api/fec/candidates": route("$0.005",
    "FEC candidate search — name, party, office, state, district, incumbent status, election cycles. Query: ?name=smith&office=S&state=CA"),
};

// --- Lazy-init: dynamic import of ESM-only @coinbase/x402 on first request ---
let paymentReady = null;

function getPaymentMiddleware() {
  if (!paymentReady) {
    paymentReady = import("@coinbase/x402").then(({ createFacilitatorConfig }) => {
      const facilitatorConfig = createFacilitatorConfig(
        process.env.CDP_API_KEY_ID,
        process.env.CDP_API_KEY_SECRET,
      );
      const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
      const resourceServer = new x402ResourceServer(facilitatorClient)
        .register(NETWORK, new ExactEvmScheme());
      return paymentMiddleware(routeConfig, resourceServer);
    });
  }
  return paymentReady;
}

// Payment gate: waits for lazy init, then delegates to x402 middleware
const paymentGate = async (req, res, next) => {
  try {
    const mw = await getPaymentMiddleware();
    mw(req, res, next);
  } catch (err) {
    res.status(500).json({ error: "Payment middleware init failed", details: err.message });
  }
};

// --- Debug: test CDP API connectivity ---
app.get("/debug/cdp", async (req, res) => {
  try {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    const config = createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);
    const headers = await config.createAuthHeaders();
    const supportedHeaders = headers.supported || {};
    const r = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/supported", {
      headers: supportedHeaders,
    });
    const data = await r.text();
    res.json({ status: r.status, envKeySet: !!process.env.CDP_API_KEY_ID, headers: Object.keys(supportedHeaders), body: data.substring(0, 500) });
  } catch (err) {
    res.json({ error: err.message, stack: err.stack?.substring(0, 300) });
  }
});

// --- Health check (free) ---
app.get("/", (req, res) => {
  const endpoints = Object.keys(routeConfig).map((key) => {
    const [method, path] = key.split(" ");
    const entry = routeConfig[key];
    return {
      method,
      path,
      price: `${entry.accepts[0].price} USDC`,
      description: entry.description,
    };
  });

  res.json({
    name: "x402 Data Bazaar",
    description: "Real-world data APIs for AI agents — weather, nutrition, VIN, census, FDA, and more. Pay per request with USDC on Base.",
    version: "2.0.0",
    endpoints: endpoints.length,
    catalog: endpoints,
    payment: { network: "Base", currency: "USDC", protocol: "x402" },
  });
});

// --- Mount routes with payment middleware ---
app.use(paymentGate, require("./routes/vin"));
app.use(paymentGate, require("./routes/weather"));
app.use(paymentGate, require("./routes/holidays"));
app.use(paymentGate, require("./routes/exchange-rates"));
app.use(paymentGate, require("./routes/ip"));
app.use(paymentGate, require("./routes/food"));
app.use(paymentGate, require("./routes/nutrition"));
app.use(paymentGate, require("./routes/fda"));
app.use(paymentGate, require("./routes/census"));
app.use(paymentGate, require("./routes/bls"));
app.use(paymentGate, require("./routes/air-quality"));
app.use(paymentGate, require("./routes/congress"));
app.use(paymentGate, require("./routes/fec"));

const PORT = process.env.PORT || 4402;
app.listen(PORT, () => console.log(`x402 Data Bazaar running on port ${PORT}`));

module.exports = app;
