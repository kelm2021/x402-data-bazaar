const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BASE_URL = "https://x402.aurelianflo.com";
const generatedCatalog = require("../routes/generated-catalog.json");

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBodyMethod(method) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function summarize(results) {
  const summary = {
    total: results.length,
    success: 0,
    failed: 0,
    nonStubSuccess: 0,
    stubSuccess: 0,
    estimatedSpendUsd: 0,
  };

  for (const row of results) {
    if (!row.ok) {
      summary.failed += 1;
      continue;
    }
    summary.success += 1;
    if (row.nonStub) {
      summary.nonStubSuccess += 1;
    } else {
      summary.stubSuccess += 1;
    }
    summary.estimatedSpendUsd += Number(row.priceUsd || 0);
  }

  summary.estimatedSpendUsd = Number(summary.estimatedSpendUsd.toFixed(4));
  return summary;
}

function runAgentcashFetch(url, method, body) {
  const args = ["agentcash@latest", "fetch", url, "--format", "json", "--max-amount", "0.5"];
  if (method && method !== "GET") {
    args.push("-m", method);
  }
  if (body && isBodyMethod(method)) {
    args.push("-b", JSON.stringify(body));
  }

  return spawnSync("npx", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: true,
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const start = Math.max(1, Number.parseInt(String(args.start || "1"), 10) || 1);
  const max = args.max ? Math.max(1, Number.parseInt(String(args.max), 10) || 0) : null;

  const autoLocalRoutes = (Array.isArray(generatedCatalog.routes) ? generatedCatalog.routes : [])
    .filter((route) => route && route.handlerId === "auto_local")
    .sort((a, b) => (a.source?.ideaId || 0) - (b.source?.ideaId || 0));

  const selected = autoLocalRoutes.slice(start - 1, max ? start - 1 + max : undefined);
  if (!selected.length) {
    throw new Error("No auto_local routes selected for probing.");
  }

  const startedAt = nowIso();
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const route = selected[index];
    const method = String(route.method || "GET").toUpperCase();
    const resourcePath = String(route.resourcePath || route.canonicalPath || route.routePath || "").trim();
    const url = `${BASE_URL}${resourcePath}`;
    const body = isBodyMethod(method)
      ? route.inputExample && typeof route.inputExample === "object"
        ? route.inputExample
        : {}
      : null;

    const row = {
      index: index + 1,
      ideaId: route.source?.ideaId || null,
      key: route.key,
      url,
      method,
      ok: false,
      nonStub: false,
      priceUsd: null,
      source: null,
      responsePreview: null,
      error: null,
    };

    const result = runAgentcashFetch(url, method, body);
    if (result.error) {
      row.error = `spawn_error: ${String(result.error.message || result.error)}`.slice(0, 600);
      results.push(row);
      await sleep(75);
      continue;
    }

    if (result.status !== 0) {
      row.error = String(result.stderr || result.stdout || `exit ${result.status}`).slice(0, 600);
      results.push(row);
      await sleep(75);
      continue;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(String(result.stdout || "{}"));
    } catch (_error) {
      row.error = `Invalid JSON response: ${String(result.stdout || "").slice(0, 240)}`;
      results.push(row);
      await sleep(75);
      continue;
    }

    const endpointPayload = parsed?.data;
    row.ok = Boolean(parsed?.success && endpointPayload?.success);
    row.nonStub = row.ok && endpointPayload?.data?.status !== "stub";
    row.source = endpointPayload?.source || null;
    row.priceUsd = Number.parseFloat(String(parsed?.metadata?.price || "").replace(/[^0-9.]/g, "")) || null;
    row.responsePreview = endpointPayload ? JSON.stringify(endpointPayload).slice(0, 420) : null;
    if (!row.ok) {
      row.error = JSON.stringify(parsed).slice(0, 500);
    }
    results.push(row);

    await sleep(75);
  }

  const finishedAt = nowIso();
  const summary = summarize(results);
  const failures = results.filter((row) => !row.ok);
  const sampleResponses = results
    .filter((row) => row.nonStub && row.responsePreview)
    .slice(0, 15)
    .map((row) => ({
      ideaId: row.ideaId,
      key: row.key,
      url: row.url,
      source: row.source,
      responsePreview: row.responsePreview,
    }));

  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    selectedCount: selected.length,
    offsetStart: start,
    summary,
    failures,
    sampleResponses,
    results,
  };

  const outDir = path.join(process.cwd(), "tmp", "probe-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `probe-auto-local-prod-agentcash-${stamp}.json`);
  const latestPath = path.join(outDir, "probe-auto-local-prod-agentcash-latest.json");
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: BASE_URL,
        selectedCount: selected.length,
        summary,
        fullPath,
        latestPath,
        sampleResponses,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
