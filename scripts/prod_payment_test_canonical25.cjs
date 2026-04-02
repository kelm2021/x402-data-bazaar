#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BASE = "https://x402.aurelianflo.com";
const DOMAIN = "x402.aurelianflo.com";
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "self";
const SAMPLE_SIZE = 25;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64Json(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function buildStarRegex(templatePath) {
  const escaped = String(templatePath || "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "([^/]+)");
  return new RegExp(`^${escaped}$`);
}

function fillStars(templatePath, captures = []) {
  let index = 0;
  return String(templatePath || "").replace(/\*/g, () => {
    const value = captures[index];
    index += 1;
    return value == null || value === "" ? "sample" : String(value);
  });
}

function toOpenApiPathTemplate(routePath) {
  let wildcardIndex = 0;
  return String(routePath || "").replace(/\*/g, () => `{param${++wildcardIndex}}`);
}

function buildCanonicalCallPath(entry) {
  const canonicalPath = String(entry?.canonicalPath || entry?.path || "").trim();
  const legacyPath = String(entry?.path || "").trim();
  const examplePath = String(entry?.examplePath || "").trim();
  if (!canonicalPath) {
    return null;
  }
  if (!canonicalPath.includes("*")) {
    return canonicalPath;
  }
  if (legacyPath && examplePath) {
    const regex = buildStarRegex(legacyPath);
    const match = examplePath.match(regex);
    if (match) {
      return fillStars(canonicalPath, match.slice(1));
    }
  }
  return fillStars(canonicalPath, []);
}

function isCanonicalUrl(urlString) {
  try {
    const pathname = new URL(urlString).pathname.toLowerCase();
    return pathname.startsWith("/api/data/") || pathname.startsWith("/api/tools/");
  } catch {
    return false;
  }
}

function getAwalDistDir() {
  const candidate = path.join(process.env.APPDATA || "", "npm", "node_modules", "awal", "dist");
  if (candidate && fs.existsSync(path.join(candidate, "ipcClient.js"))) return candidate;
  throw new Error("Unable to locate awal dist ipcClient.js");
}

async function loadAwalIpc() {
  const distDir = getAwalDistDir();
  const ipcModuleUrl = pathToFileURL(path.join(distDir, "ipcClient.js")).href;
  const authModuleUrl = pathToFileURL(path.join(distDir, "utils", "authCheck.js")).href;
  const { sendIpcRequest } = await import(ipcModuleUrl);
  const { requireAuth } = await import(authModuleUrl);
  return { requireAuth, sendIpcRequest };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    throw new Error(`Fetch ${url} failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function fetchAllIndexServices(domain) {
  const all = [];
  const limit = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await fetchJson(
      `https://402index.io/api/v1/services?q=${encodeURIComponent(domain)}&limit=${limit}&offset=${offset}`,
    );
    const batch = Array.isArray(page?.services) ? page.services : [];
    total = Number(page?.total || 0);
    all.push(...batch);
    offset += limit;
    if (!batch.length) break;
  }
  return all;
}

function summarizeResults(results = []) {
  const summary = {
    total: results.length,
    ok2xx: 0,
    non2xx: 0,
    transportFailed: 0,
    paidAuthorized: 0,
    facilitatorVerify401: 0,
  };

  for (const row of results) {
    if (row.transportError) {
      summary.transportFailed += 1;
      if (/Facilitator verify failed \(401\)/i.test(row.transportError)) {
        summary.facilitatorVerify401 += 1;
      }
      continue;
    }
    if (row.paymentAuthorized) {
      summary.paidAuthorized += 1;
    }
    if (row.status >= 200 && row.status < 300) {
      summary.ok2xx += 1;
    } else {
      summary.non2xx += 1;
    }
  }

  return summary;
}

function selectCanonicalCandidates(catalog, openApiPaths) {
  const selected = [];
  const seen = new Set();

  const rows = (Array.isArray(catalog) ? catalog : [])
    .filter((entry) => String(entry?.method || "").toUpperCase() === "GET")
    .filter((entry) => String(entry?.canonicalPath || "").startsWith("/api/data/"))
    .sort((left, right) => String(left.canonicalPath || "").localeCompare(String(right.canonicalPath || "")));

  for (const entry of rows) {
    if (selected.length >= SAMPLE_SIZE) break;
    const callPath = buildCanonicalCallPath(entry);
    if (!callPath) continue;
    const openApiTemplate = toOpenApiPathTemplate(String(entry.canonicalPath || entry.path || ""));
    const operation = openApiPaths?.[openApiTemplate]?.get;
    const requiredQuery = (Array.isArray(operation?.parameters) ? operation.parameters : []).filter(
      (param) => param?.in === "query" && param?.required,
    );
    if (requiredQuery.length > 0) {
      continue;
    }
    if (seen.has(callPath)) {
      continue;
    }
    seen.add(callPath);
    selected.push({
      routeKey: entry.routeKey,
      method: "GET",
      canonicalPath: entry.canonicalPath,
      callPath,
      url: `${BASE}${callPath}`,
      priceUsd: entry.priceUsd ?? null,
      category: entry.category ?? null,
    });
  }

  return selected;
}

(async () => {
  const startedAt = nowIso();
  const discovery = await fetchJson(`${BASE}/api/system/discovery`);
  const openapi = await fetchJson(`${BASE}/api/system/openapi.json`);
  const candidates = selectCanonicalCandidates(discovery?.catalog, openapi?.paths);

  if (candidates.length < SAMPLE_SIZE) {
    throw new Error(`Only found ${candidates.length} canonical candidates; expected ${SAMPLE_SIZE}.`);
  }

  const sample = candidates.slice(0, SAMPLE_SIZE);
  const testedUrlSet = new Set(sample.map((row) => row.url));

  const indexBefore = await fetchAllIndexServices(DOMAIN);
  const indexedBeforeSet = new Set(indexBefore.map((service) => String(service?.url || "")));
  const canonicalBefore = indexBefore.filter((service) => isCanonicalUrl(service?.url)).length;
  const testedIndexedBefore = sample.filter((row) => indexedBeforeSet.has(row.url)).length;

  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const results = [];
  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i];
    const parsed = new URL(row.url);
    const payload = {
      baseURL: `${parsed.protocol}//${parsed.host}`,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: {
        [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
      },
      maxAmountPerRequest: 300000,
    };

    const resultRow = {
      index: i + 1,
      routeKey: row.routeKey,
      url: row.url,
      status: null,
      ok: false,
      paymentAuthorized: false,
      provider: null,
      transportError: null,
      serverError: null,
    };

    try {
      const result = await sendIpcRequest("make-x402-request", payload);
      resultRow.status = Number(result?.status || 0);
      resultRow.ok = resultRow.status >= 200 && resultRow.status < 300;
      resultRow.provider =
        result?.headers?.["x-facilitator-provider"] ||
        result?.headers?.["X-Facilitator-Provider"] ||
        null;
      const paymentResponseHeader =
        result?.headers?.["PAYMENT-RESPONSE"] || result?.headers?.["payment-response"];
      const paymentResponse = decodeBase64Json(paymentResponseHeader);
      resultRow.paymentAuthorized = Boolean(paymentResponse?.success);

      if (!resultRow.ok) {
        const body = result?.data;
        if (typeof body === "string") {
          resultRow.serverError = body.slice(0, 400);
        } else if (body && typeof body === "object") {
          resultRow.serverError = JSON.stringify(body).slice(0, 400);
        } else {
          resultRow.serverError = result?.statusText || "non_2xx_response";
        }
      }
    } catch (error) {
      resultRow.transportError = error instanceof Error ? error.message : String(error);
    }

    results.push(resultRow);
    await sleep(200);
  }

  // Give index pollers a short window to pick up fresh canonical traffic.
  await sleep(90_000);

  const indexAfter = await fetchAllIndexServices(DOMAIN);
  const indexedAfterSet = new Set(indexAfter.map((service) => String(service?.url || "")));
  const canonicalAfter = indexAfter.filter((service) => isCanonicalUrl(service?.url)).length;
  const testedIndexedAfter = sample.filter((row) => indexedAfterSet.has(row.url)).length;
  const newlyIndexedTestedUrls = sample
    .filter((row) => !indexedBeforeSet.has(row.url) && indexedAfterSet.has(row.url))
    .map((row) => row.url);

  const report = {
    generatedAt: nowIso(),
    startedAt,
    baseUrl: BASE,
    sampleSize: sample.length,
    sample,
    summary: summarizeResults(results),
    results,
    indexing: {
      domain: DOMAIN,
      before: {
        totalServices: indexBefore.length,
        canonicalCount: canonicalBefore,
        testedCanonicalIndexed: testedIndexedBefore,
      },
      after: {
        totalServices: indexAfter.length,
        canonicalCount: canonicalAfter,
        testedCanonicalIndexed: testedIndexedAfter,
      },
      testedCanonicalUrls: Array.from(testedUrlSet),
      newlyIndexedTestedUrls,
    },
  };

  const stamp = nowIso().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const fullPath = path.join(outDir, `canonical25-paid-index-check-${stamp}.json`);
  const latestPath = path.join(outDir, "canonical25-paid-index-check-latest.json");
  fs.writeFileSync(fullPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        fullPath,
        latestPath,
        summary: report.summary,
        indexing: report.indexing,
      },
      null,
      2,
    ),
  );
})();

