#!/usr/bin/env node

const BASE_URL = process.env.FINANCE_WORKFLOW_CANARY_BASE_URL || "https://api.aurelianflo.com";
const MAX_AMOUNT_USD_MICROS = Number(process.env.FINANCE_WORKFLOW_CANARY_MAX_USD_MICROS || 250000);
const SEED = Number(process.env.FINANCE_WORKFLOW_CANARY_SEED || 20260403);
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "finance-workflow-paid-canary";

const cashFixture = require("./fixtures/cash-runway-2026-04-03.json");
const pricingFixture = require("./fixtures/pricing-scenario-2026-04-03.json");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCashPayload(seed = SEED, options = {}) {
  const payload = cloneJson(cashFixture);
  payload.model_options.seed = seed;
  payload.model_options.include_report = Boolean(options.includeReport);
  payload.model_options.include_artifacts = options.includeArtifacts || [];
  return payload;
}

function buildPricingPayload(seed = SEED, options = {}) {
  const payload = cloneJson(pricingFixture);
  payload.model_options.seed = seed;
  payload.model_options.include_report = Boolean(options.includeReport);
  payload.model_options.include_artifacts = options.includeArtifacts || [];
  return payload;
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function decodeBase64Json(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function sanitizeForDeterministicCompare(payload) {
  const clone = cloneJson(payload);
  if (!clone || typeof clone !== "object") {
    return clone;
  }

  if (clone.artifacts && typeof clone.artifacts === "object") {
    for (const key of Object.keys(clone.artifacts)) {
      if (key === "recommended_local_path") {
        continue;
      }
      if (clone.artifacts[key] && typeof clone.artifacts[key] === "object") {
        delete clone.artifacts[key].artifact;
      }
    }
  }

  return clone;
}

async function loadAwalIpc() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");

  const candidate = path.join(process.env.APPDATA || "", "npm", "node_modules", "awal", "dist");
  if (!fs.existsSync(path.join(candidate, "ipcClient.js"))) {
    throw new Error("Unable to locate awal dist ipcClient.js");
  }

  const ipcModuleUrl = pathToFileURL(path.join(candidate, "ipcClient.js")).href;
  const authModuleUrl = pathToFileURL(path.join(candidate, "utils", "authCheck.js")).href;
  const { sendIpcRequest } = await import(ipcModuleUrl);
  const { requireAuth } = await import(authModuleUrl);
  return { requireAuth, sendIpcRequest };
}

function buildRequest(url, body) {
  const parsed = new URL(url);
  return {
    baseURL: `${parsed.protocol}//${parsed.host}`,
    path: `${parsed.pathname}${parsed.search}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
    body,
    maxAmountPerRequest: MAX_AMOUNT_USD_MICROS,
  };
}

function assert(condition, message, failures) {
  if (!condition) {
    failures.push(message);
    console.log(`FAIL ${message}`);
    return;
  }
  console.log(`PASS ${message}`);
}

async function run() {
  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const canaries = [
    {
      name: "cash-runway-repeat-a",
      url: `${BASE_URL}/api/workflows/finance/cash-runway-forecast?seed=${SEED}`,
      body: buildCashPayload(SEED),
    },
    {
      name: "cash-runway-repeat-b",
      url: `${BASE_URL}/api/workflows/finance/cash-runway-forecast?seed=${SEED}`,
      body: buildCashPayload(SEED),
    },
    {
      name: "cash-runway-xlsx",
      url: `${BASE_URL}/api/workflows/finance/cash-runway-forecast?seed=${SEED}`,
      body: buildCashPayload(SEED, { includeReport: true, includeArtifacts: ["xlsx"] }),
    },
    {
      name: "pricing-repeat-a",
      url: `${BASE_URL}/api/workflows/finance/pricing-plan-compare?seed=${SEED}`,
      body: buildPricingPayload(SEED),
    },
    {
      name: "pricing-repeat-b",
      url: `${BASE_URL}/api/workflows/finance/pricing-plan-compare?seed=${SEED}`,
      body: buildPricingPayload(SEED),
    },
    {
      name: "pricing-xlsx",
      url: `${BASE_URL}/api/workflows/finance/pricing-plan-compare?seed=${SEED}`,
      body: buildPricingPayload(SEED, { includeReport: true, includeArtifacts: ["xlsx"] }),
    },
  ];

  const failures = [];
  const results = [];

  for (const canary of canaries) {
    console.log(`[${canary.name}]`);
    const response = await sendIpcRequest("make-x402-request", buildRequest(canary.url, canary.body));
    const payload = typeof response?.data === "string"
      ? parseJsonSafe(response.data) || response.data
      : response?.data;
    const payment = decodeBase64Json(response?.headers?.["PAYMENT-RESPONSE"]);

    assert(response?.status >= 200 && response?.status < 300, `${canary.name} returned 2xx`, failures);
    assert(Boolean(payment?.success), `${canary.name} payment settled`, failures);
    results.push({ name: canary.name, payload, payment });

    if (canary.name.endsWith("-xlsx")) {
      assert(payload?.artifacts?.xlsx?.documentType === "xlsx", `${canary.name} returns xlsx artifact`, failures);
    }

    console.log("");
  }

  const cashRepeatA = results.find((entry) => entry.name === "cash-runway-repeat-a");
  const cashRepeatB = results.find((entry) => entry.name === "cash-runway-repeat-b");
  const pricingRepeatA = results.find((entry) => entry.name === "pricing-repeat-a");
  const pricingRepeatB = results.find((entry) => entry.name === "pricing-repeat-b");

  assert(
    JSON.stringify(sanitizeForDeterministicCompare(cashRepeatA?.payload)) ===
      JSON.stringify(sanitizeForDeterministicCompare(cashRepeatB?.payload)),
    "cash runway same-seed calls are identical",
    failures,
  );
  assert(
    JSON.stringify(sanitizeForDeterministicCompare(pricingRepeatA?.payload)) ===
      JSON.stringify(sanitizeForDeterministicCompare(pricingRepeatB?.payload)),
    "pricing scenario same-seed calls are identical",
    failures,
  );

  if (failures.length > 0) {
    console.log(`Paid canary failed with ${failures.length} assertion(s).`);
    process.exit(1);
  }

  console.log("Paid canary passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
