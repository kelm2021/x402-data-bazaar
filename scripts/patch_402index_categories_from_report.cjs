#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");

const DEFAULT_DOMAIN = "x402.aurelianflo.com";
const DEFAULT_CATEGORY = "tools/utilities";
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_DELAY_402_MS = 2500;
const RETRY_DELAY_DEFAULT_MS = 1200;
const BETWEEN_PATCHES_MS = 350;

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
  console.log(`Patch 402index categories from a report file.

Usage:
  node scripts/patch_402index_categories_from_report.cjs --report <path> [options]

Options:
  --report <path>              Report JSON with added_today rows.
  --domain <host>              Domain host. Default: ${DEFAULT_DOMAIN}
  --token <value>              402index verification token.
  --default-category <value>   Fallback category for uncategorized rows. Default: ${DEFAULT_CATEGORY}
  --limit <n>                  402index pagination limit. Default: ${DEFAULT_LIMIT}
  --max-attempts <n>           PATCH retry attempts. Default: ${DEFAULT_MAX_ATTEMPTS}
  --patch-log <path>           Patch output file path.
  --verify-log <path>          Verify output file path.
  --dry-run                    No PATCH calls; still computes patch plan + verify snapshot.
  --help                       Show help.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (_error) {
          parsed = null;
        }
        resolve({
          status: Number(res.statusCode || 0),
          headers: res.headers || {},
          body,
          json: parsed,
        });
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function fetchAllServices(domain, limit) {
  const services = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const url = `https://402index.io/api/v1/services?q=${encodeURIComponent(domain)}&limit=${encodeURIComponent(
      String(limit),
    )}&offset=${encodeURIComponent(String(offset))}`;
    const response = await requestJson(url, { method: "GET" });
    if (response.status < 200 || response.status >= 300 || !response.json) {
      throw new Error(
        `Failed to fetch 402index services (status ${response.status}) for offset ${offset}: ${String(
          response.body || "",
        ).slice(0, 300)}`,
      );
    }

    const batch = Array.isArray(response.json.services) ? response.json.services : [];
    total = Number(response.json.total || 0);
    services.push(...batch);
    offset += limit;
    if (!batch.length) {
      break;
    }
  }

  return services;
}

function normalizeCategory(raw, defaultCategory) {
  const value = String(raw || "").trim();
  if (!value) {
    return defaultCategory;
  }
  if (value.toLowerCase() === "uncategorized") {
    return defaultCategory;
  }
  return value;
}

function categoryEqual(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function parseReportItems(reportJson) {
  if (Array.isArray(reportJson?.added_today)) {
    return reportJson.added_today;
  }
  if (Array.isArray(reportJson?.rows)) {
    return reportJson.rows;
  }
  return [];
}

async function patchServiceCategory(serviceId, payload) {
  const body = JSON.stringify(payload);
  const url = `https://402index.io/api/v1/services/${encodeURIComponent(String(serviceId))}`;
  return requestJson(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const reportPath = args.report ? path.resolve(String(args.report)) : null;
  if (!reportPath) {
    throw new Error("Missing required --report argument.");
  }

  const domain = String(args.domain || DEFAULT_DOMAIN).trim();
  const token = String(
    args.token || process.env.INDEX402_VERIFICATION_TOKEN || process.env.INDEX402_VERIFICATION_HASH || "",
  ).trim();
  const defaultCategory = String(args.defaultCategory || DEFAULT_CATEGORY).trim();
  const limit = Number.parseInt(String(args.limit || DEFAULT_LIMIT), 10);
  const maxAttempts = Number.parseInt(String(args.maxAttempts || DEFAULT_MAX_ATTEMPTS), 10);
  const dryRun = Boolean(args.dryRun);

  if (!domain) {
    throw new Error("Domain is required.");
  }
  if (!defaultCategory) {
    throw new Error("Default category is required.");
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${args.limit}`);
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error(`Invalid --max-attempts value: ${args.maxAttempts}`);
  }
  if (!dryRun && !token) {
    throw new Error(
      "Missing verification token. Provide --token or INDEX402_VERIFICATION_TOKEN / INDEX402_VERIFICATION_HASH.",
    );
  }

  const reportRaw = await fs.readFile(reportPath, "utf8");
  const reportJson = JSON.parse(reportRaw);
  const reportItems = parseReportItems(reportJson);
  if (!reportItems.length) {
    throw new Error("Report did not contain any rows in added_today or rows.");
  }

  const reportDir = path.dirname(reportPath);
  const reportBaseName = path.basename(reportPath, path.extname(reportPath));
  const patchLogPath = path.resolve(
    String(args.patchLog || path.join(reportDir, `${reportBaseName}.category-patch-result.json`)),
  );
  const verifyLogPath = path.resolve(
    String(args.verifyLog || path.join(reportDir, `${reportBaseName}.category-verify.json`)),
  );

  const services = await fetchAllServices(domain, limit);
  const byUrl = new Map();
  for (const service of services) {
    const url = String(service?.url || "");
    if (!url) {
      continue;
    }
    if (!byUrl.has(url)) {
      byUrl.set(url, []);
    }
    byUrl.get(url).push(service);
  }

  const summary = {
    reportCount: reportItems.length,
    servicePool: services.length,
    matched: 0,
    patched: 0,
    noop: 0,
    missing: 0,
    failed: 0,
    dryRun,
  };
  const patchRows = [];

  for (const item of reportItems) {
    const url = String(item?.endpoint || item?.url || "").trim();
    if (!url) {
      summary.missing += 1;
      patchRows.push({ url: null, status: "missing_url" });
      continue;
    }

    const method = String(item?.method || "").toUpperCase();
    const candidates = byUrl.get(url) || [];
    if (!candidates.length) {
      summary.missing += 1;
      patchRows.push({ url, method: method || null, status: "missing" });
      continue;
    }

    const matchedService =
      candidates.find((service) => String(service?.method || "").toUpperCase() === method) || candidates[0];
    summary.matched += 1;

    const targetCategory = normalizeCategory(item?.category, defaultCategory);
    const currentCategory = String(matchedService?.category || "").trim() || "uncategorized";

    if (categoryEqual(currentCategory, targetCategory)) {
      summary.noop += 1;
      patchRows.push({
        url,
        id: matchedService.id,
        method: String(matchedService?.method || "").toUpperCase() || null,
        status: "noop",
        from: currentCategory,
        to: targetCategory,
      });
      continue;
    }

    if (dryRun) {
      summary.patched += 1;
      patchRows.push({
        url,
        id: matchedService.id,
        method: String(matchedService?.method || "").toUpperCase() || null,
        status: "dry-run-patch",
        from: currentCategory,
        to: targetCategory,
      });
      continue;
    }

    let patched = false;
    let lastResponse = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      lastResponse = await patchServiceCategory(matchedService.id, {
        domain,
        verification_token: token,
        category: targetCategory,
      });

      if (lastResponse.status >= 200 && lastResponse.status < 300) {
        patched = true;
        break;
      }

      const delay = lastResponse.status === 402 ? RETRY_DELAY_402_MS : RETRY_DELAY_DEFAULT_MS;
      await sleep(delay);
    }

    if (patched) {
      summary.patched += 1;
      patchRows.push({
        url,
        id: matchedService.id,
        method: String(matchedService?.method || "").toUpperCase() || null,
        status: "patched",
        from: currentCategory,
        to: targetCategory,
        httpStatus: Number(lastResponse?.status || 0),
      });
    } else {
      summary.failed += 1;
      patchRows.push({
        url,
        id: matchedService.id,
        method: String(matchedService?.method || "").toUpperCase() || null,
        status: "failed",
        from: currentCategory,
        to: targetCategory,
        httpStatus: Number(lastResponse?.status || 0) || null,
        error: String(lastResponse?.body || "").slice(0, 500),
      });
    }

    await sleep(BETWEEN_PATCHES_MS);
  }

  const patchLog = {
    generatedAt: new Date().toISOString(),
    domain,
    reportPath,
    summary,
    rows: patchRows,
  };
  await fs.mkdir(path.dirname(patchLogPath), { recursive: true });
  await fs.writeFile(patchLogPath, `${JSON.stringify(patchLog, null, 2)}\n`, "utf8");

  const verifyServices = await fetchAllServices(domain, limit);
  const verifyByUrl = new Map();
  for (const service of verifyServices) {
    verifyByUrl.set(String(service?.url || ""), service);
  }

  const verifyRows = [];
  let verifyMissing = 0;
  for (const item of reportItems) {
    const endpointUrl = String(item?.endpoint || item?.url || "").trim();
    const matched = verifyByUrl.get(endpointUrl);
    if (!matched) {
      verifyMissing += 1;
      verifyRows.push({ url: endpointUrl, missing: true });
      continue;
    }
    verifyRows.push({
      url: endpointUrl,
      id: matched.id,
      category: matched.category || null,
    });
  }

  const byCategory = {};
  let uncategorized = 0;
  for (const row of verifyRows) {
    if (row.missing) {
      continue;
    }
    const category = String(row.category || "uncategorized");
    if (category.toLowerCase() === "uncategorized") {
      uncategorized += 1;
    }
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  const verifyResult = {
    generatedAt: new Date().toISOString(),
    checked: reportItems.length,
    missing: verifyMissing,
    uncategorized,
    byCategory,
  };
  const verifyLog = { result: verifyResult, rows: verifyRows };
  await fs.writeFile(verifyLogPath, `${JSON.stringify(verifyLog, null, 2)}\n`, "utf8");

  const output = {
    patchLogPath,
    verifyLogPath,
    patchSummary: summary,
    verifySummary: verifyResult,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

