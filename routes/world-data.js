const { Router } = require("express");
const {
  requestJson,
  sendNormalizedError,
} = require("../lib/upstream-client");

const router = Router();

function parsePositiveInt(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeCountryCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeWorldBankObservations(rows = [], limit = 200) {
  return rows.slice(0, limit).map((row) => ({
    date: row.date ?? null,
    value: row.value ?? null,
    unit: row.unit ?? null,
    obsStatus: row.obs_status ?? null,
    decimal: row.decimal ?? null,
  }));
}

function normalizeCountryPayload(entry) {
  if (!entry) {
    return null;
  }

  return {
    code: entry.cca2 ?? entry.cca3 ?? null,
    name: entry.name?.common ?? null,
    officialName: entry.name?.official ?? null,
    region: entry.region ?? null,
    subregion: entry.subregion ?? null,
    capital: Array.isArray(entry.capital) ? entry.capital : [],
    population: entry.population ?? null,
    currencies: entry.currencies ?? {},
    languages: entry.languages ?? {},
    timezones: entry.timezones ?? [],
    latlng: entry.latlng ?? [],
    flagPng: entry.flags?.png ?? null,
    flagSvg: entry.flags?.svg ?? null,
  };
}

router.get("/api/worldbank/:country/:indicator", async (req, res) => {
  try {
    const country = String(req.params.country || "").trim();
    const indicator = String(req.params.indicator || "").trim();
    if (!country || !indicator) {
      return res.status(400).json({ success: false, error: "country and indicator are required" });
    }

    const perPage = parsePositiveInt(req.query.perPage, 50, 1, 1000);
    const date = String(req.query.date || "").trim();
    const raw = await requestJson({
      provider: "worldbank",
      url:
        `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}` +
        `?format=json&per_page=${perPage}` +
        (date ? `&date=${encodeURIComponent(date)}` : ""),
    });
    const rows = Array.isArray(raw?.[1]) ? raw[1] : [];
    const observations = normalizeWorldBankObservations(rows, perPage);

    res.json({
      success: true,
      data: {
        country,
        indicator,
        count: observations.length,
        observations,
        provider: "worldbank",
        fallbackUsed: false,
      },
      source: "World Bank API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/country/:code", async (req, res) => {
  try {
    const code = normalizeCountryCode(req.params.code);
    if (!code) {
      return res.status(400).json({ success: false, error: "code is required" });
    }

    const raw = await requestJson({
      provider: "restcountries",
      url: `https://restcountries.com/v3.1/alpha/${encodeURIComponent(code)}`,
    });
    const country = normalizeCountryPayload(Array.isArray(raw) ? raw[0] : raw);

    if (!country) {
      return res.status(404).json({ success: false, error: `No country found for code ${code}` });
    }

    res.json({
      success: true,
      data: {
        ...country,
        provider: "restcountries",
        fallbackUsed: false,
      },
      source: "RestCountries API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.parsePositiveInt = parsePositiveInt;
router.normalizeCountryCode = normalizeCountryCode;
router.normalizeWorldBankObservations = normalizeWorldBankObservations;
router.normalizeCountryPayload = normalizeCountryPayload;

module.exports = router;
