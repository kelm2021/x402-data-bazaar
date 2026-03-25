
"use strict";

const {
  createTrustClient,
  MercuryTrustValidationError,
} = require("./merc-trust-client");

const DEFAULT_ALLOWED_SERVICE_IDS = Object.freeze([
  "trust-evaluate",
  "trust-delegation-verify",
  "trust-identity-attest",
  "trust-memory-enforce",
]);
const DEFAULT_ALLOWED_DECISIONS = Object.freeze(["allow"]);
const DEFAULT_ALLOWED_GUARANTEE_CODES = Object.freeze(["execution-allowed"]);
const DEFAULT_RECEIPT_TYPE = "mercury-trust-receipt";
const DEFAULT_VERIFICATION_ENDPOINT = "/api/trust/receipts/verify";
const DEFAULT_SINGLE_USE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_REQUEST_WALLET_PATHS = Object.freeze([
  "body.wallet",
  "body.subject.wallet",
  "body.identity.deployerWallet",
  "body.delegation.issuerWallet",
  "query.wallet",
  "params.wallet",
  "headers.x-wallet",
  "headers.x-caller-wallet",
  "headers.x-source-wallet",
]);

const DEFAULT_REQUEST_TARGET_AGENT_PATHS = Object.freeze([
  "body.targetAgentId",
  "body.agentId",
  "body.identity.agentId",
  "body.delegation.targetAgentId",
  "body.delegation.delegateAgentId",
  "body.memory.targetAgentId",
  "query.targetAgentId",
  "query.agentId",
  "params.targetAgentId",
  "headers.x-target-agent-id",
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

function toNonEmptyString(value, label, required) {
  if (value === undefined || value === null) {
    if (required) {
      throw new MercuryTrustValidationError(`${label} is required.`, { label });
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new MercuryTrustValidationError(`${label} must be a string when provided.`, {
      label,
      receivedType: typeof value,
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MercuryTrustValidationError(`${label} cannot be empty.`, { label });
  }
  return trimmed;
}

function normalizeBoolean(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new MercuryTrustValidationError(`${label} must be a boolean when provided.`, {
      label,
      receivedType: typeof value,
    });
  }
  return value;
}

function normalizePositiveInteger(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new MercuryTrustValidationError(`${label} must be a positive integer.`, {
      label,
      received: value,
    });
  }
  return value;
}

function normalizePositiveIntegerOrNull(value, label, fallback) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new MercuryTrustValidationError(`${label} must be a positive integer or null.`, {
      label,
      received: value,
    });
  }
  return value;
}

function parseJsonIfPossible(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return undefined;
  }
}

function parseReceiptFromHeaderValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();

  const direct = parseJsonIfPossible(trimmed);
  if (isPlainObject(direct)) {
    return direct;
  }

  if (trimmed.toLowerCase().startsWith("base64:")) {
    const encoded = trimmed.slice("base64:".length).trim();
    if (!encoded) return null;
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const parsed = parseJsonIfPossible(decoded);
      if (isPlainObject(parsed)) {
        return parsed;
      }
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function normalizeDecision(value) {
  const raw = toNonEmptyString(value, "decision", false);
  if (!raw) {
    return null;
  }
  const lowered = raw.toLowerCase();
  if (lowered === "trusted") return "allow";
  if (lowered === "untrusted") return "deny";
  if (lowered === "watch" || lowered === "challenge" || lowered === "question") return "review";
  if (lowered === "blocked" || lowered === "reject") return "deny";
  return lowered;
}

function normalizeMode(value) {
  const raw = toNonEmptyString(value, "mode", false);
  return raw ? raw.toLowerCase() : null;
}

function normalizeOptionalStringSet(value, label, defaults, mapper) {
  if (value === null) {
    return null;
  }
  const source = value === undefined ? defaults : value;
  if (source === null || source === undefined) {
    return null;
  }
  if (!Array.isArray(source)) {
    throw new MercuryTrustValidationError(`${label} must be an array of strings or null.`, {
      label,
      receivedType: typeof source,
    });
  }
  const set = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const normalized = toNonEmptyString(source[index], `${label}[${index}]`, true).toLowerCase();
    const mapped = typeof mapper === "function" ? mapper(normalized) : normalized;
    if (mapped) {
      set.add(mapped);
    }
  }
  return set;
}

function normalizePathList(value, label, defaults) {
  const source = value === undefined ? defaults : value;
  if (source === null) {
    return [];
  }
  if (!Array.isArray(source)) {
    throw new MercuryTrustValidationError(`${label} must be an array of string paths when provided.`, {
      label,
      receivedType: typeof source,
    });
  }
  return source.map((item, index) => toNonEmptyString(item, `${label}[${index}]`, true));
}

function resolveReceiptFromBody(body) {
  if (!isPlainObject(body)) {
    return null;
  }
  if (isPlainObject(body.trustReceipt)) {
    return body.trustReceipt;
  }
  if (isPlainObject(body.receipt)) {
    return body.receipt;
  }
  if (body.type === DEFAULT_RECEIPT_TYPE) {
    return body;
  }
  return null;
}

function extractTrustReceiptFromRequest(req) {
  if (req && isPlainObject(req.trustReceipt)) {
    return req.trustReceipt;
  }
  const fromBody = resolveReceiptFromBody(req ? req.body : undefined);
  if (fromBody) {
    return fromBody;
  }

  const headers = req && isPlainObject(req.headers) ? req.headers : {};
  const headerCandidates = [
    headers["x-merc-trust-receipt"],
    headers["x-mercury-trust-receipt"],
    headers["x-trust-receipt"],
  ];
  for (let index = 0; index < headerCandidates.length; index += 1) {
    const candidate = headerCandidates[index];
    if (Array.isArray(candidate)) {
      for (let itemIndex = 0; itemIndex < candidate.length; itemIndex += 1) {
        const parsed = parseReceiptFromHeaderValue(candidate[itemIndex]);
        if (parsed) {
          return parsed;
        }
      }
      continue;
    }
    const parsed = parseReceiptFromHeaderValue(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function splitPath(path) {
  return String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readRoot(req, rootName) {
  if (!req || typeof req !== "object") return undefined;
  if (rootName === "body") return req.body;
  if (rootName === "query") return req.query;
  if (rootName === "params") return req.params;
  if (rootName === "headers") return req.headers;
  return undefined;
}

function readNestedPath(root, segments) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    if (current === null || current === undefined) return undefined;
    const key = segments[index];
    if (typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function resolveRequestValueFromPaths(req, paths) {
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const segments = splitPath(path);
    if (segments.length < 2) {
      continue;
    }
    const [rootName, ...nested] = segments;
    let root = readRoot(req, rootName);
    if (rootName === "headers" && isPlainObject(root)) {
      root = Object.fromEntries(
        Object.entries(root).map(([key, value]) => [String(key || "").toLowerCase(), value]),
      );
      for (let i = 0; i < nested.length; i += 1) {
        nested[i] = nested[i].toLowerCase();
      }
    }
    const value = readNestedPath(root, nested);
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      continue;
    }
    return value;
  }
  return null;
}

function normalizeWalletLike(value) {
  const raw = toNonEmptyString(value, "wallet", false);
  if (!raw) return null;
  return raw.toLowerCase();
}

function normalizeAgentLike(value) {
  const raw = toNonEmptyString(value, "targetAgentId", false);
  if (!raw) return null;
  return raw.toLowerCase();
}

function resolveRequestOptions(optionValue, req) {
  if (optionValue === undefined || optionValue === null) {
    return undefined;
  }
  if (typeof optionValue === "function") {
    const output = optionValue(req);
    if (output === undefined || output === null) {
      return undefined;
    }
    if (!isPlainObject(output)) {
      throw new MercuryTrustValidationError("options.requestOptions function must return an object.");
    }
    return output;
  }
  if (!isPlainObject(optionValue)) {
    throw new MercuryTrustValidationError("options.requestOptions must be an object or function.");
  }
  return optionValue;
}

function buildRejectPayload(reason, message, details) {
  return {
    error: "merc-trust-receipt-rejected",
    reason,
    message,
    details: details || null,
  };
}

function toEpochMs(value) {
  const raw = toNonEmptyString(value, "date", false);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveReceiptExpiresAtMs(receipt, verification) {
  return toEpochMs(verification && verification.expiresAt ? verification.expiresAt : (receipt && receipt.expiresAt));
}

function resolveReceiptIssuedAtMs(receipt) {
  return toEpochMs(receipt && receipt.issuedAt ? receipt.issuedAt : null);
}

function createInMemoryReplayStore(options) {
  const normalizedOptions = options === undefined ? {} : options;
  if (!isPlainObject(normalizedOptions)) {
    throw new MercuryTrustValidationError("createInMemoryReplayStore options must be an object.");
  }
  const defaultTtlMs = normalizePositiveInteger(
    normalizedOptions.defaultTtlMs,
    "createInMemoryReplayStore.defaultTtlMs",
    DEFAULT_SINGLE_USE_TTL_MS,
  );
  const map = new Map();

  function purge(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    for (const [key, expiresAtMs] of map.entries()) {
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
        map.delete(key);
      }
    }
  }

  return Object.freeze({
    has: function has(receiptId, nowMs) {
      const key = toNonEmptyString(receiptId, "receiptId", false);
      if (!key) return false;
      purge(nowMs);
      return map.has(key);
    },
    set: function set(receiptId, expiresAtMs, nowMs) {
      const key = toNonEmptyString(receiptId, "receiptId", true);
      const now = Number.isFinite(nowMs) ? nowMs : Date.now();
      purge(now);
      const effectiveExpiry =
        Number.isFinite(expiresAtMs) && expiresAtMs > now
          ? expiresAtMs
          : now + defaultTtlMs;
      map.set(key, effectiveExpiry);
      return effectiveExpiry;
    },
    purge,
    delete: function remove(receiptId) {
      const key = toNonEmptyString(receiptId, "receiptId", false);
      if (!key) return false;
      return map.delete(key);
    },
    size: function size() {
      purge(Date.now());
      return map.size;
    },
  });
}

function normalizeReplayStore(store, fallbackTtlMs) {
  if (store === undefined || store === null) {
    return createInMemoryReplayStore({ defaultTtlMs: fallbackTtlMs });
  }
  if (store instanceof Map) {
    const internal = store;
    return {
      has: (receiptId, nowMs) => {
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        const key = toNonEmptyString(receiptId, "receiptId", false);
        if (!key) return false;
        const expiry = internal.get(key);
        if (!Number.isFinite(expiry) || expiry <= now) {
          internal.delete(key);
          return false;
        }
        return true;
      },
      set: (receiptId, expiresAtMs, nowMs) => {
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        const key = toNonEmptyString(receiptId, "receiptId", true);
        const effectiveExpiry =
          Number.isFinite(expiresAtMs) && expiresAtMs > now
            ? expiresAtMs
            : now + fallbackTtlMs;
        internal.set(key, effectiveExpiry);
        return effectiveExpiry;
      },
    };
  }
  if (typeof store.has !== "function" || typeof store.set !== "function") {
    throw new MercuryTrustValidationError(
      "options.replayStore must provide has(receiptId, nowMs) and set(receiptId, expiresAtMs, nowMs).",
    );
  }
  return store;
}

function createTrustReceiptMiddleware(options) {
  const normalizedOptions = options === undefined ? {} : options;
  if (!isPlainObject(normalizedOptions)) {
    throw new MercuryTrustValidationError("createTrustReceiptMiddleware options must be an object.");
  }

  const trustClient = normalizedOptions.trustClient || createTrustClient(normalizedOptions.clientOptions);
  if (!trustClient || typeof trustClient.verifyTrustReceipt !== "function") {
    throw new MercuryTrustValidationError(
      "createTrustReceiptMiddleware requires a trustClient with verifyTrustReceipt(...).",
    );
  }

  const extractReceipt = normalizedOptions.extractReceipt || extractTrustReceiptFromRequest;
  if (typeof extractReceipt !== "function") {
    throw new MercuryTrustValidationError("options.extractReceipt must be a function when provided.");
  }

  const attachProperty = toNonEmptyString(
    normalizedOptions.attachProperty,
    "options.attachProperty",
    false,
  ) || "mercuryTrust";

  const requestOptions = normalizedOptions.requestOptions;
  const failOpen = normalizeBoolean(normalizedOptions.failOpen, "options.failOpen", false);
  const requireValidSignature = normalizeBoolean(
    normalizedOptions.requireValidSignature,
    "options.requireValidSignature",
    true,
  );
  const requireCanonicalIdentityForIdentityMode = normalizeBoolean(
    normalizedOptions.requireCanonicalIdentityForIdentityMode,
    "options.requireCanonicalIdentityForIdentityMode",
    true,
  );

  const allowedServiceIds = normalizeOptionalStringSet(
    normalizedOptions.allowedServiceIds,
    "options.allowedServiceIds",
    DEFAULT_ALLOWED_SERVICE_IDS,
  );
  const allowedModes = normalizeOptionalStringSet(
    normalizedOptions.allowedModes,
    "options.allowedModes",
    null,
  );
  const allowedDecisions = normalizeOptionalStringSet(
    normalizedOptions.allowedDecisions,
    "options.allowedDecisions",
    DEFAULT_ALLOWED_DECISIONS,
    normalizeDecision,
  );
  const allowedGuaranteeCodes = normalizeOptionalStringSet(
    normalizedOptions.allowedGuaranteeCodes,
    "options.allowedGuaranteeCodes",
    DEFAULT_ALLOWED_GUARANTEE_CODES,
  );

  const requireReceiptType =
    normalizedOptions.requireReceiptType === false
      ? null
      : toNonEmptyString(normalizedOptions.requireReceiptType, "options.requireReceiptType", false) ||
        DEFAULT_RECEIPT_TYPE;

  const allowedReceiptVersions = normalizeOptionalStringSet(
    normalizedOptions.allowedReceiptVersions,
    "options.allowedReceiptVersions",
    null,
  );

  const requireVerificationEndpointMatch = normalizeBoolean(
    normalizedOptions.requireVerificationEndpointMatch,
    "options.requireVerificationEndpointMatch",
    true,
  );

  const expectedVerificationEndpoint =
    toNonEmptyString(normalizedOptions.expectedVerificationEndpoint, "options.expectedVerificationEndpoint", false) ||
    DEFAULT_VERIFICATION_ENDPOINT;

  const requireReceiptExpiry = normalizeBoolean(
    normalizedOptions.requireReceiptExpiry,
    "options.requireReceiptExpiry",
    true,
  );

  const maxReceiptAgeMs = normalizePositiveIntegerOrNull(
    normalizedOptions.maxReceiptAgeMs,
    "options.maxReceiptAgeMs",
    null,
  );

  const enforceSubjectWalletMatch = normalizeBoolean(
    normalizedOptions.enforceSubjectWalletMatch,
    "options.enforceSubjectWalletMatch",
    false,
  );
  const enforceTargetAgentIdMatch = normalizeBoolean(
    normalizedOptions.enforceTargetAgentIdMatch,
    "options.enforceTargetAgentIdMatch",
    false,
  );

  const walletResolver = normalizedOptions.walletResolver;
  if (walletResolver !== undefined && typeof walletResolver !== "function") {
    throw new MercuryTrustValidationError("options.walletResolver must be a function when provided.");
  }
  const targetAgentIdResolver = normalizedOptions.targetAgentIdResolver;
  if (targetAgentIdResolver !== undefined && typeof targetAgentIdResolver !== "function") {
    throw new MercuryTrustValidationError("options.targetAgentIdResolver must be a function when provided.");
  }

  const requestWalletPaths = normalizePathList(
    normalizedOptions.requestWalletPaths,
    "options.requestWalletPaths",
    DEFAULT_REQUEST_WALLET_PATHS,
  );
  const requestTargetAgentPaths = normalizePathList(
    normalizedOptions.requestTargetAgentPaths,
    "options.requestTargetAgentPaths",
    DEFAULT_REQUEST_TARGET_AGENT_PATHS,
  );

  const singleUseReceipt = normalizeBoolean(
    normalizedOptions.singleUseReceipt,
    "options.singleUseReceipt",
    false,
  );
  const singleUseTtlMs = normalizePositiveInteger(
    normalizedOptions.singleUseTtlMs,
    "options.singleUseTtlMs",
    DEFAULT_SINGLE_USE_TTL_MS,
  );
  const replayStore = singleUseReceipt
    ? normalizeReplayStore(normalizedOptions.replayStore, singleUseTtlMs)
    : null;

  const onResult = normalizedOptions.onResult;
  if (onResult !== undefined && typeof onResult !== "function") {
    throw new MercuryTrustValidationError("options.onResult must be a function when provided.");
  }

  function emitResult(payload, req, res) {
    if (typeof onResult !== "function") return;
    try {
      onResult(payload, req, res);
    } catch (_error) {
      // Middleware should not fail closed because telemetry hook errored.
    }
  }

  function resolveRequestWallet(req) {
    const resolved =
      typeof walletResolver === "function"
        ? walletResolver(req)
        : resolveRequestValueFromPaths(req, requestWalletPaths);
    return normalizeWalletLike(resolved);
  }

  function resolveRequestTargetAgentId(req) {
    const resolved =
      typeof targetAgentIdResolver === "function"
        ? targetAgentIdResolver(req)
        : resolveRequestValueFromPaths(req, requestTargetAgentPaths);
    return normalizeAgentLike(resolved);
  }

  return async function mercuryTrustReceiptMiddleware(req, res, next) {
    const reject = (statusCode, reason, message, details, context) => {
      const payload = buildRejectPayload(reason, message, details);
      emitResult(
        {
          allowed: false,
          reason,
          statusCode,
          message,
          details: details || null,
          receiptId: context && context.receiptId ? context.receiptId : null,
          serviceId: context && context.serviceId ? context.serviceId : null,
          mode: context && context.mode ? context.mode : null,
        },
        req,
        res,
      );

      if (res && typeof res.status === "function" && typeof res.json === "function") {
        res.status(statusCode).json(payload);
        return;
      }
      if (typeof next === "function") {
        const error = new Error(`${payload.error}: ${reason}`);
        error.status = statusCode;
        error.payload = payload;
        next(error);
      }
    };

    try {
      const receipt = extractReceipt(req, res);
      if (!isPlainObject(receipt)) {
        return reject(
          400,
          "missing-receipt",
          "No Mercury Trust receipt found in request body or receipt headers.",
        );
      }

      const verification = await trustClient.verifyTrustReceipt(
        { receipt },
        resolveRequestOptions(requestOptions, req),
      );
      if (!verification || verification.valid !== true) {
        return reject(
          403,
          "verification-failed",
          "Mercury Trust receipt signature verification failed.",
          {
            verification: verification || null,
          },
          {
            receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false),
            serviceId: toNonEmptyString(receipt.serviceId, "receipt.serviceId", false),
            mode: normalizeMode(receipt.mode),
          },
        );
      }

      const verifiedSignatureAlgorithm = toNonEmptyString(
        verification.signatureAlgorithm,
        "verification.signatureAlgorithm",
        false,
      );
      if (
        requireValidSignature &&
        (!verifiedSignatureAlgorithm || verifiedSignatureAlgorithm.toLowerCase() !== "hmac-sha256")
      ) {
        return reject(
          403,
          "unsigned-receipt",
          "Receipt is valid but not signed with the required hmac-sha256 algorithm.",
          { signatureAlgorithm: verification.signatureAlgorithm || null },
        );
      }

      const receiptType = toNonEmptyString(receipt.type, "receipt.type", false);
      if (requireReceiptType && receiptType !== requireReceiptType) {
        return reject(
          403,
          "receipt-type-not-allowed",
          "Receipt type is not permitted for this route.",
          {
            receiptType: receiptType || null,
            requiredReceiptType: requireReceiptType,
          },
        );
      }

      const receiptVersion = toNonEmptyString(receipt.version, "receipt.version", false);
      if (allowedReceiptVersions && (!receiptVersion || !allowedReceiptVersions.has(receiptVersion.toLowerCase()))) {
        return reject(
          403,
          "receipt-version-not-allowed",
          "Receipt version is not permitted for this route.",
          {
            receiptVersion: receiptVersion || null,
            allowedReceiptVersions: Array.from(allowedReceiptVersions),
          },
        );
      }

      const verificationEndpoint = toNonEmptyString(
        receipt && receipt.verification && receipt.verification.endpoint,
        "receipt.verification.endpoint",
        false,
      );
      if (
        requireVerificationEndpointMatch &&
        verificationEndpoint !== expectedVerificationEndpoint
      ) {
        return reject(
          403,
          "verification-endpoint-mismatch",
          "Receipt verification endpoint does not match route policy.",
          {
            verificationEndpoint: verificationEndpoint || null,
            expectedVerificationEndpoint,
          },
        );
      }

      const mode = normalizeMode(receipt.mode);
      const serviceId = toNonEmptyString(receipt.serviceId, "receipt.serviceId", false);
      const normalizedServiceId = serviceId ? serviceId.toLowerCase() : null;
      const decision = normalizeDecision(
        receipt && receipt.decision && typeof receipt.decision === "object"
          ? (receipt.decision.normalized || receipt.decision.status)
          : null,
      );
      const guaranteeCode = toNonEmptyString(
        receipt && receipt.guarantee && receipt.guarantee.code,
        "receipt.guarantee.code",
        false,
      );
      const normalizedGuaranteeCode = guaranteeCode ? guaranteeCode.toLowerCase() : null;

      if (allowedModes && (!mode || !allowedModes.has(mode))) {
        return reject(
          403,
          "mode-not-allowed",
          "Receipt mode is not permitted for this route.",
          { mode, allowedModes: Array.from(allowedModes) },
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }
      if (allowedServiceIds && (!normalizedServiceId || !allowedServiceIds.has(normalizedServiceId))) {
        return reject(
          403,
          "service-not-allowed",
          "Receipt serviceId is not permitted for this route.",
          {
            serviceId: serviceId || null,
            allowedServiceIds: Array.from(allowedServiceIds),
          },
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }
      if (allowedDecisions && (!decision || !allowedDecisions.has(decision))) {
        return reject(
          403,
          "decision-not-allowed",
          "Receipt decision does not satisfy this route policy.",
          {
            decision: decision || null,
            allowedDecisions: Array.from(allowedDecisions),
          },
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }
      if (allowedGuaranteeCodes && (!normalizedGuaranteeCode || !allowedGuaranteeCodes.has(normalizedGuaranteeCode))) {
        return reject(
          403,
          "guarantee-not-allowed",
          "Receipt guarantee code does not satisfy this route policy.",
          {
            guaranteeCode: normalizedGuaranteeCode || null,
            allowedGuaranteeCodes: Array.from(allowedGuaranteeCodes),
          },
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }

      if (requireCanonicalIdentityForIdentityMode && mode === "identity") {
        const canonicalIdentity = isPlainObject(receipt.canonicalIdentity)
          ? receipt.canonicalIdentity
          : {};
        if (canonicalIdentity.required !== true || canonicalIdentity.verified !== true) {
          return reject(
            403,
            "identity-not-canonical",
            "Identity receipt failed canonical ERC-8004 enforcement.",
            { canonicalIdentity },
            { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
          );
        }
      }

      const nowMs = Date.now();
      const expiresAtMs = resolveReceiptExpiresAtMs(receipt, verification);
      if (requireReceiptExpiry && !Number.isFinite(expiresAtMs)) {
        return reject(
          403,
          "missing-expiration",
          "Receipt is missing expiresAt and cannot be enforced safely.",
          null,
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
        return reject(
          403,
          "receipt-expired",
          "Receipt has expired.",
          {
            expiresAt: verification.expiresAt || receipt.expiresAt || null,
          },
          { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
        );
      }

      if (maxReceiptAgeMs !== null) {
        const issuedAtMs = resolveReceiptIssuedAtMs(receipt);
        if (!Number.isFinite(issuedAtMs)) {
          return reject(
            403,
            "missing-issued-at",
            "Receipt is missing issuedAt but freshness enforcement is enabled.",
            { maxReceiptAgeMs },
            { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
          );
        }
        const ageMs = nowMs - issuedAtMs;
        if (ageMs > maxReceiptAgeMs) {
          return reject(
            403,
            "receipt-too-old",
            "Receipt age exceeds route freshness requirements.",
            {
              maxReceiptAgeMs,
              ageMs,
              issuedAt: receipt.issuedAt || null,
            },
            { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
          );
        }
      }

      const requestWallet = enforceSubjectWalletMatch ? resolveRequestWallet(req) : null;
      const requestTargetAgentId = enforceTargetAgentIdMatch ? resolveRequestTargetAgentId(req) : null;
      const receiptWallet = normalizeWalletLike(
        receipt && receipt.subject && receipt.subject.wallet,
      );
      const receiptTargetAgentId = normalizeAgentLike(
        receipt && receipt.subject && receipt.subject.targetAgentId,
      );

      if (enforceSubjectWalletMatch) {
        if (!requestWallet || !receiptWallet || requestWallet !== receiptWallet) {
          return reject(
            403,
            "subject-wallet-mismatch",
            "Receipt subject wallet does not match request wallet.",
            {
              requestWallet: requestWallet || null,
              receiptWallet: receiptWallet || null,
            },
            { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
          );
        }
      }

      if (enforceTargetAgentIdMatch) {
        if (!requestTargetAgentId || !receiptTargetAgentId || requestTargetAgentId !== receiptTargetAgentId) {
          return reject(
            403,
            "target-agent-mismatch",
            "Receipt target agent does not match request target agent.",
            {
              requestTargetAgentId: requestTargetAgentId || null,
              receiptTargetAgentId: receiptTargetAgentId || null,
            },
            { receiptId: toNonEmptyString(receipt.receiptId, "receipt.receiptId", false), serviceId, mode },
          );
        }
      }

      const receiptId = toNonEmptyString(receipt.receiptId, "receipt.receiptId", false);
      if (singleUseReceipt) {
        if (!receiptId) {
          return reject(
            403,
            "missing-receipt-id",
            "Single-use receipt enforcement requires a receiptId.",
            null,
            { serviceId, mode },
          );
        }
        if (replayStore.has(receiptId, nowMs)) {
          return reject(
            409,
            "receipt-replay-detected",
            "Receipt has already been used for an enforced route.",
            {
              receiptId,
            },
            { receiptId, serviceId, mode },
          );
        }
        replayStore.set(
          receiptId,
          Number.isFinite(expiresAtMs) ? expiresAtMs : (nowMs + singleUseTtlMs),
          nowMs,
        );
      }

      req[attachProperty] = {
        receipt,
        verification,
        extracted: {
          requestWallet,
          requestTargetAgentId,
          receiptWallet,
          receiptTargetAgentId,
        },
        policy: {
          requireValidSignature,
          requireCanonicalIdentityForIdentityMode,
          allowedServiceIds: allowedServiceIds ? Array.from(allowedServiceIds) : null,
          allowedModes: allowedModes ? Array.from(allowedModes) : null,
          allowedDecisions: allowedDecisions ? Array.from(allowedDecisions) : null,
          allowedGuaranteeCodes: allowedGuaranteeCodes ? Array.from(allowedGuaranteeCodes) : null,
          requireReceiptType,
          allowedReceiptVersions: allowedReceiptVersions ? Array.from(allowedReceiptVersions) : null,
          requireVerificationEndpointMatch,
          expectedVerificationEndpoint,
          requireReceiptExpiry,
          maxReceiptAgeMs,
          enforceSubjectWalletMatch,
          enforceTargetAgentIdMatch,
          singleUseReceipt,
        },
      };

      emitResult(
        {
          allowed: true,
          reason: "verified",
          statusCode: 200,
          receiptId: receiptId || null,
          serviceId: serviceId || null,
          mode: mode || null,
          decision: decision || null,
          guaranteeCode: normalizedGuaranteeCode || null,
          expiresAt: verification.expiresAt || receipt.expiresAt || null,
        },
        req,
        res,
      );

      if (typeof next === "function") {
        return next();
      }
      return undefined;
    } catch (error) {
      if (failOpen) {
        req[attachProperty] = {
          bypassed: true,
          error: error && error.message ? error.message : "Mercury Trust verification failed.",
        };
        emitResult(
          {
            allowed: true,
            reason: "fail-open-bypass",
            statusCode: 200,
            error: error && error.message ? error.message : String(error),
          },
          req,
          res,
        );
        if (typeof next === "function") {
          return next();
        }
        return undefined;
      }
      return reject(
        502,
        "verification-error",
        "Mercury Trust receipt verification request failed.",
        { error: error && error.message ? error.message : String(error) },
      );
    }
  };
}

module.exports = {
  DEFAULT_ALLOWED_SERVICE_IDS,
  DEFAULT_ALLOWED_DECISIONS,
  DEFAULT_ALLOWED_GUARANTEE_CODES,
  DEFAULT_RECEIPT_TYPE,
  DEFAULT_VERIFICATION_ENDPOINT,
  DEFAULT_REQUEST_WALLET_PATHS,
  DEFAULT_REQUEST_TARGET_AGENT_PATHS,
  createTrustReceiptMiddleware,
  createInMemoryReplayStore,
  extractTrustReceiptFromRequest,
};
