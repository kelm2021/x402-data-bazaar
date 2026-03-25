const OFAC_BASE_URL = "https://sanctionslistservice.ofac.treas.gov";
const OFAC_SEARCH_URL = `${OFAC_BASE_URL}/api/Search/Search`;
const OFAC_SDN_LIST_URL = `${OFAC_BASE_URL}/api/PublicationPreview/SdnList`;
const OFAC_CONSOLIDATED_LIST_URL = `${OFAC_BASE_URL}/api/PublicationPreview/ConsolidatedList`;
const OFAC_DETAILS_URL = "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_SCORE = 90;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const USER_AGENT =
  "vendor-entity-brief/1.0 (+https://vendor-entity-brief.vercel.app)";
const FRESHNESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const freshnessCache = {
  expiresAt: 0,
  value: null,
  promise: null,
};

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeQueryName(value) {
  return normalizeString(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toUpperCase();
}

function clampInteger(value, fallback, minimum, maximum) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, numeric));
}

function splitSemicolonList(value) {
  return normalizeString(value)
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function computeMatchConfidence(bestNameScore) {
  if (bestNameScore >= 100) {
    return "exact";
  }

  if (bestNameScore >= 95) {
    return "high";
  }

  if (bestNameScore >= 90) {
    return "medium";
  }

  return "low";
}

function choosePrimaryName(names, normalizedRequestedName, fallbackName = "") {
  if (!names.length) {
    return "";
  }

  const exactCandidates = names.filter(
    (entry) => normalizeQueryName(entry) === normalizedRequestedName,
  );
  if (exactCandidates.length) {
    return [...exactCandidates].sort((left, right) => left.length - right.length)[0];
  }

  if (fallbackName && names.includes(fallbackName)) {
    return fallbackName;
  }

  return [...names].sort((left, right) => left.length - right.length)[0];
}

function sortGroupedMatches(left, right) {
  if (right.bestNameScore !== left.bestNameScore) {
    return right.bestNameScore - left.bestNameScore;
  }

  if (right.aliases.length !== left.aliases.length) {
    return right.aliases.length - left.aliases.length;
  }

  return left.primaryName.localeCompare(right.primaryName);
}

function groupMatches(rawMatches, requestedName) {
  const matches = Array.isArray(rawMatches) ? rawMatches : [];
  const normalizedRequestedName = normalizeQueryName(requestedName);
  const grouped = new Map();

  for (const match of matches) {
    const id = Number(match.id);
    const key = Number.isFinite(id) ? String(id) : `${match.name}:${match.address}:${match.type}`;
    const existing =
      grouped.get(key) ??
      {
        id: Number.isFinite(id) ? id : null,
        names: new Set(),
        addresses: new Set(),
        programs: new Set(),
        lists: new Set(),
        firstSeenName: "",
        type: normalizeString(match.type) || "Unknown",
        bestNameScore: 0,
      };

    const name = normalizeString(match.name);
    const address = normalizeString(match.address);
    if (name) {
      if (!existing.firstSeenName) {
        existing.firstSeenName = name;
      }
      existing.names.add(name);
    }
    if (address) {
      existing.addresses.add(address);
    }

    for (const program of splitSemicolonList(match.programs)) {
      existing.programs.add(program);
    }

    for (const listName of splitSemicolonList(match.lists)) {
      existing.lists.add(listName);
    }

    const nameScore = Number(match.nameScore);
    if (Number.isFinite(nameScore)) {
      existing.bestNameScore = Math.max(existing.bestNameScore, nameScore);
    }

    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .map((entry) => {
      const names = [...entry.names];
      const primaryName = choosePrimaryName(
        names,
        normalizedRequestedName,
        entry.firstSeenName,
      );
      const aliases = names
        .filter((name) => name !== primaryName)
        .sort((left, right) => left.localeCompare(right));
      const exactNameMatch = names.some(
        (name) => normalizeQueryName(name) === normalizedRequestedName,
      );

      return {
        id: entry.id,
        primaryName,
        aliases,
        type: entry.type,
        programs: [...entry.programs].sort((left, right) => left.localeCompare(right)),
        lists: [...entry.lists].sort((left, right) => left.localeCompare(right)),
        addresses: [...entry.addresses].sort((left, right) => left.localeCompare(right)),
        bestNameScore: entry.bestNameScore,
        matchConfidence: computeMatchConfidence(entry.bestNameScore),
        exactNameMatch,
        manualReviewRecommended: true,
        detailUrl: entry.id == null ? null : `${OFAC_DETAILS_URL}${entry.id}`,
      };
    })
    .sort(sortGroupedMatches);
}

function getLatestLastUpdated(entries = []) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  return sourceEntries.reduce((latest, entry) => {
    const candidate = normalizeString(entry.lastUpdated);
    if (!candidate) {
      return latest;
    }

    if (!latest) {
      return candidate;
    }

    return Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
  }, null);
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable in this runtime.");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        ...(options.headers ?? {}),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();

    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (error) {
      parsed = text;
    }

    if (!response.ok) {
      const message =
        parsed?.errorMessage ??
        parsed?.message ??
        `OFAC request failed with status ${response.status}`;
      throw createHttpError(message, 502);
    }

    return parsed;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createHttpError("OFAC request timed out.", 504);
    }

    if (error.statusCode) {
      throw error;
    }

    throw createHttpError(
      `OFAC request failed: ${error.message || "Unknown upstream error"}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearchResults(query) {
  const requestedCountry = normalizeString(query.country).toUpperCase();
  const primaryBody = {
    name: query.name,
    city: "",
    idNumber: "",
    stateProvince: "",
    nameScore: query.minScore,
    country: requestedCountry,
    programs: query.programs ?? [],
    type: query.type ?? "",
    address: "",
    list: query.list ?? "",
  };
  const primaryResults = await fetchJson(OFAC_SEARCH_URL, {
    method: "POST",
    body: primaryBody,
  });

  if (!requestedCountry) {
    return Array.isArray(primaryResults) ? primaryResults : [];
  }

  if (Array.isArray(primaryResults) && primaryResults.length > 0) {
    return primaryResults;
  }

  const fallbackResults = await fetchJson(OFAC_SEARCH_URL, {
    method: "POST",
    body: {
      ...primaryBody,
      country: "",
    },
  });

  if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
    return fallbackResults;
  }

  return Array.isArray(primaryResults) ? primaryResults : [];
}

async function fetchSourceFreshness(options = {}) {
  const now = Date.now();
  if (freshnessCache.value && freshnessCache.expiresAt > now) {
    return freshnessCache.value;
  }

  if (!options.forceRefresh && freshnessCache.promise) {
    return freshnessCache.promise;
  }

  freshnessCache.promise = Promise.all([
    fetchJson(OFAC_SDN_LIST_URL, { method: "POST", body: null }),
    fetchJson(OFAC_CONSOLIDATED_LIST_URL, { method: "POST", body: null }),
  ])
    .then(([sdnEntries, consolidatedEntries]) => {
      const value = {
        sdnLastUpdated: getLatestLastUpdated(sdnEntries),
        consolidatedLastUpdated: getLatestLastUpdated(consolidatedEntries),
      };

      freshnessCache.value = value;
      freshnessCache.expiresAt = Date.now() + FRESHNESS_CACHE_TTL_MS;
      freshnessCache.promise = null;
      return value;
    })
    .catch((error) => {
      freshnessCache.promise = null;
      throw error;
    });

  return freshnessCache.promise;
}

function buildScreeningData(query, rawMatches) {
  const normalizedMatches = Array.isArray(rawMatches) ? rawMatches : [];
  const groupedMatches = groupMatches(normalizedMatches, query.name).slice(0, query.limit);
  const exactMatchCount = groupedMatches.filter((match) => match.exactNameMatch).length;

  return {
    query: {
      name: query.name,
      minScore: query.minScore,
      limit: query.limit,
      ...(query.country ? { country: query.country } : {}),
    },
    summary: {
      status: groupedMatches.length ? "potential-match" : "no-potential-match",
      rawResultCount: normalizedMatches.length,
      matchCount: groupedMatches.length,
      exactMatchCount,
      manualReviewRecommended: groupedMatches.length > 0,
    },
    matches: groupedMatches,
  };
}

function resetFreshnessCache() {
  freshnessCache.expiresAt = 0;
  freshnessCache.value = null;
  freshnessCache.promise = null;
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_MIN_SCORE,
  MAX_LIMIT,
  OFAC_CONSOLIDATED_LIST_URL,
  OFAC_SDN_LIST_URL,
  OFAC_SEARCH_URL,
  buildScreeningData,
  clampInteger,
  createHttpError,
  fetchSearchResults,
  fetchSourceFreshness,
  normalizeString,
  resetFreshnessCache,
};
