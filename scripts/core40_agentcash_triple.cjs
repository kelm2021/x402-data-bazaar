#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BASE_URL = "https://x402.aurelianflo.com";
const MAX_AMOUNT = "0.5";
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const REQUEST_DELAY_MS = 120;
const PASSES = Math.max(1, Number.parseInt(process.env.CORE40_PASSES || "3", 10) || 3);
const previousSweep = require("../ops-dashboard/core40-reports/core40-agentcash-sweep-latest.json");

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

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function parseJsonSafe(value) { try { return JSON.parse(String(value || "")); } catch { return null; } }
function isMeaningfulObject(value) { if (!value || typeof value !== "object") return false; if (Array.isArray(value)) return value.length > 0; return Object.keys(value).length > 0; }
function looksLikeStub(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  if (text.includes('"status":"stub"')) return true;
  if (text.includes("previewtoken")) return true;
  if (text.includes("replace with real request body")) return true;
  return false;
}
function validateFunctional(routeKey, payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "non_object_payload" };
  if (looksLikeStub(payload)) return { ok: false, reason: "stub_like_payload" };
  if (String(routeKey).startsWith("POST /api/sim/probability")) return { ok: typeof payload.outcome_probability === "number", reason: "sim_probability_check" };
  if (String(routeKey).startsWith("POST /api/sim/")) return { ok: isMeaningfulObject(payload), reason: "sim_generic_check" };
  if (payload.success === false) return { ok: false, reason: "payload_success_false" };
  if (payload.success === true) return { ok: isMeaningfulObject(payload.data), reason: "enveloped_data_check" };
  return { ok: isMeaningfulObject(payload), reason: "generic_object_check" };
}
function truncate(value, limit = 280) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 3)) + "...";
}
function extractFirstJsonObject(text) {
  const input = String(text || "");
  const start = input.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { depth += 1; continue; }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}
function runCommand(command, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    try {
      const child = spawn(command, args, { cwd: process.cwd(), shell: false, windowsHide: true });
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ error, stdout, stderr, status: null, signal: null });
      });
      child.on("close", (status, signal) => {
        if (settled) return;
        settled = true;
        resolve({ error: null, stdout, stderr, status, signal });
      });
    } catch (error) {
      resolve({ error, stdout, stderr, status: null, signal: null });
    }
  });
}
function isBodyMethod(method) { return new Set(["POST", "PUT", "PATCH", "DELETE"]).has(String(method || "").toUpperCase()); }
async function runAgentcashFetch(url, method, body) {
  const args = ["agentcash@latest", "fetch", String(url), "--format", "json", "--max-amount", String(MAX_AMOUNT), ...(method === "GET" ? [] : ["-m", method])];
  if (isBodyMethod(method) && body && Object.keys(body).length) args.push("-b", JSON.stringify(body));
  if (process.platform === "win32") {
    let command = "npx agentcash@latest fetch " + String(url) + " --format json --max-amount " + String(MAX_AMOUNT);
    if (method !== "GET") command += " -m " + method;
    if (isBodyMethod(method) && body && Object.keys(body).length) {
      const bodyEscaped = JSON.stringify(body).replace(/"/g, '\\"');
      command += " -b " + bodyEscaped;
    }
    return runCommand("cmd.exe", ["/d", "/s", "/c", command]);
  }
  return runCommand(NPX_BIN, args);
}
function summarize(results) {
  return {
    total: results.length,
    succeeded: results.filter((r) => r.functionalOk).length,
    failed: results.filter((r) => !r.functionalOk).length,
    paid: results.filter((r) => r.paymentSuccess).length,
    expectedUsd: Number(results.reduce((sum, r) => sum + Number(r.expectedPriceUsd || 0), 0).toFixed(4)),
  };
}
function routePathFromUrl(url) { return new URL(url).pathname; }

async function main() {
  const targets = Array.isArray(previousSweep?.results) ? previousSweep.results.map((row) => ({
    routeKey: row.routeKey,
    url: row.url,
    method: row.method || String(row.routeKey).split(" ")[0],
    expectedPriceUsd: row.expectedPriceUsd || 0,
  })) : [];
  if (!targets.length) throw new Error("No prior core40 AgentCash sweep results found.");

  const allPasses = [];
  for (let pass = 1; pass <= PASSES; pass += 1) {
    const passStartedAt = nowIso();
    const results = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const routePath = routePathFromUrl(target.url);
      const requestBody = String(target.method).toUpperCase() === "POST" ? (POST_BODIES[routePath] || {}) : null;
      const row = {
        pass,
        index: index + 1,
        routeKey: target.routeKey,
        url: target.url,
        method: String(target.method).toUpperCase(),
        expectedPriceUsd: target.expectedPriceUsd,
        paymentSuccess: false,
        transactionHash: null,
        functionalOk: false,
        functionalReason: null,
        preview: null,
        error: null,
      };
      const run = await runAgentcashFetch(target.url, row.method, requestBody);
      if (run.error) {
        row.error = "spawn_error: " + String(run.error.message || run.error);
      } else {
        const combined = String(run.stdout || "") + "\n" + String(run.stderr || "");
        const jsonText = extractFirstJsonObject(combined);
        if (!jsonText) {
          row.error = "no_json_output: " + combined.slice(0, 300);
        } else {
          const parsed = parseJsonSafe(jsonText.replace(/^\uFEFF/, ""));
          if (!parsed) {
            row.error = "json_parse_error: " + jsonText.slice(0, 240);
          } else {
            const endpointPayload = parsed?.data;
            row.paymentSuccess = Boolean(parsed?.metadata?.payment?.success);
            row.transactionHash = parsed?.metadata?.payment?.transactionHash || null;
            const payloadForValidation = endpointPayload?.success === true && endpointPayload?.data !== undefined ? endpointPayload.data : endpointPayload;
            const validation = validateFunctional(target.routeKey, payloadForValidation);
            row.functionalOk = Boolean(parsed?.success) && Boolean(validation.ok);
            row.functionalReason = validation.reason;
            row.preview = truncate(endpointPayload || parsed);
            if (!row.functionalOk) row.error = truncate(parsed, 420);
          }
        }
      }
      results.push(row);
      process.stdout.write("pass " + pass + "/" + PASSES + " route " + (index + 1) + "/" + targets.length + " ok=" + row.functionalOk + " tx=" + (row.transactionHash || "-") + "\n");
      await sleep(REQUEST_DELAY_MS);
    }
    allPasses.push({ pass, startedAt: passStartedAt, finishedAt: nowIso(), summary: summarize(results), results });
  }

  const flatResults = allPasses.flatMap((pass) => pass.results);
  const report = {
    generatedAt: nowIso(),
    baseUrl: BASE_URL,
    passes: allPasses,
    summary: {
      passes: PASSES,
      routesPerPass: targets.length,
      totalCalls: flatResults.length,
      totalSucceeded: flatResults.filter((r) => r.functionalOk).length,
      totalFailed: flatResults.filter((r) => !r.functionalOk).length,
      totalPaid: flatResults.filter((r) => r.paymentSuccess).length,
      totalExpectedUsd: Number(flatResults.reduce((sum, r) => sum + Number(r.expectedPriceUsd || 0), 0).toFixed(4)),
    },
  };

  const outDir = path.join(process.cwd(), "ops-dashboard", "core40-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, "core40-agentcash-triple-" + stamp + ".json");
  const latestPath = path.join(outDir, "core40-agentcash-triple-latest.json");
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.summary.totalFailed === 0, fullPath, latestPath, summary: report.summary }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
