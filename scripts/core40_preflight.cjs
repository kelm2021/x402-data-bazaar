#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = "https://x402.aurelianflo.com";
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

const POST_BODIES = {
  "/api/sim/probability": { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
  "/api/sim/compare": {
    baseline: { parameters: { labor: 0.1, monetary: -0.05, yield: 0.05 }, threshold: 0 },
    candidate: { parameters: { labor: 0.25, monetary: -0.15, yield: 0.15 }, threshold: 0 },
  },
  "/api/sim/sensitivity": {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    parameter: "labor",
    delta: 0.05,
  },
  "/api/sim/forecast": {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    periods: 6,
  },
  "/api/sim/composed": {
    components: [
      { label: "growth", weight: 0.6, scenario: { parameters: { labor: 0.25, yield: 0.2 }, threshold: 0 } },
      { label: "headwinds", weight: 0.4, scenario: { parameters: { monetary: -0.2 }, threshold: 0 } },
    ],
  },
  "/api/sim/optimize": {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    bounds: {
      labor: { min: -1, max: 1 },
      monetary: { min: -1, max: 1 },
      yield: { min: -1, max: 1 },
    },
    iterations: 40,
  },
  "/api/tools/text/summarize-bullets": {
    text: "AurelianFlo publishes paid endpoints with strict discovery contracts for agent consumption.",
  },
  "/api/tools/text/translate": { text: "Hello world", targetLanguage: "es" },
  "/api/tools/text/to-json": { text: "name: Alice\nrole: Engineer\ncity: Austin" },
  "/api/tools/text/entities": { text: "Kent met OpenAI in Chicago and emailed user@example.com" },
  "/api/tools/text/sentiment": { text: "This launch is clear, useful, and stable." },
  "/api/tools/text/detect-language": { text: "Hola mundo" },
  "/api/tools/text/pii": { text: "Email user@example.com and call +1 312 555 0199", action: "detect" },
  "/api/tools/text/classify": { text: "Need invoice support", labels: ["support", "sales", "general"] },
  "/api/tools/legal/extract-clauses": { text: "This agreement includes indemnification and termination clauses." },
  "/api/tools/legal/nda-summary": { text: "NDA requires confidentiality for 24 months and excludes public information." },
  "/api/tools/contract/generate": { partyA: "Acme", partyB: "Globex", termMonths: 12 },
  "/api/tools/proposal/generate": { client: "Acme", scope: "API modernization", budget: 50000 },
  "/api/tools/report/generate": { title: "Weekly Ops", metrics: [{ key: "uptime", value: "99.9%" }] },
  "/api/tools/invoice/generate": { invoiceNumber: "INV-1001", customer: "Acme", amount: 1200 },
  "/api/tools/markdown-to-pdf": { markdown: "# Demo\n\nThis is a sample markdown payload." },
  "/api/tools/docx/generate": { title: "Partner Brief", sections: ["Summary", "Scope", "Timeline"] },
  "/api/tools/xlsx/generate": { sheets: [{ name: "Data", rows: [["name", "value"], ["a", 1], ["b", 2]] }] },
  "/api/tools/convert/csv-to-json": { csv: "name,age\nAlice,30\nBob,25" },
  "/api/tools/convert/json-to-csv": { rows: [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }] },
  "/api/tools/pay/reconcile": { transactions: [{ id: "tx1", amount: 10 }, { id: "tx2", amount: 15 }] },
};

const STAR_SAMPLES = {
  "/api/ofac-sanctions-screening/*": "/api/ofac-sanctions-screening/SBERBANK",
  "/api/restricted-party/screen/*": "/api/restricted-party/screen/SBERBANK",
  "/api/weather/current/*": "/api/weather/current/40.7128/-74.0060",
  "/api/whois/*": "/api/whois/example.com",
  "/api/dns/*": "/api/dns/example.com",
};

function nowIso() {
  return new Date().toISOString();
}

function toOpenApiTemplate(pathname) {
  let wildcardIndex = 0;
  return String(pathname || "").replace(/\*/g, () => `{param${++wildcardIndex}}`);
}

function hasSchemaShape(schema) {
  if (!schema || typeof schema !== "object") return false;
  if (typeof schema.$ref === "string" && schema.$ref.trim()) return true;
  if (schema.type === "array" && schema.items) return true;
  if (schema.type === "object") {
    const propCount = schema.properties && typeof schema.properties === "object"
      ? Object.keys(schema.properties).length
      : 0;
    if (propCount > 0) return true;
    if (schema.additionalProperties === true) return true;
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") return true;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return true;
  if (Array.isArray(schema.allOf) && schema.allOf.length) return true;
  return typeof schema.type === "string";
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function routeKeyToParts(routeKey) {
  const firstSpace = String(routeKey || "").indexOf(" ");
  const method = String(routeKey || "").slice(0, firstSpace).trim().toUpperCase();
  const path = String(routeKey || "").slice(firstSpace + 1).trim();
  return { method, path };
}

function buildCallPath(pathTemplate) {
  if (STAR_SAMPLES[pathTemplate]) return STAR_SAMPLES[pathTemplate];
  if (!pathTemplate.includes("*")) return pathTemplate;
  return pathTemplate.replace(/\*/g, "sample");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  return { response, text, json: parseJsonSafe(text) };
}

async function run() {
  const startedAt = nowIso();
  const discoveryUrl = `${BASE_URL}/api/system/discovery/core?limit=500`;
  const openApiUrl = `${BASE_URL}/api/system/openapi.json`;
  const discovery = await fetchJson(discoveryUrl);
  const openapi = await fetchJson(openApiUrl);

  if (!discovery.response.ok || !discovery.json) {
    throw new Error(`Failed to read discovery core: ${discovery.response.status} ${discovery.text.slice(0, 250)}`);
  }
  if (!openapi.response.ok || !openapi.json) {
    throw new Error(`Failed to read openapi: ${openapi.response.status} ${openapi.text.slice(0, 250)}`);
  }

  const catalog = Array.isArray(discovery.json.catalog) ? discovery.json.catalog : [];
  const coreKeys = new Set(catalog.map((entry) => String(entry.routeKey || "").trim()));
  const expectedKeys = new Set(CORE_ROUTE_KEYS);
  const missingInDiscovery = CORE_ROUTE_KEYS.filter((key) => !coreKeys.has(key));
  const unexpectedInDiscovery = [...coreKeys].filter((key) => !expectedKeys.has(key));

  const perRoute = [];
  for (const routeKey of CORE_ROUTE_KEYS) {
    const { method, path: pathTemplate } = routeKeyToParts(routeKey);
    const entry = catalog.find((row) => row.routeKey === routeKey) || null;
    const pathForCall = buildCallPath(pathTemplate);
    const endpointUrl = `${BASE_URL}${pathForCall}`;
    const openApiTemplate = toOpenApiTemplate(pathTemplate);
    const operation = openapi.json.paths?.[openApiTemplate]?.[method.toLowerCase()] || null;

    const body = method === "POST" ? (POST_BODIES[pathTemplate] || {}) : null;
    const requestInit = {
      method,
      headers: { accept: "application/json" },
    };
    if (method === "POST") {
      requestInit.headers["content-type"] = "application/json";
      requestInit.body = JSON.stringify(body || {});
    }

    const unpaidResp = await fetch(endpointUrl, requestInit);
    const unpaidText = await unpaidResp.text();
    const unpaidJson = parseJsonSafe(unpaidText);
    const resourceUrl = unpaidJson?.resource?.url || null;
    const accepts = Array.isArray(unpaidJson?.accepts) ? unpaidJson.accepts : [];

    const checks = {
      inDiscoveryCore: Boolean(entry),
      openApiOperation: Boolean(operation),
      discoveryRequestSchema: hasSchemaShape(entry?.request?.schema),
      discoveryResponseSchema: hasSchemaShape(entry?.response?.schema),
      unpaid402: unpaidResp.status === 402,
      paymentResourceUrl: typeof resourceUrl === "string" && resourceUrl.includes(pathTemplate.replace(/\*/g, "")),
      paymentAcceptsPresent: accepts.length > 0,
    };
    const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    perRoute.push({
      routeKey,
      method,
      pathTemplate,
      callPath: pathForCall,
      endpointUrl,
      checks,
      failedChecks,
      unpaidStatus: unpaidResp.status,
      unpaidError: unpaidJson?.error || null,
      priceUsd: entry?.priceUsd ?? null,
    });
  }

  const passCount = perRoute.filter((row) => row.failedChecks.length === 0).length;
  const failCount = perRoute.length - passCount;
  const finishedAt = nowIso();
  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    expectedCoreCount: CORE_ROUTE_KEYS.length,
    discoveryCoreCount: catalog.length,
    missingInDiscovery,
    unexpectedInDiscovery,
    summary: {
      total: perRoute.length,
      passed: passCount,
      failed: failCount,
    },
    results: perRoute,
  };

  const outDir = path.join(process.cwd(), "ops-dashboard", "core40-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `core40-preflight-${stamp}.json`);
  const latestPath = path.join(outDir, "core40-preflight-latest.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: failCount === 0 && missingInDiscovery.length === 0 && unexpectedInDiscovery.length === 0,
        outPath,
        latestPath,
        summary: report.summary,
        missingInDiscovery: missingInDiscovery.length,
        unexpectedInDiscovery: unexpectedInDiscovery.length,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

