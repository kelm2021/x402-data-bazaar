const { Router } = require("express");
const {
  buildMissingKeyError,
  requestJson,
  sendNormalizedError,
} = require("../lib/upstream-client");
const ofac = require("../apps/restricted-party-screen/lib/ofac");

const router = Router();

let secTickerCache = {
  expiresAt: 0,
  value: null,
};

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function parsePositiveInt(value, fallback, minimum = 1, maximum = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function getSecHeaders() {
  const userAgent = String(process.env.SEC_USER_AGENT || "").trim();
  if (!userAgent) {
    throw buildMissingKeyError("sec", "SEC_USER_AGENT");
  }

  return {
    "User-Agent": userAgent,
    Accept: "application/json",
  };
}

function normalizeSecRecentFilings(submissions, limit = 25) {
  const recent = submissions?.filings?.recent ?? {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const accessionNumbers = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : [];
  const primaryDocuments = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];

  const entries = [];
  for (let index = 0; index < forms.length; index += 1) {
    entries.push({
      form: forms[index] ?? null,
      accessionNumber: accessionNumbers[index] ?? null,
      filingDate: filingDates[index] ?? null,
      reportDate: reportDates[index] ?? null,
      primaryDocument: primaryDocuments[index] ?? null,
    });
  }

  return entries.slice(0, limit);
}

function normalizeCourtSearchResults(results = [], limit = 20) {
  return results.slice(0, limit).map((entry) => ({
    id: entry.id ?? entry.cluster_id ?? entry.docket_id ?? null,
    clusterId: entry.cluster_id ?? null,
    docketId: entry.docket_id ?? null,
    caseName: entry.caseName ?? entry.caseNameFull ?? entry.case_name ?? entry.case_name_full ?? null,
    citation: entry.citation ?? null,
    citationCount: entry.citeCount ?? entry.citation_count ?? null,
    docketNumber: entry.docketNumber ?? entry.docket_number ?? null,
    court: entry.court ?? entry.court_id ?? null,
    dateFiled: entry.dateFiled ?? entry.date_filed ?? null,
    dateCreated: entry.date_created ?? null,
    dateArgued: entry.dateArgued ?? null,
    absoluteUrl: entry.absolute_url ?? entry.docket_absolute_url ?? null,
    snippet: entry.snippet ?? null,
  }));
}

function normalizeCourtInfoResults(results = [], limit = 20) {
  return results.slice(0, limit).map((entry) => ({
    id: entry.id ?? null,
    shortName: entry.short_name ?? null,
    fullName: entry.full_name ?? null,
    citationString: entry.citation_string ?? null,
    url: entry.url ?? null,
    jurisdiction: entry.jurisdiction ?? null,
    parentCourt: entry.parent_court ?? null,
    appealsTo: entry.appeals_to ?? null,
    inUse: entry.in_use ?? null,
    dateModified: entry.date_modified ?? null,
  }));
}

function normalizeCitationLookupResults(results = [], limit = 20) {
  const rows = Array.isArray(results) ? results : [];
  return rows.slice(0, limit).map((entry) => ({
    citation: entry.citation ?? null,
    normalizedCitations: Array.isArray(entry.normalized_citations) ? entry.normalized_citations : [],
    status: entry.status ?? null,
    errorMessage: entry.error_message ?? null,
    clusterCount: Array.isArray(entry.clusters) ? entry.clusters.length : 0,
    clusters: (Array.isArray(entry.clusters) ? entry.clusters : []).slice(0, 10).map((cluster) => ({
      id: cluster.id ?? null,
      caseName: cluster.case_name ?? null,
      absoluteUrl: cluster.absolute_url ?? null,
      dateFiled: cluster.date_filed ?? null,
      citationCount: cluster.citation_count ?? null,
      precedentialStatus: cluster.precedential_status ?? null,
    })),
  }));
}

function normalizeClusterResults(results = [], limit = 20) {
  const unique = new Map();
  for (const entry of results || []) {
    const clusterId = entry.cluster_id ?? entry.clusterId ?? null;
    if (!clusterId || unique.has(clusterId)) {
      continue;
    }

    unique.set(clusterId, {
      clusterId,
      caseName: entry.caseName ?? entry.caseNameFull ?? entry.case_name ?? null,
      citation: entry.citation ?? null,
      court: entry.court ?? entry.court_id ?? null,
      dateFiled: entry.dateFiled ?? entry.date_filed ?? null,
      absoluteUrl: entry.absolute_url ?? null,
      snippet: entry.snippet ?? null,
    });

    if (unique.size >= limit) {
      break;
    }
  }

  return Array.from(unique.values());
}

async function getSecTickerMap() {
  if (secTickerCache.value && secTickerCache.expiresAt > Date.now()) {
    return secTickerCache.value;
  }

  const raw = await requestJson({
    provider: "sec-tickers",
    url: "https://www.sec.gov/files/company_tickers.json",
    headers: getSecHeaders(),
  });
  const mapping = new Map();

  Object.values(raw || {}).forEach((entry) => {
    const ticker = normalizeTicker(entry?.ticker);
    const cik = Number.parseInt(String(entry?.cik_str ?? ""), 10);
    if (!ticker || !Number.isFinite(cik)) {
      return;
    }

    mapping.set(ticker, String(cik).padStart(10, "0"));
  });

  secTickerCache = {
    value: mapping,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  return mapping;
}

async function resolveCikFromTicker(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    const error = new Error("ticker is required");
    error.statusCode = 400;
    throw error;
  }

  const map = await getSecTickerMap();
  const cik = map.get(normalizedTicker);
  if (!cik) {
    const error = new Error(`No CIK found for ticker ${normalizedTicker}`);
    error.statusCode = 404;
    throw error;
  }

  return cik;
}

function buildCourtListenerHeaders(includeJsonBody = false) {
  const token = String(process.env.COURTLISTENER_API_TOKEN || "").trim();
  const headers = {
    Accept: "application/json",
  };
  if (includeJsonBody) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Token ${token}`;
  }

  return headers;
}

function serializeCourtQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }

    params.append(key, normalized);
  }
  return params.toString();
}

async function requestCourtListener(path, options = {}) {
  const { method = "GET", query, body } = options;
  const queryString = serializeCourtQuery(query);
  const url = `https://www.courtlistener.com/api/rest/v4/${path}${queryString ? `?${queryString}` : ""}`;
  return requestJson({
    provider: "courtlistener",
    url,
    method,
    headers: buildCourtListenerHeaders(body != null),
    body,
  });
}

router.get("/api/sec/filings/:ticker", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 25, 1, 100);
    const cik = await resolveCikFromTicker(req.params.ticker);
    const headers = getSecHeaders();
    const raw = await requestJson({
      provider: "sec-submissions",
      url: `https://data.sec.gov/submissions/CIK${cik}.json`,
      headers,
    });
    const filings = normalizeSecRecentFilings(raw, limit);

    res.json({
      success: true,
      data: {
        ticker: normalizeTicker(req.params.ticker),
        cik,
        count: filings.length,
        filings,
        provider: "sec-edgar",
        fallbackUsed: false,
      },
      source: "SEC EDGAR API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/sec/company-facts/:ticker", async (req, res) => {
  try {
    const cik = await resolveCikFromTicker(req.params.ticker);
    const headers = getSecHeaders();
    const raw = await requestJson({
      provider: "sec-company-facts",
      url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      headers,
    });
    const usGaap = raw?.facts?.["us-gaap"] || {};
    const topFacts = Object.keys(usGaap)
      .slice(0, 20)
      .map((name) => {
        const units = usGaap[name]?.units || {};
        const firstUnit = Object.keys(units)[0];
        const observations = Array.isArray(units[firstUnit]) ? units[firstUnit] : [];
        return {
          name,
          unit: firstUnit || null,
          latest: observations[observations.length - 1] || null,
        };
      });

    res.json({
      success: true,
      data: {
        ticker: normalizeTicker(req.params.ticker),
        cik,
        entityName: raw?.entityName || null,
        count: topFacts.length,
        facts: topFacts,
        provider: "sec-edgar",
        fallbackUsed: false,
      },
      source: "SEC EDGAR API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/sec/insider-trades/:ticker", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 25, 1, 100);
    const cik = await resolveCikFromTicker(req.params.ticker);
    const headers = getSecHeaders();
    const raw = await requestJson({
      provider: "sec-submissions",
      url: `https://data.sec.gov/submissions/CIK${cik}.json`,
      headers,
    });
    const formFour = normalizeSecRecentFilings(raw, 300)
      .filter((entry) => entry.form === "4")
      .slice(0, limit);

    res.json({
      success: true,
      data: {
        ticker: normalizeTicker(req.params.ticker),
        cik,
        count: formFour.length,
        trades: formFour,
        provider: "sec-edgar",
        fallbackUsed: false,
      },
      source: "SEC EDGAR API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/sanctions/:name", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    if (!name) {
      return res.status(400).json({ success: false, error: "name is required" });
    }

    const query = {
      name,
      minScore: ofac.clampInteger(req.query.minScore, ofac.DEFAULT_MIN_SCORE, 80, 100),
      limit: ofac.clampInteger(req.query.limit, ofac.DEFAULT_LIMIT, 1, ofac.MAX_LIMIT),
      country: String(req.query.country || "").trim().toUpperCase(),
      type: String(req.query.type || "").trim(),
      list: String(req.query.list || "").trim(),
      programs: ofac.splitQueryValues(req.query.program),
    };
    const rawMatches = await ofac.fetchSearchResults(query);
    const freshness = await ofac.fetchSourceFreshness();
    const payload = ofac.buildScreeningResponse(query, rawMatches, freshness);

    res.json({
      ...payload,
      data: {
        ...(payload.data || {}),
        provider: "ofac",
        fallbackUsed: false,
      },
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/cases", async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const raw = await requestCourtListener("search/", {
      query: {
        q: query,
        type: "r",
        page_size: limit,
      },
    });
    const cases = normalizeCourtSearchResults(raw?.results || [], limit);

    res.json({
      success: true,
      data: {
        query,
        totalMatches: Number.isFinite(raw?.count) ? raw.count : null,
        count: cases.length,
        cases,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/opinions", async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const raw = await requestCourtListener("search/", {
      query: {
        q: query,
        type: "o",
        page_size: limit,
      },
    });
    const opinions = normalizeCourtSearchResults(raw?.results || [], limit);

    res.json({
      success: true,
      data: {
        query,
        totalMatches: Number.isFinite(raw?.count) ? raw.count : null,
        count: opinions.length,
        opinions,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/opinions/:query", async (req, res) => {
  try {
    const query = String(req.params.query || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const raw = await requestCourtListener("search/", {
      query: {
        q: query,
        type: "o",
        page_size: limit,
      },
    });
    const opinions = normalizeCourtSearchResults(raw?.results || [], limit);

    res.json({
      success: true,
      data: {
        query,
        totalMatches: Number.isFinite(raw?.count) ? raw.count : null,
        count: opinions.length,
        opinions,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/citations", async (req, res) => {
  try {
    const citationText = String(req.query.citation || req.query.text || req.query.query || "").trim();
    if (!citationText) {
      return res.status(400).json({ success: false, error: "citation is required" });
    }

    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const raw = await requestCourtListener("citation-lookup/", {
      method: "POST",
      body: {
        text: citationText,
      },
    });
    const citations = normalizeCitationLookupResults(raw, limit);

    res.json({
      success: true,
      data: {
        citation: citationText,
        count: citations.length,
        citations,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/court-info", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const id = String(req.query.id || "").trim();
    const query = String(req.query.query || req.query.q || "").trim();
    const jurisdiction = String(req.query.jurisdiction || "").trim();
    const inUseRaw = String(req.query.inUse || "").trim().toLowerCase();
    const inUse = inUseRaw === "true" ? "true" : (inUseRaw === "false" ? "false" : "");

    const raw = await requestCourtListener("courts/", {
      query: {
        page_size: limit,
        ...(id ? { id } : {}),
        ...(query ? { full_name__icontains: query } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
        ...(inUse ? { in_use: inUse } : {}),
      },
    });
    const courts = normalizeCourtInfoResults(raw?.results || [], limit);

    res.json({
      success: true,
      data: {
        filters: {
          id: id || null,
          query: query || null,
          jurisdiction: jurisdiction || null,
          inUse: inUse || null,
        },
        totalMatches: Number.isFinite(raw?.count) ? raw.count : null,
        count: courts.length,
        courts,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.get("/api/courts/clusters", async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const raw = await requestCourtListener("search/", {
      query: {
        q: query,
        type: "o",
        page_size: Math.min(limit * 3, 200),
      },
    });
    const clusters = normalizeClusterResults(raw?.results || [], limit);

    res.json({
      success: true,
      data: {
        query,
        totalMatches: Number.isFinite(raw?.count) ? raw.count : null,
        count: clusters.length,
        clusters,
        provider: "courtlistener",
        fallbackUsed: false,
      },
      source: "CourtListener API",
    });
  } catch (error) {
    sendNormalizedError(res, error);
  }
});

router.normalizeTicker = normalizeTicker;
router.parsePositiveInt = parsePositiveInt;
router.normalizeSecRecentFilings = normalizeSecRecentFilings;
router.normalizeCourtSearchResults = normalizeCourtSearchResults;
router.normalizeCourtResults = normalizeCourtSearchResults;
router.normalizeCourtInfoResults = normalizeCourtInfoResults;
router.normalizeCitationLookupResults = normalizeCitationLookupResults;
router.normalizeClusterResults = normalizeClusterResults;
router.resolveCikFromTicker = resolveCikFromTicker;

module.exports = router;
