#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const BASE_URL = String(process.env.BASE_URL || "https://x402.aurelianflo.com").replace(/\/$/, "");
const DEXTER_API = String(process.env.DEXTER_API || "https://api.dexter.cash").replace(/\/$/, "");
const SEARCH_QUERY = String(process.env.DEXTER_SEARCH_QUERY || "aurelianflo");
const REPORT_DIR = path.join(process.cwd(), "ops-dashboard", "dexter-reports");

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, status: res.status, ok: res.ok, text, json };
}

function toResourceId(payTo, resourceUrl) {
  return Buffer.from(`${payTo}:${resourceUrl}`, "utf8").toString("base64");
}

function classifyPath(url) {
  try {
    const pathname = new URL(url).pathname || "";
    if (pathname.startsWith("/api/do/")) return "do";
    if (pathname.startsWith("/api/tools/")) return "tools";
    if (pathname.startsWith("/api/data/")) return "data";
    if (pathname.startsWith("/api/sim/")) return "sim";
    return "other";
  } catch {
    return "other";
  }
}

async function loadDexterListings() {
  const url = `${DEXTER_API}/api/facilitator/marketplace/resources?search=${encodeURIComponent(SEARCH_QUERY)}&limit=500&offset=0`;
  const result = await fetchJson(url);
  if (!result.ok || !result.json || !Array.isArray(result.json.resources)) {
    throw new Error(`Failed to load Dexter listings (${result.status})`);
  }
  return result.json.resources.filter((row) => typeof row?.resourceUrl === "string" && row.resourceUrl.startsWith(`${BASE_URL}/`));
}

function summarizeListings(rows) {
  const byPrefix = { do: 0, tools: 0, data: 0, sim: 0, other: 0 };
  let inconclusive = 0;
  let verified = 0;
  let failed = 0;
  let nullQuality = 0;
  for (const row of rows) {
    byPrefix[classifyPath(row.resourceUrl)] += 1;
    if (row.verificationStatus === "inconclusive") inconclusive += 1;
    if (row.verificationStatus === "verified" || row.verificationStatus === "pass") verified += 1;
    if (row.verificationStatus === "failed" || row.verificationStatus === "fail") failed += 1;
    if (row.qualityScore === null || row.qualityScore === undefined) nullQuality += 1;
  }
  return {
    total: rows.length,
    byPrefix,
    inconclusive,
    verified,
    failed,
    nullQuality,
  };
}

function normalizePathTemplate(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/api/")) return null;
  let out = pathname;
  if (out.endsWith("/*")) out = out.slice(0, -2);
  out = out.replace(/\*+$/g, "");
  if (out.length > 5 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function buildCoreTargets(coreCatalog, existingListingUrls) {
  const targets = [];
  for (const entry of coreCatalog) {
    const payTo = entry?.payment?.payTo || null;
    if (!payTo) continue;
    const candidatePaths = [];
    if (entry?.canonicalPath) candidatePaths.push(entry.canonicalPath);
    if (entry?.path) candidatePaths.push(entry.path);
    if (Array.isArray(entry?.legacyPaths)) candidatePaths.push(...entry.legacyPaths);

    const candidateUrls = candidatePaths
      .map(normalizePathTemplate)
      .filter(Boolean)
      .map((p) => `${BASE_URL}${p}`);

    if (candidateUrls.length === 0) continue;
    const resourceUrl = candidateUrls.find((url) => existingListingUrls.has(url)) || candidateUrls[0];
    const routePathForLabel = normalizePathTemplate(entry?.canonicalPath) || normalizePathTemplate(entry?.path) || "unknown";
    targets.push({
      routeKey: entry?.routeKey || `${entry?.method || "GET"} ${routePathForLabel}`,
      payTo,
      resourceUrl,
    });
  }
  return targets;
}

async function run() {
  const startedAt = new Date().toISOString();
  console.log(`[dexter] start ${startedAt}`);
  console.log(`[dexter] base=${BASE_URL}`);

  const coreDiscovery = await fetchJson(`${BASE_URL}/api/system/discovery/core?limit=500`);
  if (!coreDiscovery.ok || !coreDiscovery.json || !Array.isArray(coreDiscovery.json.catalog)) {
    throw new Error(`Failed to load core discovery (${coreDiscovery.status})`);
  }
  const coreCatalog = coreDiscovery.json.catalog;

  const beforeListings = await loadDexterListings();
  const beforeSummary = summarizeListings(beforeListings);
  const beforeByUrl = new Map(beforeListings.map((row) => [row.resourceUrl, row]));
  const targets = buildCoreTargets(coreCatalog, new Set(beforeByUrl.keys()));
  console.log(`[dexter] core targets=${targets.length}`);
  const coreFoundBefore = targets.filter((t) => beforeByUrl.has(t.resourceUrl)).length;

  const verifyResults = [];
  for (const target of targets) {
    const resourceId = toResourceId(target.payTo, target.resourceUrl);
    const verifyUrl = `${DEXTER_API}/api/facilitator/marketplace/resources/${encodeURIComponent(resourceId)}/verify`;
    try {
      const verify = await fetchJson(verifyUrl, { method: "POST" });
      verifyResults.push({
        routeKey: target.routeKey,
        resourceUrl: target.resourceUrl,
        status: verify.status,
        ok: verify.ok,
        response: verify.json || verify.text || null,
      });
    } catch (error) {
      verifyResults.push({
        routeKey: target.routeKey,
        resourceUrl: target.resourceUrl,
        status: null,
        ok: false,
        response: { error: error?.message || String(error) },
      });
    }
  }

  const hideProbe = await fetchJson(`${DEXTER_API}/api/facilitator/me/resources`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceUrl: `${BASE_URL}/api/tools/contract/generate`, isPublic: false }),
  });

  const afterListings = await loadDexterListings();
  const afterSummary = summarizeListings(afterListings);
  const afterByUrl = new Map(afterListings.map((row) => [row.resourceUrl, row]));
  const coreFoundAfter = targets.filter((t) => afterByUrl.has(t.resourceUrl)).length;

  const coreStatusesAfter = targets.map((target) => {
    const row = afterByUrl.get(target.resourceUrl);
    return {
      routeKey: target.routeKey,
      resourceUrl: target.resourceUrl,
      listed: Boolean(row),
      verificationStatus: row?.verificationStatus || null,
      qualityScore: row?.qualityScore ?? null,
      verificationNotes: row?.verificationNotes || null,
      marketplaceScore: row?.marketplaceScore ?? null,
    };
  });

  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    dexterApi: DEXTER_API,
    coreTargetCount: targets.length,
    dexterBefore: {
      summary: beforeSummary,
      coreFound: coreFoundBefore,
    },
    dexterAfter: {
      summary: afterSummary,
      coreFound: coreFoundAfter,
    },
    actions: {
      reverifyAttempted: verifyResults.length,
      reverify200: verifyResults.filter((r) => r.status === 200).length,
      reverifyNotFound: verifyResults.filter((r) => r.status === 404).length,
      reverifyErrors: verifyResults.filter((r) => !r.ok).length,
      hideProbe: {
        status: hideProbe.status,
        ok: hideProbe.ok,
        response: hideProbe.json || hideProbe.text || null,
      },
    },
    verifyResults,
    coreStatusesAfter,
    notes: [
      "Dexter hide/unlist endpoint requires authenticated seller session.",
      "Public verify endpoint is callable without auth, but does not force a pass.",
    ],
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(REPORT_DIR, `dexter-reverify-core-${stamp}.json`);
  const latestPath = path.join(REPORT_DIR, "dexter-reverify-core-latest.json");
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[dexter] report ${outPath}`);
  console.log(
    `[dexter] before do=${beforeSummary.byPrefix.do} after do=${afterSummary.byPrefix.do} | reverify200=${report.actions.reverify200}/${report.actions.reverifyAttempted}`,
  );
}

run().catch((error) => {
  console.error(`[dexter] failed: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});
