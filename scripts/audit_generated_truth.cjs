#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CATALOG_PATH = path.resolve(process.cwd(), "routes", "generated-catalog.json");

function classifyTruthTier(route) {
  const handlerId = String(route?.handlerId || "");
  const routePath = String(route?.routePath || "").toLowerCase();
  const sourceTier = String(route?.source?.truthTier || route?.truthTier || "").trim();
  if (sourceTier) {
    return sourceTier;
  }

  if (handlerId && handlerId !== "auto_local") {
    return handlerId === "random_joke" || handlerId === "random_quote"
      ? "synthetic_content"
      : "deterministic_local";
  }

  const deterministicPatterns = [
    "/convert/csv-to-json",
    "/convert/json-to-csv",
    "/convert/json-to-xml",
    "/convert/xml-to-json",
    "/convert/html-to-md",
    "/json/flatten",
    "/json/diff",
    "/json/validate",
    "/json/schema",
    "/decode/base64",
    "/uuid",
    "/password",
    "/hash",
    "/regex",
    "/url/validate",
    "/ip/validate",
    "/util/roman",
    "/util/luhn",
    "/util/fibonacci",
    "/edu/math",
  ];
  if (deterministicPatterns.some((pattern) => routePath.includes(pattern))) {
    return "deterministic_local";
  }

  const syntheticArtifactPatterns = [
    "/pdf/",
    "/docx/",
    "/xlsx/",
    "/invoice/",
    "/receipt/",
    "/contract/",
    "/certificate/",
    "/resume/",
    "/report/",
    "/label/",
    "/bizcard/",
    "/cover-letter/",
    "/meeting-minutes/",
    "/privacy-policy/",
    "/tos/",
    "/proposal/",
    "/ticket/",
    "/csv-to-pdf",
    "/html-to-pdf",
    "/markdown-to-pdf",
    "/image/",
    "/favicon/",
    "/signature/",
    "/colors/",
    "/chart/",
    "/placeholder/",
  ];
  if (syntheticArtifactPatterns.some((pattern) => routePath.includes(pattern))) {
    return "synthetic_artifact";
  }

  const syntheticContentPatterns = [
    "/seo/",
    "/links/",
    "/perf/",
    "/ssl/",
    "/robots/",
    "/headers/",
    "/tech/",
    "/cookies/",
    "/a11y/",
    "/edu/",
    "/hr/",
    "/productivity/",
    "/marketing/",
    "/lang/",
    "/misc/",
    "/random/",
  ];
  if (syntheticContentPatterns.some((pattern) => routePath.includes(pattern))) {
    return "synthetic_content";
  }

  return "generic_fallback";
}

function main() {
  const catalogPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_CATALOG_PATH;

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog not found: ${catalogPath}`);
  }

  const raw = fs.readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, "");
  const catalog = JSON.parse(raw);
  const routes = Array.isArray(catalog?.routes) ? catalog.routes : [];

  const summary = {
    catalogPath,
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    truthTierCounts: {},
    nonTruthyCount: 0,
  };

  const nonTruthy = [];
  for (const route of routes) {
    const truthTier = classifyTruthTier(route);
    summary.truthTierCounts[truthTier] = (summary.truthTierCounts[truthTier] || 0) + 1;

    if (truthTier !== "deterministic_local") {
      summary.nonTruthyCount += 1;
      nonTruthy.push({
        key: route?.key || null,
        truthTier,
        buildMode: route?.source?.buildMode || null,
        toolName: route?.source?.toolName || null,
      });
    }
  }

  const payload = {
    summary,
    nonTruthy: nonTruthy.slice(0, 500),
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
}
