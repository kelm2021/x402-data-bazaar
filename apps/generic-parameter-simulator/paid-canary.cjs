#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BASE_URL = process.env.SIM_CANARY_BASE_URL || "https://api.aurelianflo.com";
const MAX_AMOUNT_USD_MICROS = Number(process.env.SIM_CANARY_MAX_USD_MICROS || 100000);
const SEED = Number(process.env.SIM_CANARY_SEED || 20260403);
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "sim-paid-canary";

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

function getAwalDistDir() {
  const candidate = path.join(process.env.APPDATA || "", "npm", "node_modules", "awal", "dist");
  if (candidate && fs.existsSync(path.join(candidate, "ipcClient.js"))) {
    return candidate;
  }

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

function formatValue(value) {
  if (typeof value === "number") {
    return value.toFixed(4);
  }

  return JSON.stringify(value);
}

function truncate(value, limit = 240) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function buildPaidCanaries() {
  const baselineBody = {
    parameters: {
      demand_signal: 0.65,
      execution_quality: 0.6,
      pricing_pressure: -0.25,
    },
    threshold: 0.25,
  };

  return [
    {
      name: "probability-repeat-a",
      url: `${BASE_URL}/api/sim/probability?seed=${SEED}`,
      body: baselineBody,
    },
    {
      name: "probability-repeat-b",
      url: `${BASE_URL}/api/sim/probability?seed=${SEED}`,
      body: baselineBody,
    },
    {
      name: "probability-different-seed",
      url: `${BASE_URL}/api/sim/probability?seed=${SEED + 1}`,
      body: baselineBody,
    },
    {
      name: "batch-ranking",
      url: `${BASE_URL}/api/sim/batch-probability?seed=${SEED}`,
      body: {
        scenarios: [
          {
            label: "baseline",
            parameters: {
              demand_signal: 0.65,
              execution_quality: 0.6,
              pricing_pressure: -0.25,
            },
            threshold: 0.25,
          },
          {
            label: "candidate",
            parameters: {
              demand_signal: 0.78,
              execution_quality: 0.68,
              pricing_pressure: -0.2,
            },
            threshold: 0.25,
          },
        ],
      },
    },
    {
      name: "forecast-risk",
      url: `${BASE_URL}/api/sim/forecast?seed=${SEED}`,
      body: {
        scenario: {
          parameters: { signal: 0.2 },
          uncertainty: { signal: 0.4 },
          outcome_noise: 0.5,
          threshold: 0,
        },
        periods: 2,
        drift: { signal: 0.05 },
      },
    },
    {
      name: "report-compare",
      url: `${BASE_URL}/api/sim/report?seed=${SEED}`,
      body: {
        analysis_type: "compare",
        title: "Candidate vs baseline decision memo",
        summary_focus: "decision",
        request: {
          baseline: {
            parameters: {
              demand_signal: 0.65,
              execution_quality: 0.6,
              pricing_pressure: -0.25,
            },
            threshold: 0.25,
          },
          candidate: {
            parameters: {
              demand_signal: 0.78,
              execution_quality: 0.68,
              pricing_pressure: -0.2,
            },
            threshold: 0.25,
          },
        },
      },
    },
  ];
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

  const canaries = buildPaidCanaries();
  const results = [];
  const failures = [];

  for (const canary of canaries) {
    console.log(`[${canary.name}]`);
    const response = await sendIpcRequest("make-x402-request", buildRequest(canary.url, canary.body));
    const payload =
      typeof response?.data === "string"
        ? parseJsonSafe(response.data) || response.data
        : response?.data;
    const payment = decodeBase64Json(response?.headers?.["PAYMENT-RESPONSE"]);

    assert(response?.status >= 200 && response?.status < 300, `${canary.name} returned 2xx`, failures);
    assert(Boolean(payment?.success), `${canary.name} payment settled`, failures);

    results.push({
      name: canary.name,
      url: canary.url,
      status: response?.status ?? null,
      paymentTx: payment?.transactionHash || payment?.transaction || null,
      payload,
      preview: truncate(payload),
    });

    if (canary.name === "batch-ranking") {
      assert(payload?.ranking?.[0]?.label === "candidate", "batch-ranking keeps candidate first", failures);
      assert(
        payload?.scenarios?.[0]?.result?.risk_metrics?.expected_shortfall_05 !== undefined,
        "batch-ranking includes risk metrics",
        failures,
      );
    }

    if (canary.name === "forecast-risk") {
      assert(
        payload?.timeline?.[0]?.effective_score_distribution?.p95 !== undefined,
        "forecast-risk includes effective score distribution",
        failures,
      );
      assert(
        payload?.timeline?.[0]?.risk_metrics?.expected_shortfall_05 !== undefined,
        "forecast-risk includes tail-risk metrics",
        failures,
      );
    }

    if (canary.name === "report-compare") {
      assert(
        payload?.report_meta?.analysis_type === "compare",
        "report-compare identifies analysis type",
        failures,
      );
      assert(
        Array.isArray(payload?.headline_metrics) && payload.headline_metrics.length >= 3,
        "report-compare includes headline metrics",
        failures,
      );
      assert(
        Array.isArray(payload?.tables?.scenario_summary?.rows)
          && payload.tables.scenario_summary.rows.length >= 2,
        "report-compare includes scenario rows",
        failures,
      );
      assert(
        Array.isArray(payload?.export_artifacts?.workbook_rows?.scenario_summary),
        "report-compare includes workbook rows",
        failures,
      );
    }

    console.log("");
  }

  const repeatA = results.find((entry) => entry.name === "probability-repeat-a");
  const repeatB = results.find((entry) => entry.name === "probability-repeat-b");
  const different = results.find((entry) => entry.name === "probability-different-seed");

  assert(
    JSON.stringify(repeatA?.payload) === JSON.stringify(repeatB?.payload),
    "same-seed paid calls are identical",
    failures,
  );
  assert(
    JSON.stringify(repeatA?.payload) !== JSON.stringify(different?.payload),
    "different-seed paid calls differ",
    failures,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    seed: SEED,
    maxAmountUsdMicros: MAX_AMOUNT_USD_MICROS,
    ok: failures.length === 0,
    failures,
    results: results.map((entry) => ({
      name: entry.name,
      url: entry.url,
      status: entry.status,
      paymentTx: entry.paymentTx,
      preview: entry.preview,
    })),
  };

  const outDir = path.join(__dirname, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const latestPath = path.join(outDir, "paid-canary-latest.json");
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  if (failures.length > 0) {
    console.log(`Paid canary failed with ${failures.length} issue(s).`);
    process.exit(1);
  }

  console.log("Paid canary passed.");
  console.log(`Latest report: ${latestPath}`);
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
