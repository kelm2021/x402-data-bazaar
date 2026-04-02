#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const BASE_URL = "https://x402.aurelianflo.com";
const DOMAIN = "x402.aurelianflo.com";
const INDEX_LIMIT = 200;
const REPORT_DIR = path.join(process.cwd(), "ops-dashboard", "core40-reports");
const PREFLIGHT_LATEST = path.join(REPORT_DIR, "core40-preflight-latest.json");

const CORE_ROUTE_KEYS = [
  "POST /api/sim/probability",
  "POST /api/sim/compare",
  "POST /api/sim/sensitivity",
  "POST /api/sim/forecast",
  "POST /api/sim/composed",
  "POST /api/sim/optimize",
  "GET /api/vendor-entity-brief",
  "GET /api/ofac-sanctions-screening/*",
  "GET /api/restricted-party/screen/*",
  "GET /api/vendor-onboarding/restricted-party-batch",
  "GET /api/treasury-rates",
  "GET /api/fed-funds-rate",
  "GET /api/yield-curve",
  "GET /api/mortgage-rates",
  "GET /api/inflation-expectations",
  "GET /api/weather/current/*",
  "GET /api/weather/forecast",
  "GET /api/courts/opinions",
  "GET /api/whois/*",
  "GET /api/dns/*",
  "POST /api/tools/text/summarize-bullets",
  "POST /api/tools/text/translate",
  "POST /api/tools/text/to-json",
  "POST /api/tools/text/entities",
  "POST /api/tools/text/sentiment",
  "POST /api/tools/text/detect-language",
  "POST /api/tools/text/pii",
  "POST /api/tools/text/classify",
  "POST /api/tools/legal/extract-clauses",
  "POST /api/tools/legal/nda-summary",
  "POST /api/tools/contract/generate",
  "POST /api/tools/proposal/generate",
  "POST /api/tools/report/generate",
  "POST /api/tools/invoice/generate",
  "POST /api/tools/markdown-to-pdf",
  "POST /api/tools/docx/generate",
  "POST /api/tools/xlsx/generate",
  "POST /api/tools/convert/csv-to-json",
  "POST /api/tools/convert/json-to-csv",
  "POST /api/tools/pay/reconcile",
];

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolve({
            status: Number(res.statusCode || 0),
            json,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function normalizePath(raw) {
  const value = String(raw || "").split("?")[0].trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

function routeKeyParts(routeKey) {
  const idx = String(routeKey).indexOf(" ");
  const method = String(routeKey).slice(0, idx).trim().toUpperCase();
  const template = normalizePath(String(routeKey).slice(idx + 1).trim());
  return { method, template };
}

function routeRegex(template) {
  const escaped = normalizePath(template)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

async function fetchAllIndexedServices(domain) {
  const services = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const url = `https://402index.io/api/v1/services?q=${encodeURIComponent(domain)}&limit=${INDEX_LIMIT}&offset=${offset}`;
    const response = await requestJson(url);
    if (response.status < 200 || response.status >= 300 || !response.json) {
      throw new Error(`402index fetch failed (${response.status}): ${String(response.body || "").slice(0, 240)}`);
    }
    const batch = Array.isArray(response.json.services) ? response.json.services : [];
    total = Number(response.json.total || 0);
    services.push(...batch);
    if (!batch.length) break;
    offset += INDEX_LIMIT;
  }
  return services;
}

function buildCoreMatchers() {
  return CORE_ROUTE_KEYS.map((routeKey) => {
    const { method, template } = routeKeyParts(routeKey);
    return {
      routeKey,
      method,
      template,
      regex: routeRegex(template),
    };
  });
}

function findCoreMatch(service, matchers) {
  const method = String(service?.http_method || service?.method || "").trim().toUpperCase();
  let pathname = null;
  try {
    pathname = normalizePath(new URL(String(service?.url || "")).pathname);
  } catch {
    pathname = null;
  }
  if (!pathname) return null;
  return (
    matchers.find((matcher) => matcher.method === method && matcher.regex.test(pathname)) || null
  );
}

function runPreflight() {
  const result = spawnSync(process.execPath, [path.join("scripts", "core40_preflight.cjs")], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: Number(result.status || 0),
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

async function main() {
  const startedAt = nowIso();
  const preflightExec = runPreflight();
  const preflightReport = readJsonSafe(PREFLIGHT_LATEST);
  const preflightOk =
    preflightExec.status === 0 &&
    preflightReport &&
    Number(preflightReport?.summary?.failed || 0) === 0 &&
    (preflightReport?.missingInDiscovery || []).length === 0 &&
    (preflightReport?.unexpectedInDiscovery || []).length === 0;

  const [coreDiscoveryResp, fullDiscoveryResp, indexedServices] = await Promise.all([
    requestJson(`${BASE_URL}/api/system/discovery/core?limit=500`),
    requestJson(`${BASE_URL}/api/system/discovery?profile=full&limit=1000`),
    fetchAllIndexedServices(DOMAIN),
  ]);

  const coreCatalog = Array.isArray(coreDiscoveryResp.json?.catalog) ? coreDiscoveryResp.json.catalog : [];
  const fullCatalog = Array.isArray(fullDiscoveryResp.json?.catalog) ? fullDiscoveryResp.json.catalog : [];
  const coreRouteSet = new Set(coreCatalog.map((entry) => String(entry?.routeKey || "").trim()));
  const missingCoreRoutes = CORE_ROUTE_KEYS.filter((routeKey) => !coreRouteSet.has(routeKey));

  const matchers = buildCoreMatchers();
  const indexedCoreMatches = [];
  for (const service of indexedServices) {
    const match = findCoreMatch(service, matchers);
    if (!match) continue;
    indexedCoreMatches.push({
      id: String(service?.id || ""),
      routeKey: match.routeKey,
      url: String(service?.url || ""),
      category: String(service?.category || "uncategorized"),
      health: String(service?.health || "unknown"),
      price: String(service?.price || ""),
    });
  }

  const routeMatchCounts = {};
  for (const routeKey of CORE_ROUTE_KEYS) {
    routeMatchCounts[routeKey] = indexedCoreMatches.filter((row) => row.routeKey === routeKey).length;
  }

  const finishedAt = nowIso();
  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    preflight: {
      ok: Boolean(preflightOk),
      exitCode: preflightExec.status,
      latestReportPath: PREFLIGHT_LATEST,
      stderr: preflightExec.stderr || null,
    },
    discovery: {
      coreStatus: coreDiscoveryResp.status,
      coreRouteCount: coreCatalog.length,
      fullStatus: fullDiscoveryResp.status,
      fullRouteCount: fullCatalog.length,
      missingCoreRoutes,
    },
    index: {
      domain: DOMAIN,
      indexedServiceCount: indexedServices.length,
      coreMatchedServiceCount: indexedCoreMatches.length,
      uniqueCoreRouteMatches: Object.values(routeMatchCounts).filter((count) => count > 0).length,
      unknownHealthCoreMatches: indexedCoreMatches.filter((row) => row.health.toLowerCase() === "unknown").length,
      routeMatchCounts,
      sampleCoreMatches: indexedCoreMatches.slice(0, 40),
    },
    summary: {
      ok:
        Boolean(preflightOk) &&
        coreDiscoveryResp.status === 200 &&
        fullDiscoveryResp.status === 200 &&
        missingCoreRoutes.length === 0,
      reasons: [
        !preflightOk ? "preflight_failed" : null,
        coreDiscoveryResp.status !== 200 ? "core_discovery_http_error" : null,
        fullDiscoveryResp.status !== 200 ? "full_discovery_http_error" : null,
        missingCoreRoutes.length ? "core_discovery_missing_routes" : null,
      ].filter(Boolean),
    },
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const outPath = path.join(REPORT_DIR, `core40-nightly-monitor-${stamp}.json`);
  const latestPath = path.join(REPORT_DIR, "core40-nightly-monitor-latest.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        latestPath,
        ok: report.summary.ok,
        reasons: report.summary.reasons,
        preflightOk,
        coreRouteCount: coreCatalog.length,
        fullRouteCount: fullCatalog.length,
        coreMatchedServiceCount: indexedCoreMatches.length,
      },
      null,
      2,
    ),
  );

  if (!report.summary.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
