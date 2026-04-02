#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { createMetricsStore } = require("../metrics");

const DEFAULT_ENV_FILE = ".env.remote.prod";
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_TOP = 100;

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
  console.log(`Report deprecated-path traffic from prod metrics.

Usage:
  node scripts/report_deprecated_path_callers.cjs [options]

Options:
  --env-file <path>      Env file containing KV_REST_API_URL and KV_REST_API_TOKEN.
                         Default: ${DEFAULT_ENV_FILE}
  --lookback-hours <n>   Only include routes seen in the last N hours. Default: ${DEFAULT_LOOKBACK_HOURS}
  --top <n>              Max rows in top list. Default: ${DEFAULT_TOP}
  --out <path>           Output report JSON path.
  --help                 Show help.
`);
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

function parseEnvText(text) {
  const output = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function isDeprecatedRoute(routePath, method) {
  const pathValue = normalizePathname(routePath).toLowerCase();
  const methodValue = String(method || "").trim().toUpperCase();
  if (!pathValue.startsWith("/api/")) {
    return { deprecated: false, reason: null };
  }
  if (pathValue.startsWith("/api/system/")) {
    return { deprecated: false, reason: null };
  }
  if (pathValue.startsWith("/api/data/")) {
    return { deprecated: false, reason: null };
  }
  if (pathValue.startsWith("/api/tools/")) {
    if (methodValue === "GET") {
      return { deprecated: true, reason: "legacy_get_on_tools_surface" };
    }
    return { deprecated: false, reason: null };
  }
  if (pathValue.startsWith("/api/do/")) {
    return { deprecated: true, reason: "legacy_do_surface" };
  }
  return { deprecated: true, reason: "legacy_unsurfaced_api_path" };
}

function suggestCanonicalPath(routePath, method) {
  const pathValue = normalizePathname(routePath);
  const methodValue = String(method || "").trim().toUpperCase();
  if (pathValue.startsWith("/api/do/")) {
    return `/api/tools/${pathValue.slice("/api/do/".length)}`;
  }
  if (pathValue.startsWith("/api/tools/") && methodValue === "GET") {
    return `/api/data/${pathValue.slice("/api/tools/".length)}`;
  }
  if (pathValue.startsWith("/api/")) {
    const remainder = pathValue.slice("/api/".length);
    if (!remainder) {
      return null;
    }
    if (methodValue === "POST") {
      return `/api/tools/${remainder}`;
    }
    if (methodValue === "GET" || methodValue === "HEAD") {
      return `/api/data/${remainder}`;
    }
  }
  return null;
}

function isSeenInLookback(lastSeenAt, cutoffMs) {
  if (!lastSeenAt) {
    return false;
  }
  const timestamp = Date.parse(lastSeenAt);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return timestamp >= cutoffMs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const envFile = path.resolve(String(args.envFile || DEFAULT_ENV_FILE));
  const lookbackHours = Number.parseInt(String(args.lookbackHours || DEFAULT_LOOKBACK_HOURS), 10);
  const topN = Number.parseInt(String(args.top || DEFAULT_TOP), 10);
  const outPath = path.resolve(
    String(
      args.out ||
        path.join(
          "tmp",
          "reports",
          `deprecated-path-caller-sweep-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        ),
    ),
  );

  if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
    throw new Error(`Invalid --lookback-hours value: ${args.lookbackHours}`);
  }
  if (!Number.isFinite(topN) || topN <= 0) {
    throw new Error(`Invalid --top value: ${args.top}`);
  }

  const envText = await fs.readFile(envFile, "utf8");
  const envValues = parseEnvText(envText);
  for (const [key, value] of Object.entries(envValues)) {
    process.env[key] = value;
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN in env file.");
  }

  const store = createMetricsStore({ routes: {}, env: process.env });
  const summary = await store.getSummary();
  const routes = Array.isArray(summary.routes) ? summary.routes : [];
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;

  const deprecatedRows = [];
  for (const route of routes) {
    const total = Number(route?.total || 0);
    if (!Number.isFinite(total) || total <= 0) {
      continue;
    }

    const routePath = normalizePathname(route?.routePath || "");
    const method = String(route?.method || "").trim().toUpperCase();
    const deprecated = isDeprecatedRoute(routePath, method);
    if (!deprecated.deprecated) {
      continue;
    }
    if (!isSeenInLookback(route?.lastSeenAt, cutoffMs)) {
      continue;
    }

    deprecatedRows.push({
      key: route?.key || `${method} ${routePath}`,
      method,
      routePath,
      reason: deprecated.reason,
      suggestedCanonicalPath: suggestCanonicalPath(routePath, method),
      category: route?.category || null,
      total: total,
      paymentRequired: Number(route?.paymentRequired || 0),
      paidSuccess: Number(route?.paidSuccess || 0),
      serverErrors: Number(route?.serverErrors || 0),
      lastSeenAt: route?.lastSeenAt || null,
      lastStatus: route?.lastStatus ?? null,
    });
  }

  deprecatedRows.sort((left, right) => {
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    return String(left.key || "").localeCompare(String(right.key || ""));
  });

  const topRows = deprecatedRows.slice(0, topN);
  const totalRequests = deprecatedRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalPaidSuccess = deprecatedRows.reduce((sum, row) => sum + Number(row.paidSuccess || 0), 0);
  const total402 = deprecatedRows.reduce((sum, row) => sum + Number(row.paymentRequired || 0), 0);
  const total5xx = deprecatedRows.reduce((sum, row) => sum + Number(row.serverErrors || 0), 0);
  const byReason = {};
  for (const row of deprecatedRows) {
    byReason[row.reason] = (byReason[row.reason] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    cutoffIso: new Date(cutoffMs).toISOString(),
    totals: {
      deprecatedRoutesSeen: deprecatedRows.length,
      deprecatedRequests: totalRequests,
      paymentRequired402: total402,
      paidSuccess: totalPaidSuccess,
      serverErrors5xx: total5xx,
      byReason,
      callerAttributionAvailable: false,
      callerAttributionNote:
        "Current metrics snapshot has no per-source caller rows; report is route-level until source attribution is enabled.",
    },
    topRows,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        totals: report.totals,
        topCount: topRows.length,
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

