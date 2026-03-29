const {
  runSimulation,
  runCompare,
  runSensitivity,
  runForecast,
  runComposed,
  runOptimize,
} = require("../sim/engine");
const { parseSimCount, parseSimParams } = require("../lib/sim-params");

const PATH_HANDLERS = {
  "/api/sim/probability": {
    parse: parseSimParams,
    execute: ({ numSims, scenario }) => runSimulation(numSims, scenario),
  },
  "/api/sim/compare": {
    execute: ({ numSims, body }) => runCompare(numSims, body),
  },
  "/api/sim/sensitivity": {
    execute: ({ numSims, body }) => runSensitivity(numSims, body),
  },
  "/api/sim/forecast": {
    execute: ({ numSims, body }) => runForecast(numSims, body),
  },
  "/api/sim/composed": {
    execute: ({ numSims, body }) => runComposed(numSims, body),
  },
  "/api/sim/optimize": {
    execute: ({ numSims, body }) => runOptimize(numSims, body),
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    return "";
  }

  if (path === "/") {
    return path;
  }

  return path.replace(/\/+$/, "");
}

function getBodyWithoutSims(req) {
  if (!isPlainObject(req.body)) {
    return {};
  }

  const { sims: _ignoredSims, ...rest } = req.body;
  return rest;
}

function normalizeErrorPayload(result) {
  if (!result || typeof result !== "object") {
    return {
      error: "invalid_response",
      message: "simulation engine returned an invalid response",
    };
  }

  if (typeof result.error === "string") {
    return {
      error: result.error,
      message: result.message || "request validation failed",
      ...(result.details !== undefined ? { details: result.details } : {}),
    };
  }

  if (result.error && typeof result.error === "object") {
    return result.error;
  }

  return {
    error: "invalid_response",
    message: "simulation engine returned an invalid response",
  };
}

function statusForError(errorCode) {
  if (errorCode === "unsupported_endpoint") {
    return 404;
  }

  if (typeof errorCode === "string" && errorCode.startsWith("invalid_")) {
    return 400;
  }

  return 422;
}

async function primaryHandler(req, res) {
  const path = normalizePath(req.path);
  const route = PATH_HANDLERS[path];

  if (!route) {
    return res.status(404).json({
      error: "unsupported_endpoint",
      message: `No simulator endpoint is registered for path ${path || "(empty)"}`,
      details: {
        supported_paths: Object.keys(PATH_HANDLERS),
      },
    });
  }

  if (route.parse) {
    const parsed = route.parse(req);
    if (parsed.error) {
      return res.status(400).json(parsed.error);
    }

    const result = route.execute(parsed);
    if (result?.error) {
      const normalizedError = normalizeErrorPayload(result);
      return res.status(statusForError(normalizedError.error)).json(normalizedError);
    }

    return res.json(result);
  }

  const simCountResult = parseSimCount(req);
  if (simCountResult.error) {
    return res.status(400).json(simCountResult.error);
  }

  const result = route.execute({
    numSims: simCountResult.value,
    body: getBodyWithoutSims(req),
  });

  if (result?.error) {
    const normalizedError = normalizeErrorPayload(result);
    return res.status(statusForError(normalizedError.error)).json(normalizedError);
  }

  return res.json(result);
}

module.exports = primaryHandler;
