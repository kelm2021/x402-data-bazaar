const { Router } = require("express");
const {
  UpstreamRequestError,
  buildMissingKeyError,
  requestJson,
  sendNormalizedError,
  withProviderFallback,
} = require("../lib/upstream-client");

const router = Router();

const DEFAULT_TREASURY_SERIES = ["DGS1", "DGS2", "DGS5", "DGS10", "DGS30"];
const GOLD_FRED_SERIES_CANDIDATES = ["GOLDAMGBD228NLBM", "GOLDPMGBD228NLBM"];

function normalizeTickerSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function parseLimit(value, fallback, maxValue) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(maxValue, parsed));
}

function normalizeYahooQuote(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const price = Number(raw.regularMarketPrice);
  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    symbol: raw.symbol,
    price,
    change: Number(raw.regularMarketChange),
    percentChange: Number(raw.regularMarketChangePercent),
    open: Number(raw.regularMarketOpen),
    high: Number(raw.regularMarketDayHigh),
    low: Number(raw.regularMarketDayLow),
    previousClose: Number(raw.regularMarketPreviousClose),
    currency: raw.currency || null,
    exchange: raw.fullExchangeName || null,
    timestamp: raw.regularMarketTime ? new Date(raw.regularMarketTime * 1000).toISOString() : null,
  };
}

function normalizeFinnhubQuote(symbol, raw) {
  if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.c))) {
    return null;
  }

  return {
    symbol,
    price: Number(raw.c),
    change: Number(raw.d),
    percentChange: Number(raw.dp),
    high: Number(raw.h),
    low: Number(raw.l),
    open: Number(raw.o),
    previousClose: Number(raw.pc),
    timestamp: Number(raw.t) ? new Date(Number(raw.t) * 1000).toISOString() : null,
  };
}

function parseAlphaVantageCandles(raw, limit) {
  if (!raw || typeof raw !== "object") {
    throw new UpstreamRequestError("Alpha Vantage payload missing", {
      provider: "alpha-vantage",
      code: "upstream_payload",
    });
  }

  if (raw.Note || raw["Error Message"]) {
    throw new UpstreamRequestError(raw.Note || raw["Error Message"], {
      provider: "alpha-vantage",
      code: "upstream_http",
      upstreamStatus: 429,
      retryable: true,
      details: raw,
    });
  }

  const series = raw["Time Series (Daily)"];
  if (!series || typeof series !== "object") {
    throw new UpstreamRequestError("Alpha Vantage candle series missing", {
      provider: "alpha-vantage",
      code: "upstream_payload",
      details: raw,
    });
  }

  return Object.entries(series)
    .map(([date, values]) => ({
      date,
      open: Number(values["1. open"]),
      high: Number(values["2. high"]),
      low: Number(values["3. low"]),
      close: Number(values["4. close"]),
      volume: Number(values["6. volume"] || values["5. volume"]),
    }))
    .filter((entry) => Number.isFinite(entry.close))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}

function parseYahooCandles(raw, limit) {
  const result = raw?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};

  const candles = timestamps
    .map((time, index) => ({
      date: new Date(Number(time) * 1000).toISOString().slice(0, 10),
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: Number(quote.volume?.[index]),
    }))
    .filter((entry) => Number.isFinite(entry.close))
    .slice(-limit)
    .reverse();

  if (!candles.length) {
    throw new UpstreamRequestError("No candle data returned", {
      provider: "yahoo-finance",
      code: "upstream_payload",
      details: raw,
    });
  }

  return candles;
}

function normalizeFredObservations(observations = []) {
  return observations
    .map((entry) => ({
      date: entry.date,
      value: entry.value === "." ? null : Number(entry.value),
    }))
    .filter((entry) => Number.isFinite(entry.value));
}

function normalizeFredSeriesPayload(seriesId, observations = []) {
  return {
    seriesId,
    latest: observations[0] || null,
    history: observations,
    provider: "fred",
    fallbackUsed: false,
  };
}

function buildFredSeriesBundle(seriesIds, historyBySeriesId) {
  return {
    series: seriesIds,
    latest: Object.fromEntries(
      seriesIds.map((seriesId) => [seriesId, historyBySeriesId?.[seriesId]?.[0] || null]),
    ),
    history: historyBySeriesId,
    provider: "fred",
    fallbackUsed: false,
  };
}

function normalizeYahooChartSeries(raw, limit, label = "Yahoo chart") {
  const result = raw?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const close = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];

  const observations = timestamps
    .map((ts, index) => ({
      date: new Date(Number(ts) * 1000).toISOString().slice(0, 10),
      value: Number(close[index]),
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .slice(-limit)
    .reverse();

  if (!observations.length) {
    throw new UpstreamRequestError(`${label} payload missing market data`, {
      provider: "yahoo-finance",
      code: "upstream_payload",
      details: raw,
    });
  }

  return observations;
}

function normalizeYahooSp500Series(raw, limit) {
  return normalizeYahooChartSeries(raw, limit, "Yahoo S&P 500");
}

function getFredKey() {
  const key = String(process.env.FRED_API_KEY || "").trim();
  if (!key) {
    throw buildMissingKeyError("fred", "FRED_API_KEY");
  }
  return key;
}

async function fetchFredSeries(seriesId, limit = 12) {
  const apiKey = getFredKey();
  const raw = await requestJson({
    provider: "fred",
    url:
      "https://api.stlouisfed.org/fred/series/observations" +
      `?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}` +
      `&file_type=json&sort_order=desc&limit=${limit}`,
  });

  return normalizeFredObservations(raw?.observations || []);
}

async function fetchFredSeriesWithKey(seriesId, limit, apiKey) {
  const normalizedKey = String(apiKey || "").trim();
  if (!normalizedKey) {
    throw buildMissingKeyError("fred", "FRED_API_KEY");
  }

  const raw = await requestJson({
    provider: "fred",
    url:
      "https://api.stlouisfed.org/fred/series/observations" +
      `?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(normalizedKey)}` +
      `&file_type=json&sort_order=desc&limit=${limit}`,
  });

  return normalizeFredObservations(raw?.observations || []);
}

function isFredSeriesMissingError(error) {
  if (!(error instanceof UpstreamRequestError)) {
    return false;
  }

  if (error.provider !== "fred" || Number(error.upstreamStatus) !== 400) {
    return false;
  }

  const detailsMessage = String(error.details?.error_message || "");
  return /series does not exist/i.test(detailsMessage);
}

async function fetchFredGoldSeries(limit, apiKey) {
  let lastError = null;

  for (const seriesId of GOLD_FRED_SERIES_CANDIDATES) {
    try {
      const observations = await fetchFredSeriesWithKey(seriesId, limit, apiKey);
      return { seriesId, observations };
    } catch (error) {
      if (isFredSeriesMissingError(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new UpstreamRequestError("No FRED gold series candidates configured", {
    provider: "fred",
    code: "invalid_upstream",
    statusCode: 500,
  });
}

router.get("/api/stocks/quote/:symbol", async (req, res) => {
  try {
    const symbol = normalizeTickerSymbol(req.params.symbol);
    if (!symbol) {
      return res.status(400).json({ success: false, error: "symbol is required" });
    }

    const finnhubKey = String(process.env.FINNHUB_API_KEY || "").trim();
    const result = await withProviderFallback({
      primary: {
        provider: "finnhub",
        enabled: Boolean(finnhubKey),
        keyName: "FINNHUB_API_KEY",
        execute: async () => {
          const raw = await requestJson({
            provider: "finnhub",
            url:
              `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}` +
              `&token=${encodeURIComponent(finnhubKey)}`,
          });
          const normalized = normalizeFinnhubQuote(symbol, raw);
          if (!normalized) {
            throw new UpstreamRequestError("Finnhub quote payload missing market data", {
              provider: "finnhub",
              code: "upstream_payload",
              details: raw,
            });
          }
          return normalized;
        },
      },
      fallback: {
        provider: "yahoo-finance",
        enabled: true,
        execute: async () => {
          const raw = await requestJson({
            provider: "yahoo-finance",
            url:
              "https://query1.finance.yahoo.com/v7/finance/quote" +
              `?symbols=${encodeURIComponent(symbol)}`,
          });
          const normalized = normalizeYahooQuote(raw?.quoteResponse?.result?.[0]);
          if (!normalized) {
            throw new UpstreamRequestError("Yahoo quote payload missing market data", {
              provider: "yahoo-finance",
              code: "upstream_payload",
              details: raw,
            });
          }
          return normalized;
        },
      },
    });

    return res.json({
      success: true,
      data: {
        ...result.data,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      },
      source: result.provider === "finnhub" ? "Finnhub API" : "Yahoo Finance API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/stocks/search", async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "q is required" });
    }
    const limit = parseLimit(req.query.limit, 10, 50);
    const finnhubKey = String(process.env.FINNHUB_API_KEY || "").trim();

    const result = await withProviderFallback({
      primary: {
        provider: "finnhub",
        enabled: Boolean(finnhubKey),
        keyName: "FINNHUB_API_KEY",
        execute: async () => {
          const raw = await requestJson({
            provider: "finnhub",
            url:
              "https://finnhub.io/api/v1/search" +
              `?q=${encodeURIComponent(query)}&token=${encodeURIComponent(finnhubKey)}`,
          });
          return (raw?.result || []).slice(0, limit).map((entry) => ({
            symbol: entry.symbol,
            description: entry.description,
            type: entry.type || null,
            exchange: entry.exchange || null,
          }));
        },
      },
      fallback: {
        provider: "yahoo-finance",
        enabled: true,
        execute: async () => {
          const raw = await requestJson({
            provider: "yahoo-finance",
            url: `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
          });
          return (raw?.quotes || []).slice(0, limit).map((entry) => ({
            symbol: entry.symbol,
            description: entry.shortname || entry.longname || entry.symbol,
            type: entry.quoteType || null,
            exchange: entry.exchDisp || null,
          }));
        },
      },
    });

    return res.json({
      success: true,
      data: {
        query,
        count: result.data.length,
        results: result.data,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      },
      source: result.provider === "finnhub" ? "Finnhub API" : "Yahoo Finance API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/stocks/candles/:symbol", async (req, res) => {
  try {
    const symbol = normalizeTickerSymbol(req.params.symbol);
    if (!symbol) {
      return res.status(400).json({ success: false, error: "symbol is required" });
    }

    const interval = String(req.query.interval || "1d");
    const range = String(req.query.range || "6mo");
    const limit = parseLimit(req.query.limit, 60, 365);
    const alphaKey = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();

    const result = await withProviderFallback({
      primary: {
        provider: "alpha-vantage",
        enabled: Boolean(alphaKey),
        keyName: "ALPHA_VANTAGE_API_KEY",
        execute: async () => {
          const raw = await requestJson({
            provider: "alpha-vantage",
            url:
              "https://www.alphavantage.co/query" +
              `?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}` +
              `&outputsize=compact&apikey=${encodeURIComponent(alphaKey)}`,
          });
          return parseAlphaVantageCandles(raw, limit);
        },
      },
      fallback: {
        provider: "yahoo-finance",
        enabled: true,
        execute: async () => {
          const raw = await requestJson({
            provider: "yahoo-finance",
            url:
              `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
              `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`,
          });
          return parseYahooCandles(raw, limit);
        },
      },
    });

    return res.json({
      success: true,
      data: {
        symbol,
        interval,
        range,
        count: result.data.length,
        candles: result.data,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      },
      source: result.provider === "alpha-vantage" ? "Alpha Vantage API" : "Yahoo Finance API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/treasury-rates", async (req, res) => {
  try {
    const series = String(req.query.series || DEFAULT_TREASURY_SERIES.join(","))
      .split(",")
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean);
    const limit = parseLimit(req.query.limit, 12, 120);

    const history = {};
    for (const seriesId of series) {
      history[seriesId] = await fetchFredSeries(seriesId, limit);
    }

    return res.json({
      success: true,
      data: {
        series,
        latest: Object.fromEntries(
          series.map((seriesId) => [seriesId, history[seriesId]?.[0] || null]),
        ),
        history,
        provider: "fred",
        fallbackUsed: false,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/fed-funds-rate", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 24, 240);
    const history = await fetchFredSeries("FEDFUNDS", limit);

    return res.json({
      success: true,
      data: {
        seriesId: "FEDFUNDS",
        latest: history[0] || null,
        history,
        provider: "fred",
        fallbackUsed: false,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/yield-curve", async (req, res) => {
  try {
    const series = ["DGS1", "DGS2", "DGS5", "DGS10", "DGS30"];
    const latest = {};
    for (const seriesId of series) {
      latest[seriesId] = (await fetchFredSeries(seriesId, 2))[0] || null;
    }

    const tenYear = latest.DGS10?.value;
    const twoYear = latest.DGS2?.value;
    const spread10y2y =
      Number.isFinite(tenYear) && Number.isFinite(twoYear)
        ? Number((tenYear - twoYear).toFixed(3))
        : null;

    return res.json({
      success: true,
      data: {
        latest,
        spread10y2y,
        provider: "fred",
        fallbackUsed: false,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/commodities/gold", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 30, 365);
    const fredKey = String(process.env.FRED_API_KEY || "").trim();
    try {
      const { seriesId, observations } = await fetchFredGoldSeries(limit, fredKey);
      return res.json({
        success: true,
        data: {
          ...normalizeFredSeriesPayload(seriesId, observations),
          provider: "fred",
          fallbackUsed: false,
        },
        source: "FRED API",
      });
    } catch (error) {
      const fallbackAllowed =
        error?.code === "missing_key"
        || error?.code === "timeout"
        || isFredSeriesMissingError(error)
        || [401, 403, 429].includes(Number(error?.upstreamStatus))
        || Number(error?.upstreamStatus) >= 500;
      if (!fallbackAllowed) {
        throw error;
      }

      const raw = await requestJson({
        provider: "yahoo-finance",
        url:
          "https://query1.finance.yahoo.com/v8/finance/chart/GC=F" +
          "?interval=1d&range=1y",
      });
      const observations = normalizeYahooChartSeries(raw, limit, "Yahoo gold");

      return res.json({
        success: true,
        data: {
          seriesId: "GC=F",
          latest: observations[0] || null,
          history: observations,
          provider: "yahoo-finance",
          fallbackUsed: true,
        },
        source: "Yahoo Finance API",
      });
    }
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/commodities/oil", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 30, 365);
    const observations = await fetchFredSeries("DCOILWTICO", limit);

    return res.json({
      success: true,
      data: normalizeFredSeriesPayload("DCOILWTICO", observations),
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/mortgage-rates", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 52, 520);
    const observations = await fetchFredSeries("MORTGAGE30US", limit);

    return res.json({
      success: true,
      data: normalizeFredSeriesPayload("MORTGAGE30US", observations),
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/sp500", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 60, 365);
    const fredKey = String(process.env.FRED_API_KEY || "").trim();

    const result = await withProviderFallback({
      primary: {
        provider: "fred",
        enabled: Boolean(fredKey),
        keyName: "FRED_API_KEY",
        execute: async () => {
          const observations = await fetchFredSeriesWithKey("SP500", limit, fredKey);
          return normalizeFredSeriesPayload("SP500", observations);
        },
      },
      fallback: {
        provider: "yahoo-finance",
        enabled: true,
        execute: async () => {
          const raw = await requestJson({
            provider: "yahoo-finance",
            url:
              "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC" +
              "?interval=1d&range=1y",
          });
          const observations = normalizeYahooSp500Series(raw, limit);
          return {
            seriesId: "^GSPC",
            latest: observations[0] || null,
            history: observations,
            provider: "yahoo-finance",
            fallbackUsed: true,
          };
        },
      },
    });

    return res.json({
      success: true,
      data: {
        ...result.data,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      },
      source: result.provider === "fred" ? "FRED API" : "Yahoo Finance API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/vix", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 60, 365);
    const observations = await fetchFredSeries("VIXCLS", limit);

    return res.json({
      success: true,
      data: normalizeFredSeriesPayload("VIXCLS", observations),
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/dollar-index", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 60, 365);
    const observations = await fetchFredSeries("DTWEXBGS", limit);

    return res.json({
      success: true,
      data: normalizeFredSeriesPayload("DTWEXBGS", observations),
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/credit-spreads", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 24, 240);
    const series = ["BAMLH0A0HYM2", "BAMLC0A0CM"];
    const history = {};
    for (const seriesId of series) {
      history[seriesId] = await fetchFredSeries(seriesId, limit);
    }

    const highYieldSpread = Number(history.BAMLH0A0HYM2?.[0]?.value);
    const investmentGradeSpread = Number(history.BAMLC0A0CM?.[0]?.value);
    const spreadGap =
      Number.isFinite(highYieldSpread) && Number.isFinite(investmentGradeSpread)
        ? Number((highYieldSpread - investmentGradeSpread).toFixed(3))
        : null;

    return res.json({
      success: true,
      data: {
        ...buildFredSeriesBundle(series, history),
        spreadGap,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/real-rates", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 60, 365);
    const series = ["DFII5", "DFII10"];
    const history = {};
    for (const seriesId of series) {
      history[seriesId] = await fetchFredSeries(seriesId, limit);
    }

    const fiveYear = Number(history.DFII5?.[0]?.value);
    const tenYear = Number(history.DFII10?.[0]?.value);
    const avgRealRate =
      Number.isFinite(fiveYear) && Number.isFinite(tenYear)
        ? Number(((fiveYear + tenYear) / 2).toFixed(3))
        : null;

    return res.json({
      success: true,
      data: {
        ...buildFredSeriesBundle(series, history),
        avgRealRate,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.get("/api/inflation-expectations", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 60, 365);
    const series = ["T5YIE", "T10YIE"];
    const history = {};
    for (const seriesId of series) {
      history[seriesId] = await fetchFredSeries(seriesId, limit);
    }

    const fiveYear = Number(history.T5YIE?.[0]?.value);
    const tenYear = Number(history.T10YIE?.[0]?.value);
    const breakevenSlope =
      Number.isFinite(tenYear) && Number.isFinite(fiveYear)
        ? Number((tenYear - fiveYear).toFixed(3))
        : null;

    return res.json({
      success: true,
      data: {
        ...buildFredSeriesBundle(series, history),
        breakevenSlope,
      },
      source: "FRED API",
    });
  } catch (error) {
    return sendNormalizedError(res, error);
  }
});

router.normalizeTickerSymbol = normalizeTickerSymbol;
router.parseLimit = parseLimit;
router.parseAlphaVantageCandles = parseAlphaVantageCandles;
router.parseYahooCandles = parseYahooCandles;
router.normalizeYahooChartSeries = normalizeYahooChartSeries;
router.normalizeYahooSp500Series = normalizeYahooSp500Series;
router.normalizeFredObservations = normalizeFredObservations;
router.normalizeFredSeriesPayload = normalizeFredSeriesPayload;
router.buildFredSeriesBundle = buildFredSeriesBundle;
router.isFredSeriesMissingError = isFredSeriesMissingError;
router.fetchFredGoldSeries = fetchFredGoldSeries;
router.fetchFredSeriesWithKey = fetchFredSeriesWithKey;

module.exports = router;
