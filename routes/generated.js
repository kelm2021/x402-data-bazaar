const { Router } = require("express");
const catalog = require("./generated-catalog.json");
const {
  QUICK_WIN_HANDLER_IDS,
  QUICK_WIN_HANDLERS,
} = require("./generated-quickwins");
const { buildAutoLocalPayload } = require("./generated-auto-local");

const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const CANONICAL_GENERATED_NAMESPACE = "/api/tools";

function normalizeGeneratedNamespacePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }
  return raw.replace(/^\/api\/do(?=\/|$)/i, CANONICAL_GENERATED_NAMESPACE);
}

function wildcardToExpress(pathname) {
  let wildcardIndex = 0;
  return normalizeGeneratedNamespacePath(pathname).replace(/\*/g, () => `:value${++wildcardIndex}`);
}

function deriveRouteParts(entry = {}) {
  const key = String(entry.key || "").trim();
  const keyParts = key.split(/\s+/);
  const keyMethod = keyParts.length >= 2 ? keyParts[0].toUpperCase() : null;
  const keyPath = keyParts.length >= 2 ? key.slice(key.indexOf(" ") + 1).trim() : null;
  const method = String(entry.method || keyMethod || "GET").toUpperCase();
  const configuredPath = normalizeGeneratedNamespacePath(
    entry.expressPath || keyPath || entry.routePath || "",
  );
  const expressPath = wildcardToExpress(configuredPath);

  return {
    method,
    expressPath,
    key,
  };
}

function getQuickWinHandler(entry, routeParts) {
  if (entry && entry.handlerId && QUICK_WIN_HANDLER_IDS[entry.handlerId]) {
    return QUICK_WIN_HANDLERS[QUICK_WIN_HANDLER_IDS[entry.handlerId]];
  }
  if (entry && entry.key) {
    if (QUICK_WIN_HANDLERS[entry.key]) {
      return QUICK_WIN_HANDLERS[entry.key];
    }
    const normalizedKey = String(entry.key).replace(
      /^([A-Z]+)\s+\/api\/do(?=\/|$)/i,
      `$1 ${CANONICAL_GENERATED_NAMESPACE}`,
    );
    if (QUICK_WIN_HANDLERS[normalizedKey]) {
      return QUICK_WIN_HANDLERS[normalizedKey];
    }
  }

  const fallbackKey = `${routeParts.method} ${normalizeGeneratedNamespacePath(entry.routePath || routeParts.expressPath || "")}`;
  return QUICK_WIN_HANDLERS[fallbackKey] || null;
}

function buildStubPayload(entry, req) {
  if (entry.outputExample && typeof entry.outputExample === "object") {
    return entry.outputExample;
  }

  return {
    success: true,
    data: {
      status: "stub",
      routeKey: entry.key || `${req.method} ${req.path}`,
      message: "Generated endpoint stub. Replace with provider-backed logic.",
      request: {
        params: req.params || {},
        query: req.query || {},
        body: req.body || null,
      },
    },
    source: "x402-generated-catalog",
  };
}

function createGeneratedHandler(entry, routeParts) {
  const quickWinHandler = getQuickWinHandler(entry, routeParts);
  return async function generatedHandler(req, res) {
    try {
      let payload = null;
      if (quickWinHandler) {
        payload = await quickWinHandler(req, entry);
      } else if (entry && entry.handlerId === "auto_local") {
        payload = await buildAutoLocalPayload(entry, req);
      } else {
        payload = buildStubPayload(entry, req);
      }
      if (payload && payload.success === false) {
        const statusCode = String(payload.error || "").startsWith("invalid_") ? 400 : 422;
        return res.status(statusCode).json(payload);
      }
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Generated endpoint handler failed",
        details: error.message || String(error),
      });
    }
  };
}

function getCatalogRoutes() {
  return Array.isArray(catalog?.routes) ? catalog.routes : [];
}

const router = Router();

for (const routeEntry of getCatalogRoutes()) {
  const routeParts = deriveRouteParts(routeEntry);
  const { method, expressPath } = routeParts;
  if (!SUPPORTED_METHODS.has(method)) {
    continue;
  }
  if (!expressPath || !expressPath.startsWith("/")) {
    continue;
  }

  const methodName = method.toLowerCase();
  if (typeof router[methodName] !== "function") {
    continue;
  }

  router[methodName](expressPath, createGeneratedHandler(routeEntry, routeParts));
}

router.deriveRouteParts = deriveRouteParts;
router.buildStubPayload = buildStubPayload;
router.getQuickWinHandler = getQuickWinHandler;
router.getCatalogRoutes = getCatalogRoutes;
router.quickWinHandlers = QUICK_WIN_HANDLERS;
router.quickWinHandlerIds = QUICK_WIN_HANDLER_IDS;

module.exports = router;
