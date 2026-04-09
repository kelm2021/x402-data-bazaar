#!/usr/bin/env node

const BASE_URL = process.env.VENDOR_WORKFLOW_CANARY_BASE_URL || "https://api.aurelianflo.com";
const MAX_AMOUNT_USD_MICROS = Number(process.env.VENDOR_WORKFLOW_CANARY_MAX_USD_MICROS || 250000);
const SEED = Number(process.env.VENDOR_WORKFLOW_CANARY_SEED || 20260403);
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "vendor-workflow-paid-canary";

function buildBatchPayload(seed = SEED, options = {}) {
  return {
    as_of_date: "2026-04-03",
    workflow: "vendor.risk_assessment",
    mode: "vendor_batch",
    inputs: {
      vendors: [
        {
          name: "SBERBANK",
          country: "CZ",
          criticality: "high",
          annual_spend_usd: 2500000,
          cross_border: true,
          service_category: "banking",
        },
        {
          name: "ACME LOGISTICS LLC",
          country: "US",
          criticality: "medium",
          annual_spend_usd: 900000,
          cross_border: false,
          service_category: "logistics",
        },
        {
          name: "NOVA PAYMENTS LTD",
          country: "GB",
          criticality: "high",
          annual_spend_usd: 1700000,
          cross_border: true,
          service_category: "payments",
        },
      ],
    },
    model_options: {
      seed,
      screening_threshold: 90,
      screening_limit: 3,
      include_report: Boolean(options.includeReport),
      include_artifacts: options.includeArtifacts || [],
    },
  };
}

function buildSinglePayload(seed = SEED, options = {}) {
  return {
    as_of_date: "2026-04-03",
    workflow: "vendor.risk_assessment",
    mode: "single_vendor",
    inputs: {
      vendors: [
        {
          name: "SBERBANK",
          country: "CZ",
          criticality: "high",
          annual_spend_usd: 2500000,
          cross_border: true,
          service_category: "banking",
        },
      ],
    },
    model_options: {
      seed,
      screening_threshold: 90,
      screening_limit: 3,
      include_report: Boolean(options.includeReport),
      include_artifacts: options.includeArtifacts || [],
    },
  };
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
  const clone = JSON.parse(JSON.stringify(payload));
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
      name: "vendor-batch-repeat-a",
      url: `${BASE_URL}/api/workflows/vendor/risk-assessment?seed=${SEED}`,
      body: buildBatchPayload(SEED),
    },
    {
      name: "vendor-batch-repeat-b",
      url: `${BASE_URL}/api/workflows/vendor/risk-assessment?seed=${SEED}`,
      body: buildBatchPayload(SEED),
    },
    {
      name: "vendor-single",
      url: `${BASE_URL}/api/workflows/vendor/risk-assessment?seed=${SEED}`,
      body: buildSinglePayload(SEED),
    },
    {
      name: "vendor-batch-xlsx",
      url: `${BASE_URL}/api/workflows/vendor/risk-assessment?seed=${SEED}`,
      body: buildBatchPayload(SEED, { includeReport: true, includeArtifacts: ["xlsx"] }),
    },
  ];

  const failures = [];
  const results = [];

  for (const canary of canaries) {
    console.log(`[${canary.name}]`);
    const response = await sendIpcRequest("make-x402-request", buildRequest(canary.url, canary.body));
    const payload = typeof response?.data === "string" ? parseJsonSafe(response.data) || response.data : response?.data;
    const payment = decodeBase64Json(response?.headers?.["PAYMENT-RESPONSE"]);

    assert(response?.status >= 200 && response?.status < 300, `${canary.name} returned 2xx`, failures);
    assert(Boolean(payment?.success), `${canary.name} payment settled`, failures);
    results.push({ name: canary.name, payload, payment });

    if (canary.name === "vendor-single") {
      assert(payload?.workflow_meta?.mode === "single_vendor", "vendor-single reports single_vendor mode", failures);
    }
    if (canary.name === "vendor-batch-xlsx") {
      assert(payload?.artifacts?.xlsx?.documentType === "xlsx", "vendor-batch-xlsx returns xlsx artifact", failures);
    }
    assert(payload?.diagnostics?.upstream_stubbed === false, `${canary.name} uses real upstream composition`, failures);
    console.log("");
  }

  const repeatA = results.find((entry) => entry.name === "vendor-batch-repeat-a");
  const repeatB = results.find((entry) => entry.name === "vendor-batch-repeat-b");
  assert(
    JSON.stringify(sanitizeForDeterministicCompare(repeatA?.payload)) ===
      JSON.stringify(sanitizeForDeterministicCompare(repeatB?.payload)),
    "same-seed vendor batch calls are identical",
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
