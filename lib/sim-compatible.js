const SIM_HINT =
  "Pass parameters directly to POST /api/sim/*. See GET /api/sim for pipeline examples.";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, precision = 6) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clampNormalized(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(-1, Math.min(1, value));
}

function buildParameter(rawValue, normalizedValue, formula, interpretation) {
  if (!Number.isFinite(rawValue)) {
    return null;
  }

  const clampedNormalized = clampNormalized(normalizedValue);
  if (!Number.isFinite(clampedNormalized)) {
    return null;
  }

  return {
    raw: roundNumber(rawValue),
    normalized: roundNumber(clampedNormalized),
    formula,
    range: [-1, 1],
    interpretation,
  };
}

function normalizePath(pathname) {
  return String(pathname || "").split("?")[0];
}

function isRouteMatch(pathname, pattern) {
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }

  return pathname === pattern;
}

function average(values) {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function sumValues(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function pickFirstWorldBankValue(observations) {
  if (!Array.isArray(observations)) {
    return null;
  }

  for (const row of observations) {
    const value = toFiniteNumber(row?.value);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

const SIM_COMPATIBILITY_RULES = [
  {
    pattern: "/api/bls/unemployment",
    build(data) {
      const value = toFiniteNumber(data?.latest?.rate_pct);
      return {
        unemployment_rate: buildParameter(
          value,
          Number.isFinite(value) ? (5 - value) / 3 : null,
          "(5.0 - value) / 3.0",
          "positive = healthy labor market",
        ),
      };
    },
  },
  {
    pattern: "/api/bls/cpi",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        inflation_level: buildParameter(
          value,
          Number.isFinite(value) ? (280 - value) / 200 : null,
          "(280 - value) / 200",
          "positive = low inflation, negative = high",
        ),
      };
    },
  },
  {
    pattern: "/api/bls/jobs",
    build(data) {
      const value = toFiniteNumber(data?.latest?.jobs_thousands);
      return {
        employment_strength: buildParameter(
          value,
          Number.isFinite(value) ? (value - 150000) / 20000 : null,
          "(value - 150000) / 20000",
          "positive = strong job creation",
        ),
      };
    },
  },
  {
    pattern: "/api/bls/wages",
    build(data) {
      const value = toFiniteNumber(data?.latest?.avg_hourly_earnings_usd);
      return {
        wage_growth: buildParameter(
          value,
          Number.isFinite(value) ? (value - 30) / 18 : null,
          "(value - 30) / 18",
          "positive = above-trend wages",
        ),
      };
    },
  },
  {
    pattern: "/api/fed-funds-rate",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        monetary_pressure: buildParameter(
          value,
          Number.isFinite(value) ? (3 - value) / 4 : null,
          "(3.0 - value) / 4.0",
          "positive = accommodative, negative = restrictive",
        ),
      };
    },
  },
  {
    pattern: "/api/treasury-rates",
    build(data) {
      const rateValues = Object.values(data?.latest || {})
        .map((entry) => toFiniteNumber(entry?.value))
        .filter((value) => Number.isFinite(value));
      const value = average(rateValues);

      return {
        rate_environment: buildParameter(
          value,
          Number.isFinite(value) ? (3 - value) / 4 : null,
          "(3.0 - value) / 4.0",
          "positive = low rates, negative = high",
        ),
      };
    },
  },
  {
    pattern: "/api/commodities/gold",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        gold_risk_signal: buildParameter(
          value,
          Number.isFinite(value) ? (3000 - value) / 2000 : null,
          "(3000 - value) / 2000",
          "positive = lower risk-off pressure, negative = elevated safe-haven demand",
        ),
      };
    },
  },
  {
    pattern: "/api/commodities/oil",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        energy_cost_signal: buildParameter(
          value,
          Number.isFinite(value) ? (75 - value) / 50 : null,
          "(75 - value) / 50",
          "positive = lower energy cost pressure, negative = elevated oil prices",
        ),
      };
    },
  },
  {
    pattern: "/api/mortgage-rates",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        mortgage_affordability: buildParameter(
          value,
          Number.isFinite(value) ? (5 - value) / 4 : null,
          "(5.0 - value) / 4.0",
          "positive = more affordable borrowing, negative = tighter housing finance",
        ),
      };
    },
  },
  {
    pattern: "/api/sp500",
    build(data) {
      const latest = toFiniteNumber(data?.history?.[0]?.value ?? data?.latest?.value);
      const previous = toFiniteNumber(data?.history?.[1]?.value);
      const momentum =
        Number.isFinite(latest) && Number.isFinite(previous) && previous !== 0
          ? (latest - previous) / previous
          : null;

      return {
        equity_momentum: buildParameter(
          momentum,
          Number.isFinite(momentum) ? momentum * 20 : null,
          "((latest - previous) / previous) * 20, clamped",
          "positive = bullish benchmark momentum, negative = risk-off momentum",
        ),
      };
    },
  },
  {
    pattern: "/api/vix",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        volatility_regime: buildParameter(
          value,
          Number.isFinite(value) ? (20 - value) / 20 : null,
          "(20 - value) / 20",
          "positive = calmer risk regime, negative = elevated fear",
        ),
      };
    },
  },
  {
    pattern: "/api/dollar-index",
    build(data) {
      const value = toFiniteNumber(data?.latest?.value);
      return {
        usd_broad_strength: buildParameter(
          value,
          Number.isFinite(value) ? (value - 100) / 25 : null,
          "(value - 100) / 25",
          "positive = broad USD strength, negative = broad USD weakness",
        ),
      };
    },
  },
  {
    pattern: "/api/credit-spreads",
    build(data) {
      const value = toFiniteNumber(data?.latest?.BAMLH0A0HYM2?.value);
      return {
        credit_stress: buildParameter(
          value,
          Number.isFinite(value) ? (4 - value) / 4 : null,
          "(4.0 - value) / 4.0",
          "positive = tighter credit conditions eased, negative = widening risk spreads",
        ),
      };
    },
  },
  {
    pattern: "/api/real-rates",
    build(data) {
      const value = toFiniteNumber(data?.avgRealRate);
      return {
        real_rate_signal: buildParameter(
          value,
          Number.isFinite(value) ? (1 - value) / 2 : null,
          "(1.0 - value) / 2.0",
          "positive = more accommodative real-rate backdrop, negative = tighter real rates",
        ),
      };
    },
  },
  {
    pattern: "/api/inflation-expectations",
    build(data) {
      const fiveYear = toFiniteNumber(data?.latest?.T5YIE?.value);
      const tenYear = toFiniteNumber(data?.latest?.T10YIE?.value);
      const value =
        Number.isFinite(fiveYear) && Number.isFinite(tenYear)
          ? (fiveYear + tenYear) / 2
          : null;

      return {
        inflation_expectation_anchor: buildParameter(
          value,
          Number.isFinite(value) ? (2.3 - value) / 1.5 : null,
          "(2.3 - value) / 1.5",
          "positive = anchored/contained inflation expectations, negative = expectations running hot",
        ),
      };
    },
  },
  {
    pattern: "/api/yield-curve",
    build(data) {
      const value = toFiniteNumber(data?.spread10y2y);
      return {
        yield_signal: buildParameter(
          value,
          Number.isFinite(value) ? value / 2 : null,
          "value / 2.0",
          "positive = normal curve, negative = inverted",
        ),
      };
    },
  },
  {
    pattern: "/api/census/population",
    build(data) {
      const value = toFiniteNumber(data?.locations?.[0]?.population);
      return {
        population_density_signal: buildParameter(
          value,
          Number.isFinite(value) && value > 0
            ? Math.log10(value) / Math.log10(1000000) - 0.5
            : null,
          "log10(value) / log10(1000000) - 0.5",
          "positive = high population",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/census\/income\/[^/]+$/,
    build(data) {
      const value = toFiniteNumber(data?.medianHouseholdIncome);
      return {
        income_signal: buildParameter(
          value,
          Number.isFinite(value) ? (value - 55000) / 60000 : null,
          "(value - 55000) / 60000",
          "positive = above-median income",
        ),
      };
    },
  },
  {
    pattern: "/api/census/housing",
    build(data) {
      const location = data?.locations?.[0] || null;
      const renterRatio = toFiniteNumber(location?.renterRatioPct);
      let value = Number.isFinite(renterRatio) ? 100 - renterRatio : null;

      if (!Number.isFinite(value)) {
        const ownerOccupied = toFiniteNumber(location?.ownerOccupied);
        const renterOccupied = toFiniteNumber(location?.renterOccupied);
        if (Number.isFinite(ownerOccupied) && Number.isFinite(renterOccupied)) {
          const total = ownerOccupied + renterOccupied;
          value = total > 0 ? (ownerOccupied / total) * 100 : null;
        }
      }

      return {
        homeownership_signal: buildParameter(
          value,
          Number.isFinite(value) ? (value - 60) / 30 : null,
          "(value - 60) / 30",
          "positive = high ownership rate",
        ),
      };
    },
  },
  {
    pattern: "/api/census/age-breakdown",
    build(data) {
      const totalPopulation = toFiniteNumber(data?.totalPopulation);
      const maleYouth = (Array.isArray(data?.male) ? data.male : [])
        .map((entry) => toFiniteNumber(entry?.count))
        .filter((value) => Number.isFinite(value));
      const femaleYouth = (Array.isArray(data?.female) ? data.female : [])
        .map((entry) => toFiniteNumber(entry?.count))
        .filter((value) => Number.isFinite(value));
      const youthPopulation = sumValues([...maleYouth, ...femaleYouth]);
      const value =
        Number.isFinite(totalPopulation) && totalPopulation > 0 && Number.isFinite(youthPopulation)
          ? ((totalPopulation - youthPopulation) / totalPopulation) * 100
          : null;

      return {
        working_age_ratio: buildParameter(
          value,
          Number.isFinite(value) ? (value - 58) / 30 : null,
          "(value - 58) / 30",
          "positive = strong working-age population",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/stocks\/candles\/[^/]+$/,
    build(data) {
      const candle = Array.isArray(data?.candles) ? data.candles[0] : null;
      const open = toFiniteNumber(candle?.open);
      const close = toFiniteNumber(candle?.close);
      const high = toFiniteNumber(candle?.high);
      const low = toFiniteNumber(candle?.low);
      const momentumRaw =
        Number.isFinite(open) && open > 0 && Number.isFinite(close) ? (close - open) / open : null;
      const volatilityRaw =
        Number.isFinite(open) && open > 0 && Number.isFinite(high) && Number.isFinite(low)
          ? (high - low) / open
          : null;

      return {
        price_momentum: buildParameter(
          momentumRaw,
          Number.isFinite(momentumRaw) ? momentumRaw * 10 : null,
          "((close - open) / open) * 10, clamped",
          "positive = uptrend",
        ),
        volatility: buildParameter(
          volatilityRaw,
          Number.isFinite(volatilityRaw) ? volatilityRaw * 20 : null,
          "(high - low) / open * 20, clamped",
          "higher = more volatile",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/exchange-rates\/(?!quote\/)[^/]+$/,
    build(data) {
      const base = String(data?.base || "").trim().toUpperCase();
      const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
      const eurRate = toFiniteNumber(
        quotes.find((entry) => String(entry?.target || "").toUpperCase() === "EUR")?.rate,
      );
      const value = base === "USD" ? eurRate : null;

      return {
        usd_strength: buildParameter(
          value,
          Number.isFinite(value) ? (1 - value) * 2 : null,
          "(1.0 - EUR_rate) * 2",
          "positive = strong USD",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/air-quality\/[^/]+$/,
    build(data) {
      const value = toFiniteNumber(data?.overallAqi);
      return {
        air_quality_signal: buildParameter(
          value,
          Number.isFinite(value) ? (100 - value) / 100 : null,
          "(100 - value) / 100",
          "positive = clean air",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/uv-index\/[^/]+\/[^/]+$/,
    build(data) {
      const value = toFiniteNumber(data?.current?.uvIndex);
      return {
        uv_risk: buildParameter(
          value,
          Number.isFinite(value) ? (5 - value) / 8 : null,
          "(5.0 - value) / 8.0",
          "positive = low UV, negative = high",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/ofac-sanctions-screening\/[^/]+$/,
    build(data) {
      const matchCount = toFiniteNumber(data?.summary?.matchCount);
      return {
        sanctions_risk: buildParameter(
          matchCount,
          Number.isFinite(matchCount) ? -(Math.log(1 + matchCount) / Math.log(1 + 20)) : null,
          "-(log(1 + matchCount) / log(1 + 20))",
          "0 = clean, negative = risk",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/sanctions\/[^/]+$/,
    build(data) {
      const matchCount = toFiniteNumber(data?.summary?.matchCount);
      return {
        sanctions_risk: buildParameter(
          matchCount,
          Number.isFinite(matchCount) ? -(Math.log(1 + matchCount) / Math.log(1 + 20)) : null,
          "-(log(1 + matchCount) / log(1 + 20))",
          "0 = clean, negative = risk",
        ),
      };
    },
  },
  {
    pattern: "/api/congress/bills",
    build(data) {
      const billCount = toFiniteNumber(data?.count);
      return {
        legislative_activity: buildParameter(
          billCount,
          Number.isFinite(billCount) ? Math.min(1, billCount / 30) : null,
          "min(1, billCount / 30)",
          "higher = more activity",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/sec\/filings\/[^/]+$/,
    build(data) {
      const filingCount = toFiniteNumber(data?.count);
      return {
        filing_activity: buildParameter(
          filingCount,
          Number.isFinite(filingCount) ? Math.min(1, filingCount / 30) : null,
          "min(1, filingCount / 30)",
          "higher = more filings",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/sec\/insider-trades\/[^/]+$/,
    build(data) {
      const total = toFiniteNumber(data?.count);
      const buyCount = 0;
      const sellCount = 0;
      const value =
        Number.isFinite(total) && total >= 0
          ? (buyCount - sellCount) / Math.max(1, total)
          : null;

      return {
        insider_sentiment: buildParameter(
          value,
          value,
          "(buyCount - sellCount) / max(1, total)",
          "positive = net buying",
        ),
      };
    },
  },
  {
    pattern: "/api/courts/cases",
    build(data) {
      const matchCount = toFiniteNumber(data?.totalMatches);
      const fallbackCount = toFiniteNumber(data?.count);
      const value = Number.isFinite(matchCount) ? matchCount : fallbackCount;

      return {
        litigation_risk: buildParameter(
          value,
          Number.isFinite(value) ? -(Math.log(1 + value) / Math.log(1 + 100000)) : null,
          "-(log(1 + matchCount) / log(1 + 100000))",
          "0 = clean, negative = exposure",
        ),
      };
    },
  },
  {
    pattern: /^\/api\/worldbank\/[^/]+\/[^/]+$/,
    build(data) {
      const value = pickFirstWorldBankValue(data?.observations);
      return {
        indicator_signal: buildParameter(
          value,
          Number.isFinite(value) ? Math.log10(value) / Math.log10(30000000000000) : null,
          "log10(value) / log10(30000000000000)",
          "higher = stronger",
        ),
      };
    },
  },
];

function buildSimCompatible(pathname, payload) {
  if (!isPlainObject(payload) || payload.success !== true || !isPlainObject(payload.data)) {
    return null;
  }

  const normalizedPath = normalizePath(pathname);
  for (const rule of SIM_COMPATIBILITY_RULES) {
    if (!isRouteMatch(normalizedPath, rule.pattern)) {
      continue;
    }

    const parameters = rule.build(payload.data, payload) || {};
    const normalizedEntries = Object.entries(parameters).filter(
      ([, value]) => isPlainObject(value),
    );

    if (!normalizedEntries.length) {
      return null;
    }

    return {
      parameters: Object.fromEntries(normalizedEntries),
      sim_hint: SIM_HINT,
    };
  }

  return null;
}

function appendSimCompatible(pathname, payload) {
  if (!isPlainObject(payload) || Object.prototype.hasOwnProperty.call(payload, "simCompatible")) {
    return payload;
  }

  const simCompatible = buildSimCompatible(pathname, payload);
  if (!simCompatible) {
    return payload;
  }

  return {
    ...payload,
    simCompatible,
  };
}

module.exports = {
  SIM_HINT,
  appendSimCompatible,
  buildSimCompatible,
};
