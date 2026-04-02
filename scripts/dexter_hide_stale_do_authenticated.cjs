#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const DEXTER_API = String(process.env.DEXTER_API || "https://api.dexter.cash").replace(/\/$/, "");
const COOKIE = String(process.env.DEXTER_COOKIE || "").trim();
const INPUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), "ops-dashboard", "dexter-reports", "dexter-stale-do-urls-latest.json");

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  if (!COOKIE) {
    throw new Error("Missing DEXTER_COOKIE env var.");
  }
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (rows.length === 0) {
    throw new Error(`No rows in ${INPUT_PATH}`);
  }

  const results = [];
  for (const row of rows) {
    const resourceUrl = row?.resourceUrl;
    if (!resourceUrl) continue;
    const res = await fetchJson(`${DEXTER_API}/api/facilitator/me/resources`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: COOKIE,
      },
      body: JSON.stringify({ resourceUrl, isPublic: false }),
    });
    results.push({
      resourceUrl,
      status: res.status,
      ok: res.ok,
      response: res.json || res.text || null,
    });
  }

  const summary = {
    attempted: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath: INPUT_PATH,
    summary,
    results,
  };

  const outDir = path.join(process.cwd(), "ops-dashboard", "dexter-reports");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `dexter-hide-stale-do-${stamp}.json`);
  const latestPath = path.join(outDir, "dexter-hide-stale-do-latest.json");
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ summary, outPath }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
