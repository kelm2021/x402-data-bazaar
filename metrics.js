const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Redis } = require("@upstash/redis");

const DASHBOARD_USERNAME = "metrics";
const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_HOURLY_BUCKETS = 7 * 24;
const METRICS_NAMESPACE = "metrics:v1";
const DEFAULT_SELF_TAG_HEADER_NAME = "x-metrics-source";
const DEFAULT_SELF_TAG_HEADER_VALUE = "self";
const DEFAULT_TOP_CALLERS = 12;
const USD_MICROS_PER_USD = 1_000_000;
const RETIRED_ROUTE_PREFIXES = ["/api/fec"];
const RETIRED_ROUTE_KEYS = new Set([
  "POST /api/vendor-entity-brief",
  "POST /api/vendor-onboarding/vendor-entity-brief-batch",
]);
const RECENT_PAYING_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const RECENT_PAYING_WINDOW_72H_MS = 72 * 60 * 60 * 1000;

function normalizeSecret(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toIsoHour(value = new Date()) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function getRoutePathValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const firstSpace = normalized.indexOf(" ");
  if (firstSpace > 0) {
    const prefix = normalized.slice(0, firstSpace).toUpperCase();
    if (prefix === "GET" || prefix === "HEAD" || prefix === "POST" || prefix === "PUT") {
      return normalized.slice(firstSpace + 1).trim();
    }
  }

  return normalized;
}

function isRetiredRoutePath(value) {
  const routePath = getRoutePathValue(value).toLowerCase();
  if (!routePath) {
    return false;
  }

  return RETIRED_ROUTE_PREFIXES.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
  );
}

function isRetiredRouteKey(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return false;
  }

  return RETIRED_ROUTE_KEYS.has(normalized);
}

function isRetiredRoute(route = {}) {
  return (
    isRetiredRouteKey(route.key) ||
    isRetiredRoutePath(route.routePath) ||
    isRetiredRoutePath(route.key)
  );
}

function sanitizeRouteKeyForDisplay(routeKey) {
  return isRetiredRouteKey(routeKey) || isRetiredRoutePath(routeKey) ? null : routeKey ?? null;
}

function sanitizeRouteKeysForDisplay(routeKeys = []) {
  const visible = [];
  const seen = new Set();
  for (const routeKey of routeKeys) {
    if (!routeKey || isRetiredRouteKey(routeKey) || isRetiredRoutePath(routeKey) || seen.has(routeKey)) {
      continue;
    }
    seen.add(routeKey);
    visible.push(routeKey);
  }
  return visible.sort();
}

function createCounterSet() {
  return {
    total: 0,
    success: 0,
    paidSuccess: 0,
    externalPaidSuccess: 0,
    selfTaggedPaidSuccess: 0,
    paymentRequired: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalDurationMs: 0,
    paidUsdMicros: 0,
    externalPaidUsdMicros: 0,
    selfTaggedPaidUsdMicros: 0,
  };
}

function getHeaderValue(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeFingerprintPart(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function getForwardedIp(req) {
  const forwardedFor = getHeaderValue(req.headers, "x-forwarded-for");
  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim() || null;
  }

  const realIp = getHeaderValue(req.headers, "x-real-ip");
  if (realIp) {
    return String(realIp).trim() || null;
  }

  return req.ip ?? null;
}

function normalizeServiceHost(value) {
  const normalized = String(value ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "unknown-host";
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    try {
      return normalizeServiceHost(new URL(normalized).host.toLowerCase());
    } catch (error) {
      return normalizeServiceHost(normalized.replace(/^https?:\/\//, ""));
    }
  }

  try {
    const parsed = new URL(`http://${normalized}`);
    const hostname = String(parsed.hostname ?? "").trim().toLowerCase();
    if (hostname) {
      return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
    }
  } catch (error) {
    // Fall through to regex-based normalization for malformed host headers.
  }

  const bracketedIpv6 = normalized.match(/^\[([0-9a-f:]+)\](?::\d+)?$/i);
  if (bracketedIpv6) {
    return `[${bracketedIpv6[1].toLowerCase()}]`;
  }

  if (/^[^:\s]+:\d+$/.test(normalized)) {
    return normalized.slice(0, normalized.lastIndexOf(":"));
  }

  if (normalized.endsWith(".")) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function getRequestServiceHost(req) {
  const forwardedHost = getHeaderValue(req.headers, "x-forwarded-host");
  if (forwardedHost) {
    return normalizeServiceHost(forwardedHost);
  }

  const hostHeader = getHeaderValue(req.headers, "host");
  if (hostHeader) {
    return normalizeServiceHost(hostHeader);
  }

  if (req.hostname) {
    return normalizeServiceHost(req.hostname);
  }

  return "unknown-host";
}

function isRawHostObservation(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized === "unknown-host" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(normalized) ||
    /^\[[0-9a-f:]+\](?::\d+)?$/i.test(normalized)
  );
}

function formatObservedHostLabel(value) {
  return isRawHostObservation(value) ? "Direct IP / raw host header" : String(value ?? "unknown-host");
}

function formatObservedHostDetail(service) {
  const routeCountLabel = `${formatInteger(service.routeCount)} active routes seen for this observed host`;
  if (!isRawHostObservation(service.serviceHost)) {
    return routeCountLabel;
  }

  return `${routeCountLabel}; do not treat this row as a distinct product surface`;
}

function classifyUserAgent(userAgent) {
  const value = String(userAgent ?? "").toLowerCase();

  if (!value) {
    return "unknown";
  }

  if (value.includes("node-fetch")) {
    return "node-fetch";
  }

  if (value.includes("undici")) {
    return "undici";
  }

  if (value.includes("curl/")) {
    return "curl";
  }

  if (
    value.includes("python-requests") ||
    value.includes("httpx") ||
    value.includes("aiohttp")
  ) {
    return "python";
  }

  if (value.includes("postmanruntime")) {
    return "postman";
  }

  if (value.includes("go-http-client")) {
    return "go";
  }

  if (
    value.includes("mozilla/") ||
    value.includes("chrome/") ||
    value.includes("safari/") ||
    value.includes("firefox/")
  ) {
    return "browser";
  }

  return "other";
}

function createMetricsAttribution(options = {}) {
  const env = options.env ?? process.env;
  const sourceSalt =
    options.sourceSalt ??
    env.METRICS_SOURCE_SALT ??
    env.METRICS_DASHBOARD_PASSWORD ??
    env.KV_REST_API_TOKEN ??
    null;

  return {
    sourceSalt: sourceSalt ? String(sourceSalt) : null,
    mode: sourceSalt ? "salted-fingerprint" : "agent-class-only",
    selfTagHeaderName: DEFAULT_SELF_TAG_HEADER_NAME,
    selfTagHeaderValue: DEFAULT_SELF_TAG_HEADER_VALUE,
  };
}

function getPublicMetricsAttribution(attribution = createMetricsAttribution()) {
  const privacy =
    attribution.mode === "salted-fingerprint"
      ? "Caller IDs are salted hashes of network origin and user agent. Raw IPs and raw user agents are never stored."
      : "Caller IDs fall back to broad client classes because no metrics salt is configured. Raw IPs and raw user agents are never stored.";

  return {
    enabled: true,
    mode: attribution.mode,
    selfTagHeaderName: attribution.selfTagHeaderName,
    selfTagValueHint: attribution.selfTagHeaderValue,
    privacy,
  };
}

function createRequestSourceDescriber(attribution = createMetricsAttribution()) {
  const selfTagHeaderName = attribution.selfTagHeaderName.toLowerCase();
  const selfTagHeaderValue = attribution.selfTagHeaderValue.toLowerCase();
  const sourceSalt = attribution.sourceSalt;

  return function describeRequestSource(req) {
    const userAgent = normalizeFingerprintPart(
      getHeaderValue(req.headers, "user-agent"),
      "unknown-user-agent",
    );
    const networkOrigin = normalizeFingerprintPart(
      getForwardedIp(req),
      "unknown-network-origin",
    );
    const selfTag = String(getHeaderValue(req.headers, selfTagHeaderName) ?? "")
      .trim()
      .toLowerCase();
    const sourceKind = selfTag === selfTagHeaderValue ? "self-tagged" : "anonymous";
    const agentClass = classifyUserAgent(userAgent);
    const prefix = sourceKind === "self-tagged" ? "self" : "anon";
    const sourceId = sourceSalt
      ? `${prefix}_${crypto
          .createHmac("sha256", sourceSalt)
          .update(`${networkOrigin}|${userAgent}`)
          .digest("hex")
          .slice(0, 12)}`
      : `${prefix}_${agentClass}`;

    return {
      sourceId,
      sourceKind,
      agentClass,
    };
  };
}

function formatUsdPrice(price) {
  if (price == null) {
    return "Free";
  }

  if (typeof price === "number") {
    return `$${price.toFixed(3)} USDC`;
  }

  const normalized = price.startsWith("$") ? price : `$${price}`;
  return `${normalized} USDC`;
}

function parseUsdAmount(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s*USDC$/i, "")
    .replace(/^\$/, "");

  if (!normalized || normalized.toLowerCase() === "free") {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function usdToMicros(value) {
  const numeric = parseUsdAmount(value);
  return numeric == null ? 0 : Math.round(numeric * USD_MICROS_PER_USD);
}

function microsToUsd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }

  return Number((numeric / USD_MICROS_PER_USD).toFixed(6));
}

function formatUsdAmount(value) {
  const numeric = Number(value ?? 0);
  const minimumFractionDigits = numeric >= 1 ? 2 : 3;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function getRoutePriceUsdMicros(route = {}) {
  const directMicros = Number(route.priceUsdMicros);
  if (Number.isFinite(directMicros) && directMicros > 0) {
    return Math.round(directMicros);
  }

  return usdToMicros(route.priceUsd ?? route.priceLabel ?? route.price ?? null);
}

function normalizeRouteCatalog(routeCatalog = []) {
  return routeCatalog.map((route) => {
    const key = route.key ?? `${route.method} ${route.routePath}`;
    const [derivedMethod, ...routeParts] = String(key || "").split(" ");
    const method = route.method ?? derivedMethod ?? "GET";
    const routePath = route.routePath ?? routeParts.join(" ");
    const priceUsdMicros = getRoutePriceUsdMicros(route);

    return {
      key,
      method,
      routePath,
      description: route.description ?? "",
      priceLabel:
        route.priceLabel ?? formatUsdPrice(route.priceUsd ?? route.price ?? null),
      priceUsdMicros,
    };
  });
}

function createRouteCatalog(routes = {}) {
  return normalizeRouteCatalog(
    Object.entries(routes).map(([key, config]) => {
      const [method, routePath] = key.split(" ");
      const paymentOption = Array.isArray(config.accepts) ? config.accepts[0] : config.accepts;

      return {
        key,
        method,
        routePath,
        description: config.description ?? "",
        priceLabel: formatUsdPrice(paymentOption?.price ?? null),
        priceUsdMicros: usdToMicros(paymentOption?.price ?? null),
      };
    }),
  );
}

function createRouteResolver(routeCatalog) {
  const exactMatches = new Map();
  const wildcardMatches = [];

  for (const route of routeCatalog) {
    if (route.routePath.includes("*")) {
      wildcardMatches.push(route);
    } else {
      exactMatches.set(`${route.method} ${route.routePath}`, route.key);
    }
  }

  function resolveByMethod(normalizedMethod, requestPath) {
    const exactKey = exactMatches.get(`${normalizedMethod} ${requestPath}`);
    if (exactKey) {
      return exactKey;
    }

    for (const route of wildcardMatches) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const prefix = route.routePath.slice(0, route.routePath.indexOf("*"));
      if (requestPath.startsWith(prefix)) {
        return route.key;
      }
    }

    return null;
  }

  return function resolveMetricRouteKey(method, requestPath) {
    const normalizedMethod = String(method || "").toUpperCase();
    const directKey = resolveByMethod(normalizedMethod, requestPath);
    if (directKey) {
      return directKey;
    }

    if (normalizedMethod === "HEAD") {
      const fallbackGetKey = resolveByMethod("GET", requestPath);
      if (fallbackGetKey) {
        return fallbackGetKey;
      }
    }

    return `${normalizedMethod} ${requestPath}`;
  };
}

function createRouteState(route) {
  return {
    ...createCounterSet(),
    key: route.key,
    method: route.method,
    routePath: route.routePath,
    description: route.description,
    priceLabel: route.priceLabel,
    priceUsdMicros: getRoutePriceUsdMicros(route),
    lastSeenAt: null,
    lastStatus: null,
    lastPath: null,
  };
}

function createSourceState(source = {}) {
  return {
    ...createCounterSet(),
    sourceId: source.sourceId,
    sourceKind: source.sourceKind ?? "anonymous",
    agentClass: source.agentClass ?? "unknown",
    lastSeenAt: null,
    lastRouteKey: null,
    lastPath: null,
  };
}

function createServiceState(service = {}) {
  return {
    ...createCounterSet(),
    serviceHost: service.serviceHost ?? "unknown-host",
    lastSeenAt: null,
    lastRouteKey: null,
    lastPath: null,
    routeKeysSeen: [],
  };
}

function createHourlyState(hourStart) {
  return {
    ...createCounterSet(),
    hourStart,
  };
}

function createSnapshot(routeCatalog) {
  const routes = {};
  for (const route of routeCatalog) {
    routes[route.key] = createRouteState(route);
  }

  return {
    startedAt: new Date().toISOString(),
    updatedAt: null,
    totals: createCounterSet(),
    routes,
    sources: {},
    services: {},
    hourly: {},
  };
}

function getEventPaidUsdMicros(event) {
  if (!(event.statusCode >= 200 && event.statusCode < 300 && event.wasPaid)) {
    return 0;
  }

  const directMicros = Number(event.paidUsdMicros);
  if (Number.isFinite(directMicros) && directMicros > 0) {
    return Math.round(directMicros);
  }

  const routeMicros = Number(event.routePriceUsdMicros);
  if (Number.isFinite(routeMicros) && routeMicros > 0) {
    return Math.round(routeMicros);
  }

  return 0;
}

function deriveRoutePaidUsdMicros(route = {}) {
  const recorded = numericValue(route.paidUsdMicros);
  if (recorded > 0) {
    return recorded;
  }

  const priceUsdMicros = getRoutePriceUsdMicros(route);
  const paidSuccess = numericValue(route.paidSuccess);
  if (priceUsdMicros <= 0 || paidSuccess <= 0) {
    return 0;
  }

  return priceUsdMicros * paidSuccess;
}

function deriveSourcePaidCounts(source = {}) {
  const paidSuccess = numericValue(source.paidSuccess);
  const recordedExternal = numericValue(source.externalPaidSuccess);
  const recordedSelf = numericValue(source.selfTaggedPaidSuccess);

  if (recordedExternal > 0 || recordedSelf > 0) {
    return {
      externalPaidSuccess: recordedExternal,
      selfTaggedPaidSuccess: recordedSelf,
    };
  }

  if (paidSuccess <= 0) {
    return {
      externalPaidSuccess: 0,
      selfTaggedPaidSuccess: 0,
    };
  }

  if (source.sourceKind === "self-tagged") {
    return {
      externalPaidSuccess: 0,
      selfTaggedPaidSuccess: paidSuccess,
    };
  }

  return {
    externalPaidSuccess: paidSuccess,
    selfTaggedPaidSuccess: 0,
  };
}

function markCounters(target, event) {
  target.total += 1;
  target.totalDurationMs += event.durationMs;

  if (event.statusCode >= 200 && event.statusCode < 300) {
    target.success += 1;
    if (event.wasPaid) {
      target.paidSuccess += 1;
      const paidUsdMicros = getEventPaidUsdMicros(event);
      target.paidUsdMicros += paidUsdMicros;

      if (event.sourceKind === "self-tagged") {
        target.selfTaggedPaidSuccess += 1;
        target.selfTaggedPaidUsdMicros += paidUsdMicros;
      } else {
        target.externalPaidSuccess += 1;
        target.externalPaidUsdMicros += paidUsdMicros;
      }
    }
    return;
  }

  if (event.statusCode === 402) {
    target.paymentRequired += 1;
    return;
  }

  if (event.statusCode >= 500) {
    target.serverErrors += 1;
    return;
  }

  if (event.statusCode >= 400) {
    target.clientErrors += 1;
  }
}

function trimHourlyBuckets(hourly, now = new Date()) {
  const minimumTime = now.getTime() - MAX_HOURLY_BUCKETS * 60 * 60 * 1000;

  for (const [hourKey] of Object.entries(hourly)) {
    if (Date.parse(hourKey) < minimumTime) {
      delete hourly[hourKey];
    }
  }
}

function applyEvent(snapshot, event) {
  snapshot.updatedAt = event.at;
  markCounters(snapshot.totals, event);

  const routeState =
    snapshot.routes[event.routeKey] ??
    (snapshot.routes[event.routeKey] = {
      ...createCounterSet(),
      key: event.routeKey,
      method: event.method,
      routePath: event.path,
      description: "Unconfigured route",
      priceLabel: "Free",
      priceUsdMicros: event.routePriceUsdMicros ?? 0,
      lastSeenAt: null,
      lastStatus: null,
      lastPath: null,
    });

  if (!routeState.priceUsdMicros && event.routePriceUsdMicros) {
    routeState.priceUsdMicros = Math.round(event.routePriceUsdMicros);
  }

  const metricsEvent =
    event.routePriceUsdMicros || routeState.priceUsdMicros
      ? {
          ...event,
          routePriceUsdMicros: event.routePriceUsdMicros ?? routeState.priceUsdMicros,
        }
      : event;

  markCounters(routeState, metricsEvent);
  routeState.lastSeenAt = event.at;
  routeState.lastStatus = event.statusCode;
  routeState.lastPath = event.path;

  const hourKey = toIsoHour(event.at);
  const bucket =
    snapshot.hourly[hourKey] ?? (snapshot.hourly[hourKey] = createHourlyState(hourKey));
  markCounters(bucket, metricsEvent);

  const sourceState =
    snapshot.sources[event.sourceId] ??
    (snapshot.sources[event.sourceId] = createSourceState({
      sourceId: event.sourceId,
      sourceKind: event.sourceKind,
      agentClass: event.agentClass,
    }));
  markCounters(sourceState, metricsEvent);
  sourceState.lastSeenAt = event.at;
  sourceState.lastRouteKey = event.routeKey;
  sourceState.lastPath = event.path;

  const canonicalServiceHost = normalizeServiceHost(event.serviceHost);
  const serviceState =
    snapshot.services[canonicalServiceHost] ??
    (snapshot.services[canonicalServiceHost] = createServiceState({
      serviceHost: canonicalServiceHost,
    }));
  markCounters(serviceState, metricsEvent);
  serviceState.lastSeenAt = event.at;
  serviceState.lastRouteKey = event.routeKey;
  serviceState.lastPath = event.path;
  if (!serviceState.routeKeysSeen.includes(event.routeKey)) {
    serviceState.routeKeysSeen.push(event.routeKey);
  }

  trimHourlyBuckets(snapshot.hourly, new Date(event.at));
}

function roundAverage(totalDurationMs, totalRequests) {
  if (!totalRequests) {
    return 0;
  }

  return Math.round(totalDurationMs / totalRequests);
}

function getRecentHourKeys(hours = DEFAULT_LOOKBACK_HOURS, now = new Date()) {
  const buckets = [];
  const cursor = new Date(now);
  cursor.setUTCMinutes(0, 0, 0);

  for (let index = hours - 1; index >= 0; index -= 1) {
    const bucket = new Date(cursor);
    bucket.setUTCHours(cursor.getUTCHours() - index);
    buckets.push(bucket.toISOString());
  }

  return buckets;
}

function addCounterValues(target, raw = {}) {
  target.total += numericValue(raw.total);
  target.success += numericValue(raw.success);
  target.paidSuccess += numericValue(raw.paidSuccess);
  target.externalPaidSuccess += numericValue(raw.externalPaidSuccess);
  target.selfTaggedPaidSuccess += numericValue(raw.selfTaggedPaidSuccess);
  target.paymentRequired += numericValue(raw.paymentRequired);
  target.clientErrors += numericValue(raw.clientErrors);
  target.serverErrors += numericValue(raw.serverErrors);
  target.totalDurationMs += numericValue(raw.totalDurationMs);
  target.paidUsdMicros += numericValue(raw.paidUsdMicros);
  target.externalPaidUsdMicros += numericValue(raw.externalPaidUsdMicros);
  target.selfTaggedPaidUsdMicros += numericValue(raw.selfTaggedPaidUsdMicros);
  return target;
}

function mergeServiceState(target, source = {}) {
  addCounterValues(target, source);

  const sourceRouteKeys = Array.isArray(source.routeKeysSeen) ? source.routeKeysSeen : [];
  if (sourceRouteKeys.length > 0) {
    const mergedKeys = new Set(target.routeKeysSeen ?? []);
    for (const routeKey of sourceRouteKeys) {
      mergedKeys.add(routeKey);
    }
    target.routeKeysSeen = Array.from(mergedKeys);
  }

  const targetSeenAt = Date.parse(target.lastSeenAt ?? "");
  const sourceSeenAt = Date.parse(source.lastSeenAt ?? "");
  const shouldReplaceLast =
    !target.lastSeenAt ||
    (Number.isFinite(sourceSeenAt) && (!Number.isFinite(targetSeenAt) || sourceSeenAt >= targetSeenAt));

  if (shouldReplaceLast) {
    target.lastSeenAt = source.lastSeenAt ?? target.lastSeenAt;
    target.lastRouteKey = source.lastRouteKey ?? target.lastRouteKey;
    target.lastPath = source.lastPath ?? target.lastPath;
  }

  return target;
}

function mergeServicesByCanonicalHost(services = {}) {
  const merged = {};
  for (const service of Object.values(services)) {
    const canonicalHost = normalizeServiceHost(service?.serviceHost);
    const target =
      merged[canonicalHost] ??
      (merged[canonicalHost] = createServiceState({
        serviceHost: canonicalHost,
      }));
    mergeServiceState(target, service);
  }

  return merged;
}

function buildTrafficQuality(allCallers = [], options = {}) {
  const referenceTime = Date.parse(options.referenceTime ?? "");
  const nowMs = Number.isFinite(referenceTime) ? referenceTime : Date.now();
  const activeCallers = allCallers.filter(
    (source) => !isRetiredRoutePath(source.lastRouteKeyRaw ?? source.lastRouteKey),
  );
  const payingSources = activeCallers.filter(
    (source) => numericValue(source.paidSuccess) > 0,
  );
  const nonPayingSources = activeCallers.filter(
    (source) => numericValue(source.paidSuccess) === 0,
  );
  const activeRequests = activeCallers.reduce((sum, source) => sum + numericValue(source.total), 0);
  const activePaymentRequired = activeCallers.reduce(
    (sum, source) => sum + numericValue(source.paymentRequired),
    0,
  );
  const nonPayingRequests = nonPayingSources.reduce(
    (sum, source) => sum + numericValue(source.total),
    0,
  );
  const nonPayingPaymentRequired = nonPayingSources.reduce(
    (sum, source) => sum + numericValue(source.paymentRequired),
    0,
  );
  const recentPaying24h = payingSources.filter((source) => {
    const seenAt = Date.parse(source.lastSeenAt ?? "");
    return Number.isFinite(seenAt) && nowMs - seenAt <= RECENT_PAYING_WINDOW_24H_MS;
  }).length;
  const recentPaying72h = payingSources.filter((source) => {
    const seenAt = Date.parse(source.lastSeenAt ?? "");
    return Number.isFinite(seenAt) && nowMs - seenAt <= RECENT_PAYING_WINDOW_72H_MS;
  }).length;
  const agentClassMap = new Map();
  for (const source of activeCallers) {
    const key = source.agentClass || "unknown";
    const entry = agentClassMap.get(key) ?? {
      agentClass: key,
      requests: 0,
      paidSuccess: 0,
      sourceCount: 0,
      nonPayingSourceCount: 0,
    };
    entry.requests += numericValue(source.total);
    entry.paidSuccess += numericValue(source.paidSuccess);
    entry.sourceCount += 1;
    if (numericValue(source.paidSuccess) === 0) {
      entry.nonPayingSourceCount += 1;
    }
    agentClassMap.set(key, entry);
  }

  const topAgentClasses = Array.from(agentClassMap.values())
    .sort((left, right) => {
      if (right.requests !== left.requests) {
        return right.requests - left.requests;
      }

      if (right.nonPayingSourceCount !== left.nonPayingSourceCount) {
        return right.nonPayingSourceCount - left.nonPayingSourceCount;
      }

      return left.agentClass.localeCompare(right.agentClass);
    })
    .slice(0, 5);

  return {
    sources: {
      total: activeCallers.length,
      paying: payingSources.length,
      nonPaying: nonPayingSources.length,
      shareNonPaying: activeCallers.length > 0 ? nonPayingSources.length / activeCallers.length : 0,
      activePaying24h: recentPaying24h,
      activePaying72h: recentPaying72h,
    },
    requests: {
      total: activeRequests,
      fromNonPayingSources: nonPayingRequests,
      shareNonPaying: activeRequests > 0 ? nonPayingRequests / activeRequests : 0,
    },
    paymentRequired: {
      total: activePaymentRequired,
      fromNonPayingSources: nonPayingPaymentRequired,
      shareFromNonPayingSources:
        activePaymentRequired > 0 ? nonPayingPaymentRequired / activePaymentRequired : 0,
    },
    topAgentClasses,
  };
}

function buildSummary(snapshot, storage) {
  const hourlyKeys = getRecentHourKeys();
  const hourly = hourlyKeys.map((hourStart) => {
    const bucket = snapshot.hourly[hourStart] ?? createHourlyState(hourStart);

    return {
      hourStart,
      total: bucket.total,
      success: bucket.success,
      paidSuccess: bucket.paidSuccess,
      externalPaidSuccess: bucket.externalPaidSuccess,
      paymentRequired: bucket.paymentRequired,
      clientErrors: bucket.clientErrors,
      serverErrors: bucket.serverErrors,
      paidUsd: microsToUsd(bucket.paidUsdMicros),
      externalPaidUsd: microsToUsd(bucket.externalPaidUsdMicros),
      selfTaggedPaidUsd: microsToUsd(bucket.selfTaggedPaidUsdMicros),
      averageLatencyMs: roundAverage(bucket.totalDurationMs, bucket.total),
    };
  });

  const routes = Object.values(snapshot.routes)
    .map((route) => {
      const paidUsdMicros = deriveRoutePaidUsdMicros(route);

      return {
        key: route.key,
        method: route.method,
        routePath: route.routePath,
        description: route.description,
        priceLabel: route.priceLabel,
        priceUsd: microsToUsd(route.priceUsdMicros),
        total: route.total,
        success: route.success,
        paidSuccess: route.paidSuccess,
        externalPaidSuccess: route.externalPaidSuccess,
        selfTaggedPaidSuccess: route.selfTaggedPaidSuccess,
        paymentRequired: route.paymentRequired,
        clientErrors: route.clientErrors,
        serverErrors: route.serverErrors,
        paidUsd: microsToUsd(paidUsdMicros),
        externalPaidUsd: microsToUsd(route.externalPaidUsdMicros),
        selfTaggedPaidUsd: microsToUsd(route.selfTaggedPaidUsdMicros),
        averageLatencyMs: roundAverage(route.totalDurationMs, route.total),
        lastSeenAt: route.lastSeenAt,
        lastStatus: route.lastStatus,
        lastPath: route.lastPath,
      };
    })
    .sort((left, right) => {
      if (right.paidUsd !== left.paidUsd) {
        return right.paidUsd - left.paidUsd;
      }

      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.key.localeCompare(right.key);
    });
  const retiredRoutes = routes.filter((route) => isRetiredRoute(route));
  const activeRoutes = routes.filter((route) => !isRetiredRoute(route));
  const retiredRouteRequestCount = retiredRoutes.reduce(
    (sum, route) => sum + numericValue(route.total),
    0,
  );
  const retiredRoutePaymentRequired = retiredRoutes.reduce(
    (sum, route) => sum + numericValue(route.paymentRequired),
    0,
  );

  const allCallers = Object.values(snapshot.sources)
    .map((source) => {
      const paidCounts = deriveSourcePaidCounts(source);
      const rawLastRouteKey = source.lastRouteKey ?? null;
      const sanitizedLastRouteKey = sanitizeRouteKeyForDisplay(rawLastRouteKey);

      return {
        sourceId: source.sourceId,
        sourceKind: source.sourceKind,
        agentClass: source.agentClass,
        total: source.total,
        success: source.success,
        paidSuccess: source.paidSuccess,
        externalPaidSuccess: paidCounts.externalPaidSuccess,
        selfTaggedPaidSuccess: paidCounts.selfTaggedPaidSuccess,
        paymentRequired: source.paymentRequired,
        clientErrors: source.clientErrors,
        serverErrors: source.serverErrors,
        paidUsd: microsToUsd(source.paidUsdMicros),
        externalPaidUsd: microsToUsd(source.externalPaidUsdMicros),
        selfTaggedPaidUsd: microsToUsd(source.selfTaggedPaidUsdMicros),
        averageLatencyMs: roundAverage(source.totalDurationMs, source.total),
        lastSeenAt: source.lastSeenAt,
        lastRouteKey: sanitizedLastRouteKey,
        lastRouteKeyRaw: rawLastRouteKey,
        lastPath: source.lastPath,
      };
    })
    .filter((source) => source.total > 0)
    .sort((left, right) => {
      if (right.externalPaidUsd !== left.externalPaidUsd) {
        return right.externalPaidUsd - left.externalPaidUsd;
      }

      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.sourceId.localeCompare(right.sourceId);
    });
  const callers = allCallers
    .slice(0, DEFAULT_TOP_CALLERS)
    .map(({ lastRouteKeyRaw, ...caller }) => caller);
  const mergedServices = mergeServicesByCanonicalHost(snapshot.services);
  const services = Object.values(mergedServices)
    .map((service) => {
      const routeKeys = sanitizeRouteKeysForDisplay(service.routeKeysSeen);
      return {
        serviceHost: service.serviceHost,
        total: service.total,
        success: service.success,
        paidSuccess: service.paidSuccess,
        externalPaidSuccess: service.externalPaidSuccess,
        selfTaggedPaidSuccess: service.selfTaggedPaidSuccess,
        paymentRequired: service.paymentRequired,
        clientErrors: service.clientErrors,
        serverErrors: service.serverErrors,
        paidUsd: microsToUsd(service.paidUsdMicros),
        externalPaidUsd: microsToUsd(service.externalPaidUsdMicros),
        selfTaggedPaidUsd: microsToUsd(service.selfTaggedPaidUsdMicros),
        averageLatencyMs: roundAverage(service.totalDurationMs, service.total),
        lastSeenAt: service.lastSeenAt,
        lastRouteKey: sanitizeRouteKeyForDisplay(service.lastRouteKey),
        lastPath: service.lastPath,
        routeCount: routeKeys.length,
        routeKeys,
      };
    })
    .filter((service) => service.total > 0)
    .sort((left, right) => {
      if (right.externalPaidUsd !== left.externalPaidUsd) {
        return right.externalPaidUsd - left.externalPaidUsd;
      }

      if (right.paidUsd !== left.paidUsd) {
        return right.paidUsd - left.paidUsd;
      }

      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.serviceHost.localeCompare(right.serviceHost);
    });
  const selfTaggedRequests = allCallers.reduce(
    (sum, source) => sum + (source.sourceKind === "self-tagged" ? source.total : 0),
    0,
  );
  const derivedPaidUsdMicros = activeRoutes.reduce(
    (sum, route) => sum + usdToMicros(route.paidUsd ?? 0),
    0,
  );
  const recordedPaidUsdMicros = numericValue(snapshot.totals.paidUsdMicros);
  const totalPaidUsdMicros = recordedPaidUsdMicros > 0 ? recordedPaidUsdMicros : derivedPaidUsdMicros;
  const attributedPaidSuccess = allCallers.reduce(
    (sum, source) => sum + (source.paidSuccess ?? 0),
    0,
  );
  const attributedExternalPaidSuccess = allCallers.reduce(
    (sum, source) => sum + (source.externalPaidSuccess ?? 0),
    0,
  );
  const attributedSelfTaggedPaidSuccess = allCallers.reduce(
    (sum, source) => sum + (source.selfTaggedPaidSuccess ?? 0),
    0,
  );
  const totalExternalPaidSuccess =
    numericValue(snapshot.totals.externalPaidSuccess) > 0
      ? numericValue(snapshot.totals.externalPaidSuccess)
      : attributedExternalPaidSuccess;
  const totalSelfTaggedPaidSuccess =
    numericValue(snapshot.totals.selfTaggedPaidSuccess) > 0
      ? numericValue(snapshot.totals.selfTaggedPaidSuccess)
      : attributedSelfTaggedPaidSuccess;
  const unattributedHistoricalPaidSuccess = Math.max(
    0,
    snapshot.totals.paidSuccess - attributedPaidSuccess,
  );
  const historicalPaidRevenueBackfilled =
    totalPaidUsdMicros > 0 &&
    snapshot.totals.paidSuccess > 0 &&
    unattributedHistoricalPaidSuccess > 0;
  const trafficQuality = buildTrafficQuality(allCallers, {
    referenceTime: snapshot.updatedAt,
  });

  return {
    generatedAt: new Date().toISOString(),
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.updatedAt,
    storage,
    totals: {
      total: snapshot.totals.total,
      success: snapshot.totals.success,
      paidSuccess: snapshot.totals.paidSuccess,
      externalPaidSuccess: totalExternalPaidSuccess,
      selfTaggedPaidSuccess: totalSelfTaggedPaidSuccess,
      paymentRequired: snapshot.totals.paymentRequired,
      clientErrors: snapshot.totals.clientErrors,
      serverErrors: snapshot.totals.serverErrors,
      paidUsd: microsToUsd(totalPaidUsdMicros),
      externalPaidUsd: microsToUsd(snapshot.totals.externalPaidUsdMicros),
      selfTaggedPaidUsd: microsToUsd(snapshot.totals.selfTaggedPaidUsdMicros),
      averageLatencyMs: roundAverage(snapshot.totals.totalDurationMs, snapshot.totals.total),
      uniqueCallersSeen: allCallers.length,
      uniqueServicesSeen: services.length,
      selfTaggedRequests,
      anonymousRequests: Math.max(0, snapshot.totals.total - selfTaggedRequests),
      uniqueRoutesSeen: activeRoutes.filter((route) => route.total > 0).length,
      attributedPaidSuccess,
      attributedExternalPaidSuccess,
      attributedSelfTaggedPaidSuccess,
      unattributedHistoricalPaidSuccess,
      historicalPaidRevenueBackfilled,
      retiredRoutesRemoved: retiredRoutes.length,
      retiredRouteRequests: retiredRouteRequestCount,
      retiredRoutePaymentRequired,
    },
    routes: activeRoutes,
    callers,
    services,
    hourly,
    trafficQuality,
  };
}

function createRedisClient(options = {}) {
  const env = options.env ?? process.env;
  const url = options.url ?? env.KV_REST_API_URL;
  const token = options.token ?? env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return new Redis({
    url,
    token,
    enableTelemetry: false,
  });
}

function getMetricsRedisKeys(routeKey, hourStart, sourceId, serviceHost) {
  return {
    startedAt: `${METRICS_NAMESPACE}:started-at`,
    updatedAt: `${METRICS_NAMESPACE}:updated-at`,
    totals: `${METRICS_NAMESPACE}:totals`,
    routeKeys: `${METRICS_NAMESPACE}:route-keys`,
    sourceKeys: `${METRICS_NAMESPACE}:source-keys`,
    serviceKeys: `${METRICS_NAMESPACE}:service-keys`,
    route: routeKey ? `${METRICS_NAMESPACE}:route:${encodeURIComponent(routeKey)}` : null,
    hour: hourStart ? `${METRICS_NAMESPACE}:hour:${hourStart}` : null,
    source: sourceId ? `${METRICS_NAMESPACE}:source:${encodeURIComponent(sourceId)}` : null,
    service: serviceHost
      ? `${METRICS_NAMESPACE}:service:${encodeURIComponent(serviceHost)}`
      : null,
    serviceRoutes: serviceHost
      ? `${METRICS_NAMESPACE}:service-routes:${encodeURIComponent(serviceHost)}`
      : null,
  };
}

function numericValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mergeCounterValues(target, raw = {}) {
  target.total = numericValue(raw.total);
  target.success = numericValue(raw.success);
  target.paidSuccess = numericValue(raw.paidSuccess);
  target.externalPaidSuccess = numericValue(raw.externalPaidSuccess);
  target.selfTaggedPaidSuccess = numericValue(raw.selfTaggedPaidSuccess);
  target.paymentRequired = numericValue(raw.paymentRequired);
  target.clientErrors = numericValue(raw.clientErrors);
  target.serverErrors = numericValue(raw.serverErrors);
  target.totalDurationMs = numericValue(raw.totalDurationMs);
  target.paidUsdMicros = numericValue(raw.paidUsdMicros);
  target.externalPaidUsdMicros = numericValue(raw.externalPaidUsdMicros);
  target.selfTaggedPaidUsdMicros = numericValue(raw.selfTaggedPaidUsdMicros);
  return target;
}

function queueCounterUpdates(pipeline, key, event) {
  pipeline.hincrby(key, "total", 1);
  pipeline.hincrby(key, "totalDurationMs", event.durationMs);

  if (event.statusCode >= 200 && event.statusCode < 300) {
    pipeline.hincrby(key, "success", 1);
    if (event.wasPaid) {
      pipeline.hincrby(key, "paidSuccess", 1);
      const paidUsdMicros = getEventPaidUsdMicros(event);
      if (paidUsdMicros > 0) {
        pipeline.hincrby(key, "paidUsdMicros", paidUsdMicros);
      }

      if (event.sourceKind === "self-tagged") {
        pipeline.hincrby(key, "selfTaggedPaidSuccess", 1);
        if (paidUsdMicros > 0) {
          pipeline.hincrby(key, "selfTaggedPaidUsdMicros", paidUsdMicros);
        }
      } else {
        pipeline.hincrby(key, "externalPaidSuccess", 1);
        if (paidUsdMicros > 0) {
          pipeline.hincrby(key, "externalPaidUsdMicros", paidUsdMicros);
        }
      }
    }
    return;
  }

  if (event.statusCode === 402) {
    pipeline.hincrby(key, "paymentRequired", 1);
    return;
  }

  if (event.statusCode >= 500) {
    pipeline.hincrby(key, "serverErrors", 1);
    return;
  }

  if (event.statusCode >= 400) {
    pipeline.hincrby(key, "clientErrors", 1);
  }
}

function queueCompactCounterUpdates(pipeline, key, event) {
  pipeline.hincrby(key, "total", 1);
  pipeline.hincrby(key, "totalDurationMs", event.durationMs);

  if (event.statusCode >= 200 && event.statusCode < 300) {
    pipeline.hincrby(key, "success", 1);
    if (event.wasPaid) {
      pipeline.hincrby(key, "paidSuccess", 1);
      const paidUsdMicros = getEventPaidUsdMicros(event);
      if (paidUsdMicros > 0) {
        pipeline.hincrby(key, "paidUsdMicros", paidUsdMicros);
      }
    }
    return;
  }

  if (event.statusCode === 402) {
    pipeline.hincrby(key, "paymentRequired", 1);
    return;
  }

  if (event.statusCode >= 500) {
    pipeline.hincrby(key, "serverErrors", 1);
    return;
  }

  if (event.statusCode >= 400) {
    pipeline.hincrby(key, "clientErrors", 1);
  }
}

function createRedisMetricsStore(routeCatalog, redis) {
  const storage = {
    kind: "redis",
    persistent: true,
    label: "Upstash Redis via Vercel integration",
  };
  const routeCatalogMap = new Map(routeCatalog.map((route) => [route.key, route]));

  return {
    storage,
    async record(event) {
      const serviceHost = normalizeServiceHost(event.serviceHost);
      const route = routeCatalogMap.get(event.routeKey) ?? {
        key: event.routeKey,
        method: event.method,
        routePath: event.path,
        description: "Unconfigured route",
        priceLabel: "Free",
        priceUsdMicros: 0,
      };
      const metricsEvent = {
        ...event,
        serviceHost,
        routePriceUsdMicros: event.routePriceUsdMicros ?? route.priceUsdMicros ?? 0,
      };
      const hourStart = toIsoHour(event.at);
      const keys = getMetricsRedisKeys(
        event.routeKey,
        hourStart,
        event.sourceId,
        serviceHost,
      );

      const pipeline = redis.pipeline();
      pipeline.setnx(keys.startedAt, event.at);
      pipeline.set(keys.updatedAt, event.at);
      queueCompactCounterUpdates(pipeline, keys.totals, metricsEvent);
      pipeline.sadd(keys.routeKeys, event.routeKey);
      pipeline.hset(keys.route, {
        key: route.key,
        method: route.method,
        routePath: route.routePath,
        description: route.description,
        priceLabel: route.priceLabel,
        priceUsdMicros: String(route.priceUsdMicros ?? 0),
        lastSeenAt: event.at,
        lastStatus: String(event.statusCode),
        lastPath: event.path,
      });
      queueCompactCounterUpdates(pipeline, keys.route, metricsEvent);
      pipeline.hset(keys.hour, {
        hourStart,
      });
      queueCompactCounterUpdates(pipeline, keys.hour, metricsEvent);
      pipeline.expire(keys.hour, MAX_HOURLY_BUCKETS * 60 * 60);
      await pipeline.exec();
    },
    async getSummary() {
      const keys = getMetricsRedisKeys();
      const [startedAt, updatedAt, rawTotals, recordedRouteKeys] =
        await Promise.all([
          redis.get(keys.startedAt),
          redis.get(keys.updatedAt),
          redis.hgetall(keys.totals),
          redis.smembers(keys.routeKeys),
        ]);

      const snapshot = createSnapshot(routeCatalog);
      snapshot.startedAt = startedAt ?? snapshot.startedAt;
      snapshot.updatedAt = updatedAt ?? null;
      snapshot.totals = mergeCounterValues(createCounterSet(), rawTotals ?? {});

      const routeKeys = Array.from(
        new Set([
          ...routeCatalog.map((route) => route.key),
          ...((recordedRouteKeys ?? []).map(String)),
        ]),
      );

      if (routeKeys.length > 0) {
        const routePipeline = redis.pipeline();
        for (const routeKey of routeKeys) {
          routePipeline.hgetall(getMetricsRedisKeys(routeKey).route);
        }
        const routeStates = await routePipeline.exec();

        routeKeys.forEach((routeKey, index) => {
          const savedState = routeStates[index] ?? {};
          const baseRoute =
            routeCatalogMap.get(routeKey) ?? {
              key: savedState?.key ?? routeKey,
              method: savedState?.method ?? routeKey.split(" ")[0] ?? "GET",
            routePath:
                savedState?.routePath ??
                (routeKey.split(" ").slice(1).join(" ") || routeKey),
              description: savedState?.description ?? "Unconfigured route",
              priceLabel: savedState?.priceLabel ?? "Free",
              priceUsdMicros: getRoutePriceUsdMicros(savedState),
            };
          const routeState = createRouteState(baseRoute);

          mergeCounterValues(routeState, savedState);
          routeState.priceUsdMicros = getRoutePriceUsdMicros({
            ...baseRoute,
            ...savedState,
          });
          routeState.lastSeenAt = savedState?.lastSeenAt ?? null;
          routeState.lastStatus =
            savedState?.lastStatus == null ? null : numericValue(savedState.lastStatus);
          routeState.lastPath = savedState?.lastPath ?? null;
          snapshot.routes[routeKey] = routeState;
        });
      }

      const recentHours = getRecentHourKeys();
      if (recentHours.length > 0) {
        const hourPipeline = redis.pipeline();
        for (const hourStart of recentHours) {
          hourPipeline.hgetall(getMetricsRedisKeys(null, hourStart).hour);
        }
        const hourStates = await hourPipeline.exec();

        recentHours.forEach((hourStart, index) => {
          const savedState = hourStates[index];
          if (!savedState) {
            return;
          }

          const hourState = createHourlyState(hourStart);
          mergeCounterValues(hourState, savedState);
          snapshot.hourly[hourStart] = hourState;
        });
      }

      return buildSummary(snapshot, storage);
    },
  };
}

function createInMemoryMetricsStore(routeCatalog) {
  const snapshot = createSnapshot(routeCatalog);
  const storage = {
    kind: "memory",
    persistent: false,
    label: "Ephemeral in-memory counters",
  };

  return {
    storage,
    async record(event) {
      applyEvent(snapshot, event);
    },
    async getSummary() {
      return buildSummary(snapshot, storage);
    },
  };
}

async function loadFileSnapshot(filePath, routeCatalog) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const snapshot = createSnapshot(routeCatalog);

    snapshot.startedAt = parsed.startedAt ?? snapshot.startedAt;
    snapshot.updatedAt = parsed.updatedAt ?? null;

    if (parsed.totals) {
      snapshot.totals = { ...snapshot.totals, ...parsed.totals };
    }

    if (parsed.routes && typeof parsed.routes === "object") {
      for (const [routeKey, savedRoute] of Object.entries(parsed.routes)) {
        snapshot.routes[routeKey] = {
          ...(snapshot.routes[routeKey] ?? {
            ...createCounterSet(),
            key: routeKey,
            method: routeKey.split(" ")[0] ?? "GET",
            routePath: routeKey.split(" ").slice(1).join(" ") || routeKey,
            description: "Unconfigured route",
            priceLabel: "Free",
            priceUsdMicros: 0,
            lastSeenAt: null,
            lastStatus: null,
            lastPath: null,
          }),
          ...savedRoute,
        };
        snapshot.routes[routeKey].priceUsdMicros = getRoutePriceUsdMicros(snapshot.routes[routeKey]);
      }
    }

    if (parsed.sources && typeof parsed.sources === "object") {
      for (const [sourceId, savedSource] of Object.entries(parsed.sources)) {
        snapshot.sources[sourceId] = {
          ...createSourceState({ sourceId }),
          ...savedSource,
        };
      }
    }

    if (parsed.services && typeof parsed.services === "object") {
      for (const [serviceHost, savedService] of Object.entries(parsed.services)) {
        snapshot.services[serviceHost] = {
          ...createServiceState({ serviceHost }),
          ...savedService,
          routeKeysSeen: Array.isArray(savedService?.routeKeysSeen)
            ? savedService.routeKeysSeen
            : [],
        };
      }
    }

    if (parsed.hourly && typeof parsed.hourly === "object") {
      snapshot.hourly = parsed.hourly;
    }

    trimHourlyBuckets(snapshot.hourly);
    return snapshot;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createSnapshot(routeCatalog);
    }

    throw error;
  }
}

function createFileMetricsStore(routeCatalog, filePath) {
  const storage = {
    kind: "file",
    persistent: true,
    label: `JSON file store (${filePath})`,
  };
  let snapshotPromise = loadFileSnapshot(filePath, routeCatalog);
  let writeQueue = Promise.resolve();

  async function persist(snapshot) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
  }

  return {
    storage,
    async record(event) {
      const snapshot = await snapshotPromise;
      applyEvent(snapshot, event);
      writeQueue = writeQueue.then(() => persist(snapshot));
      await writeQueue;
    },
    async getSummary() {
      const snapshot = await snapshotPromise;
      await writeQueue;
      return buildSummary(snapshot, storage);
    },
  };
}

function createMetricsStore(options = {}) {
  const routeCatalog = options.routeCatalog
    ? normalizeRouteCatalog(options.routeCatalog)
    : createRouteCatalog(options.routes);
  const redisClient = options.redisClient ?? createRedisClient(options);
  const filePath = options.filePath ?? options.env?.METRICS_STORE_FILE;

  if (redisClient) {
    return createRedisMetricsStore(routeCatalog, redisClient);
  }

  if (filePath) {
    return createFileMetricsStore(routeCatalog, filePath);
  }

  return createInMemoryMetricsStore(routeCatalog);
}

function createMetricsMiddleware(options = {}) {
  const store = options.store;
  const logger = options.logger ?? console;
  const routeCatalog = options.routeCatalog
    ? normalizeRouteCatalog(options.routeCatalog)
    : createRouteCatalog(options.routes);
  const attribution = options.attribution ?? createMetricsAttribution(options);
  const resolveMetricRouteKey =
    options.resolveMetricRouteKey ?? createRouteResolver(routeCatalog);
  const describeRequestSource =
    options.describeRequestSource ?? createRequestSourceDescriber(attribution);
  const routeCatalogMap = new Map(routeCatalog.map((route) => [route.key, route]));

  return function metricsMiddleware(req, res, next) {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    const startedAt = Date.now();

    res.on("finish", () => {
      const source = describeRequestSource(req);
      const routeKey = resolveMetricRouteKey(req.method, req.path);
      const route = routeCatalogMap.get(routeKey);
      const event = {
        at: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        method: req.method.toUpperCase(),
        path: req.path,
        routeKey,
        statusCode: res.statusCode,
        wasPaid: Boolean(req.headers["payment-signature"] || req.headers["x-payment"]),
        routePriceUsdMicros: route?.priceUsdMicros ?? 0,
        serviceHost: getRequestServiceHost(req),
        sourceId: source.sourceId,
        sourceKind: source.sourceKind,
        agentClass: source.agentClass,
      };

      Promise.resolve(store.record(event)).catch((error) => {
        logger.error(
          "metrics record failure:",
          JSON.stringify({
            message: error?.message || "Unknown error",
            routeKey: event.routeKey,
            path: event.path,
          }),
        );
      });
    });

    next();
  };
}

function hasMetricsAccess(req, password) {
  const expectedPassword = normalizeSecret(password);
  if (!expectedPassword) {
    return true;
  }

  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return false;
    }

    const username = decoded.slice(0, separatorIndex);
    const providedPassword = normalizeSecret(decoded.slice(separatorIndex + 1));
    return username === DASHBOARD_USERNAME && providedPassword === expectedPassword;
  } catch (error) {
    return false;
  }
}

function sendMetricsAuthChallenge(res) {
  res.set("WWW-Authenticate", `Basic realm="Metrics Dashboard"`);
  res.status(401).type("text/plain").send("Metrics dashboard authentication required.");
}

function formatTimestamp(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatHourLabel(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(new Date(value));
}

function formatPercent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

function renderSummaryCard(title, value, detail, options = {}) {
  const className = options.className ? ` ${options.className}` : "";

  return `
    <article class="metric-card${escapeHtml(className)}">
      <h3>${escapeHtml(title)}</h3>
      <p class="metric-value">${escapeHtml(value)}</p>
      <p class="metric-detail">${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderHourlyTable(hourly) {
  const peakCount = Math.max(1, ...hourly.map((bucket) => bucket.total));
  const rows = hourly
    .map((bucket) => {
      const width = Math.max(4, Math.round((bucket.total / peakCount) * 100));

      return `
        <tr>
          <th scope="row">${escapeHtml(formatHourLabel(bucket.hourStart))}</th>
          <td>
            <div class="bar-cell">
              <span class="bar-track" aria-hidden="true">
                <span class="bar-fill" style="width:${width}%"></span>
              </span>
              <span>${escapeHtml(formatInteger(bucket.total))}</span>
            </div>
          </td>
          <td>${escapeHtml(formatInteger(bucket.paidSuccess ?? 0))}</td>
          <td>${escapeHtml(formatUsdAmount(bucket.paidUsd ?? 0))}</td>
          <td>${escapeHtml(formatInteger(bucket.paymentRequired))}</td>
          <td>${escapeHtml(formatInteger(bucket.serverErrors))}</td>
          <td>${escapeHtml(formatInteger(bucket.averageLatencyMs))} ms</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table>
        <caption>Hourly request volume for the last 24 hours.</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Requests</th>
            <th scope="col">Paid</th>
            <th scope="col">Revenue</th>
            <th scope="col">402</th>
            <th scope="col">5xx</th>
            <th scope="col">Avg latency</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

const DASHBOARD_ROUTE_GROUPS = [
  {
    key: "weather",
    title: "Weather & Environment",
    description:
      "Forecasts, current conditions, solar timing, and air quality APIs for outdoor and location-aware decisions.",
    prefixes: ["/api/weather", "/api/air-quality", "/api/sun"],
    keywords: ["weather", "forecast", "air quality", "sunrise", "sunset", "solar", "twilight"],
  },
  {
    key: "calendar",
    title: "Calendar & Scheduling",
    description:
      "Holiday, business-day, and date-sensitive scheduling APIs that help agents plan around real-world calendars.",
    prefixes: ["/api/holidays", "/api/business-days"],
    keywords: ["holiday", "business day", "calendar", "timezone"],
  },
  {
    key: "government",
    title: "Government & Civic Data",
    description:
      "Public-sector datasets covering economics, regulations, elections, legislation, and population statistics.",
    prefixes: ["/api/census", "/api/bls", "/api/fda", "/api/congress"],
    keywords: [
      "census",
      "labor statistics",
      "bls",
      "fda",
      "congress",
      "government",
      "election",
      "legislation",
    ],
  },
  {
    key: "finance",
    title: "Finance & Markets",
    description:
      "Exchange-rate, conversion, and market-style lookup APIs for money and price-sensitive workflows.",
    prefixes: ["/api/exchange-rates"],
    keywords: ["exchange rate", "currency", "fx", "quote", "market"],
  },
  {
    key: "food",
    title: "Food & Nutrition",
    description:
      "Food lookup and nutrition APIs for ingredients, products, and dietary enrichment tasks.",
    prefixes: ["/api/food", "/api/nutrition"],
    keywords: ["food", "nutrition", "barcode", "calories", "usda"],
  },
  {
    key: "identity",
    title: "Identity & Location",
    description:
      "Vehicle, IP, ZIP, and location-style enrichment APIs that add place or identity context to workflows.",
    prefixes: ["/api/vin", "/api/ip", "/api/zip"],
    keywords: ["vin", "vehicle", "ip geolocation", "postal", "zip", "location"],
  },
  {
    key: "other",
    title: "Other APIs",
    description: "Configured APIs that do not fit one of the main dashboard categories yet.",
    prefixes: [],
    keywords: [],
  },
];

function isDashboardHiddenRoute(route = {}) {
  if (isRetiredRoute(route)) {
    return true;
  }

  return route.description === "Unconfigured route" && route.priceLabel === "Free";
}

function routeMatchesGroup(route, group) {
  const routePath = String(route.routePath || "").toLowerCase();
  const text = [route.key, route.routePath, route.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    group.prefixes.some((prefix) => routePath.startsWith(prefix)) ||
    group.keywords.some((keyword) => text.includes(keyword))
  );
}

function buildDashboardRouteGroups(routes = []) {
  const visibleRoutes = routes.filter((route) => !isDashboardHiddenRoute(route));
  const groups = DASHBOARD_ROUTE_GROUPS.map((group) => ({
    ...group,
    routes: [],
  }));
  const fallbackGroup = groups[groups.length - 1];

  for (const route of visibleRoutes) {
    const targetGroup =
      groups.find((group) => group.key !== "other" && routeMatchesGroup(route, group)) ??
      fallbackGroup;
    targetGroup.routes.push(route);
  }

  return {
    visibleRoutes,
    hiddenCount: Math.max(0, routes.length - visibleRoutes.length),
    groups: groups
    .map((group) => ({
        ...group,
        requestCount: group.routes.reduce((sum, route) => sum + route.total, 0),
        paidSuccess: group.routes.reduce(
          (sum, route) => sum + (route.paidSuccess ?? 0),
          0,
        ),
        paidUsd: group.routes.reduce(
          (sum, route) => sum + (route.paidUsd ?? 0),
          0,
        ),
        routes: [...group.routes].sort((left, right) => {
          if ((right.paidUsd ?? 0) !== (left.paidUsd ?? 0)) {
            return (right.paidUsd ?? 0) - (left.paidUsd ?? 0);
          }

          if (right.total !== left.total) {
            return right.total - left.total;
          }

          return left.key.localeCompare(right.key);
        }),
      }))
      .filter((group) => group.routes.length > 0),
  };
}

function renderRoutesTable(routes, options = {}) {
  const rows = routes
    .map((route) => {
      return `
        <tr>
          <th scope="row">
            <div class="route-key">${escapeHtml(route.key)}</div>
            <div class="route-detail">${escapeHtml(route.description || "No description")}</div>
          </th>
          <td>${escapeHtml(route.priceLabel)}</td>
          <td>${escapeHtml(formatInteger(route.total))}</td>
          <td>${escapeHtml(formatInteger(route.paidSuccess))}</td>
          <td>${escapeHtml(formatUsdAmount(route.paidUsd ?? 0))}</td>
          <td>${escapeHtml(formatInteger(route.paymentRequired))}</td>
          <td>${escapeHtml(formatInteger(route.serverErrors))}</td>
          <td>${escapeHtml(formatTimestamp(route.lastSeenAt))}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table>
        <caption>${escapeHtml(
          options.caption || "Route-level request totals and recent activity.",
        )}</caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Price</th>
            <th scope="col">Requests</th>
            <th scope="col">Paid</th>
            <th scope="col">Revenue</th>
            <th scope="col">402</th>
            <th scope="col">5xx</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRouteGroups(routes) {
  const model = buildDashboardRouteGroups(routes);

  if (!model.visibleRoutes.length) {
    return {
      content: `<p class="empty-state">No configured API routes have recorded traffic yet.</p>`,
      hiddenCount: model.hiddenCount,
      visibleCount: 0,
    };
  }

  // Grouped subsections keep large route catalogs easier to scan with screen readers and keyboard navigation.
  const content = model.groups
    .map((group) => {
      const headingId = `route-group-${group.key}`;

      return `
        <section class="route-group" aria-labelledby="${escapeHtml(headingId)}">
          <div class="section-header route-group-header">
            <div>
              <h3 id="${escapeHtml(headingId)}">${escapeHtml(group.title)}</h3>
              <p>${escapeHtml(group.description)}</p>
            </div>
            <p class="group-stat">${escapeHtml(
              `${formatInteger(group.routes.length)} routes · ${formatInteger(group.requestCount)} requests`,
            )}</p>
          </div>
          ${renderRoutesTable(group.routes, {
            caption: `${group.title} route totals, paid request counts, and settled revenue.`,
          })}
        </section>
      `;
    })
    .join("");

  return {
    content,
    hiddenCount: model.hiddenCount,
    visibleCount: model.visibleRoutes.length,
  };
}

function renderCallersTable(callers) {
  const rows = callers
    .map((caller) => {
      const callerKind =
        caller.sourceKind === "self-tagged"
          ? "Self-tagged operator traffic"
          : "Anonymous caller fingerprint";

      return `
        <tr>
          <th scope="row">
            <div class="route-key">${escapeHtml(caller.sourceId)}</div>
            <div class="route-detail">${escapeHtml(callerKind)}</div>
          </th>
          <td>${escapeHtml(caller.agentClass)}</td>
          <td>${escapeHtml(formatInteger(caller.total))}</td>
          <td>${escapeHtml(formatInteger(caller.paidSuccess))}</td>
          <td>${escapeHtml(formatUsdAmount(caller.paidUsd ?? 0))}</td>
          <td>${escapeHtml(formatInteger(caller.paymentRequired))}</td>
          <td>${escapeHtml(caller.lastRouteKey || "Unknown")}</td>
          <td>${escapeHtml(formatTimestamp(caller.lastSeenAt))}</td>
        </tr>
      `;
    })
    .join("");

  if (!rows) {
    return `<p class="empty-state">No caller fingerprints recorded yet.</p>`;
  }

  return `
    <div class="table-scroll">
      <table>
        <caption>Top caller fingerprints, grouped without storing raw IP addresses or raw user agents.</caption>
        <thead>
          <tr>
            <th scope="col">Caller</th>
            <th scope="col">Client class</th>
            <th scope="col">Requests</th>
            <th scope="col">Paid 2xx</th>
            <th scope="col">Revenue</th>
            <th scope="col">402</th>
            <th scope="col">Last route</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderServicesTable(services) {
  // A semantic table keeps host-level attribution debugging navigable for screen readers and keyboard users.
  const rows = services
    .map((service) => {
      return `
        <tr>
          <th scope="row">
            <div class="route-key">${escapeHtml(formatObservedHostLabel(service.serviceHost))}</div>
            <div class="route-detail">${escapeHtml(formatObservedHostDetail(service))}</div>
          </th>
          <td>${escapeHtml(formatInteger(service.total))}</td>
          <td>${escapeHtml(formatInteger(service.externalPaidSuccess ?? 0))}</td>
          <td>${escapeHtml(formatUsdAmount(service.externalPaidUsd ?? 0))}</td>
          <td>${escapeHtml(formatInteger(service.paidSuccess))}</td>
          <td>${escapeHtml(formatInteger(service.paymentRequired))}</td>
          <td>${escapeHtml(formatInteger(service.routeCount))}</td>
          <td>${escapeHtml(service.lastRouteKey || "Unknown")}</td>
          <td>${escapeHtml(formatTimestamp(service.lastSeenAt))}</td>
        </tr>
      `;
    })
    .join("");

  if (!rows) {
    return `<p class="empty-state">No observed hosts have recorded traffic yet.</p>`;
  }

  return `
    <div class="table-scroll">
      <table>
        <caption>Traffic grouped by observed request host. Counts can include production domains, aliases, preview hosts, localhost, or raw IP host headers, so use this table for attribution debugging rather than product counts.</caption>
        <thead>
          <tr>
            <th scope="col">Observed host</th>
            <th scope="col">Requests</th>
            <th scope="col">External paid</th>
            <th scope="col">External USD</th>
            <th scope="col">All paid</th>
            <th scope="col">402</th>
            <th scope="col">Routes live</th>
            <th scope="col">Last route</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderDashboardPage(summary, options = {}) {
  const storageNotice = summary.storage.persistent
    ? "This dashboard is backed by a persistent store."
    : "This dashboard is using ephemeral counters. On Vercel, totals reset on cold starts and do not aggregate across instances.";
  const authNotice = options.passwordProtected
    ? "Protected with HTTP Basic auth."
    : "Public access is enabled. Set METRICS_DASHBOARD_PASSWORD to protect this dashboard.";
  const topRoute =
    summary.routes.find(
      (route) => !isDashboardHiddenRoute(route) && ((route.paidUsd ?? 0) > 0 || route.total > 0),
    ) ?? null;

  // Semantic landmarks and tables keep the dashboard usable with screen readers and keyboard-only navigation.
  const cards = [
    renderSummaryCard(
      "All settled revenue",
      formatUsdAmount(summary.totals.paidUsd ?? 0),
      `${formatInteger(summary.totals.paidSuccess ?? 0)} paid 2xx responses settled across the catalog`,
      { className: "metric-card-revenue" },
    ),
    renderSummaryCard(
      "Paid requests",
      formatInteger(summary.totals.paidSuccess ?? 0),
      "All paid requests are counted together",
      { className: "metric-card-positive" },
    ),
    renderSummaryCard(
      "Payment challenges",
      formatInteger(summary.totals.paymentRequired),
      "402 responses returned before payment",
      { className: "metric-card-warm" },
    ),
    renderSummaryCard(
      "Configured routes",
      formatInteger(summary.totals.uniqueRoutesSeen ?? 0),
      "Routes with recorded traffic in the current store",
    ),
    renderSummaryCard(
      "Total requests",
      formatInteger(summary.totals.total),
      "All API requests counted together",
      { className: "metric-card-warm" },
    ),
    renderSummaryCard(
      "Average latency",
      `${formatInteger(summary.totals.averageLatencyMs)} ms`,
      `Updated ${formatTimestamp(summary.updatedAt)}`,
    ),
  ].join("");
  const routeGroups = renderRouteGroups(summary.routes);
  const routesDescription = [
    `Showing ${formatInteger(routeGroups.visibleCount)} configured routes grouped by category and sorted by settled revenue first.`,
    routeGroups.hiddenCount
      ? `${formatInteger(routeGroups.hiddenCount)} legacy or retired rows hidden.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>x402 Data Bazaar Metrics</title>
    <style>
      :root {
        --bg: #f3efe7;
        --bg-accent: #fff9ef;
        --card: rgba(255, 251, 245, 0.88);
        --ink: #1b1e1f;
        --muted: #536064;
        --line: rgba(27, 30, 31, 0.12);
        --brand: #0f766e;
        --brand-soft: rgba(15, 118, 110, 0.16);
        --warn: #9a3412;
        --warn-soft: rgba(154, 52, 18, 0.12);
        --shadow: 0 20px 45px rgba(36, 38, 38, 0.1);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Trebuchet MS", "Gill Sans", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 34%),
          radial-gradient(circle at top right, rgba(154, 52, 18, 0.14), transparent 28%),
          linear-gradient(180deg, var(--bg-accent), var(--bg));
      }

      a { color: inherit; }

      .skip-link {
        position: absolute;
        left: 1rem;
        top: -3rem;
        padding: 0.75rem 1rem;
        background: #ffffff;
        border-radius: 999px;
        box-shadow: var(--shadow);
        transition: top 0.2s ease;
      }

      .skip-link:focus {
        top: 1rem;
      }

      .page-shell {
        width: min(1120px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 2rem 0 3rem;
      }

      header {
        padding: 1.5rem;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--card);
        box-shadow: var(--shadow);
      }

      .eyebrow {
        margin: 0 0 0.75rem;
        font-size: 0.9rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--brand);
      }

      h1, h2, h3, p { margin-top: 0; }

      h1 {
        margin-bottom: 0.5rem;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(2rem, 5vw, 3.4rem);
        line-height: 1.05;
      }

      .lede {
        max-width: 62ch;
        color: var(--muted);
        margin-bottom: 1rem;
      }

      main {
        display: grid;
        gap: 1rem;
        margin-top: 1rem;
      }

      section {
        padding: 1.25rem;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--card);
        box-shadow: var(--shadow);
      }

      .notice {
        display: grid;
        gap: 0.5rem;
        padding: 1rem;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.6);
      }

      .notice p {
        margin-bottom: 0;
        color: var(--muted);
      }

      .notice h3 {
        margin-bottom: 0.15rem;
      }

      .notice-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.9rem;
      }

      .notice strong {
        color: var(--ink);
      }

      .notice.storage {
        background: linear-gradient(180deg, rgba(15, 118, 110, 0.08), rgba(255, 251, 245, 0.92));
      }

      .notice.security {
        background: linear-gradient(180deg, rgba(154, 52, 18, 0.08), rgba(255, 251, 245, 0.92));
      }

      .metric-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.9rem;
      }

      .metric-card {
        padding: 1rem;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.55);
      }

      .metric-card-revenue {
        background: linear-gradient(180deg, rgba(15, 118, 110, 0.16), rgba(255, 255, 255, 0.72));
      }

      .metric-card-positive {
        background: linear-gradient(180deg, rgba(32, 132, 75, 0.14), rgba(255, 255, 255, 0.72));
      }

      .metric-card-warm {
        background: linear-gradient(180deg, rgba(154, 52, 18, 0.14), rgba(255, 255, 255, 0.72));
      }

      .metric-card h3 {
        font-size: 0.95rem;
        color: var(--muted);
        margin-bottom: 0.8rem;
      }

      .metric-value {
        font-size: 2rem;
        font-weight: 700;
        margin-bottom: 0.3rem;
      }

      .metric-detail {
        color: var(--muted);
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: baseline;
        flex-wrap: wrap;
      }

      .section-header p {
        margin-bottom: 0;
        color: var(--muted);
      }

      .hero-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .hero-chip {
        margin: 0;
        padding: 0.65rem 0.9rem;
        border-radius: 999px;
        border: 1px solid rgba(15, 118, 110, 0.18);
        background: rgba(255, 255, 255, 0.72);
        color: var(--muted);
      }

      .hero-chip strong {
        color: var(--ink);
      }

      .refresh-link {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.7rem 1rem;
        border-radius: 999px;
        border: 1px solid rgba(15, 118, 110, 0.25);
        background: var(--brand-soft);
        color: var(--ink);
        text-decoration: none;
        font-weight: 700;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      caption {
        text-align: left;
        padding-bottom: 0.75rem;
        color: var(--muted);
      }

      th, td {
        text-align: left;
        padding: 0.8rem 0.65rem;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }

      th {
        font-size: 0.95rem;
      }

      .route-key {
        font-weight: 700;
      }

      .route-detail {
        margin-top: 0.35rem;
        color: var(--muted);
        font-weight: 400;
        max-width: 44ch;
      }

      .bar-cell {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) auto;
        align-items: center;
        gap: 0.75rem;
      }

      .bar-track {
        height: 0.75rem;
        border-radius: 999px;
        background: rgba(27, 30, 31, 0.08);
        overflow: hidden;
      }

      .bar-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--brand), #0ea5a3);
      }

      .meta-list {
        display: grid;
        gap: 0.35rem;
        color: var(--muted);
      }

      .empty-state {
        margin-bottom: 0;
        color: var(--muted);
      }

      .route-group {
        margin-top: 1rem;
        padding: 1rem;
        border-radius: 20px;
        border: 1px solid rgba(27, 30, 31, 0.08);
        background: rgba(255, 255, 255, 0.45);
      }

      .route-group:first-of-type {
        margin-top: 0;
      }

      .route-group-header {
        margin-bottom: 0.75rem;
      }

      .route-group-header h3 {
        margin-bottom: 0.25rem;
      }

      .group-stat {
        color: var(--muted);
        font-weight: 700;
      }

      @media (max-width: 720px) {
        .page-shell { width: min(100% - 1rem, 1120px); padding-top: 1rem; }
        header, section { border-radius: 20px; padding: 1rem; }
        th, td { padding-inline: 0.45rem; }
      }

      @media (prefers-reduced-motion: reduce) {
        .skip-link {
          transition: none;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#metrics-main">Skip to metrics</a>
    <div class="page-shell">
      <header>
        <p class="eyebrow">x402 Data Bazaar</p>
        <h1>Revenue & Demand Dashboard</h1>
        <p class="lede">Track total requests, paid calls, settled revenue, and the route families that are converting into paid usage.</p>
        <div class="hero-chips" aria-label="Current leaders">
          <p class="hero-chip"><strong>Top route:</strong> ${escapeHtml(
            topRoute?.key || "No route traffic yet",
          )}</p>
        </div>
      </header>

      <main id="metrics-main">
        <section aria-labelledby="summary-heading">
          <div class="section-header">
            <div>
              <h2 id="summary-heading">Revenue Snapshot</h2>
              <p>Started ${escapeHtml(formatTimestamp(summary.startedAt))} and last updated ${escapeHtml(formatTimestamp(summary.updatedAt))}. Settled revenue is counted as one aggregate total across all paid requests.</p>
            </div>
            <a class="refresh-link" href="/ops/metrics">Refresh Snapshot</a>
          </div>
          <div class="metric-grid">${cards}</div>
        </section>

        <section aria-labelledby="notes-heading">
          <div class="section-header">
            <div>
              <h2 id="notes-heading">How To Read This</h2>
              <p>This dashboard is intentionally aggregate-first. It tracks total requests, total paid calls, total settled revenue, and route-level performance.</p>
            </div>
          </div>
          <div class="notice-grid">
            <article class="notice storage">
              <h3>Storage Mode</h3>
              <p><strong>${escapeHtml(summary.storage.label)}</strong></p>
              <p>${escapeHtml(storageNotice)}</p>
            </article>
            <article class="notice security">
              <h3>Access</h3>
              <p>${escapeHtml(authNotice)}</p>
            </article>
            <article class="notice">
              <h3>Attribution Scope</h3>
              <p>${escapeHtml("Internal and external paid traffic are no longer split in the dashboard.")}</p>
              <p>${escapeHtml(
                "Revenue is displayed as one total across all settled paid requests.",
              )}</p>
            </article>
            <article class="notice">
              <h3>Revenue Coverage</h3>
              <p>${escapeHtml(
                summary.totals.historicalPaidRevenueBackfilled
                  ? "Historical settled revenue was backfilled from route-level paid counts."
                  : "Revenue totals are based on directly recorded paid events in the current store.",
              )}</p>
              <p>${escapeHtml(
                "Route-level totals still show which endpoints are being used and which ones are actually settling revenue.",
              )}</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="hourly-heading">
          <div class="section-header">
            <div>
              <h2 id="hourly-heading">Last 24 Hours</h2>
              <p>Hourly request buckets with total paid volume and settled revenue.</p>
            </div>
          </div>
          ${renderHourlyTable(summary.hourly)}
        </section>

        <section aria-labelledby="routes-heading">
          <div class="section-header">
            <div>
              <h2 id="routes-heading">Catalog By Type</h2>
              <p>${escapeHtml(routesDescription)}</p>
            </div>
          </div>
          ${routeGroups.content}
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function createMetricsDataHandler(options = {}) {
  return async function metricsDataHandler(req, res) {
    if (!hasMetricsAccess(req, options.password)) {
      sendMetricsAuthChallenge(res);
      return;
    }

    const summary = await options.store.getSummary();
    res.set("Cache-Control", "no-store");
    res.json({
      ...summary,
      attribution: getPublicMetricsAttribution(options.attribution),
    });
  };
}

function createMetricsDashboardHandler(options = {}) {
  return async function metricsDashboardHandler(req, res) {
    if (!hasMetricsAccess(req, options.password)) {
      sendMetricsAuthChallenge(res);
      return;
    }

    const summary = await options.store.getSummary();
    res.set("Cache-Control", "no-store");
    res.type("html").send(
      renderDashboardPage(
        {
          ...summary,
          attribution: getPublicMetricsAttribution(options.attribution),
        },
        {
          passwordProtected: Boolean(options.password),
        },
      ),
    );
  };
}

module.exports = {
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createRouteCatalog,
  createRouteResolver,
};
