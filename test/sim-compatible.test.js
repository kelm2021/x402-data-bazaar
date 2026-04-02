const assert = require("node:assert/strict");
const test = require("node:test");
const { appendSimCompatible, buildSimCompatible } = require("../lib/sim-compatible");

function assertApprox(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance);
}

test("buildSimCompatible enriches BLS unemployment responses", () => {
  const payload = {
    success: true,
    data: {
      latest: {
        rate_pct: 4.4,
      },
    },
    source: "Bureau of Labor Statistics",
  };

  const simCompatible = buildSimCompatible("/api/bls/unemployment", payload);

  assert.ok(simCompatible);
  assert.equal(simCompatible.parameters.unemployment_rate.raw, 4.4);
  assert.equal(simCompatible.parameters.unemployment_rate.normalized, 0.2);
  assert.equal(simCompatible.parameters.unemployment_rate.formula, "(5.0 - value) / 3.0");
});

test("buildSimCompatible enriches stock candles with clamped momentum and volatility", () => {
  const payload = {
    success: true,
    data: {
      candles: [{ open: 100, close: 105, high: 110, low: 95 }],
    },
    source: "Alpha Vantage API",
  };

  const simCompatible = buildSimCompatible("/api/stocks/candles/AAPL", payload);

  assert.ok(simCompatible);
  assert.equal(simCompatible.parameters.price_momentum.raw, 0.05);
  assert.equal(simCompatible.parameters.price_momentum.normalized, 0.5);
  assert.equal(simCompatible.parameters.volatility.raw, 0.15);
  assert.equal(simCompatible.parameters.volatility.normalized, 1);
});

test("buildSimCompatible skips unsupported endpoints", () => {
  const payload = {
    success: true,
    data: {
      current: { uvIndex: 4 },
    },
  };

  const simCompatible = buildSimCompatible("/api/weather/current/40.7/-74.0", payload);
  assert.equal(simCompatible, null);
});

test("appendSimCompatible adds sanctions risk parameter", () => {
  const payload = {
    success: true,
    data: {
      summary: { matchCount: 5 },
    },
  };

  const enriched = appendSimCompatible("/api/sanctions/ACME", payload);
  const expected = -(Math.log(6) / Math.log(21));

  assert.ok(enriched.simCompatible);
  assert.equal(enriched.simCompatible.parameters.sanctions_risk.raw, 5);
  assert.ok(
    Math.abs(enriched.simCompatible.parameters.sanctions_risk.normalized - expected) < 0.000001,
  );
});

test("appendSimCompatible ignores exchange quote alias path", () => {
  const payload = {
    success: true,
    data: {
      base: "USD",
      quotes: [{ target: "EUR", rate: 0.92 }],
    },
  };

  const enriched = appendSimCompatible("/api/exchange-rates/quote/USD/EUR/100", payload);
  assert.equal(enriched.simCompatible, undefined);
});

test("appendSimCompatible enriches world bank response", () => {
  const payload = {
    success: true,
    data: {
      observations: [{ value: 27000000000000 }],
    },
  };

  const enriched = appendSimCompatible("/api/worldbank/US/NY.GDP.MKTP.CD", payload);

  assert.ok(enriched.simCompatible);
  assert.equal(enriched.simCompatible.parameters.indicator_signal.raw, 27000000000000);
  assert.ok(enriched.simCompatible.parameters.indicator_signal.normalized > 0.9);
});

test("buildSimCompatible enriches new macro finance endpoints", () => {
  const gold = buildSimCompatible("/api/commodities/gold", {
    success: true,
    data: { latest: { value: 4492 } },
  });
  assert.ok(gold);
  assert.equal(gold.parameters.gold_risk_signal.raw, 4492);
  assertApprox(gold.parameters.gold_risk_signal.normalized, -0.746);

  const oil = buildSimCompatible("/api/commodities/oil", {
    success: true,
    data: { latest: { value: 100 } },
  });
  assert.ok(oil);
  assert.equal(oil.parameters.energy_cost_signal.raw, 100);
  assertApprox(oil.parameters.energy_cost_signal.normalized, -0.5);

  const mortgage = buildSimCompatible("/api/mortgage-rates", {
    success: true,
    data: { latest: { value: 6.5 } },
  });
  assert.ok(mortgage);
  assert.equal(mortgage.parameters.mortgage_affordability.raw, 6.5);
  assertApprox(mortgage.parameters.mortgage_affordability.normalized, -0.375);

  const sp500 = buildSimCompatible("/api/sp500", {
    success: true,
    data: {
      latest: { value: 5000 },
      history: [{ value: 5000 }, { value: 4950 }],
    },
  });
  assert.ok(sp500);
  assertApprox(sp500.parameters.equity_momentum.raw, 0.010101);
  assertApprox(sp500.parameters.equity_momentum.normalized, 0.20202);

  const vix = buildSimCompatible("/api/vix", {
    success: true,
    data: { latest: { value: 30 } },
  });
  assert.ok(vix);
  assert.equal(vix.parameters.volatility_regime.raw, 30);
  assertApprox(vix.parameters.volatility_regime.normalized, -0.5);

  const dollarIndex = buildSimCompatible("/api/dollar-index", {
    success: true,
    data: { latest: { value: 110 } },
  });
  assert.ok(dollarIndex);
  assert.equal(dollarIndex.parameters.usd_broad_strength.raw, 110);
  assertApprox(dollarIndex.parameters.usd_broad_strength.normalized, 0.4);
});

test("buildSimCompatible enriches additional FRED macro endpoints", () => {
  const credit = buildSimCompatible("/api/credit-spreads", {
    success: true,
    data: {
      latest: {
        BAMLH0A0HYM2: { value: 5.2 },
      },
    },
  });
  assert.ok(credit);
  assert.equal(credit.parameters.credit_stress.raw, 5.2);
  assertApprox(credit.parameters.credit_stress.normalized, -0.3);

  const realRates = buildSimCompatible("/api/real-rates", {
    success: true,
    data: {
      avgRealRate: 1.5,
    },
  });
  assert.ok(realRates);
  assert.equal(realRates.parameters.real_rate_signal.raw, 1.5);
  assertApprox(realRates.parameters.real_rate_signal.normalized, -0.25);

  const inflationExpectations = buildSimCompatible("/api/inflation-expectations", {
    success: true,
    data: {
      latest: {
        T5YIE: { value: 2.1 },
        T10YIE: { value: 2.4 },
      },
    },
  });
  assert.ok(inflationExpectations);
  assert.equal(inflationExpectations.parameters.inflation_expectation_anchor.raw, 2.25);
  assertApprox(inflationExpectations.parameters.inflation_expectation_anchor.normalized, 0.033333);
});
