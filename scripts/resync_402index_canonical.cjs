#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");

const DEFAULT_DOMAIN = "x402.aurelianflo.com";
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BETWEEN_PATCHES_MS = 300;
const RETRY_DELAY_402_MS = 2500;
const RETRY_DELAY_DEFAULT_MS = 1200;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_full, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  console.log(`Re-sync 402index categories against canonical discovery catalog.

Usage:
  node scripts/resync_402index_canonical.cjs [options]

Options:
  --domain <host>             Domain host. Default: ${DEFAULT_DOMAIN}
  --discovery-url <url>       Discovery endpoint. Default: https://<domain>/api/system/discovery
  --token <value>             402index verification token.
  --limit <n>                 402index pagination limit. Default: ${DEFAULT_LIMIT}
  --max-attempts <n>          PATCH retry attempts. Default: ${DEFAULT_MAX_ATTEMPTS}
  --between-ms <n>            Delay between PATCH calls. Default: ${DEFAULT_BETWEEN_PATCHES_MS}
  --out <path>                Output report JSON path.
  --dry-run                   Compute plan only, do not PATCH.
  --help                      Show help.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (_error) {
          parsed = null;
        }
        resolve({
          status: Number(res.statusCode || 0),
          headers: res.headers || {},
          body,
          json: parsed,
        });
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function normalizePathname(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "/";
  }
  const withoutQuery = value.split("?")[0];
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function normalizeCategory(raw) {
  return String(raw || "").trim().toLowerCase();
}

function categoriesEqual(left, right) {
  return normalizeCategory(left) === normalizeCategory(right);
}

const GENERIC_TAGS = new Set([
  "api",
  "agent",
  "agents",
  "tool",
  "tools",
  "data",
  "lookup",
  "compute",
  "generate",
  "generated",
  "validate",
  "utility",
  "core",
  "v1",
  "v2",
  "realtime",
  "real-time",
  "real_time",
]);

function deriveCategoryFromEntry(entry, fallbackPath) {
  const explicit = normalizeCategory(entry?.category);
  if (explicit) {
    return explicit;
  }

  const surface = normalizeCategory(entry?.surface) || "generated";
  const tags = Array.isArray(entry?.tags)
    ? entry.tags.map((tag) => normalizeCategory(tag)).filter(Boolean)
    : [];
  const topicalTags = tags.filter((tag) => !GENERIC_TAGS.has(tag));
  const preferred = [
    "finance",
    "weather",
    "legal",
    "compliance",
    "simulation",
    "modeling",
    "text",
    "document",
    "contracts",
    "proposal",
    "reporting",
    "payments",
    "internet",
    "dns",
    "whois",
    "courts",
    "entity",
    "sanctions",
    "risk",
    "convert",
    "translation",
  ];
  const preferredTopic = preferred.find((topic) => topicalTags.includes(topic));
  let topic = preferredTopic || topicalTags[topicalTags.length - 1];

  if (!topic) {
    const path = normalizePathname(fallbackPath || entry?.path || entry?.canonicalPath || "");
    const segments = path.split("/").filter(Boolean);
    topic = segments[2] || segments[1] || "general";
  }

  return `${surface}/${topic}`;
}

function compileWildcardPattern(template) {
  const normalized = normalizePathname(template);
  const starCount = (normalized.match(/\*/g) || []).length;
  const pieces = normalized.split("*").map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`^${pieces.join("([^/]+)")}$`);
  const staticLength = normalized.replace(/\*/g, "").length;
  return { template: normalized, regex, starCount, staticLength };
}

function renderWildcardTemplate(template, captures) {
  let captureIndex = 0;
  return normalizePathname(template).replace(/\*/g, () => {
    const value = captures[captureIndex];
    captureIndex += 1;
    return value == null || value === "" ? "*" : String(value);
  });
}

function methodMatches(expectedMethod, actualMethod) {
  const expected = String(expectedMethod || "").trim().toUpperCase();
  const actual = String(actualMethod || "").trim().toUpperCase();
  if (!expected || !actual) {
    return true;
  }
  return expected === actual;
}

function buildCandidatePaths(pathname, method) {
  const normalizedPath = normalizePathname(pathname);
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const candidates = [{ path: normalizedPath, source: "direct", penalty: 0 }];

  if (normalizedPath.startsWith("/api/do/")) {
    const suffix = normalizedPath.slice("/api/do/".length);
    candidates.push({ path: `/api/tools/${suffix}`, source: "do_to_tools", penalty: 2 });
    if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || !normalizedMethod) {
      candidates.push({ path: `/api/data/${suffix}`, source: "do_to_data", penalty: 4 });
    }
  }

  if (normalizedPath.startsWith("/api/tools/") && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) {
    const suffix = normalizedPath.slice("/api/tools/".length);
    candidates.push({ path: `/api/data/${suffix}`, source: "tools_get_to_data", penalty: 2 });
  }

  if (
    normalizedPath.startsWith("/api/") &&
    !normalizedPath.startsWith("/api/data/") &&
    !normalizedPath.startsWith("/api/tools/") &&
    !normalizedPath.startsWith("/api/system/")
  ) {
    const suffix = normalizedPath.slice("/api/".length);
    if (normalizedMethod === "POST" || normalizedMethod === "PUT" || normalizedMethod === "PATCH") {
      candidates.push({ path: `/api/tools/${suffix}`, source: "legacy_api_to_tools", penalty: 3 });
    } else {
      candidates.push({ path: `/api/data/${suffix}`, source: "legacy_api_to_data", penalty: 3 });
    }
  }

  const dedupe = new Map();
  for (const candidate of candidates) {
    if (!dedupe.has(candidate.path)) {
      dedupe.set(candidate.path, candidate);
    }
  }
  return Array.from(dedupe.values());
}

async function fetchAllServices(domain, limit) {
  const services = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const url = `https://402index.io/api/v1/services?q=${encodeURIComponent(domain)}&limit=${encodeURIComponent(
      String(limit),
    )}&offset=${encodeURIComponent(String(offset))}`;
    const response = await requestJson(url, { method: "GET" });
    if (response.status < 200 || response.status >= 300 || !response.json) {
      throw new Error(
        `Failed to fetch 402index services (status ${response.status}) at offset ${offset}: ${String(
          response.body || "",
        ).slice(0, 300)}`,
      );
    }

    const batch = Array.isArray(response.json.services) ? response.json.services : [];
    total = Number(response.json.total || 0);
    services.push(...batch);
    offset += limit;
    if (!batch.length) {
      break;
    }
  }

  return services;
}

async function fetchDiscoveryCatalog(discoveryUrl) {
  const response = await requestJson(discoveryUrl, { method: "GET" });
  if (response.status < 200 || response.status >= 300 || !response.json) {
    throw new Error(
      `Failed to fetch discovery catalog (status ${response.status}): ${String(response.body || "").slice(0, 300)}`,
    );
  }
  const catalog = Array.isArray(response.json.catalog) ? response.json.catalog : [];
  if (!catalog.length) {
    throw new Error("Discovery response did not include a non-empty catalog array.");
  }
  return catalog;
}

function buildMatchers(catalog) {
  const matchers = [];

  for (const entry of catalog) {
    const resolvedCategory = deriveCategoryFromEntry(entry, entry?.path || entry?.canonicalPath);
    const templates = [];
    if (entry.path) {
      templates.push({ source: "path", template: entry.path });
    }
    if (entry.canonicalPath) {
      templates.push({ source: "canonical", template: entry.canonicalPath });
    }
    if (Array.isArray(entry.legacyPaths)) {
      for (const legacyPath of entry.legacyPaths) {
        templates.push({ source: "legacy", template: legacyPath });
      }
    }

    const dedupe = new Set();
    for (const descriptor of templates) {
      const normalized = normalizePathname(descriptor.template);
      const dedupeKey = `${descriptor.source}:${normalized}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }
      dedupe.add(dedupeKey);
      const compiled = compileWildcardPattern(normalized);
      matchers.push({
        source: descriptor.source,
        method: String(entry.method || "").toUpperCase() || null,
        category: resolvedCategory || null,
        routePath: normalizePathname(entry.path || normalized),
        canonicalPath: normalizePathname(entry.canonicalPath || entry.path || normalized),
        ...compiled,
      });
    }
  }

  return matchers;
}

function chooseBestMatch(pathname, method, matchers) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const sourceWeight = { canonical: 3, path: 2, legacy: 1 };
  const candidates = buildCandidatePaths(pathname, method);
  let best = null;

  for (const candidate of candidates) {
    for (const matcher of matchers) {
      if (!methodMatches(matcher.method, normalizedMethod)) {
        continue;
      }
      const matched = candidate.path.match(matcher.regex);
      if (!matched) {
        continue;
      }
      const captures = matched.slice(1);
      const methodScore = matcher.method && matcher.method === normalizedMethod ? 10 : 0;
      const score =
        matcher.staticLength * 100 +
        (sourceWeight[matcher.source] || 0) * 5 +
        methodScore -
        matcher.starCount -
        (candidate.penalty || 0);

      if (!best || score > best.score) {
        best = {
          matcher,
          captures,
          score,
          matchedInputPath: candidate.path,
          matchedInputSource: candidate.source,
        };
      }
    }
  }

  return best;
}

async function patchService(serviceId, payload) {
  const body = JSON.stringify(payload);
  const url = `https://402index.io/api/v1/services/${encodeURIComponent(String(serviceId))}`;
  return requestJson(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const domain = String(args.domain || DEFAULT_DOMAIN).trim();
  const discoveryUrl = String(args.discoveryUrl || `https://${domain}/api/system/discovery`).trim();
  const token = String(args.token || process.env.INDEX402_VERIFICATION_TOKEN || "").trim();
  const limit = Number.parseInt(String(args.limit || DEFAULT_LIMIT), 10);
  const maxAttempts = Number.parseInt(String(args.maxAttempts || DEFAULT_MAX_ATTEMPTS), 10);
  const betweenMs = Number.parseInt(String(args.betweenMs || DEFAULT_BETWEEN_PATCHES_MS), 10);
  const dryRun = Boolean(args.dryRun);
  const outPath = path.resolve(
    String(args.out || path.join("tmp", "reports", `402index-canonical-resync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)),
  );

  if (!domain) {
    throw new Error("Domain is required.");
  }
  if (!dryRun && !token) {
    throw new Error("Missing --token (or INDEX402_VERIFICATION_TOKEN env var).");
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${args.limit}`);
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error(`Invalid --max-attempts value: ${args.maxAttempts}`);
  }

  const [catalog, services] = await Promise.all([
    fetchDiscoveryCatalog(discoveryUrl),
    fetchAllServices(domain, limit),
  ]);
  const matchers = buildMatchers(catalog);

  const summary = {
    domain,
    discoveryUrl,
    dryRun,
    catalogEntries: catalog.length,
    indexedServices: services.length,
    matched: 0,
    unmatched: 0,
    categoryPatched: 0,
    categoryNoop: 0,
    failed: 0,
    canonicalPathMismatches: 0,
  };

  const rows = [];

  for (const service of services) {
    const serviceId = String(service?.id || "").trim();
    const serviceUrl = String(service?.url || "").trim();
    const currentCategory = String(service?.category || "").trim() || "uncategorized";
    const method = String(service?.http_method || service?.method || "").trim().toUpperCase() || null;

    let pathname = null;
    try {
      pathname = normalizePathname(new URL(serviceUrl).pathname);
    } catch (_error) {
      pathname = null;
    }

    if (!pathname) {
      summary.unmatched += 1;
      rows.push({
        id: serviceId || null,
        url: serviceUrl || null,
        method,
        status: "unmatched",
        reason: "invalid_url",
        fromCategory: currentCategory,
      });
      continue;
    }

    const best = chooseBestMatch(pathname, method, matchers);
    if (!best || !best.matcher?.category) {
      summary.unmatched += 1;
      rows.push({
        id: serviceId || null,
        url: serviceUrl,
        path: pathname,
        method,
        status: "unmatched",
        reason: "no_catalog_match",
        fromCategory: currentCategory,
      });
      continue;
    }

    summary.matched += 1;

    const expectedCanonicalPath = renderWildcardTemplate(best.matcher.canonicalPath, best.captures);
    const canonicalMismatch = normalizePathname(expectedCanonicalPath) !== pathname;
    if (canonicalMismatch) {
      summary.canonicalPathMismatches += 1;
    }

    const targetCategory = best.matcher.category;
    if (categoriesEqual(currentCategory, targetCategory)) {
      summary.categoryNoop += 1;
      rows.push({
        id: serviceId,
        url: serviceUrl,
        path: pathname,
        method,
        status: "noop",
        fromCategory: currentCategory,
        toCategory: targetCategory,
        canonicalExpectedPath: expectedCanonicalPath,
        canonicalMismatch,
        matchedBy: best.matcher.source,
        matchedInputSource: best.matchedInputSource,
        matchedRoutePath: best.matcher.routePath,
      });
      continue;
    }

    if (dryRun) {
      summary.categoryPatched += 1;
      rows.push({
        id: serviceId,
        url: serviceUrl,
        path: pathname,
        method,
        status: "dry-run-patch",
        fromCategory: currentCategory,
        toCategory: targetCategory,
        canonicalExpectedPath: expectedCanonicalPath,
        canonicalMismatch,
        matchedBy: best.matcher.source,
        matchedInputSource: best.matchedInputSource,
        matchedRoutePath: best.matcher.routePath,
      });
      continue;
    }

    let patched = false;
    let lastResponse = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      lastResponse = await patchService(serviceId, {
        domain,
        verification_token: token,
        category: targetCategory,
      });
      if (lastResponse.status >= 200 && lastResponse.status < 300) {
        patched = true;
        break;
      }
      const delay = lastResponse.status === 402 ? RETRY_DELAY_402_MS : RETRY_DELAY_DEFAULT_MS;
      await sleep(delay);
    }

    if (patched) {
      summary.categoryPatched += 1;
      rows.push({
        id: serviceId,
        url: serviceUrl,
        path: pathname,
        method,
        status: "patched",
        fromCategory: currentCategory,
        toCategory: targetCategory,
        canonicalExpectedPath: expectedCanonicalPath,
        canonicalMismatch,
        matchedBy: best.matcher.source,
        matchedInputSource: best.matchedInputSource,
        matchedRoutePath: best.matcher.routePath,
        httpStatus: Number(lastResponse?.status || 0),
      });
    } else {
      summary.failed += 1;
      rows.push({
        id: serviceId,
        url: serviceUrl,
        path: pathname,
        method,
        status: "failed",
        fromCategory: currentCategory,
        toCategory: targetCategory,
        canonicalExpectedPath: expectedCanonicalPath,
        canonicalMismatch,
        matchedBy: best.matcher.source,
        matchedInputSource: best.matchedInputSource,
        matchedRoutePath: best.matcher.routePath,
        httpStatus: Number(lastResponse?.status || 0) || null,
        error: String(lastResponse?.body || "").slice(0, 300),
      });
    }

    if (betweenMs > 0) {
      await sleep(betweenMs);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    rows,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
