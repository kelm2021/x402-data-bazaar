#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_DISCOVERY_BASE_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http";
const DEFAULT_DISCOVERY_LIMIT = 500;
const DEFAULT_DOMAIN = "x402-data-bazaar.vercel.app";
const DEFAULT_METRICS_URL = "https://x402-data-bazaar.vercel.app/ops/metrics/data";
const DEFAULT_402INDEX_BASE_URL = "https://402index.io/api/v1";
const DEFAULT_402INDEX_SEARCH_LIMIT = 100;
const DEFAULT_402INDEX_PROBE_STREAM_PATH = "/demo/probe-live";
const DEFAULT_402INDEX_AUDIT_HOST_LIMIT = 200;
const DEFAULT_402INDEX_AUDIT_CONCURRENCY = 1;
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "self";

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function decodeBase64Json(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch (error) {
    return null;
  }
}

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

function findEnvFile() {
  const candidates = [
    path.join(process.cwd(), ".env.vercel.production.check"),
    path.join(process.cwd(), ".env.vercel.production"),
    path.join(
      "C:\\Users\\KentEgan\\claude projects\\x402-data-bazaar",
      ".env.vercel.production.check",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadMetricsPassword() {
  const envFile = findEnvFile();
  if (!envFile) {
    return { envFile: null, password: null };
  }

  const parsed = parseEnvFile(fs.readFileSync(envFile, "utf8"));
  return {
    envFile,
    password: parsed.METRICS_DASHBOARD_PASSWORD || null,
  };
}

async function safeFetch(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return { ok: true, response, text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAwalDistDir() {
  const candidates = [
    path.join(process.env.APPDATA || "", "npm", "node_modules", "awal", "dist"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, "ipcClient.js"))) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate the installed awal CLI runtime needed for paid verification.",
  );
}

async function loadAwalIpc() {
  const distDir = getAwalDistDir();
  const ipcModuleUrl = pathToFileURL(path.join(distDir, "ipcClient.js")).href;
  const authModuleUrl = pathToFileURL(path.join(distDir, "utils", "authCheck.js")).href;
  const { sendIpcRequest } = await import(ipcModuleUrl);
  const { requireAuth } = await import(authModuleUrl);

  return { requireAuth, sendIpcRequest };
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function summarizeService(service) {
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    protocol: service.protocol,
    health: service.health_status ?? null,
    source: service.source ?? null,
    method: service.http_method ?? null,
    paymentValid: service.x402_payment_valid ?? null,
    reliability: service.reliability_score ?? null,
    lastChecked: service.last_checked ?? null,
  };
}

function normalizeUsdPrice(value) {
  if (value == null) {
    return null;
  }

  const cleaned = String(value).replace(/\$/g, "").replace(/\s*USDC$/i, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncateText(value, maxLength = 280) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

function sanitizeHeaderMap(headers) {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, truncateText(value)]),
  );
}

function normalizeServiceUrl(url, { stripQuery = false } = {}) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(String(url));
    const origin = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`;
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const search = stripQuery ? "" : parsed.search;
    return `${origin}${pathname}${search}`;
  } catch (error) {
    return null;
  }
}

function parseSseEvents(rawText) {
  const events = [];
  for (const line of String(rawText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) {
      continue;
    }

    try {
      events.push(JSON.parse(payload));
    } catch (error) {
      events.push({
        step: "raw",
        message: payload,
      });
    }
  }

  return events;
}

function sanitizeProbeEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  if (!event.headers || typeof event.headers !== "object") {
    return event;
  }

  return {
    ...event,
    headers: sanitizeHeaderMap(event.headers),
  };
}

function summarizeProbeEvents(events) {
  const summary = {
    protocol: null,
    healthStatus: null,
    responseStatus: null,
    responseTimeMs: null,
    totalTimeMs: null,
    validation: null,
    headers: {},
  };

  for (const event of events) {
    if (event?.step === "response") {
      summary.responseStatus = event.status ?? summary.responseStatus;
      summary.responseTimeMs = event.time_ms ?? summary.responseTimeMs;
      continue;
    }

    if (event?.step === "headers") {
      summary.protocol = event.protocol ?? summary.protocol;
      summary.headers = sanitizeHeaderMap(event.headers);
      continue;
    }

    if (event?.step === "analysis" || event?.step === "done") {
      summary.protocol = event.protocol ?? summary.protocol;
      summary.healthStatus = event.health_status ?? summary.healthStatus;
      summary.totalTimeMs = event.total_time_ms ?? summary.totalTimeMs;
      continue;
    }

    if (
      event?.step === "l402_validation" ||
      event?.step === "x402_validation" ||
      event?.step === "mpp_validation"
    ) {
      summary.validation = {
        step: event.step,
        valid: event.valid ?? null,
        details: event.details ?? null,
        message: event.message ?? null,
      };
    }
  }

  return summary;
}

function summarizeLocalProbeFromHttp(response, text) {
  const status = response?.status ?? null;
  const paymentRequired = response?.headers?.get("payment-required");
  const wwwAuthenticate = response?.headers?.get("www-authenticate");
  let protocol = null;

  if (paymentRequired) {
    protocol = "x402";
  } else if (wwwAuthenticate && /L402/i.test(wwwAuthenticate)) {
    protocol = "L402";
  } else if (wwwAuthenticate && /Payment/i.test(wwwAuthenticate)) {
    protocol = "MPP";
  }

  let healthStatus = "degraded";
  if (status === 402 && protocol) {
    healthStatus = "healthy";
  } else if (status >= 500) {
    healthStatus = "down";
  } else if (status >= 200 && status < 300 && !protocol) {
    healthStatus = "degraded";
  }

  let validation = null;
  if (protocol === "x402") {
    validation = {
      step: "x402_validation",
      valid: Boolean(paymentRequired),
      details: {
        hasPaymentRequiredHeader: Boolean(paymentRequired),
      },
      message: paymentRequired
        ? "x402 payment-required header detected."
        : "Missing x402 payment-required header.",
    };
  } else if (protocol === "L402") {
    const hasMacaroon = /macaroon=/i.test(wwwAuthenticate || "");
    const hasInvoice = /invoice=/i.test(wwwAuthenticate || "");
    validation = {
      step: "l402_validation",
      valid: hasMacaroon && hasInvoice,
      details: {
        hasMacaroon,
        hasInvoice,
      },
      message:
        hasMacaroon && hasInvoice
          ? "L402 WWW-Authenticate header includes macaroon + invoice."
          : "L402 WWW-Authenticate header missing macaroon or invoice.",
    };
  }

  return {
    protocol,
    healthStatus,
    responseStatus: status,
    responseTimeMs: null,
    totalTimeMs: null,
    validation,
    headers: sanitizeHeaderMap({
      ...(paymentRequired ? { "PAYMENT-REQUIRED": paymentRequired } : {}),
      ...(wwwAuthenticate ? { "WWW-Authenticate": wwwAuthenticate } : {}),
    }),
    body: truncateText(text, 220),
  };
}

async function fetchDirectProbe(endpointUrl) {
  const result = await safeFetch(endpointUrl, {
    headers: {
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      status: null,
      summary: {
        protocol: null,
        healthStatus: null,
        responseStatus: null,
        responseTimeMs: null,
        totalTimeMs: null,
        validation: null,
        headers: {},
      },
      events: [],
      networkError: result.error,
      source: "direct",
    };
  }

  const summary = summarizeLocalProbeFromHttp(result.response, result.text);
  return {
    ok: result.response.ok || result.response.status === 402,
    status: result.response.status,
    summary,
    events: [
      {
        step: "direct_request",
        message: `GET ${endpointUrl}`,
      },
      {
        step: "direct_response",
        message: `HTTP ${result.response.status}`,
        headers: summary.headers,
      },
    ],
    networkError: null,
    source: "direct",
  };
}

function build402IndexServicesUrl(query, limit = DEFAULT_402INDEX_SEARCH_LIMIT) {
  const parsed = new URL(`${DEFAULT_402INDEX_BASE_URL}/services`);
  parsed.searchParams.set("q", String(query || ""));
  parsed.searchParams.set("limit", String(limit));
  return parsed.toString();
}

function build402IndexProbeUrl(endpointUrl) {
  const parsed = new URL(`${DEFAULT_402INDEX_BASE_URL}${DEFAULT_402INDEX_PROBE_STREAM_PATH}`);
  parsed.searchParams.set("url", endpointUrl);
  return parsed.toString();
}

async function fetch402IndexServices(query, limit = DEFAULT_402INDEX_SEARCH_LIMIT) {
  const url = build402IndexServicesUrl(query, limit);
  const result = await safeFetch(url, {});

  if (!result.ok) {
    return {
      ok: false,
      url,
      networkError: result.error,
    };
  }

  const body = parseMaybeJson(result.text);
  return {
    ok: result.response.ok,
    status: result.response.status,
    url,
    query,
    body,
  };
}

async function fetch402IndexProbe(endpointUrl, options = {}) {
  const maxRetries = parseInteger(options.maxRetries, 3);
  const url = build402IndexProbeUrl(endpointUrl);
  const retryDelaysMs = [1000, 2000, 4000, 8000];
  let attempt = 0;
  let lastResult = null;

  while (attempt <= maxRetries) {
    lastResult = await safeFetch(url, {});

    if (!lastResult.ok) {
      return {
        ok: false,
        url,
        networkError: lastResult.error,
        events: [],
        summary: null,
      };
    }

    if (lastResult.response.status !== 429) {
      break;
    }

    const retryAfterHeader = lastResult.response.headers.get("retry-after");
    const retryAfterSeconds = parseInteger(retryAfterHeader, null);
    const fallbackDelay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
    const delayMs =
      retryAfterSeconds != null && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : fallbackDelay;

    if (attempt >= maxRetries) {
      break;
    }

    await sleep(delayMs);
    attempt += 1;
  }

  const events = parseSseEvents(lastResult?.text ?? "");
  const sanitizedEvents = events.map(sanitizeProbeEvent);
  if (lastResult?.response?.status === 429) {
    const directFallback = await fetchDirectProbe(endpointUrl);
    return {
      ok: directFallback.ok,
      status: 429,
      url,
      events: directFallback.events,
      summary: {
        ...directFallback.summary,
        details: {
          ...(directFallback.summary?.details ?? {}),
          fallbackUsed: true,
          fallbackReason: "402index-probe-rate-limited",
        },
      },
      networkError: directFallback.networkError ?? null,
      source: "402index+direct-fallback",
    };
  }

  return {
    ok: lastResult?.response?.ok ?? false,
    status: lastResult?.response?.status ?? null,
    url,
    events: sanitizedEvents,
    summary: summarizeProbeEvents(sanitizedEvents),
    networkError: null,
    source: "402index",
  };
}

function classify402IndexMatches(endpointUrl, services) {
  const endpointExact = normalizeServiceUrl(endpointUrl, { stripQuery: false });
  const endpointPathOnly = normalizeServiceUrl(endpointUrl, { stripQuery: true });
  const endpointHost = (() => {
    try {
      return new URL(endpointUrl).host.toLowerCase();
    } catch (error) {
      return null;
    }
  })();

  const exact = [];
  const samePath = [];
  const sameHost = [];

  for (const service of services) {
    if (!service?.url) {
      continue;
    }

    const serviceExact = normalizeServiceUrl(service.url, { stripQuery: false });
    const servicePathOnly = normalizeServiceUrl(service.url, { stripQuery: true });
    let serviceHost = null;
    try {
      serviceHost = new URL(service.url).host.toLowerCase();
    } catch (error) {
      serviceHost = null;
    }

    if (endpointExact && serviceExact === endpointExact) {
      exact.push(summarizeService(service));
    }

    if (endpointPathOnly && servicePathOnly === endpointPathOnly) {
      samePath.push(summarizeService(service));
    }

    if (endpointHost && serviceHost === endpointHost) {
      sameHost.push(summarizeService(service));
    }
  }

  return {
    exactUrlMatches: exact,
    samePathMatches: samePath,
    sameHostMatches: sameHost,
  };
}

function build402IndexRecommendations(endpointUrl, probe, matches) {
  const suggestions = [];

  const hasQuery = (() => {
    try {
      return Boolean(new URL(endpointUrl).search);
    } catch (error) {
      return false;
    }
  })();

  if (probe?.summary?.responseStatus !== 402) {
    suggestions.push(
      "Unpaid request did not return HTTP 402; discovery health will degrade unless the endpoint challenges with 402 first.",
    );
  }

  if (!probe?.summary?.protocol) {
    suggestions.push(
      "No payment protocol header detected; ensure x402 sends PAYMENT-REQUIRED or L402 sends WWW-Authenticate.",
    );
  }

  if (probe?.summary?.validation && probe.summary.validation.valid === false) {
    suggestions.push(
      "Protocol validation failed in the live probe; compare headers with the validation details and fix before listing.",
    );
  }

  if (!matches.samePathMatches.length && !matches.exactUrlMatches.length) {
    suggestions.push(
      "No matching indexed service was found for this endpoint path; check discovery registration and canonical route exposure.",
    );
  }

  if (hasQuery && !matches.exactUrlMatches.length && matches.samePathMatches.length) {
    suggestions.push(
      "This URL includes query parameters while the directory appears to index the path only; prefer canonical path URLs for checks.",
    );
  }

  if (!matches.sameHostMatches.length) {
    suggestions.push(
      "No services from this host are indexed; confirm the service is published to discovery sources consumed by 402index.",
    );
  }

  return suggestions;
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeProtocolLabel(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (lower === "l402") {
    return "L402";
  }
  if (lower === "x402") {
    return "x402";
  }
  if (lower === "mpp") {
    return "MPP";
  }
  return normalized;
}

function classifyIndexCoverage(endpointUrl, hostServices) {
  const endpointExact = normalizeServiceUrl(endpointUrl, { stripQuery: false });
  const endpointPathOnly = normalizeServiceUrl(endpointUrl, { stripQuery: true });

  const exactMatches = [];
  const pathMatches = [];

  for (const service of hostServices) {
    const serviceExact = normalizeServiceUrl(service.url, { stripQuery: false });
    const servicePathOnly = normalizeServiceUrl(service.url, { stripQuery: true });

    if (endpointExact && serviceExact === endpointExact) {
      exactMatches.push(summarizeService(service));
    }

    if (endpointPathOnly && servicePathOnly === endpointPathOnly) {
      pathMatches.push(summarizeService(service));
    }
  }

  const coverage =
    exactMatches.length > 0 ? "exact" : pathMatches.length > 0 ? "path" : hostServices.length ? "host-only" : "none";

  return {
    coverage,
    exactMatches,
    pathMatches,
  };
}

function summarizeHostMetadataQuality(hostServices) {
  const services = Array.isArray(hostServices) ? hostServices : [];
  const totals = {
    indexedServices: services.length,
    missingPrice: 0,
    uncategorized: 0,
    missingDescription: 0,
    degradedOrDown: 0,
  };

  for (const service of services) {
    const hasPrice = service?.price_usd != null || service?.price_sats != null;
    const category = String(service?.category ?? "").toLowerCase();
    const hasDescription = Boolean(String(service?.description ?? "").trim());
    const health = String(service?.health_status ?? "").toLowerCase();

    if (!hasPrice) {
      totals.missingPrice += 1;
    }
    if (!category || category === "uncategorized") {
      totals.uncategorized += 1;
    }
    if (!hasDescription) {
      totals.missingDescription += 1;
    }
    if (health === "degraded" || health === "down") {
      totals.degradedOrDown += 1;
    }
  }

  return totals;
}

function summarizeAuditTotals(items) {
  const totals = {
    endpoints: items.length,
    probeHealthy: 0,
    probeDegraded: 0,
    probeDown: 0,
    probeUnknown: 0,
    probeErrors: 0,
    probeRateLimited: 0,
    paymentRequired402: 0,
    indexExact: 0,
    indexPath: 0,
    indexHostOnly: 0,
    indexNone: 0,
    metadata: {
      missingPriceOnIndexedRoutes: 0,
      uncategorizedOnIndexedRoutes: 0,
      missingDescriptionOnIndexedRoutes: 0,
      categoryMismatchOnIndexedRoutes: 0,
      priceMismatchOnIndexedRoutes: 0,
    },
    protocolDetected: {
      x402: 0,
      L402: 0,
      MPP: 0,
      unknown: 0,
    },
  };

  for (const item of items) {
    const probeSummary = item.probe?.summary ?? null;
    const healthStatus = probeSummary?.healthStatus ?? null;
    const protocol = normalizeProtocolLabel(probeSummary?.protocol);
    const coverage = item.indexing?.coverage ?? "none";
    const probeStatus = item.probe?.status ?? null;
    const indexedRouteMeta = item.indexing?.indexedRouteMetadata ?? null;
    const expectedMeta = item.expected ?? null;

    if (probeStatus === 429) {
      totals.probeRateLimited += 1;
    }

    if (probeSummary?.responseStatus === 402) {
      totals.paymentRequired402 += 1;
    }

    if (healthStatus === "healthy") {
      totals.probeHealthy += 1;
    } else if (healthStatus === "degraded") {
      totals.probeDegraded += 1;
    } else if (healthStatus === "down") {
      totals.probeDown += 1;
    } else if (healthStatus === "unknown") {
      totals.probeUnknown += 1;
    } else {
      totals.probeErrors += 1;
    }

    if (coverage === "exact") {
      totals.indexExact += 1;
    } else if (coverage === "path") {
      totals.indexPath += 1;
    } else if (coverage === "host-only") {
      totals.indexHostOnly += 1;
    } else {
      totals.indexNone += 1;
    }

    if (coverage === "exact" || coverage === "path") {
      const hasPrice =
        indexedRouteMeta?.price_usd != null || indexedRouteMeta?.price_sats != null;
      const category = String(indexedRouteMeta?.category ?? "").toLowerCase();
      const hasDescription = Boolean(String(indexedRouteMeta?.description ?? "").trim());

      if (!hasPrice) {
        totals.metadata.missingPriceOnIndexedRoutes += 1;
      }
      if (!category || category === "uncategorized") {
        totals.metadata.uncategorizedOnIndexedRoutes += 1;
      }
      if (!hasDescription) {
        totals.metadata.missingDescriptionOnIndexedRoutes += 1;
      }

      if (
        expectedMeta?.category &&
        indexedRouteMeta?.category &&
        String(indexedRouteMeta.category).toLowerCase() !==
          String(expectedMeta.category).toLowerCase()
      ) {
        totals.metadata.categoryMismatchOnIndexedRoutes += 1;
      }

      if (expectedMeta?.priceUsd != null && indexedRouteMeta?.price_usd != null) {
        const drift = Math.abs(Number(indexedRouteMeta.price_usd) - Number(expectedMeta.priceUsd));
        if (Number.isFinite(drift) && drift > 1e-6) {
          totals.metadata.priceMismatchOnIndexedRoutes += 1;
        }
      }
    }

    if (protocol === "x402") {
      totals.protocolDetected.x402 += 1;
    } else if (protocol === "L402") {
      totals.protocolDetected.L402 += 1;
    } else if (protocol === "MPP") {
      totals.protocolDetected.MPP += 1;
    } else {
      totals.protocolDetected.unknown += 1;
    }
  }

  return totals;
}

function loadRouteEntriesFromModule({
  modulePath,
  moduleId,
  serviceName,
  categoryByRouteKey = new Map(),
}) {
  const resolvedPath = path.resolve(modulePath);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(resolvedPath);
  const routeConfig =
    mod.routeConfig ??
    (typeof mod.createRouteConfig === "function" ? mod.createRouteConfig() : null) ??
    {};
  const entries = [];

  for (const [routeKey, config] of Object.entries(routeConfig)) {
    if (!config || typeof config !== "object") {
      continue;
    }

    const resource = config.resource ?? null;
    const accepts = asArray(config.accepts);
    const firstAccept = accepts[0] ?? {};
    const protocolHint =
      firstAccept.scheme && String(firstAccept.scheme).toLowerCase() === "exact"
        ? "x402"
        : null;

    if (!resource || !String(resource).startsWith("http")) {
      continue;
    }

    entries.push({
      moduleId,
      serviceName,
      modulePath: resolvedPath,
      routeKey,
      resourceUrl: String(resource),
      resourcePath: (() => {
        try {
          const parsed = new URL(resource);
          return `${parsed.pathname}${parsed.search}`;
        } catch (error) {
          return null;
        }
      })(),
      protocolHint,
      price: firstAccept.price ?? null,
      expectedPriceUsd: normalizeUsdPrice(firstAccept.price ?? null),
      expectedCategory: categoryByRouteKey.get(routeKey) ?? null,
      payTo: firstAccept.payTo ?? null,
    });
  }

  return entries;
}

function buildCurrentEndpointInventory() {
  const categoryByRouteKey = (() => {
    try {
      // eslint-disable-next-line global-require
      const { createSellerPortfolio } = require("../portfolio");
      const map = new Map();
      const portfolio = createSellerPortfolio();
      for (const seller of portfolio) {
        const category = seller.category ?? null;
        for (const routeKey of seller.routeKeys ?? []) {
          if (category && !map.has(routeKey)) {
            map.set(routeKey, category);
          }
        }
      }
      return map;
    } catch (error) {
      return new Map();
    }
  })();

  const sourceModules = [
    {
      moduleId: "warehouse",
      serviceName: "x402 Data Bazaar",
      modulePath: path.join(process.cwd(), "app.js"),
    },
    {
      moduleId: "restricted-party-screen",
      serviceName: "Restricted Party Screen",
      modulePath: path.join(process.cwd(), "apps", "restricted-party-screen", "app.js"),
    },
    {
      moduleId: "vendor-entity-brief",
      serviceName: "Vendor Entity Brief",
      modulePath: path.join(process.cwd(), "apps", "vendor-entity-brief", "app.js"),
    },
  ];

  const entries = [];
  for (const source of sourceModules) {
    if (!fs.existsSync(source.modulePath)) {
      continue;
    }

    entries.push(...loadRouteEntriesFromModule({ ...source, categoryByRouteKey }));
  }

  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const dedupeKey = `${entry.moduleId}::${entry.routeKey}::${entry.resourceUrl}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(entry);
  }

  return deduped;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const normalizedConcurrency = Math.max(1, Number.parseInt(concurrency, 10) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = [];
  for (let index = 0; index < Math.min(normalizedConcurrency, items.length); index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function buildDiscoveryUrl(baseUrl = DEFAULT_DISCOVERY_BASE_URL, limit = DEFAULT_DISCOVERY_LIMIT, offset = 0) {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set("limit", String(limit));
  parsed.searchParams.set("offset", String(offset));
  return parsed.toString();
}

async function fetchAllDiscoveryItems(baseUrl = DEFAULT_DISCOVERY_BASE_URL, limit = DEFAULT_DISCOVERY_LIMIT) {
  let offset = 0;
  let discoveredTotal = null;
  let pageCount = 0;
  const items = [];
  const retryDelaysMs = [2000, 5000, 10000, 15000];

  while (discoveredTotal == null || offset < discoveredTotal) {
    const pageUrl = buildDiscoveryUrl(baseUrl, limit, offset);
    let result = null;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      result = await safeFetch(pageUrl, {});

      if (!result.ok) {
        return {
          ok: false,
          url: pageUrl,
          networkError: result.error,
        };
      }

      if (result.response.status !== 429) {
        break;
      }

      if (attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt]);
      }
    }

    if (result.response.status === 429) {
      return {
        ok: false,
        url: pageUrl,
        status: 429,
        networkError: "HTTP 429 from discovery API",
      };
    }

    const body = parseMaybeJson(result.text);
    const pageItems = Array.isArray(body?.items) ? body.items : [];
    items.push(...pageItems);

    if (discoveredTotal == null) {
      discoveredTotal = body?.pagination?.total ?? pageItems.length;
    }

    pageCount += 1;
    offset += limit;

    if (!pageItems.length) {
      break;
    }
  }

  return {
    ok: true,
    url: buildDiscoveryUrl(baseUrl, limit, 0),
    itemCount: items.length,
    pageCount,
    total: discoveredTotal ?? items.length,
    items,
  };
}

function summarizeDiscoveryItem(item) {
  const primaryAccept = Array.isArray(item.accepts) ? item.accepts[0] : item.accepts;
  return {
    resource: item.resource,
    lastUpdated: item.lastUpdated,
    payTo: primaryAccept?.payTo ?? null,
    description: primaryAccept?.description ?? null,
  };
}

async function runMetrics(url = DEFAULT_METRICS_URL) {
  const baseHeaders = {
    [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
  };

  const firstAttempt = await safeFetch(url, {
    headers: baseHeaders,
  });

  if (!firstAttempt.ok) {
    printJson({
      ok: false,
      stage: "metrics",
      url,
      networkError: firstAttempt.error,
    });
    return;
  }

  if (firstAttempt.response.status === 401) {
    const { envFile, password } = loadMetricsPassword();
    if (!password) {
      printJson({
        ok: false,
        stage: "metrics",
        url,
        status: 401,
        authRequired: true,
        envFile,
      });
      return;
    }

    const authorization = `Basic ${Buffer.from(`metrics:${password}`).toString("base64")}`;
    const secondAttempt = await safeFetch(url, {
      headers: {
        ...baseHeaders,
        Authorization: authorization,
      },
    });

    if (!secondAttempt.ok) {
      printJson({
        ok: false,
        stage: "metrics",
        url,
        envFile,
        networkError: secondAttempt.error,
      });
      return;
    }

    const body = parseMaybeJson(secondAttempt.text);
    printJson({
      ok: secondAttempt.response.ok,
      stage: "metrics",
      url,
      status: secondAttempt.response.status,
      envFile,
      body,
    });
    return;
  }

  printJson({
    ok: firstAttempt.response.ok,
    stage: "metrics",
    url,
    status: firstAttempt.response.status,
    body: parseMaybeJson(firstAttempt.text),
  });
}

async function runUnpaid(url) {
  if (!url) {
    throw new Error("unpaid requires a URL");
  }

  const result = await safeFetch(url, {
    headers: {
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
  });

  if (!result.ok) {
    printJson({
      ok: false,
      stage: "unpaid",
      url,
      networkError: result.error,
    });
    return;
  }

  printJson({
    ok: result.response.ok,
    stage: "unpaid",
    url,
    status: result.response.status,
    paymentRequiredHeader: result.response.headers.get("payment-required"),
    body: parseMaybeJson(result.text),
  });
}

async function runDiscovery(needle = DEFAULT_DOMAIN) {
  const result = await fetchAllDiscoveryItems();

  if (!result.ok) {
    printJson({
      ok: false,
      stage: "discovery",
      url: result.url,
      status: result.status ?? null,
      networkError: result.networkError ?? result.error ?? null,
    });
    return;
  }

  const matches = result.items
    .filter((item) => {
      const resources = [item.resource, ...(Array.isArray(item.accepts) ? item.accepts : [item.accepts])]
        .map((value) => (value && typeof value === "object" ? value.resource : null))
        .filter(Boolean);
      return resources.some((value) => String(value).includes(needle));
    })
    .map(summarizeDiscoveryItem);

  printJson({
    ok: true,
    stage: "discovery",
    url: result.url,
    needle,
    searchedCount: result.itemCount,
    searchedTotal: result.total,
    pagesFetched: result.pageCount,
    count: matches.length,
    matches,
  });
}

async function runProbe(url) {
  if (!url) {
    throw new Error("probe requires a URL");
  }

  const result = await safeFetch(url, {
    headers: {
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
  });

  if (!result.ok) {
    printJson({
      ok: false,
      stage: "probe",
      url,
      networkError: result.error,
    });
    return;
  }

  printJson({
    ok: result.response.ok,
    stage: "probe",
    url,
    status: result.response.status,
  });
}

async function run402IndexSearch(query, limitArg) {
  if (!query) {
    throw new Error("402index-search requires a query string");
  }

  const limit = parseInteger(limitArg, DEFAULT_402INDEX_SEARCH_LIMIT);
  const result = await fetch402IndexServices(query, limit);

  if (!result.ok) {
    printJson({
      ok: false,
      stage: "402index-search",
      query,
      url: result.url,
      status: result.status ?? null,
      networkError: result.networkError ?? null,
      body: result.body ?? null,
    });
    return;
  }

  const services = Array.isArray(result.body?.services) ? result.body.services : [];
  printJson({
    ok: true,
    stage: "402index-search",
    query,
    url: result.url,
    status: result.status,
    total: result.body?.total ?? services.length,
    count: services.length,
    services: services.map(summarizeService),
  });
}

async function run402IndexProbe(endpointUrl) {
  if (!endpointUrl) {
    throw new Error("402index-probe requires an endpoint URL");
  }

  const result = await fetch402IndexProbe(endpointUrl);

  if (!result.ok) {
    printJson({
      ok: false,
      stage: "402index-probe",
      endpointUrl,
      url: result.url,
      status: result.status ?? null,
      networkError: result.networkError ?? null,
      events: result.events ?? [],
      summary: result.summary ?? null,
    });
    return;
  }

  printJson({
    ok: true,
    stage: "402index-probe",
    endpointUrl,
    url: result.url,
    status: result.status,
    source: result.source ?? "402index",
    summary: result.summary,
    events: result.events,
  });
}

async function run402IndexCheck(endpointUrl, limitArg) {
  if (!endpointUrl) {
    throw new Error("402index-check requires an endpoint URL");
  }

  let parsedEndpoint = null;
  try {
    parsedEndpoint = new URL(endpointUrl);
  } catch (error) {
    throw new Error(`402index-check requires a valid URL: ${endpointUrl}`);
  }

  const pathOnlyUrl = `${parsedEndpoint.protocol}//${parsedEndpoint.host}${parsedEndpoint.pathname}`;
  const hostQuery = parsedEndpoint.host;
  const limit = parseInteger(limitArg, DEFAULT_402INDEX_SEARCH_LIMIT);
  const searchQueries = [...new Set([endpointUrl, pathOnlyUrl, hostQuery])];

  const [probeResult, ...searchResults] = await Promise.all([
    fetch402IndexProbe(endpointUrl),
    ...searchQueries.map((query) => fetch402IndexServices(query, limit)),
  ]);
  const searchErrors = searchResults.filter((entry) => !entry.ok);

  const combinedMap = new Map();
  for (const entry of searchResults) {
    const services = Array.isArray(entry.body?.services) ? entry.body.services : [];
    for (const service of services) {
      if (!service?.id) {
        continue;
      }
      combinedMap.set(service.id, service);
    }
  }
  const combinedServices = [...combinedMap.values()];
  const matches = classify402IndexMatches(endpointUrl, combinedServices);
  const recommendations = build402IndexRecommendations(endpointUrl, probeResult, matches);

  printJson({
    ok: probeResult.ok && searchErrors.length === 0,
    stage: "402index-check",
    endpointUrl,
    checks: {
      probe: {
        ok: probeResult.ok,
        url: probeResult.url,
        status: probeResult.status ?? null,
        source: probeResult.source ?? "402index",
        networkError: probeResult.networkError ?? null,
        summary: probeResult.summary ?? null,
      },
      searches: searchResults.map((entry) => ({
        ok: entry.ok,
        query: entry.query,
        url: entry.url,
        status: entry.status ?? null,
        total: entry.body?.total ?? null,
        count: Array.isArray(entry.body?.services) ? entry.body.services.length : null,
        networkError: entry.networkError ?? null,
      })),
    },
    directory: {
      distinctServicesSeen: combinedServices.length,
      exactUrlMatches: matches.exactUrlMatches,
      samePathMatches: matches.samePathMatches,
      sameHostMatches: matches.sameHostMatches,
    },
    recommendations,
  });
}

async function run402IndexAudit(scopeArg, concurrencyArg) {
  const scope = String(scopeArg || "all").trim().toLowerCase();
  const concurrency = parseInteger(concurrencyArg, DEFAULT_402INDEX_AUDIT_CONCURRENCY);
  const allEntries = buildCurrentEndpointInventory();
  const entries =
    scope === "all"
      ? allEntries
      : allEntries.filter(
          (entry) =>
            entry.moduleId.toLowerCase().includes(scope) ||
            entry.serviceName.toLowerCase().includes(scope) ||
            entry.resourceUrl.toLowerCase().includes(scope),
        );

  if (!entries.length) {
    printJson({
      ok: false,
      stage: "402index-audit",
      scope,
      reason: "No endpoints matched the requested scope.",
    });
    return;
  }

  const hostSet = new Set();
  for (const entry of entries) {
    try {
      hostSet.add(new URL(entry.resourceUrl).host.toLowerCase());
    } catch (error) {
      // skip malformed URL
    }
  }

  const hosts = [...hostSet];
  const hostSearchResults = await Promise.all(
    hosts.map((host) => fetch402IndexServices(host, DEFAULT_402INDEX_AUDIT_HOST_LIMIT)),
  );
  const hostServices = new Map();
  const hostSearchSummary = [];

  for (let index = 0; index < hosts.length; index += 1) {
    const host = hosts[index];
    const result = hostSearchResults[index];
    const services = Array.isArray(result.body?.services) ? result.body.services : [];
    hostServices.set(host, services);
    const metadataQuality = summarizeHostMetadataQuality(services);
    hostSearchSummary.push({
      host,
      ok: result.ok,
      status: result.status ?? null,
      total: result.body?.total ?? services.length,
      count: services.length,
      metadataQuality,
      networkError: result.networkError ?? null,
      queryUrl: result.url,
    });
  }

  const auditedEndpoints = await mapWithConcurrency(
    entries,
    concurrency,
    async (entry) => {
      let host = null;
      try {
        host = new URL(entry.resourceUrl).host.toLowerCase();
      } catch (error) {
        host = null;
      }

      const probe = await fetch402IndexProbe(entry.resourceUrl);
      const servicesForHost = host ? hostServices.get(host) ?? [] : [];
      const indexing = classifyIndexCoverage(entry.resourceUrl, servicesForHost);
      const bestIndexedRoute =
        indexing.exactMatches[0] ??
        indexing.pathMatches[0] ??
        null;
      const bestIndexedRaw =
        bestIndexedRoute == null
          ? null
          : servicesForHost.find((service) => service.id === bestIndexedRoute.id) ?? null;
      const recommendations = build402IndexRecommendations(entry.resourceUrl, probe, {
        exactUrlMatches: indexing.exactMatches,
        samePathMatches: indexing.pathMatches,
        sameHostMatches: servicesForHost.map(summarizeService),
      });

      return {
        moduleId: entry.moduleId,
        serviceName: entry.serviceName,
        routeKey: entry.routeKey,
        endpointUrl: entry.resourceUrl,
        resourcePath: entry.resourcePath,
        protocolHint: entry.protocolHint,
        pricing: {
          price: entry.price ?? null,
          expectedPriceUsd: entry.expectedPriceUsd ?? null,
          payTo: entry.payTo ?? null,
        },
        expected: {
          category: entry.expectedCategory ?? null,
          priceUsd: entry.expectedPriceUsd ?? null,
        },
        probe: {
          ok: probe.ok,
          status: probe.status ?? null,
          source: probe.source ?? "402index",
          summary: probe.summary ?? null,
          networkError: probe.networkError ?? null,
        },
        indexing: {
          coverage: indexing.coverage,
          exactMatches: indexing.exactMatches,
          pathMatches: indexing.pathMatches,
          hostMatchCount: servicesForHost.length,
          indexedRouteMetadata: bestIndexedRaw
            ? {
                id: bestIndexedRaw.id ?? null,
                url: bestIndexedRaw.url ?? null,
                source: bestIndexedRaw.source ?? null,
                category: bestIndexedRaw.category ?? null,
                price_usd: bestIndexedRaw.price_usd ?? null,
                price_sats: bestIndexedRaw.price_sats ?? null,
                description: bestIndexedRaw.description ?? null,
                health_status: bestIndexedRaw.health_status ?? null,
              }
            : null,
        },
        recommendations,
      };
    },
  );

  const totals = summarizeAuditTotals(auditedEndpoints);
  const failures = auditedEndpoints.filter(
    (entry) => {
      const metadata = entry.indexing?.indexedRouteMetadata ?? null;
      const coverage = entry.indexing?.coverage ?? "none";
      const metadataGap =
        (coverage === "exact" || coverage === "path") &&
        (!metadata ||
          (metadata.price_usd == null && metadata.price_sats == null) ||
          !metadata.description ||
          String(metadata.category ?? "").toLowerCase() === "uncategorized");

      return (
        !entry.probe.ok ||
        coverage === "none" ||
        coverage === "host-only" ||
        entry.probe?.summary?.responseStatus !== 402 ||
        entry.probe?.summary?.healthStatus !== "healthy" ||
        metadataGap
      );
    },
  );

  printJson({
    ok: true,
    stage: "402index-audit",
    scope,
    generatedAt: new Date().toISOString(),
    inventory: {
      modules: [...new Set(auditedEndpoints.map((entry) => entry.moduleId))],
      hosts,
      endpointCount: auditedEndpoints.length,
    },
    hostSearch: hostSearchSummary,
    totals,
    failureCount: failures.length,
    failures,
    endpoints: auditedEndpoints,
  });
}

async function runPay(url, maxAmount = 10000) {
  if (!url) {
    throw new Error("pay requires a URL");
  }

  const parsed = new URL(url);
  const { requireAuth, sendIpcRequest } = await loadAwalIpc();

  await requireAuth();

  const result = await sendIpcRequest("make-x402-request", {
    baseURL: `${parsed.protocol}//${parsed.host}`,
    path: `${parsed.pathname}${parsed.search}`,
    method: "GET",
    headers: {
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
    maxAmountPerRequest: Number(maxAmount) || 10000,
  });

  printJson({
    ok: result.status >= 200 && result.status < 300,
    stage: "pay",
    url,
    maxAmount: Number(maxAmount) || 10000,
    paymentResponse: decodeBase64Json(result.headers?.["PAYMENT-RESPONSE"]),
    body: result,
  });
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (command === "metrics") {
    await runMetrics(args[0]);
    return;
  }

  if (command === "unpaid") {
    await runUnpaid(args[0]);
    return;
  }

  if (command === "discovery") {
    await runDiscovery(args[0]);
    return;
  }

  if (command === "probe") {
    await runProbe(args[0]);
    return;
  }

  if (command === "402index-search") {
    await run402IndexSearch(args[0], args[1]);
    return;
  }

  if (command === "402index-probe") {
    await run402IndexProbe(args[0]);
    return;
  }

  if (command === "402index-check") {
    await run402IndexCheck(args[0], args[1]);
    return;
  }

  if (command === "402index-audit") {
    await run402IndexAudit(args[0], args[1]);
    return;
  }

  if (command === "pay") {
    await runPay(args[0], args[1]);
    return;
  }

  throw new Error(
    "Usage: automation_http.cjs <metrics|unpaid|discovery|probe|pay|402index-search|402index-probe|402index-check|402index-audit> [arg]",
  );
}

main().catch((error) => {
  printJson({
    ok: false,
    stage: "fatal",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
