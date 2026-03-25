const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DISCOVERY_BASE_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http";
const DEFAULT_DISCOVERY_LIMIT = 500;
const DEFAULT_METRICS_URL = "https://x402-data-bazaar.vercel.app/ops/metrics/data";
const DEFAULT_ENV_CANDIDATES = [
  ".env.vercel.production.check",
  ".env.vercel.production",
];

function parseEnvFile(raw) {
  const values = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return values;
}

function findEnvFile(candidates = DEFAULT_ENV_CANDIDATES) {
  for (const candidate of candidates) {
    const absolutePath = path.isAbsolute(candidate)
      ? candidate
      : path.join(process.cwd(), candidate);

    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

function loadMetricsPassword(options = {}) {
  const envFile = options.envFile ?? findEnvFile(options.envCandidates);
  if (!envFile) {
    return { envFile: null, password: null };
  }

  const parsed = parseEnvFile(fs.readFileSync(envFile, "utf8"));
  return {
    envFile,
    password: parsed.METRICS_DASHBOARD_PASSWORD || null,
  };
}

async function safeFetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = text;

  try {
    body = JSON.parse(text);
  } catch (error) {
    // Keep plain text for debugging if JSON parsing fails.
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMetricsSummary(options = {}) {
  const url = options.url ?? DEFAULT_METRICS_URL;
  const firstAttempt = await safeFetchJson(url, {
    headers: options.headers ?? {},
  });

  if (firstAttempt.status !== 401) {
    return {
      ...firstAttempt,
      url,
      envFile: null,
    };
  }

  const { envFile, password } = loadMetricsPassword(options);
  if (!password) {
    return {
      ...firstAttempt,
      url,
      envFile,
      authRequired: true,
    };
  }

  const authorization = `Basic ${Buffer.from(`metrics:${password}`).toString("base64")}`;
  const secondAttempt = await safeFetchJson(url, {
    headers: {
      ...(options.headers ?? {}),
      Authorization: authorization,
    },
  });

  return {
    ...secondAttempt,
    url,
    envFile,
  };
}

function buildDiscoveryUrl(baseUrl = DEFAULT_DISCOVERY_BASE_URL, limit = DEFAULT_DISCOVERY_LIMIT, offset = 0) {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set("limit", String(limit));
  parsed.searchParams.set("offset", String(offset));
  return parsed.toString();
}

async function fetchDiscoveryResources(options = {}) {
  const baseUrl = options.url ?? DEFAULT_DISCOVERY_BASE_URL;
  const headers = options.headers ?? {};
  const limit = Number(options.limit) || DEFAULT_DISCOVERY_LIMIT;
  const maxPages = Number(options.maxPages) || Number.POSITIVE_INFINITY;
  const retryDelaysMs = options.retryDelaysMs ?? [2000, 5000, 10000, 15000];

  let offset = 0;
  let discoveredTotal = null;
  let pageCount = 0;
  const items = [];
  let firstResponse = null;

  while ((discoveredTotal == null || offset < discoveredTotal) && pageCount < maxPages) {
    const pageUrl = buildDiscoveryUrl(baseUrl, limit, offset);
    let result = null;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      result = await safeFetchJson(pageUrl, {
        headers,
      });

      if (result.status !== 429) {
        break;
      }

      if (attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt]);
      }
    }

    if (!result.ok) {
      return {
        ...result,
        url: pageUrl,
      };
    }

    if (!firstResponse) {
      firstResponse = result;
    }

    const pageItems = Array.isArray(result.body?.items) ? result.body.items : [];
    items.push(...pageItems);

    if (discoveredTotal == null) {
      discoveredTotal = result.body?.pagination?.total ?? pageItems.length;
    }

    pageCount += 1;
    offset += limit;

    if (!pageItems.length) {
      break;
    }
  }

  return {
    ...firstResponse,
    url: buildDiscoveryUrl(baseUrl, limit, 0),
    body: {
      ...(firstResponse?.body && typeof firstResponse.body === "object" ? firstResponse.body : {}),
      items,
      pagination: {
        ...(firstResponse?.body?.pagination || {}),
        limit,
        offset: 0,
        total: discoveredTotal ?? items.length,
        pagesFetched: pageCount,
      },
    },
  };
}

module.exports = {
  DEFAULT_DISCOVERY_BASE_URL,
  DEFAULT_DISCOVERY_LIMIT,
  DEFAULT_METRICS_URL,
  buildDiscoveryUrl,
  fetchDiscoveryResources,
  fetchMetricsSummary,
  findEnvFile,
  loadMetricsPassword,
  parseEnvFile,
  safeFetchJson,
};
