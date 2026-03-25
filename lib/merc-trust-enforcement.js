"use strict";

const {
  createTrustClient,
  MercuryTrustValidationError,
} = require("./merc-trust-client");
const {
  DEFAULT_ALLOWED_DECISIONS,
  DEFAULT_ALLOWED_GUARANTEE_CODES,
  DEFAULT_ALLOWED_SERVICE_IDS,
  DEFAULT_RECEIPT_TYPE,
  DEFAULT_VERIFICATION_ENDPOINT,
  createTrustReceiptMiddleware,
} = require("./merc-trust-receipt-middleware");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const NULL_LIST_VALUES = new Set(["*", "any", "null", "none"]);
const DEFAULT_ENFORCED_PATH_PREFIXES = Object.freeze([
  "/api/business-days/next",
  "/api/holidays/today",
]);
const DEFAULT_REVIEW_ALLOWED_PATH_PREFIXES = Object.freeze([
  "/api/business-days/next",
  "/api/holidays/today",
]);
const DEFAULT_REVIEW_ALLOWED_DECISIONS = Object.freeze([
  ...DEFAULT_ALLOWED_DECISIONS,
  "review",
]);
const DEFAULT_REVIEW_ALLOWED_GUARANTEE_CODES = Object.freeze([
  ...DEFAULT_ALLOWED_GUARANTEE_CODES,
  "review-required",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toOptionalString(value, label) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new MercuryTrustValidationError(`${label} must be a string when provided.`, {
      label,
      receivedType: typeof value,
    });
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseBooleanLike(value, label) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = toOptionalString(value, label);
  if (!normalized) {
    throw new MercuryTrustValidationError(`${label} cannot be empty.`, { label });
  }
  const lowered = normalized.toLowerCase();
  if (TRUE_VALUES.has(lowered)) return true;
  if (FALSE_VALUES.has(lowered)) return false;
  throw new MercuryTrustValidationError(`${label} must be one of true/false/1/0/yes/no/on/off.`, {
    label,
    received: value,
  });
}

function resolveBooleanOption(overrideValue, envValue, label, fallback) {
  if (overrideValue !== undefined) {
    return parseBooleanLike(overrideValue, label);
  }
  if (envValue === undefined || envValue === null || String(envValue).trim() === "") {
    return fallback;
  }
  return parseBooleanLike(envValue, label);
}

function parsePositiveIntegerLike(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MercuryTrustValidationError(`${label} must be a positive integer when provided.`, {
      label,
      received: value,
    });
  }
  return parsed;
}

function resolveIntegerOption(overrideValue, envValue, label, fallback, allowNull = false) {
  if (overrideValue === null && allowNull) {
    return null;
  }
  if (overrideValue !== undefined) {
    const parsed = parsePositiveIntegerLike(overrideValue, label);
    return parsed === undefined ? fallback : parsed;
  }
  if (allowNull && typeof envValue === "string" && envValue.trim().toLowerCase() === "null") {
    return null;
  }
  const parsed = parsePositiveIntegerLike(envValue, label);
  return parsed === undefined ? fallback : parsed;
}

function parseStringArrayLike(value, label) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item, index) => toOptionalString(item, `${label}[${index}]`))
      .filter(Boolean);
    return normalized.length ? normalized : [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (NULL_LIST_VALUES.has(trimmed.toLowerCase())) {
      return null;
    }
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  throw new MercuryTrustValidationError(`${label} must be a comma-delimited string, array, null, or undefined.`, {
    label,
    receivedType: typeof value,
  });
}

function resolveArrayOption(overrideValue, envValue, label, fallback) {
  if (overrideValue !== undefined) {
    return parseStringArrayLike(overrideValue, label);
  }
  const parsed = parseStringArrayLike(envValue, label);
  return parsed === undefined ? fallback : parsed;
}

function removeUndefinedKeys(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function mergeUniqueStringArrays(primary, extras) {
  if (primary === null) {
    return null;
  }
  const merged = [];
  for (const value of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(extras) ? extras : [])]) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) continue;
    if (!merged.includes(normalized)) {
      merged.push(normalized);
    }
  }
  return merged;
}

function createPathPrefixMatcher(prefixes) {
  if (prefixes === null) {
    return null;
  }
  if (!Array.isArray(prefixes)) {
    throw new MercuryTrustValidationError(
      "enforcedPathPrefixes must be an array of prefixes or null.",
    );
  }
  const normalizedPrefixes = prefixes
    .map((item, index) => {
      const value = toOptionalString(item, `enforcedPathPrefixes[${index}]`);
      if (!value) return null;
      return value.startsWith("/") ? value : `/${value}`;
    })
    .filter(Boolean);

  if (!normalizedPrefixes.length) {
    return () => false;
  }

  return function isMercTrustEnforcedPath(pathValue) {
    const candidate = String(pathValue || "");
    return normalizedPrefixes.some((prefix) => candidate.startsWith(prefix));
  };
}

function createDefaultTelemetryHook(logger) {
  if (!logger || typeof logger !== "object") {
    return undefined;
  }
  const logWarn = typeof logger.warn === "function" ? logger.warn.bind(logger) : null;
  if (!logWarn) {
    return undefined;
  }
  return function defaultMercTrustOnResult(event, req) {
    if (!event || typeof event !== "object") {
      return;
    }
    const payload = {
      allowed: Boolean(event.allowed),
      reason: event.reason || null,
      statusCode: event.statusCode || null,
      serviceId: event.serviceId || null,
      mode: event.mode || null,
      receiptId: event.receiptId || null,
      method: req && req.method ? req.method : null,
      path: req && req.path ? req.path : null,
    };
    if (event.allowed === false) {
      logWarn("Merc-Trust enforcement rejected request:", JSON.stringify(payload));
      return;
    }
    if (event.reason === "fail-open-bypass") {
      logWarn("Merc-Trust enforcement fail-open bypass:", JSON.stringify(payload));
    }
  };
}

function createMercTrustEnforcementFromEnv(options = {}) {
  const normalizedOptions = options || {};
  if (!isPlainObject(normalizedOptions)) {
    throw new MercuryTrustValidationError(
      "createMercTrustEnforcementFromEnv options must be an object when provided.",
    );
  }

  const env = isPlainObject(normalizedOptions.env) ? normalizedOptions.env : process.env;
  const logger = normalizedOptions.logger ?? console;

  const enabled = resolveBooleanOption(
    normalizedOptions.enabled,
    env.MERC_TRUST_ENFORCEMENT_ENABLED,
    "MERC_TRUST_ENFORCEMENT_ENABLED",
    false,
  );
  if (!enabled) {
    return null;
  }

  const trustClient =
    normalizedOptions.trustClient ??
    createTrustClient(
      removeUndefinedKeys({
        baseUrl: toOptionalString(
          normalizedOptions.baseUrl ?? env.MERC_TRUST_BASE_URL,
          "MERC_TRUST_BASE_URL",
        ),
        timeoutMs: resolveIntegerOption(
          normalizedOptions.timeoutMs,
          env.MERC_TRUST_TIMEOUT_MS,
          "MERC_TRUST_TIMEOUT_MS",
          undefined,
        ),
        headers: normalizedOptions.clientHeaders,
      }),
    );

  const enforcedPathPrefixes = resolveArrayOption(
    normalizedOptions.enforcedPathPrefixes,
    env.MERC_TRUST_ENFORCED_PATH_PREFIXES,
    "MERC_TRUST_ENFORCED_PATH_PREFIXES",
    [...DEFAULT_ENFORCED_PATH_PREFIXES],
  );
  const shouldEnforcePath = createPathPrefixMatcher(enforcedPathPrefixes);
  const reviewAllowedPathPrefixes = resolveArrayOption(
    normalizedOptions.reviewAllowedPathPrefixes,
    env.MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES,
    "MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES",
    [...DEFAULT_REVIEW_ALLOWED_PATH_PREFIXES],
  );
  const shouldAllowReviewPath = createPathPrefixMatcher(reviewAllowedPathPrefixes);

  const middlewareOptions = {
    trustClient,
    attachProperty:
      toOptionalString(
        normalizedOptions.attachProperty ?? env.MERC_TRUST_ATTACH_PROPERTY,
        "MERC_TRUST_ATTACH_PROPERTY",
      ) || "mercTrust",
    failOpen: resolveBooleanOption(
      normalizedOptions.failOpen,
      env.MERC_TRUST_FAIL_OPEN,
      "MERC_TRUST_FAIL_OPEN",
      false,
    ),
    requireValidSignature: resolveBooleanOption(
      normalizedOptions.requireValidSignature,
      env.MERC_TRUST_REQUIRE_SIGNATURE,
      "MERC_TRUST_REQUIRE_SIGNATURE",
      true,
    ),
    requireCanonicalIdentityForIdentityMode: resolveBooleanOption(
      normalizedOptions.requireCanonicalIdentityForIdentityMode,
      env.MERC_TRUST_REQUIRE_CANONICAL_IDENTITY,
      "MERC_TRUST_REQUIRE_CANONICAL_IDENTITY",
      true,
    ),
    allowedServiceIds: resolveArrayOption(
      normalizedOptions.allowedServiceIds,
      env.MERC_TRUST_ALLOWED_SERVICE_IDS,
      "MERC_TRUST_ALLOWED_SERVICE_IDS",
      [...DEFAULT_ALLOWED_SERVICE_IDS],
    ),
    allowedModes: resolveArrayOption(
      normalizedOptions.allowedModes,
      env.MERC_TRUST_ALLOWED_MODES,
      "MERC_TRUST_ALLOWED_MODES",
      null,
    ),
    allowedDecisions: resolveArrayOption(
      normalizedOptions.allowedDecisions,
      env.MERC_TRUST_ALLOWED_DECISIONS,
      "MERC_TRUST_ALLOWED_DECISIONS",
      [...DEFAULT_ALLOWED_DECISIONS],
    ),
    allowedGuaranteeCodes: resolveArrayOption(
      normalizedOptions.allowedGuaranteeCodes,
      env.MERC_TRUST_ALLOWED_GUARANTEE_CODES,
      "MERC_TRUST_ALLOWED_GUARANTEE_CODES",
      [...DEFAULT_ALLOWED_GUARANTEE_CODES],
    ),
    requireReceiptType:
      normalizedOptions.requireReceiptType === false
        ? false
        : toOptionalString(
            normalizedOptions.requireReceiptType ?? env.MERC_TRUST_REQUIRE_RECEIPT_TYPE,
            "MERC_TRUST_REQUIRE_RECEIPT_TYPE",
          ) || DEFAULT_RECEIPT_TYPE,
    requireVerificationEndpointMatch: resolveBooleanOption(
      normalizedOptions.requireVerificationEndpointMatch,
      env.MERC_TRUST_REQUIRE_VERIFICATION_ENDPOINT_MATCH,
      "MERC_TRUST_REQUIRE_VERIFICATION_ENDPOINT_MATCH",
      true,
    ),
    expectedVerificationEndpoint:
      toOptionalString(
        normalizedOptions.expectedVerificationEndpoint ?? env.MERC_TRUST_EXPECTED_VERIFICATION_ENDPOINT,
        "MERC_TRUST_EXPECTED_VERIFICATION_ENDPOINT",
      ) || DEFAULT_VERIFICATION_ENDPOINT,
    requireReceiptExpiry: resolveBooleanOption(
      normalizedOptions.requireReceiptExpiry,
      env.MERC_TRUST_REQUIRE_RECEIPT_EXPIRY,
      "MERC_TRUST_REQUIRE_RECEIPT_EXPIRY",
      true,
    ),
    maxReceiptAgeMs: resolveIntegerOption(
      normalizedOptions.maxReceiptAgeMs,
      env.MERC_TRUST_MAX_RECEIPT_AGE_MS,
      "MERC_TRUST_MAX_RECEIPT_AGE_MS",
      null,
      true,
    ),
    enforceSubjectWalletMatch: resolveBooleanOption(
      normalizedOptions.enforceSubjectWalletMatch,
      env.MERC_TRUST_ENFORCE_SUBJECT_WALLET_MATCH,
      "MERC_TRUST_ENFORCE_SUBJECT_WALLET_MATCH",
      false,
    ),
    enforceTargetAgentIdMatch: resolveBooleanOption(
      normalizedOptions.enforceTargetAgentIdMatch,
      env.MERC_TRUST_ENFORCE_TARGET_AGENT_MATCH,
      "MERC_TRUST_ENFORCE_TARGET_AGENT_MATCH",
      false,
    ),
    singleUseReceipt: resolveBooleanOption(
      normalizedOptions.singleUseReceipt,
      env.MERC_TRUST_SINGLE_USE_RECEIPT,
      "MERC_TRUST_SINGLE_USE_RECEIPT",
      false,
    ),
    singleUseTtlMs: resolveIntegerOption(
      normalizedOptions.singleUseTtlMs,
      env.MERC_TRUST_SINGLE_USE_TTL_MS,
      "MERC_TRUST_SINGLE_USE_TTL_MS",
      undefined,
    ),
    onResult:
      typeof normalizedOptions.onResult === "function"
        ? normalizedOptions.onResult
        : createDefaultTelemetryHook(logger),
  };

  const reviewAllowedDecisions = resolveArrayOption(
    normalizedOptions.reviewAllowedDecisions,
    env.MERC_TRUST_REVIEW_ALLOWED_DECISIONS,
    "MERC_TRUST_REVIEW_ALLOWED_DECISIONS",
    mergeUniqueStringArrays(middlewareOptions.allowedDecisions, DEFAULT_REVIEW_ALLOWED_DECISIONS),
  );
  const reviewAllowedGuaranteeCodes = resolveArrayOption(
    normalizedOptions.reviewAllowedGuaranteeCodes,
    env.MERC_TRUST_REVIEW_ALLOWED_GUARANTEE_CODES,
    "MERC_TRUST_REVIEW_ALLOWED_GUARANTEE_CODES",
    mergeUniqueStringArrays(
      middlewareOptions.allowedGuaranteeCodes,
      DEFAULT_REVIEW_ALLOWED_GUARANTEE_CODES,
    ),
  );

  const strictMiddleware = createTrustReceiptMiddleware(middlewareOptions);
  const reviewMiddleware = createTrustReceiptMiddleware({
    ...middlewareOptions,
    allowedDecisions: reviewAllowedDecisions,
    allowedGuaranteeCodes: reviewAllowedGuaranteeCodes,
  });
  const middleware = function selectiveMercTrustMiddleware(req, res, next) {
    const requestPath = req && req.path ? req.path : "";
    if (shouldEnforcePath !== null && !shouldEnforcePath(requestPath)) {
      return next();
    }
    if (shouldAllowReviewPath && shouldAllowReviewPath(requestPath)) {
      return reviewMiddleware(req, res, next);
    }
    return strictMiddleware(req, res, next);
  };
  middleware.mercTrustEnforcement = Object.freeze({
    enabled: true,
    enforcedPathPrefixes,
    reviewAllowedPathPrefixes,
    attachProperty: middlewareOptions.attachProperty,
    failOpen: middlewareOptions.failOpen,
    requireValidSignature: middlewareOptions.requireValidSignature,
    requireCanonicalIdentityForIdentityMode:
      middlewareOptions.requireCanonicalIdentityForIdentityMode,
    allowedServiceIds: middlewareOptions.allowedServiceIds,
    allowedModes: middlewareOptions.allowedModes,
    allowedDecisions: middlewareOptions.allowedDecisions,
    allowedGuaranteeCodes: middlewareOptions.allowedGuaranteeCodes,
    reviewAllowedDecisions,
    reviewAllowedGuaranteeCodes,
    requireReceiptType: middlewareOptions.requireReceiptType,
    requireVerificationEndpointMatch: middlewareOptions.requireVerificationEndpointMatch,
    expectedVerificationEndpoint: middlewareOptions.expectedVerificationEndpoint,
    requireReceiptExpiry: middlewareOptions.requireReceiptExpiry,
    maxReceiptAgeMs: middlewareOptions.maxReceiptAgeMs,
    enforceSubjectWalletMatch: middlewareOptions.enforceSubjectWalletMatch,
    enforceTargetAgentIdMatch: middlewareOptions.enforceTargetAgentIdMatch,
    singleUseReceipt: middlewareOptions.singleUseReceipt,
    singleUseTtlMs: middlewareOptions.singleUseTtlMs ?? null,
  });

  return middleware;
}

module.exports = {
  createMercTrustEnforcementFromEnv,
};
