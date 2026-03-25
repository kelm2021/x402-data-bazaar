const fetch = require("node-fetch");

const DEFAULT_QUOTE_TARGETS = ["EUR", "GBP", "JPY"];

function normalizeCurrencyCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function parseQuoteTargets(base, targetValue) {
  const rawTargets = String(targetValue ?? "")
    .split(",")
    .map((value) => normalizeCurrencyCode(value))
    .filter(Boolean);

  const targets = rawTargets.length
    ? rawTargets
    : DEFAULT_QUOTE_TARGETS.filter((code) => code !== base);

  return [...new Set(targets)].filter((code) => code !== base);
}

function parseRequestedAmount(value) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function roundQuoteValue(value) {
  return Number(value.toFixed(value >= 100 ? 2 : 4));
}

function buildConversionQuotes(base, rates, targets, amount) {
  return targets
    .filter((target) => Number.isFinite(rates[target]))
    .map((target) => {
      const rate = Number(rates[target]);
      const convertedAmount = amount * rate;

      return {
        target,
        rate: roundQuoteValue(rate),
        inverseRate: roundQuoteValue(1 / rate),
        convertedAmount: roundQuoteValue(convertedAmount),
        summary: `${roundQuoteValue(amount)} ${base} = ${roundQuoteValue(convertedAmount)} ${target}`,
      };
    });
}

module.exports = async function primaryHandler(req, res) {
  try {
    const baseCode = normalizeCurrencyCode(req.params.base);
    const targetValue = req.params.target ?? req.query.to ?? req.query.symbols;
    const amount = parseRequestedAmount(req.params.amount ?? req.query.amount ?? 100);

    if (!baseCode) {
      return res.status(400).json({
        success: false,
        error: "base currency is required",
      });
    }

    if (amount == null) {
      return res.status(400).json({
        success: false,
        error: "amount must be a positive number",
      });
    }

    const response = await fetch(`https://open.er-api.com/v6/latest/${baseCode}`);
    const raw = await response.json();

    if (raw.result !== "success") {
      return res.status(400).json({
        success: false,
        error: `Invalid base currency: ${baseCode}`,
      });
    }

    const targets = parseQuoteTargets(baseCode, targetValue);
    const quotes = buildConversionQuotes(baseCode, raw.rates, targets, amount);

    if (!quotes.length) {
      return res.status(400).json({
        success: false,
        error: `No valid quote targets found for ${baseCode}`,
      });
    }

    if (req.route?.path === "/api/exchange-rates/quote/:base/:target/:amount") {
      return res.json({
        success: true,
        data: {
          base: baseCode,
          target: quotes[0].target,
          requestedAmount: roundQuoteValue(amount),
          asOf: raw.time_last_update_utc,
          rate: quotes[0].rate,
          inverseRate: quotes[0].inverseRate,
          convertedAmount: quotes[0].convertedAmount,
          summary: quotes[0].summary,
        },
        source: "ExchangeRate-API (open.er-api.com)",
      });
    }

    return res.json({
      success: true,
      data: {
        base: baseCode,
        requestedAmount: roundQuoteValue(amount),
        asOf: raw.time_last_update_utc,
        quoteCount: quotes.length,
        primaryQuote: quotes[0],
        quotes,
      },
      source: "ExchangeRate-API (open.er-api.com)",
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: "Upstream API error",
      details: error.message,
    });
  }
};
