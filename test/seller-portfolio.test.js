const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSellerScaffoldConfig,
  createPortfolioReport,
  createSellerPortfolio,
} = require("../portfolio");
const { installPortfolioTemplate } = require("../portfolio/templates");

test("seller portfolio exposes focused hero sellers with warehouse route metadata", () => {
  const portfolio = createSellerPortfolio();
  const weather = portfolio.find((seller) => seller.id === "weather-decision");

  assert.ok(weather);
  assert.equal(weather.heroRoute.key, "GET /api/weather/current/*");
  assert.equal(weather.heroExpressPath, "/api/weather/current/:lat/:lon");
  assert.equal(weather.heroRoute.resourcePath, "/api/weather/current/40.7128/-74.0060");
  assert.equal(weather.routes.length, 3);
  assert.equal(weather.surfaceHeroRoute.key, "GET /api/weather/current");
  assert.equal(weather.surfaceRoutes.length, 3);
});

test("buildSellerScaffoldConfig derives a Bazaar-ready hero route config", () => {
  const config = buildSellerScaffoldConfig("fx-conversion-quotes");

  assert.equal(config.packageName, "fx-conversion-quotes");
  assert.equal(config.route.key, "GET /api/exchange-rates/*");
  assert.equal(config.route.expressPath, "/api/exchange-rates/:base");
  assert.equal(config.route.resourcePath, "/api/exchange-rates/USD");
  assert.deepEqual(config.route.queryExample, { to: "EUR,GBP,JPY", amount: "100" });
  assert.equal(config.portfolio.launchTier, "P1");
});

test("installPortfolioTemplate copies a real handler into a generated seller", async () => {
  const sellerDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-template-test-"));

  try {
    await fs.writeFile(
      path.join(sellerDir, "seller.config.json"),
      `${JSON.stringify({ route: { key: "GET /api/example" } }, null, 2)}\n`,
      "utf8",
    );
    const result = await installPortfolioTemplate({
      sellerId: "weather-decision",
      sellerDir,
    });
    const targetFile = path.join(sellerDir, "handlers", "primary.js");
    const content = await fs.readFile(targetFile, "utf8");
    const sellerConfig = JSON.parse(
      await fs.readFile(path.join(sellerDir, "seller.config.json"), "utf8"),
    );

    assert.equal(result.installed, true);
    assert.match(content, /Open-Meteo API/);
    assert.match(content, /buildDecisionBrief/);
    assert.equal(result.configSync.updated, true);
    assert.equal(sellerConfig.route.key, "GET /api/weather/current");
    assert.equal(sellerConfig.routes.length, 3);
  } finally {
    await fs.rm(sellerDir, { recursive: true, force: true });
  }
});

test("createPortfolioReport prioritizes discovery gaps and flags reliability risks", () => {
  const report = createPortfolioReport({
    metricsSummary: {
      generatedAt: "2026-03-16T17:00:00.000Z",
      routes: [
        {
          key: "GET /api/weather/current/*",
          total: 6,
          success: 2,
          paidSuccess: 2,
          paymentRequired: 4,
          clientErrors: 0,
          serverErrors: 0,
          averageLatencyMs: 701,
          lastSeenAt: "2026-03-15T16:29:07.076Z",
        },
        {
          key: "GET /api/weather/current",
          total: 369,
          success: 1,
          paidSuccess: 1,
          paymentRequired: 367,
          clientErrors: 1,
          serverErrors: 0,
          averageLatencyMs: 17,
          lastSeenAt: "2026-03-16T17:00:15.133Z",
        },
        {
          key: "GET /api/weather/forecast",
          total: 8,
          success: 1,
          paidSuccess: 1,
          paymentRequired: 4,
          clientErrors: 3,
          serverErrors: 0,
          averageLatencyMs: 223,
          lastSeenAt: "2026-03-13T14:16:05.934Z",
        },
        {
          key: "GET /api/nutrition/search",
          total: 15,
          success: 4,
          paidSuccess: 4,
          paymentRequired: 9,
          clientErrors: 0,
          serverErrors: 2,
          averageLatencyMs: 503,
          lastSeenAt: "2026-03-15T16:43:14.334Z",
        },
      ],
    },
    discoveryItems: [
      {
        resource: "https://x402.aurelianflo.com/api/weather/current/40.7128/-74.0060",
        lastUpdated: "2026-03-16T17:00:00.000Z",
      },
    ],
  });

  const weather = report.sellers.find((seller) => seller.id === "weather-decision");
  const nutrition = report.sellers.find((seller) => seller.id === "nutrition-search");

  assert.equal(weather.discovery.indexed, true);
  assert.equal(weather.action, "keep-live");
  assert.equal(weather.metrics.paymentRequired, 375);

  assert.equal(nutrition.action, "hold-or-retire");
  assert.equal(nutrition.metrics.serverErrors, 2);
});

