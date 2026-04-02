#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BASE_URL = "https://x402.aurelianflo.com";
const MAX_AMOUNT_USD_MICROS = 500000; // $0.50 cap per request
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "core40-paid-sweep";
const REQUEST_DELAY_MS = 140;

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

const STAR_SAMPLES = {
  "/api/ofac-sanctions-screening/*": "/api/ofac-sanctions-screening/SBERBANK",
  "/api/restricted-party/screen/*": "/api/restricted-party/screen/SBERBANK",
  "/api/weather/current/*": "/api/weather/current/40.7128/-74.0060",
  "/api/whois/*": "/api/whois/example.com",
  "/api/dns/*": "/api/dns/example.com",
};

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
    iterations: 60,
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

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function decodeBase64Json(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const wanted = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key || "").toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

function parseExtensionResponses(headers) {
  const raw =
    getHeaderValue(headers, "EXTENSION-RESPONSES")
    || getHeaderValue(headers, "x-extension-responses")
    || null;
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const asJson = parseJsonSafe(raw);
  if (asJson) {
    return asJson;
  }

  return decodeBase64Json(raw);
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
  const json = parseJsonSafe(text);
  if (!response.ok || !json) {
    throw new Error(`Fetch ${url} failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

function routeKeyParts(routeKey) {
  const firstSpace = String(routeKey || "").indexOf(" ");
  return {
    method: String(routeKey || "").slice(0, firstSpace).trim().toUpperCase(),
    pathTemplate: String(routeKey || "").slice(firstSpace + 1).trim(),
  };
}

function buildCallPath(pathTemplate) {
  if (STAR_SAMPLES[pathTemplate]) return STAR_SAMPLES[pathTemplate];
  if (!String(pathTemplate).includes("*")) return String(pathTemplate);
  return String(pathTemplate).replace(/\*/g, "sample");
}

function isMeaningfulObject(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function looksLikeStub(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  if (text.includes("\"status\":\"stub\"")) return true;
  if (text.includes("previewtoken")) return true;
  if (text.includes("replace with real request body")) return true;
  return false;
}

function validateFunctional(routeKey, payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "non_object_payload" };
  }

  if (looksLikeStub(payload)) {
    return { ok: false, reason: "stub_like_payload" };
  }

  if (String(routeKey).startsWith("POST /api/sim/probability")) {
    return { ok: typeof payload.outcome_probability === "number", reason: "sim_probability_check" };
  }

  if (String(routeKey).startsWith("POST /api/sim/")) {
    return { ok: isMeaningfulObject(payload), reason: "sim_generic_check" };
  }

  if (payload.success === false) {
    return { ok: false, reason: "payload_success_false" };
  }

  if (payload.success === true) {
    return { ok: isMeaningfulObject(payload.data), reason: "enveloped_data_check" };
  }

  return { ok: isMeaningfulObject(payload), reason: "generic_object_check" };
}

function truncate(value, limit = 380) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

async function run() {
  const startedAt = nowIso();
  const discovery = await fetchJson(`${BASE_URL}/api/system/discovery/core?limit=500`);
  const catalog = Array.isArray(discovery.catalog) ? discovery.catalog : [];
  const byRouteKey = new Map(catalog.map((entry) => [String(entry.routeKey || "").trim(), entry]));
  const missing = CORE_ROUTE_KEYS.filter((routeKey) => !byRouteKey.has(routeKey));
  if (missing.length > 0) {
    throw new Error(`Core routes missing from discovery/core: ${missing.join(", ")}`);
  }

  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const results = [];
  for (let index = 0; index < CORE_ROUTE_KEYS.length; index += 1) {
    const routeKey = CORE_ROUTE_KEYS[index];
    const { method, pathTemplate } = routeKeyParts(routeKey);
    const callPath = buildCallPath(pathTemplate);
    const callUrl = `${BASE_URL}${callPath}`;
    const requestBody = method === "POST" ? (POST_BODIES[pathTemplate] || {}) : null;

    const resultRow = {
      index: index + 1,
      routeKey,
      method,
      pathTemplate,
      callPath,
      callUrl,
      status: null,
      transportError: null,
      paymentAuthorized: false,
      paymentTx: null,
      extensionResponses: null,
      extensionResponsesState: null,
      provider: null,
      functionalOk: false,
      functionalReason: null,
      responsePreview: null,
    };

    try {
      const parsedUrl = new URL(callUrl);
      const request = {
        baseURL: `${parsedUrl.protocol}//${parsedUrl.host}`,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers: {
          [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
        },
        maxAmountPerRequest: MAX_AMOUNT_USD_MICROS,
      };

      if (method === "POST") {
        request.headers["content-type"] = "application/json";
        request.body = requestBody || {};
      }

      const response = await sendIpcRequest("make-x402-request", request);
      resultRow.status = Number(response?.status || 0);
      resultRow.provider =
        response?.headers?.["x-facilitator-provider"] ||
        response?.headers?.["X-Facilitator-Provider"] ||
        null;

      const paymentHeader =
        getHeaderValue(response?.headers, "PAYMENT-RESPONSE")
        || null;
      const paymentResponse = decodeBase64Json(paymentHeader);
      resultRow.paymentAuthorized = Boolean(paymentResponse?.success);
      resultRow.paymentTx = paymentResponse?.transactionHash || paymentResponse?.transaction || null;
      resultRow.extensionResponses = parseExtensionResponses(response?.headers);
      resultRow.extensionResponsesState =
        resultRow.extensionResponses?.bazaar?.status
        || resultRow.extensionResponses?.status
        || null;

      const payload =
        typeof response?.data === "string"
          ? parseJsonSafe(response.data) || response.data
          : response?.data;
      resultRow.responsePreview = truncate(payload);

      if (resultRow.status >= 200 && resultRow.status < 300) {
        const validation = validateFunctional(routeKey, payload);
        resultRow.functionalOk = Boolean(validation.ok);
        resultRow.functionalReason = validation.reason;
      } else {
        resultRow.functionalOk = false;
        resultRow.functionalReason = `non_2xx_status_${resultRow.status}`;
      }
    } catch (error) {
      resultRow.transportError = error instanceof Error ? error.message : String(error);
      resultRow.functionalOk = false;
      resultRow.functionalReason = "transport_error";
    }

    results.push(resultRow);
    await sleep(REQUEST_DELAY_MS);
  }

  const summary = {
    total: results.length,
    success2xx: results.filter((row) => row.status >= 200 && row.status < 300).length,
    transportFailed: results.filter((row) => row.transportError).length,
    paymentAuthorized: results.filter((row) => row.paymentAuthorized).length,
    functionalPassed: results.filter((row) => row.functionalOk).length,
    functionalFailed: results.filter((row) => !row.functionalOk).length,
    extensionResponsesObserved: results.filter((row) => Boolean(row.extensionResponses)).length,
    extensionResponsesByStatus: results.reduce((acc, row) => {
      const key = String(row.extensionResponsesState || "missing").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };

  const failures = results.filter((row) => !row.functionalOk);
  const samples = results
    .filter((row) => row.functionalOk)
    .slice(0, 15)
    .map((row) => ({
      routeKey: row.routeKey,
      callUrl: row.callUrl,
      paymentTx: row.paymentTx,
      preview: row.responsePreview,
    }));

  const finishedAt = nowIso();
  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    summary,
    failures,
    samples,
    results,
  };

  const outDir = path.join(process.cwd(), "ops-dashboard", "core40-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `core40-paid-sweep-${stamp}.json`);
  const latestPath = path.join(outDir, "core40-paid-sweep-latest.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: summary.functionalFailed === 0,
        outPath,
        latestPath,
        summary,
        failureCount: failures.length,
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
