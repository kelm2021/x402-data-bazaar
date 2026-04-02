const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BASE_URL = "https://x402.aurelianflo.com";
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "self";
const MAX_AMOUNT_PER_REQUEST = 300000;

const generatedCatalog = require("../routes/generated-catalog.json");

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64Json(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch (_error) {
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

function routeTargetUrl(route) {
  const resourcePath = String(route.resourcePath || route.canonicalPath || route.routePath || "").trim();
  if (!resourcePath.startsWith("/")) {
    throw new Error(`Route ${route.key} has invalid resourcePath`);
  }
  return `${BASE_URL}${resourcePath}`;
}

function isBodyMethod(method) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function pickInputBody(route) {
  if (route.inputExample && typeof route.inputExample === "object") {
    return route.inputExample;
  }
  return {};
}

function toJsonSafe(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (typeof value === "object") {
    return value;
  }
  return null;
}

function isNonStubPayload(json) {
  if (!json || typeof json !== "object") {
    return false;
  }
  if (json.success !== true) {
    return false;
  }
  if (!json.data || typeof json.data !== "object") {
    return false;
  }
  return json.data.status !== "stub";
}

function summarize(results) {
  const summary = {
    total: results.length,
    ok2xx: 0,
    non2xx: 0,
    transportFailed: 0,
    nonStub2xx: 0,
    stub2xx: 0,
  };

  for (const row of results) {
    if (row.transportError) {
      summary.transportFailed += 1;
      continue;
    }
    if (row.status >= 200 && row.status < 300) {
      summary.ok2xx += 1;
      if (row.nonStub) {
        summary.nonStub2xx += 1;
      } else {
        summary.stub2xx += 1;
      }
    } else {
      summary.non2xx += 1;
    }
  }

  return summary;
}

(async () => {
  const allRoutes = Array.isArray(generatedCatalog.routes) ? generatedCatalog.routes : [];
  const autoLocalRoutes = allRoutes.filter((route) => route && route.handlerId === "auto_local");
  if (!autoLocalRoutes.length) {
    throw new Error("No auto_local routes found in routes/generated-catalog.json");
  }

  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const startedAt = nowIso();
  const results = [];

  for (let index = 0; index < autoLocalRoutes.length; index += 1) {
    const route = autoLocalRoutes[index];
    const method = String(route.method || "GET").toUpperCase();
    const targetUrl = routeTargetUrl(route);
    const row = {
      index: index + 1,
      ideaId: route.source?.ideaId || null,
      key: route.key,
      targetUrl,
      status: null,
      nonStub: false,
      paymentAuthorized: false,
      paymentResponse: null,
      responseSource: null,
      responsePreview: null,
      transportError: null,
      serverError: null,
    };

    try {
      const parsed = new URL(targetUrl);
      const payload = {
        baseURL: `${parsed.protocol}//${parsed.host}`,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          accept: "application/json",
          [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
        },
        maxAmountPerRequest: MAX_AMOUNT_PER_REQUEST,
      };

      if (isBodyMethod(method)) {
        payload.body = pickInputBody(route);
        payload.headers["content-type"] = "application/json";
      }

      const result = await sendIpcRequest("make-x402-request", payload);
      row.status = Number(result?.status || 0);
      const paymentResponseHeader =
        result?.headers?.["PAYMENT-RESPONSE"] || result?.headers?.["payment-response"];
      const paymentResponse = decodeBase64Json(paymentResponseHeader);
      row.paymentResponse = paymentResponse;
      row.paymentAuthorized = Boolean(paymentResponse?.success);

      const json = toJsonSafe(result?.data);
      row.nonStub = row.status >= 200 && row.status < 300 ? isNonStubPayload(json) : false;
      row.responseSource = json?.source || null;
      row.responsePreview = json ? JSON.stringify(json).slice(0, 400) : null;
      if (row.status < 200 || row.status >= 300) {
        row.serverError = result?.statusText || row.responsePreview || "non-2xx";
      }
    } catch (error) {
      row.transportError = error instanceof Error ? error.message : String(error);
    }

    results.push(row);
    await sleep(100);
  }

  const finishedAt = nowIso();
  const summary = summarize(results);
  const failures = results.filter((row) => row.transportError || row.status < 200 || row.status >= 300);
  const stub2xx = results.filter((row) => !row.transportError && row.status >= 200 && row.status < 300 && !row.nonStub);
  const sampleResponses = results
    .filter((row) => row.nonStub && row.responsePreview)
    .slice(0, 12)
    .map((row) => ({
      ideaId: row.ideaId,
      key: row.key,
      targetUrl: row.targetUrl,
      source: row.responseSource,
      responsePreview: row.responsePreview,
    }));

  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    autoLocalRouteCount: autoLocalRoutes.length,
    summary,
    failures,
    stub2xx,
    sampleResponses,
    results,
  };

  const outDir = path.join(process.cwd(), "tmp", "probe-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `probe-auto-local-prod-${stamp}.json`);
  const latestPath = path.join(outDir, "probe-auto-local-prod-latest.json");
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: BASE_URL,
        autoLocalRouteCount: autoLocalRoutes.length,
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
