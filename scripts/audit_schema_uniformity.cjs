#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createApiDiscoveryHandler, createOpenApiHandler, routeConfig } = require("../app");

function hasSchemaShape(schema) {
  if (!schema || typeof schema !== "object") return false;
  if (typeof schema.$ref === "string" && schema.$ref.trim()) return true;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return true;
  if (Array.isArray(schema.allOf) && schema.allOf.length) return true;
  if (schema.type === "array" && schema.items) return true;
  if (schema.type === "object") {
    const propCount =
      schema.properties && typeof schema.properties === "object"
        ? Object.keys(schema.properties).length
        : 0;
    if (propCount > 0) return true;
    if (schema.additionalProperties === true) return true;
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") return true;
    return false;
  }
  if (schema.properties && typeof schema.properties === "object" && Object.keys(schema.properties).length > 0) {
    return true;
  }
  return typeof schema.type === "string";
}

function toOpenApiTemplate(pathname) {
  let wildcardIndex = 0;
  return String(pathname || "").replace(/\*/g, () => `{param${++wildcardIndex}}`);
}

function invokeDiscoveryDoc() {
  const handler = createApiDiscoveryHandler(routeConfig, { env: process.env });
  let payload = null;
  handler(
    {
      protocol: "https",
      query: {},
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "host") return "x402.aurelianflo.com";
        return undefined;
      },
    },
    {
      json(value) {
        payload = value;
      },
    },
  );
  return payload;
}

function invokeOpenApiDoc() {
  const handler = createOpenApiHandler(routeConfig, { env: process.env });
  let payload = null;
  handler({}, { json: (value) => { payload = value; } });
  return payload;
}

function auditUniformity(discovery, openapi) {
  const catalog = Array.isArray(discovery?.catalog) ? discovery.catalog : [];
  const issues = [];
  const requiredTopLevel = [
    "method",
    "path",
    "canonicalPath",
    "surface",
    "routeKey",
    "request",
    "response",
  ];

  let writeOps = 0;
  let readOps = 0;
  let openApiOps = 0;
  for (const methods of Object.values(openapi?.paths || {})) {
    if (!methods || typeof methods !== "object") continue;
    for (const key of Object.keys(methods)) {
      if (["get", "post", "put", "patch", "delete", "head"].includes(key)) {
        openApiOps += 1;
      }
    }
  }

  for (const entry of catalog) {
    const method = String(entry?.method || "").toUpperCase();
    const pathValue = String(entry?.path || "");
    const routeKey = String(entry?.routeKey || `${method} ${pathValue}`);
    const isWrite = method === "POST" || method === "PUT" || method === "PATCH";
    if (isWrite) writeOps += 1;
    else readOps += 1;

    for (const key of requiredTopLevel) {
      if (entry?.[key] === undefined || entry?.[key] === null || entry?.[key] === "") {
        issues.push({ routeKey, type: "missing_field", field: key });
      }
    }

    const request = entry?.request || {};
    const requestSchema = request?.schema;
    const requestExample = request?.example;
    if (!hasSchemaShape(requestSchema)) {
      issues.push({ routeKey, type: "invalid_request_schema" });
    }
    if (requestExample && typeof requestExample === "object") {
      if (!requestExample.type) {
        issues.push({ routeKey, type: "request_example_missing_type" });
      }
      if (isWrite && requestExample.body === undefined) {
        issues.push({ routeKey, type: "write_example_missing_body" });
      }
    } else {
      issues.push({ routeKey, type: "missing_request_example" });
    }

    const response = entry?.response || {};
    if (!hasSchemaShape(response?.schema)) {
      issues.push({ routeKey, type: "invalid_response_schema" });
    }
    if (!response?.example || typeof response.example !== "object") {
      issues.push({ routeKey, type: "missing_response_example" });
    }

    const template = toOpenApiTemplate(pathValue);
    const openApiOp = openapi?.paths?.[template]?.[String(method).toLowerCase()];
    if (!openApiOp) {
      issues.push({ routeKey, type: "missing_openapi_operation", template });
      continue;
    }

    if (!openApiOp.summary && !openApiOp.description) {
      issues.push({ routeKey, type: "missing_openapi_summary_or_description" });
    }

    if (isWrite) {
      const bodySchema = openApiOp?.requestBody?.content?.["application/json"]?.schema;
      if (!hasSchemaShape(bodySchema)) {
        issues.push({ routeKey, type: "invalid_openapi_request_body_schema" });
      }
    } else {
      if (openApiOp?.requestBody) {
        issues.push({ routeKey, type: "unexpected_openapi_request_body_on_read" });
      }
    }
  }

  const issueCounts = {};
  for (const issue of issues) {
    issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    endpointCount: catalog.length,
    openApiOperationCount: openApiOps,
    writeOps,
    readOps,
    issueCount: issues.length,
    issueCounts,
    issues,
  };
}

function main() {
  const discovery = invokeDiscoveryDoc();
  const openapi = invokeOpenApiDoc();
  const report = auditUniformity(discovery, openapi);

  const outDir = path.join(process.cwd(), "tmp", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `schema-uniformity-audit-${stamp}.json`);
  const latestPath = path.join(outDir, "schema-uniformity-audit-latest.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        latestPath,
        endpointCount: report.endpointCount,
        openApiOperationCount: report.openApiOperationCount,
        issueCount: report.issueCount,
        issueCounts: report.issueCounts,
      },
      null,
      2,
    ),
  );
}

main();
