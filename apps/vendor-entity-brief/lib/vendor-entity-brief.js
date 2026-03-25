const { createHttpError, normalizeString } = require("./ofac");

const GLEIF_BASE_URL = "https://api.gleif.org/api/v1";
const GLEIF_FUZZY_COMPLETIONS_URL = `${GLEIF_BASE_URL}/fuzzycompletions`;
const GLEIF_LEI_RECORDS_URL = `${GLEIF_BASE_URL}/lei-records`;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const USER_AGENT =
  "vendor-entity-brief/1.0 (+https://vendor-entity-brief.vercel.app)";

function normalizeComparisonString(value) {
  return normalizeString(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toUpperCase();
}

function splitTokens(value) {
  return normalizeComparisonString(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
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
        "User-Agent": USER_AGENT,
        ...(options.headers ?? {}),
      },
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
        parsed?.errors?.[0]?.title ??
        parsed?.message ??
        `GLEIF request failed with status ${response.status}`;
      throw createHttpError(message, 502);
    }

    return parsed;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createHttpError("GLEIF request timed out.", 504);
    }

    if (error.statusCode) {
      throw error;
    }

    throw createHttpError(
      `GLEIF request failed: ${error.message || "Unknown upstream error"}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((entry) => normalizeString(entry)).filter(Boolean))];
}

function getEntityNames(entity = {}) {
  const legalName = entity.legalName?.name ?? null;
  const otherNames = Array.isArray(entity.otherNames)
    ? entity.otherNames.map((entry) => entry?.name)
    : [];
  const transliteratedNames = Array.isArray(entity.transliteratedOtherNames)
    ? entity.transliteratedOtherNames.map((entry) => entry?.name)
    : [];

  return dedupeStrings([legalName, ...otherNames, ...transliteratedNames]);
}

function computeNameMatchScore(queryName, names = []) {
  const normalizedQuery = normalizeComparisonString(queryName);
  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = splitTokens(queryName);
  let bestScore = 0;

  for (const name of names) {
    const normalizedCandidate = normalizeComparisonString(name);
    if (!normalizedCandidate) {
      continue;
    }

    if (normalizedCandidate === normalizedQuery) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
      bestScore = Math.max(bestScore, 96);
      continue;
    }

    const candidateTokens = splitTokens(name);
    const overlapCount = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    const overlapRatio =
      queryTokens.length > 0 ? overlapCount / queryTokens.length : 0;
    const prefixBonus = normalizedCandidate.startsWith(normalizedQuery) ? 8 : 0;
    const tokenBonus = candidateTokens.some((token) => normalizedQuery.startsWith(token)) ? 4 : 0;
    const score = Math.round(70 + overlapRatio * 24 + prefixBonus + tokenBonus);
    bestScore = Math.max(bestScore, Math.min(95, score));
  }

  return bestScore;
}

function getNameMatchConfidence(score) {
  if (score >= 99) {
    return "exact";
  }

  if (score >= 95) {
    return "high";
  }

  if (score >= 88) {
    return "medium";
  }

  return "low";
}

function formatAddress(address = {}) {
  const addressLines = Array.isArray(address.addressLines) ? address.addressLines : [];
  const parts = [
    ...addressLines,
    address.city,
    address.region,
    address.country,
    address.postalCode,
  ];

  return dedupeStrings(parts).join(", ");
}

function buildEntityCandidate(record, query, fuzzyRank = null) {
  const attributes = record?.attributes ?? {};
  const entity = attributes.entity ?? {};
  const registration = attributes.registration ?? {};
  const names = getEntityNames(entity);
  const legalName = entity.legalName?.name ?? names[0] ?? record?.id ?? "";
  const jurisdiction = normalizeString(entity.jurisdiction);
  const requestedCountry = normalizeString(query.country).toUpperCase();
  const countryMatch = requestedCountry ? jurisdiction === requestedCountry : null;
  const nameMatchScore = computeNameMatchScore(query.name, names);
  const boostedNameMatchScore =
    countryMatch === true ? Math.min(100, nameMatchScore + 3) : nameMatchScore;
  const aliases = names.filter((name) => name !== legalName);

  return {
    lei: attributes.lei ?? record?.id ?? null,
    legalName,
    aliasNames: aliases,
    jurisdiction: jurisdiction || null,
    countryMatch,
    nameMatchScore: boostedNameMatchScore,
    nameMatchConfidence: getNameMatchConfidence(boostedNameMatchScore),
    fuzzyRank,
    entityStatus: entity.status ?? null,
    registrationStatus: registration.status ?? null,
    registrationCorroboration: registration.corroborationLevel ?? null,
    registeredAs: entity.registeredAs ?? null,
    registeredAt: entity.registeredAt?.id ?? null,
    legalFormId: entity.legalForm?.id ?? null,
    category: entity.category ?? null,
    bic: Array.isArray(attributes.bic) ? attributes.bic : [],
    conformityFlag: attributes.conformityFlag ?? null,
    managingLou: registration.managingLou ?? null,
    lastUpdateDate: registration.lastUpdateDate ?? null,
    nextRenewalDate: registration.nextRenewalDate ?? null,
    legalAddress: formatAddress(entity.legalAddress),
    headquartersAddress: formatAddress(entity.headquartersAddress),
    sourceUrl: record?.links?.self ?? `${GLEIF_LEI_RECORDS_URL}/${attributes.lei ?? record?.id}`,
  };
}

function compareCandidates(left, right) {
  const leftCountryBoost = left.countryMatch === true ? 1 : 0;
  const rightCountryBoost = right.countryMatch === true ? 1 : 0;
  if (rightCountryBoost !== leftCountryBoost) {
    return rightCountryBoost - leftCountryBoost;
  }

  if (right.nameMatchScore !== left.nameMatchScore) {
    return right.nameMatchScore - left.nameMatchScore;
  }

  const leftFuzzyRank = Number.isFinite(left.fuzzyRank) ? left.fuzzyRank : Number.MAX_SAFE_INTEGER;
  const rightFuzzyRank = Number.isFinite(right.fuzzyRank) ? right.fuzzyRank : Number.MAX_SAFE_INTEGER;
  if (leftFuzzyRank !== rightFuzzyRank) {
    return leftFuzzyRank - rightFuzzyRank;
  }

  return String(left.legalName).localeCompare(String(right.legalName));
}

async function fetchFuzzyCompletions(name) {
  const url = buildUrl(GLEIF_FUZZY_COMPLETIONS_URL, {
    field: "entity.legalName",
    q: name,
  });
  const payload = await fetchJson(url);

  return Array.isArray(payload?.data)
    ? payload.data.map((entry, index) => ({
      lei:
        entry?.relationships?.["lei-records"]?.data?.id ??
        entry?.relationships?.["lei-records"]?.data?.[0]?.id ??
        null,
      label: entry?.attributes?.value ?? null,
      fuzzyRank: index,
    }))
    : [];
}

async function fetchLeiRecords(name, pageSize) {
  const url = buildUrl(GLEIF_LEI_RECORDS_URL, {
    "filter[fulltext]": name,
    "page[size]": pageSize,
  });
  const payload = await fetchJson(url);

  return {
    records: Array.isArray(payload?.data) ? payload.data : [],
    publishDate: payload?.meta?.goldenCopy?.publishDate ?? null,
  };
}

async function fetchLeiRecordById(lei) {
  if (!lei) {
    return null;
  }

  const payload = await fetchJson(`${GLEIF_LEI_RECORDS_URL}/${encodeURIComponent(lei)}`);
  return payload?.data ?? null;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function fetchEntityCandidates(query) {
  const expandedPageSize = Math.max(query.limit * 4, 10);
  const [fuzzyMatches, leiRecordSearch] = await Promise.all([
    fetchFuzzyCompletions(query.name),
    fetchLeiRecords(query.name, expandedPageSize),
  ]);

  const fuzzyRankByLei = new Map(
    fuzzyMatches
      .filter((entry) => entry.lei)
      .map((entry) => [entry.lei, entry.fuzzyRank]),
  );
  const recordMap = new Map(
    leiRecordSearch.records
      .filter((record) => record?.id)
      .map((record) => [record.id, record]),
  );
  const missingFuzzyIds = fuzzyMatches
    .map((entry) => entry.lei)
    .filter((lei) => lei && !recordMap.has(lei))
    .slice(0, query.limit);

  if (missingFuzzyIds.length) {
    const supplementalRecords = await mapWithConcurrency(
      missingFuzzyIds,
      3,
      (lei) => fetchLeiRecordById(lei),
    );

    for (const record of supplementalRecords.filter(Boolean)) {
      recordMap.set(record.id, record);
    }
  }

  const candidates = [...recordMap.values()]
    .map((record) => buildEntityCandidate(record, query, fuzzyRankByLei.get(record.id) ?? null))
    .sort(compareCandidates)
    .slice(0, query.limit);

  return {
    publishDate: leiRecordSearch.publishDate,
    candidates,
  };
}

function buildSummary(query, entityCandidates, screening) {
  const bestEntityCandidate = entityCandidates[0] ?? null;
  const screeningMatchCount = screening.summary.matchCount;

  if (screeningMatchCount > 0) {
    return {
      status: "manual-review-required",
      recommendedAction: "pause-and-review",
      leiCandidateCount: entityCandidates.length,
      screeningMatchCount,
      manualReviewRecommended: true,
      entityResolutionConfidence: bestEntityCandidate?.nameMatchConfidence ?? "low",
    };
  }

  if (!entityCandidates.length) {
    return {
      status: "entity-resolution-needed",
      recommendedAction: "verify-entity-manually",
      leiCandidateCount: 0,
      screeningMatchCount,
      manualReviewRecommended: true,
      entityResolutionConfidence: "low",
    };
  }

  if (
    bestEntityCandidate.nameMatchConfidence === "low" ||
    (query.country && bestEntityCandidate.countryMatch === false)
  ) {
    return {
      status: "entity-review-recommended",
      recommendedAction: "verify-entity-before-proceeding",
      leiCandidateCount: entityCandidates.length,
      screeningMatchCount,
      manualReviewRecommended: true,
      entityResolutionConfidence: bestEntityCandidate.nameMatchConfidence,
    };
  }

  return {
    status: "clear-to-proceed",
    recommendedAction: "proceed",
    leiCandidateCount: entityCandidates.length,
    screeningMatchCount,
    manualReviewRecommended: false,
    entityResolutionConfidence: bestEntityCandidate.nameMatchConfidence,
  };
}

function buildVendorEntityBriefResponse(query, entitySearch, screening, freshness) {
  const entityCandidates = entitySearch.candidates;
  const bestEntityCandidate = entityCandidates[0] ?? null;

  return {
    success: true,
    data: {
      query: {
        name: query.name,
        ...(query.country ? { country: query.country } : {}),
        minScore: query.minScore,
        limit: query.limit,
      },
      summary: buildSummary(query, entityCandidates, screening),
      bestEntityCandidate,
      entityCandidates,
      screening: {
        summary: screening.summary,
        topMatch: screening.matches[0] ?? null,
        matches: screening.matches,
      },
      sourceFreshness: {
        gleifGoldenCopyPublishDate: entitySearch.publishDate,
        ofac: freshness,
      },
      screeningOnly: false,
      note:
        "This API provides vendor due-diligence support for agents. Sanctions matches and low-confidence entity matches require human review before a compliance or onboarding decision.",
    },
    source: "GLEIF API + OFAC Sanctions List Service",
  };
}

module.exports = {
  DEFAULT_LIMIT,
  GLEIF_FUZZY_COMPLETIONS_URL,
  GLEIF_LEI_RECORDS_URL,
  MAX_LIMIT,
  buildVendorEntityBriefResponse,
  fetchEntityCandidates,
};
