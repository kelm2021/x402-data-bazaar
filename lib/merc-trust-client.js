"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const MERCURY_TRUST_DEFAULT_BASE_URL = "https://merc-trust.vercel.app";
const MERCURY_TRUST_DEFAULT_TIMEOUT_MS = 15000;
const MERCURY_TRUST_DEFAULT_X402_MAX_AMOUNT_ATOMIC = 50000;
const MERCURY_TRUST_DEFAULT_X402_RUNNER = "npx";
const MERCURY_TRUST_DEFAULT_X402_AWAL_PACKAGE = "awal@latest";
const TRUST_MODES = Object.freeze(["delegation", "identity", "memory"]);
const TRUST_MODE_SET = new Set(TRUST_MODES);
const TRUST_GATE_ALLOW_DECISIONS = new Set(["allow", "trusted"]);
const TRUST_GATE_REVIEW_DECISIONS = new Set(["review", "challenge", "watch", "question"]);
const TRUST_GATE_DENY_DECISIONS = new Set(["deny", "reject", "blocked", "block"]);

class MercuryTrustError extends Error {
  constructor(message, options) {
    super(message);
    this.name = this.constructor.name;
    if (options && options.code) {
      this.code = options.code;
    }
    if (options && options.details !== undefined) {
      this.details = options.details;
    }
    if (options && options.cause) {
      this.cause = options.cause;
    }
  }
}

class MercuryTrustValidationError extends MercuryTrustError {
  constructor(message, details) {
    super(message, { code: "VALIDATION_ERROR", details });
  }
}

class MercuryTrustHttpError extends MercuryTrustError {
  constructor(message, details) {
    super(message, { code: "HTTP_ERROR", details });
    this.status = details ? details.status : undefined;
    this.statusText = details ? details.statusText : undefined;
    this.url = details ? details.url : undefined;
    this.method = details ? details.method : undefined;
    this.responseBody = details ? details.responseBody : undefined;
    this.responseHeaders = details ? details.responseHeaders : undefined;
  }
}

class MercuryTrustNetworkError extends MercuryTrustError {
  constructor(message, details) {
    super(message, { code: "NETWORK_ERROR", details });
  }
}

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

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new MercuryTrustValidationError(
      `${label} must be a plain object.`,
      { label, receivedType: typeof value },
    );
  }
}

function assertOptionalPlainObject(value, label) {
  if (value === undefined) {
    return;
  }
  assertPlainObject(value, label);
}

function toNonEmptyString(value, label, required) {
  if (value === undefined || value === null) {
    if (required) {
      throw new MercuryTrustValidationError(`${label} is required.`, { label });
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new MercuryTrustValidationError(`${label} must be a string.`, {
      label,
      receivedType: typeof value,
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MercuryTrustValidationError(`${label} cannot be empty.`, {
      label,
    });
  }
  return trimmed;
}

function parseJsonIfPossible(text) {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
}

function normalizeTimeoutMs(value, label, fallbackMs) {
  if (value === undefined || value === null) {
    return fallbackMs;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new MercuryTrustValidationError(`${label} must be a positive integer.`, {
      label,
      received: value,
    });
  }
  return value;
}

function normalizeHeaders(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  assertPlainObject(value, label);
  const normalized = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (typeof key !== "string" || !key.trim()) {
      throw new MercuryTrustValidationError(`${label} contains an invalid header key.`, {
        label,
        key,
      });
    }
    const headerValue = value[key];
    if (headerValue === undefined || headerValue === null) {
      continue;
    }
    if (typeof headerValue !== "string") {
      throw new MercuryTrustValidationError(
        `${label}.${key} must be a string when provided.`,
        { label, key, receivedType: typeof headerValue },
      );
    }
    normalized[key] = headerValue;
  }
  return normalized;
}

function normalizeStringArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new MercuryTrustValidationError(`${label} must be an array of strings when provided.`, {
      label,
      receivedType: typeof value,
    });
  }
  const normalized = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || !item.trim()) {
      throw new MercuryTrustValidationError(`${label}[${i}] must be a non-empty string.`, {
        label,
        index: i,
      });
    }
    normalized.push(item.trim());
  }
  return normalized;
}

function toOptionalBoolean(value, label) {
  if (value === undefined || value === null) {
    return undefined;
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

function normalizeResponseHeaders(value) {
  if (!value) return {};
  if (typeof value.entries === "function") {
    return Object.fromEntries(value.entries());
  }
  if (isPlainObject(value)) {
    return { ...value };
  }
  return {};
}

function extractJsonFromText(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) {
    return {};
  }
  const parsed = parseJsonIfPossible(raw);
  if (parsed !== undefined) {
    return parsed;
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const fragment = raw.slice(firstBrace, lastBrace + 1);
    const parsedFragment = parseJsonIfPossible(fragment);
    if (parsedFragment !== undefined) {
      return parsedFragment;
    }
  }
  throw new MercuryTrustNetworkError("x402 transport returned non-JSON output.", {
    outputSnippet: raw.slice(0, 500),
  });
}

function normalizeX402Config(value, label, defaults) {
  if (value === undefined || value === null) {
    return { ...defaults };
  }
  if (typeof value === "boolean") {
    return {
      ...defaults,
      enabled: value,
    };
  }
  assertPlainObject(value, label);
  const enabled = toOptionalBoolean(value.enabled, `${label}.enabled`);
  const strategy = toNonEmptyString(value.strategy, `${label}.strategy`);
  const runnerCommand = toNonEmptyString(value.runnerCommand, `${label}.runnerCommand`);
  const runnerArgsPrefix = normalizeStringArray(value.runnerArgsPrefix, `${label}.runnerArgsPrefix`);
  const awalPackage = toNonEmptyString(value.awalPackage, `${label}.awalPackage`);
  const correlationId = toNonEmptyString(value.correlationId, `${label}.correlationId`);
  const commandTimeoutMs = normalizePositiveInteger(
    value.commandTimeoutMs,
    `${label}.commandTimeoutMs`,
    defaults.commandTimeoutMs,
  );
  const maxAmountAtomic = normalizePositiveInteger(
    value.maxAmountAtomic,
    `${label}.maxAmountAtomic`,
    defaults.maxAmountAtomic,
  );
  const transport = value.transport;
  if (transport !== undefined && typeof transport !== "function") {
    throw new MercuryTrustValidationError(`${label}.transport must be a function when provided.`, {
      label,
      receivedType: typeof transport,
    });
  }
  const merged = {
    ...defaults,
    ...value,
    maxAmountAtomic,
    enabled: enabled === undefined ? defaults.enabled : enabled,
    strategy: strategy || defaults.strategy,
    runnerCommand: runnerCommand || defaults.runnerCommand,
    runnerArgsPrefix: runnerArgsPrefix.length > 0 ? runnerArgsPrefix : defaults.runnerArgsPrefix,
    awalPackage: awalPackage || defaults.awalPackage,
    correlationId: correlationId || defaults.correlationId,
    commandTimeoutMs,
    transport: transport || defaults.transport,
  };
  if (merged.strategy !== "awal-cli" && merged.strategy !== "custom") {
    throw new MercuryTrustValidationError(`${label}.strategy must be "awal-cli" or "custom".`, {
      strategy: merged.strategy,
    });
  }
  if (merged.strategy === "custom" && typeof merged.transport !== "function") {
    throw new MercuryTrustValidationError(
      `${label}.transport is required when strategy is "custom".`,
    );
  }
  return merged;
}

function resolveAwalRunnerInvocation(x402Config) {
  if (x402Config.runnerCommand) {
    return {
      command: x402Config.runnerCommand,
      argsPrefix: Array.isArray(x402Config.runnerArgsPrefix) ? x402Config.runnerArgsPrefix : [],
    };
  }

  if (process.platform === "win32") {
    const npxCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (fs.existsSync(npxCliPath)) {
      return {
        command: process.execPath,
        argsPrefix: [npxCliPath],
      };
    }
  }

  return {
    command: MERCURY_TRUST_DEFAULT_X402_RUNNER,
    argsPrefix: [],
  };
}

function buildErrorMessageForResponse(path, response, parsedBody, rawText, method) {
  const httpMethod = typeof method === "string" && method.trim() ? method.trim().toUpperCase() : "POST";
  if (response.status === 402) {
    return `Mercury Trust API request requires x402 payment for ${httpMethod} ${path}. Use an x402-capable client or include valid payment headers.`;
  }
  let detail = "";
  if (parsedBody && typeof parsedBody.error === "string" && parsedBody.error.trim()) {
    detail = parsedBody.error.trim();
  } else if (typeof rawText === "string" && rawText.trim()) {
    detail = rawText.trim().slice(0, 300);
  }
  if (detail) {
    return `Mercury Trust API request failed (${response.status} ${response.statusText}) for ${httpMethod} ${path}: ${detail}`;
  }
  return `Mercury Trust API request failed (${response.status} ${response.statusText}) for ${httpMethod} ${path}.`;
}

function normalizeBaseUrl(value) {
  const baseUrl = toNonEmptyString(
    value === undefined ? MERCURY_TRUST_DEFAULT_BASE_URL : value,
    "baseUrl",
    true,
  );
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new MercuryTrustValidationError("baseUrl must be a valid URL.", {
      baseUrl,
    });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new MercuryTrustValidationError(
      "baseUrl must use http or https protocol.",
      { protocol: parsed.protocol },
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function validateDelegationPayload(input) {
  assertPlainObject(input, "verifyDelegation input");
  const normalized = { ...input };
  normalized.wallet = toNonEmptyString(normalized.wallet, "verifyDelegation.wallet");
  normalized.targetAgentId = toNonEmptyString(
    normalized.targetAgentId,
    "verifyDelegation.targetAgentId",
  );
  normalized.delegationId = toNonEmptyString(
    normalized.delegationId,
    "verifyDelegation.delegationId",
  );
  if (normalized.delegation !== undefined) {
    assertPlainObject(normalized.delegation, "verifyDelegation.delegation");
    if (Object.keys(normalized.delegation).length === 0) {
      throw new MercuryTrustValidationError(
        "verifyDelegation.delegation must not be an empty object.",
      );
    }
  }

  if (!normalized.delegationId && normalized.delegation === undefined) {
    throw new MercuryTrustValidationError(
      'verifyDelegation input must include at least one of "delegationId" or "delegation".',
    );
  }

  return normalized;
}

function validateIdentityPayload(input) {
  assertPlainObject(input, "attestIdentity input");
  const normalized = { ...input };
  normalized.wallet = toNonEmptyString(normalized.wallet, "attestIdentity.wallet");
  normalized.targetAgentId = toNonEmptyString(
    normalized.targetAgentId,
    "attestIdentity.targetAgentId",
  );
  normalized.attestationId = toNonEmptyString(
    normalized.attestationId,
    "attestIdentity.attestationId",
  );
  if (normalized.identity !== undefined) {
    assertPlainObject(normalized.identity, "attestIdentity.identity");
    if (Object.keys(normalized.identity).length === 0) {
      throw new MercuryTrustValidationError(
        "attestIdentity.identity must not be an empty object.",
      );
    }
  }
  if (!normalized.attestationId && normalized.identity === undefined) {
    throw new MercuryTrustValidationError(
      'attestIdentity input must include at least one of "attestationId" or "identity".',
    );
  }
  return normalized;
}

function validateMemoryPayload(input) {
  assertPlainObject(input, "enforceMemoryPolicy input");
  const normalized = { ...input };
  normalized.wallet = toNonEmptyString(normalized.wallet, "enforceMemoryPolicy.wallet");
  normalized.targetAgentId = toNonEmptyString(
    normalized.targetAgentId,
    "enforceMemoryPolicy.targetAgentId",
  );
  assertPlainObject(normalized.memory, "enforceMemoryPolicy.memory");
  if (Object.keys(normalized.memory).length === 0) {
    throw new MercuryTrustValidationError(
      "enforceMemoryPolicy.memory must not be an empty object.",
    );
  }
  return normalized;
}

function validateQuickCheckPayload(input) {
  assertPlainObject(input, "quickCheck input");
  const normalized = { ...input };
  normalized.wallet = toNonEmptyString(normalized.wallet, "quickCheck.wallet");
  normalized.targetAgentId = toNonEmptyString(
    normalized.targetAgentId,
    "quickCheck.targetAgentId",
  );

  const mode = toNonEmptyString(normalized.mode, "quickCheck.mode", true).toLowerCase();
  if (!TRUST_MODE_SET.has(mode)) {
    throw new MercuryTrustValidationError(
      `quickCheck.mode must be one of: ${TRUST_MODES.join(", ")}.`,
      { mode },
    );
  }
  normalized.mode = mode;

  if (mode === "delegation") {
    if (normalized.delegation !== undefined) {
      assertPlainObject(normalized.delegation, "quickCheck.delegation");
      if (Object.keys(normalized.delegation).length === 0) {
        throw new MercuryTrustValidationError("quickCheck.delegation must not be empty.");
      }
    }
    normalized.delegationId = toNonEmptyString(normalized.delegationId, "quickCheck.delegationId");
    if (!normalized.delegationId && normalized.delegation === undefined) {
      throw new MercuryTrustValidationError(
        'quickCheck input for mode "delegation" must include "delegation" or "delegationId".',
      );
    }
  }
  if (mode === "identity") {
    if (normalized.identity !== undefined) {
      assertPlainObject(normalized.identity, "quickCheck.identity");
      if (Object.keys(normalized.identity).length === 0) {
        throw new MercuryTrustValidationError("quickCheck.identity must not be empty.");
      }
    }
    normalized.attestationId = toNonEmptyString(normalized.attestationId, "quickCheck.attestationId");
    normalized.manifestId = toNonEmptyString(normalized.manifestId, "quickCheck.manifestId");
    if (!normalized.attestationId && !normalized.manifestId && normalized.identity === undefined) {
      throw new MercuryTrustValidationError(
        'quickCheck input for mode "identity" must include "identity", "attestationId", or "manifestId".',
      );
    }
  }
  if (mode === "memory") {
    assertPlainObject(normalized.memory, "quickCheck.memory");
    if (Object.keys(normalized.memory).length === 0) {
      throw new MercuryTrustValidationError("quickCheck.memory must not be empty.");
    }
  }

  return normalized;
}

function validateObjectPayload(input, label) {
  assertPlainObject(input, label);
  return { ...input };
}

function validateOptionalObjectPayload(input, label) {
  if (input === undefined || input === null) {
    return {};
  }
  return validateObjectPayload(input, label);
}

function validateTrustReceiptVerificationInput(input) {
  assertPlainObject(input, "verifyTrustReceipt input");

  if (Object.prototype.hasOwnProperty.call(input, "receipt")) {
    assertPlainObject(input.receipt, "verifyTrustReceipt.receipt");
    if (Object.keys(input.receipt).length === 0) {
      throw new MercuryTrustValidationError(
        "verifyTrustReceipt.receipt must not be an empty object.",
      );
    }
    return { receipt: { ...input.receipt } };
  }

  if (Object.keys(input).length === 0) {
    throw new MercuryTrustValidationError(
      'verifyTrustReceipt input must include a receipt object or receipt fields.',
    );
  }
  return { receipt: { ...input } };
}

function normalizeGateDecision(value) {
  const normalized = toNonEmptyString(value, "decision", false);
  if (!normalized) {
    return null;
  }
  const lowered = normalized.toLowerCase();
  if (TRUST_GATE_ALLOW_DECISIONS.has(lowered)) {
    return "allow";
  }
  if (TRUST_GATE_REVIEW_DECISIONS.has(lowered)) {
    return "review";
  }
  if (TRUST_GATE_DENY_DECISIONS.has(lowered)) {
    return "deny";
  }
  return lowered;
}

function extractGateDecision(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  const candidates = [
    response.normalizedDecision,
    response.quickCheck && response.quickCheck.normalizedDecision,
    response.decision && response.decision.status,
    response.quickCheck && response.quickCheck.decisionCode,
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const decision = normalizeGateDecision(candidates[index]);
    if (decision) {
      return decision;
    }
  }
  return null;
}

function extractGateReason(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  const candidates = [
    response.decision && response.decision.reason,
    response.quickCheck && response.quickCheck.decisionReason,
    response.summary,
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const value = toNonEmptyString(candidates[index], "reason", false);
    if (value) {
      return value;
    }
  }
  return null;
}

function extractTrustReceipt(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  if (isPlainObject(response.receipt)) {
    return response.receipt;
  }
  if (isPlainObject(response.passport)) {
    return response.passport;
  }
  if (isPlainObject(response.decisionMemory)) {
    return response.decisionMemory;
  }
  return null;
}

function validateGateActionInput(input) {
  assertPlainObject(input, "gateAction input");
  const requestPayload = { ...input };
  const escalateOnReview = toOptionalBoolean(
    requestPayload.escalateOnReview,
    "gateAction.escalateOnReview",
  );
  const deepCheckOnAllow = toOptionalBoolean(
    requestPayload.deepCheckOnAllow,
    "gateAction.deepCheckOnAllow",
  );
  const quickCheckOnly = toOptionalBoolean(
    requestPayload.quickCheckOnly,
    "gateAction.quickCheckOnly",
  );

  delete requestPayload.escalateOnReview;
  delete requestPayload.deepCheckOnAllow;
  delete requestPayload.quickCheckOnly;

  return {
    quickCheckInput: validateQuickCheckPayload(requestPayload),
    controls: {
      escalateOnReview: escalateOnReview === undefined ? true : escalateOnReview,
      deepCheckOnAllow: deepCheckOnAllow === true,
      quickCheckOnly: quickCheckOnly === true,
    },
  };
}

function buildDeepCheckInput(mode, input) {
  if (mode === "delegation") {
    return validateDelegationPayload({
      wallet: input.wallet,
      targetAgentId: input.targetAgentId,
      delegationId: input.delegationId,
      delegation: input.delegation,
    });
  }
  if (mode === "identity") {
    return validateIdentityPayload({
      wallet: input.wallet,
      targetAgentId: input.targetAgentId,
      attestationId: input.attestationId,
      manifestId: input.manifestId,
      identity: input.identity,
      manifest: input.manifest,
    });
  }
  return validateMemoryPayload({
    wallet: input.wallet,
    targetAgentId: input.targetAgentId,
    memory: input.memory,
  });
}

function buildUrlWithQuery(baseUrl, normalizedPath, query, label) {
  const url = new URL(`${baseUrl}${normalizedPath}`);
  if (query === undefined || query === null) {
    return url.toString();
  }
  assertPlainObject(query, label);
  const keys = Object.keys(query);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const value = query[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
        const item = value[itemIndex];
        if (item === undefined || item === null) {
          continue;
        }
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function assertPostPath(path) {
  const normalizedPath = toNonEmptyString(path, "path", true);
  if (!normalizedPath.startsWith("/")) {
    throw new MercuryTrustValidationError('path must start with "/".', { path });
  }
  return normalizedPath;
}

function createAbortSignal(timeoutMs, externalSignal) {
  let timeoutId;
  let unsubscribe = function noop() {};

  if (externalSignal !== undefined && externalSignal !== null) {
    if (
      typeof externalSignal !== "object"
      || typeof externalSignal.aborted !== "boolean"
      || typeof externalSignal.addEventListener !== "function"
    ) {
      throw new MercuryTrustValidationError(
        "requestOptions.signal must be an AbortSignal when provided.",
      );
    }
  }

  const controller = new AbortController();
  if (externalSignal && externalSignal.aborted) {
    controller.abort(externalSignal.reason);
  } else if (externalSignal) {
    const onAbort = function onAbort() {
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener("abort", onAbort, { once: true });
    unsubscribe = function cleanupAbortListener() {
      externalSignal.removeEventListener("abort", onAbort);
    };
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(function onTimeout() {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
    },
  };
}

async function runAwalCliX402Pay(request, x402Config) {
  const runner = resolveAwalRunnerInvocation(x402Config);
  const args = [
    ...runner.argsPrefix,
    x402Config.awalPackage,
    "x402",
    "pay",
    request.url,
    "-X",
    "POST",
    "-d",
    JSON.stringify(request.body || {}),
    "--max-amount",
    String(x402Config.maxAmountAtomic),
    "--json",
  ];
  if (request.headers && Object.keys(request.headers).length > 0) {
    args.push("-h", JSON.stringify(request.headers));
  }
  if (x402Config.correlationId) {
    args.push("--correlation-id", x402Config.correlationId);
  }

  try {
    const result = await execFileAsync(runner.command, args, {
      timeout: request.timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      signal: request.signal,
      windowsHide: true,
    });
    return extractJsonFromText(result.stdout || "");
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    const combined = `${stdout}\n${stderr}`.trim();
    const parsed = parseJsonIfPossible(combined);
    if (parsed && typeof parsed === "object" && Number.isInteger(parsed.status)) {
      return parsed;
    }
    throw new MercuryTrustNetworkError(
      `x402 transport command failed: ${error.message}`,
      {
        runnerCommand: runner.command,
        args,
        outputSnippet: combined.slice(0, 1000),
      },
    );
  }
}

function normalizeTransportResult(result, request) {
  if (!result || typeof result !== "object") {
    throw new MercuryTrustNetworkError("x402 transport returned an invalid response object.", {
      resultType: typeof result,
      url: request.url,
    });
  }
  const status = Number(result.status);
  if (!Number.isInteger(status)) {
    throw new MercuryTrustNetworkError("x402 transport response missing numeric status.", {
      result,
      url: request.url,
    });
  }
  const statusText = typeof result.statusText === "string" ? result.statusText : "";
  const responseBody = Object.prototype.hasOwnProperty.call(result, "data")
    ? result.data
    : (Object.prototype.hasOwnProperty.call(result, "body") ? result.body : result);
  const responseHeaders = normalizeResponseHeaders(result.headers);
  return {
    status,
    statusText,
    responseBody,
    responseHeaders,
  };
}

async function executeX402Transport(request, x402Config) {
  if (x402Config.strategy === "custom") {
    let result;
    try {
      result = await x402Config.transport({
        url: request.url,
        method: "POST",
        body: request.body,
        headers: request.headers,
        timeoutMs: request.timeoutMs,
        maxAmountAtomic: x402Config.maxAmountAtomic,
        correlationId: x402Config.correlationId,
        signal: request.signal,
      });
    } catch (error) {
      throw new MercuryTrustNetworkError(`Custom x402 transport failed: ${error.message}`, {
        url: request.url,
        cause: error,
      });
    }
    return normalizeTransportResult(result, request);
  }

  const result = await runAwalCliX402Pay(request, x402Config);
  return normalizeTransportResult(result, request);
}

function createTrustClient(options) {
  const resolvedOptions = options === undefined ? {} : options;
  assertPlainObject(resolvedOptions, "options");

  const baseUrl = normalizeBaseUrl(resolvedOptions.baseUrl);
  const defaultTimeoutMs = normalizeTimeoutMs(
    resolvedOptions.timeoutMs,
    "options.timeoutMs",
    MERCURY_TRUST_DEFAULT_TIMEOUT_MS,
  );
  const defaultHeaders = normalizeHeaders(resolvedOptions.headers, "options.headers");
  const operatorKey = toNonEmptyString(
    resolvedOptions.operatorKey,
    "options.operatorKey",
  );
  const automationKey = toNonEmptyString(
    resolvedOptions.automationKey,
    "options.automationKey",
  );
  const bearerToken = toNonEmptyString(
    resolvedOptions.bearerToken,
    "options.bearerToken",
  );
  const defaultX402Config = normalizeX402Config(
    resolvedOptions.x402,
    "options.x402",
    {
      enabled: false,
      strategy: "awal-cli",
      maxAmountAtomic: MERCURY_TRUST_DEFAULT_X402_MAX_AMOUNT_ATOMIC,
      runnerCommand: undefined,
      runnerArgsPrefix: [],
      awalPackage: MERCURY_TRUST_DEFAULT_X402_AWAL_PACKAGE,
      correlationId: undefined,
      commandTimeoutMs: 60000,
      transport: undefined,
    },
  );

  const hasFetch = typeof fetch === "function";
  if (!hasFetch && !defaultX402Config.enabled) {
    throw new MercuryTrustError(
      "Global fetch is not available in this runtime. Use Node.js 18+ or provide a fetch polyfill.",
      { code: "FETCH_UNAVAILABLE" },
    );
  }

  function buildRequestHeaders(resolvedRequestOptions, includeContentType) {
    const requestHeaders = normalizeHeaders(
      resolvedRequestOptions.headers,
      "requestOptions.headers",
    );
    const mergedHeaders = {
      accept: "application/json",
      ...defaultHeaders,
      ...requestHeaders,
    };
    if (includeContentType !== false) {
      mergedHeaders["content-type"] = "application/json";
    }

    const requestOperatorKey = toNonEmptyString(
      resolvedRequestOptions.operatorKey,
      "requestOptions.operatorKey",
    ) || operatorKey;
    const requestAutomationKey = toNonEmptyString(
      resolvedRequestOptions.automationKey,
      "requestOptions.automationKey",
    ) || automationKey;
    const requestBearerToken = toNonEmptyString(
      resolvedRequestOptions.bearerToken,
      "requestOptions.bearerToken",
    ) || bearerToken;

    if (requestOperatorKey) {
      mergedHeaders["x-operator-key"] = requestOperatorKey;
    }
    if (requestAutomationKey) {
      mergedHeaders["x-automation-key"] = requestAutomationKey;
    }
    if (requestBearerToken) {
      mergedHeaders.authorization = `Bearer ${requestBearerToken}`;
    }

    return mergedHeaders;
  }

  async function post(path, payload, requestOptions) {
    const normalizedPath = assertPostPath(path);
    const body = payload === undefined ? {} : payload;
    assertPlainObject(body, "payload");

    const resolvedRequestOptions = requestOptions === undefined ? {} : requestOptions;
    assertPlainObject(resolvedRequestOptions, "requestOptions");
    const timeoutMs = normalizeTimeoutMs(
      resolvedRequestOptions.timeoutMs,
      "requestOptions.timeoutMs",
      defaultTimeoutMs,
    );
    const requestX402Input = (() => {
      if (resolvedRequestOptions.x402 !== undefined) {
        if (resolvedRequestOptions.maxAmountAtomic !== undefined && isPlainObject(resolvedRequestOptions.x402)) {
          return {
            ...resolvedRequestOptions.x402,
            maxAmountAtomic: resolvedRequestOptions.maxAmountAtomic,
          };
        }
        return resolvedRequestOptions.x402;
      }
      if (resolvedRequestOptions.maxAmountAtomic !== undefined) {
        return {
          enabled: true,
          maxAmountAtomic: resolvedRequestOptions.maxAmountAtomic,
        };
      }
      return undefined;
    })();
    const requestX402Config = normalizeX402Config(
      requestX402Input,
      "requestOptions.x402",
      defaultX402Config,
    );
    const effectiveRequestTimeoutMs = requestX402Config.enabled
      ? Math.max(timeoutMs, requestX402Config.commandTimeoutMs || timeoutMs)
      : timeoutMs;
    const mergedHeaders = buildRequestHeaders(resolvedRequestOptions, true);

    const url = `${baseUrl}${normalizedPath}`;
    const signalState = createAbortSignal(effectiveRequestTimeoutMs, resolvedRequestOptions.signal);

    try {
      let responseStatus;
      let responseStatusText;
      let responseBody;
      let responseHeaders;

      if (requestX402Config.enabled) {
        const transportResult = await executeX402Transport(
          {
            url,
            path: normalizedPath,
            body,
            headers: mergedHeaders,
            timeoutMs: effectiveRequestTimeoutMs,
            signal: signalState.signal,
          },
          requestX402Config,
        );
        responseStatus = transportResult.status;
        responseStatusText = transportResult.statusText || "";
        responseBody = transportResult.responseBody;
        responseHeaders = transportResult.responseHeaders || {};
      } else {
        if (!hasFetch) {
          throw new MercuryTrustError(
            "Global fetch is not available and x402 transport is disabled.",
            { code: "FETCH_UNAVAILABLE" },
          );
        }
        const response = await fetch(url, {
          method: "POST",
          headers: mergedHeaders,
          body: JSON.stringify(body),
          signal: signalState.signal,
        });
        const responseText = await response.text();
        const parsedBody = parseJsonIfPossible(responseText);
        responseStatus = response.status;
        responseStatusText = response.statusText;
        responseBody = parsedBody === undefined ? responseText : parsedBody;
        responseHeaders = normalizeResponseHeaders(response.headers);
      }

      const parsedBody =
        typeof responseBody === "string"
          ? parseJsonIfPossible(responseBody)
          : (responseBody !== undefined ? responseBody : undefined);
      const responseText =
        typeof responseBody === "string"
          ? responseBody
          : (responseBody === undefined ? "" : JSON.stringify(responseBody));

      if (!(responseStatus >= 200 && responseStatus < 300)) {
        throw new MercuryTrustHttpError(
          buildErrorMessageForResponse(
            normalizedPath,
            { status: responseStatus, statusText: responseStatusText || "" },
            parsedBody,
            responseText,
            "POST",
          ),
          {
            status: responseStatus,
            statusText: responseStatusText,
            url,
            method: "POST",
            responseBody: parsedBody === undefined ? responseBody : parsedBody,
            responseHeaders,
          },
        );
      }

      return parsedBody === undefined ? {} : parsedBody;
    } catch (error) {
      if (error instanceof MercuryTrustError) {
        throw error;
      }
      if (error && error.name === "AbortError") {
        throw new MercuryTrustNetworkError(
          `Mercury Trust API request timed out after ${effectiveRequestTimeoutMs}ms for POST ${normalizedPath}.`,
          { path: normalizedPath, timeoutMs: effectiveRequestTimeoutMs },
        );
      }
      throw new MercuryTrustNetworkError(
        `Mercury Trust API request failed for POST ${normalizedPath}: ${error.message}`,
        { path: normalizedPath, cause: error },
      );
    } finally {
      signalState.cleanup();
    }
  }

  async function get(path, query, requestOptions) {
    const normalizedPath = assertPostPath(path);
    const resolvedQuery = query === undefined ? {} : query;
    if (resolvedQuery !== null) {
      assertPlainObject(resolvedQuery, "query");
    }

    const resolvedRequestOptions = requestOptions === undefined ? {} : requestOptions;
    assertPlainObject(resolvedRequestOptions, "requestOptions");
    const timeoutMs = normalizeTimeoutMs(
      resolvedRequestOptions.timeoutMs,
      "requestOptions.timeoutMs",
      defaultTimeoutMs,
    );
    const mergedHeaders = buildRequestHeaders(resolvedRequestOptions, false);
    const url = buildUrlWithQuery(baseUrl, normalizedPath, resolvedQuery, "query");
    const signalState = createAbortSignal(timeoutMs, resolvedRequestOptions.signal);

    try {
      if (!hasFetch) {
        throw new MercuryTrustError(
          "Global fetch is not available in this runtime. Use Node.js 18+ or provide a fetch polyfill.",
          { code: "FETCH_UNAVAILABLE" },
        );
      }
      const response = await fetch(url, {
        method: "GET",
        headers: mergedHeaders,
        signal: signalState.signal,
      });
      const responseText = await response.text();
      const parsedBody = parseJsonIfPossible(responseText);
      const responseBody = parsedBody === undefined ? responseText : parsedBody;
      const responseHeaders = normalizeResponseHeaders(response.headers);

      if (!(response.status >= 200 && response.status < 300)) {
        throw new MercuryTrustHttpError(
          buildErrorMessageForResponse(
            normalizedPath,
            { status: response.status, statusText: response.statusText || "" },
            parsedBody,
            responseText,
            "GET",
          ),
          {
            status: response.status,
            statusText: response.statusText,
            url,
            method: "GET",
            responseBody: parsedBody === undefined ? responseBody : parsedBody,
            responseHeaders,
          },
        );
      }

      return parsedBody === undefined ? {} : parsedBody;
    } catch (error) {
      if (error instanceof MercuryTrustError) {
        throw error;
      }
      if (error && error.name === "AbortError") {
        throw new MercuryTrustNetworkError(
          `Mercury Trust API request timed out after ${timeoutMs}ms for GET ${normalizedPath}.`,
          { path: normalizedPath, timeoutMs },
        );
      }
      throw new MercuryTrustNetworkError(
        `Mercury Trust API request failed for GET ${normalizedPath}: ${error.message}`,
        { path: normalizedPath, cause: error },
      );
    } finally {
      signalState.cleanup();
    }
  }

  async function verifyDelegation(input, requestOptions) {
    return post("/api/trust/delegation/verify", validateDelegationPayload(input), requestOptions);
  }

  async function attestIdentity(input, requestOptions) {
    return post("/api/trust/identity/attest", validateIdentityPayload(input), requestOptions);
  }

  async function enforceMemoryPolicy(input, requestOptions) {
    return post("/api/trust/memory/enforce", validateMemoryPayload(input), requestOptions);
  }

  async function quickCheck(input, requestOptions) {
    return post("/api/trust/quick-check", validateQuickCheckPayload(input), requestOptions);
  }

  async function createWalletChallenge(input, requestOptions) {
    return post(
      "/api/trust/wallet/challenges",
      validateObjectPayload(input, "createWalletChallenge input"),
      requestOptions,
    );
  }

  async function verifyWalletProof(input, requestOptions) {
    return post(
      "/api/trust/wallet/verify",
      validateObjectPayload(input, "verifyWalletProof input"),
      requestOptions,
    );
  }

  async function issueDelegation(input, requestOptions) {
    return post(
      "/api/trust/delegations/issue",
      validateObjectPayload(input, "issueDelegation input"),
      requestOptions,
    );
  }

  async function revokeDelegation(delegationId, input, requestOptions) {
    const normalizedDelegationId = toNonEmptyString(
      delegationId,
      "revokeDelegation.delegationId",
      true,
    );
    return post(
      `/api/trust/delegations/${encodeURIComponent(normalizedDelegationId)}/revoke`,
      validateOptionalObjectPayload(input, "revokeDelegation input"),
      requestOptions,
    );
  }

  async function registerManifest(input, requestOptions) {
    return post(
      "/api/trust/manifests/register",
      validateObjectPayload(input, "registerManifest input"),
      requestOptions,
    );
  }

  async function revokeManifest(manifestId, input, requestOptions) {
    const normalizedManifestId = toNonEmptyString(manifestId, "revokeManifest.manifestId", true);
    return post(
      `/api/trust/manifests/${encodeURIComponent(normalizedManifestId)}/revoke`,
      validateOptionalObjectPayload(input, "revokeManifest input"),
      requestOptions,
    );
  }

  async function revokeWalletProof(proofId, input, requestOptions) {
    const normalizedProofId = toNonEmptyString(proofId, "revokeWalletProof.proofId", true);
    return post(
      `/api/trust/wallet/proofs/${encodeURIComponent(normalizedProofId)}/revoke`,
      validateOptionalObjectPayload(input, "revokeWalletProof input"),
      requestOptions,
    );
  }

  async function writeDecisionMemory(input, requestOptions) {
    return post(
      "/api/trust/decisions",
      validateObjectPayload(input, "writeDecisionMemory input"),
      requestOptions,
    );
  }

  async function getLatestDecision(query, requestOptions) {
    return get(
      "/api/trust/decisions/latest",
      validateOptionalObjectPayload(query, "getLatestDecision query"),
      requestOptions,
    );
  }

  async function getDecisionHistory(query, requestOptions) {
    return get(
      "/api/trust/decisions/history",
      validateOptionalObjectPayload(query, "getDecisionHistory query"),
      requestOptions,
    );
  }

  async function checkDecisionConsistency(query, requestOptions) {
    return get(
      "/api/trust/decisions/consistency",
      validateOptionalObjectPayload(query, "checkDecisionConsistency query"),
      requestOptions,
    );
  }

  async function verifyTrustReceipt(input, requestOptions) {
    return post(
      "/api/trust/receipts/verify",
      validateTrustReceiptVerificationInput(input),
      requestOptions,
    );
  }

  async function gateAction(input, requestOptions) {
    const validated = validateGateActionInput(input);
    const quickCheckResponse = await quickCheck(validated.quickCheckInput, requestOptions);
    const quickDecision = extractGateDecision(quickCheckResponse) || "review";
    const shouldEscalate =
      !validated.controls.quickCheckOnly &&
      (quickDecision === "review"
        ? validated.controls.escalateOnReview
        : validated.controls.deepCheckOnAllow);

    if (!shouldEscalate || quickDecision === "deny") {
      return {
        allowed: quickDecision === "allow",
        stage: "quick-check",
        escalated: false,
        needsDeepCheck: quickDecision === "review" && !validated.controls.quickCheckOnly,
        finalDecision: quickDecision,
        reason: extractGateReason(quickCheckResponse),
        quickCheck: quickCheckResponse,
        deepCheck: null,
        receipt: extractTrustReceipt(quickCheckResponse),
      };
    }

    const deepInput = buildDeepCheckInput(validated.quickCheckInput.mode, validated.quickCheckInput);
    let deepCheckResponse;
    if (validated.quickCheckInput.mode === "delegation") {
      deepCheckResponse = await verifyDelegation(deepInput, requestOptions);
    } else if (validated.quickCheckInput.mode === "identity") {
      deepCheckResponse = await attestIdentity(deepInput, requestOptions);
    } else {
      deepCheckResponse = await enforceMemoryPolicy(deepInput, requestOptions);
    }

    const deepDecision = extractGateDecision(deepCheckResponse) || "review";
    return {
      allowed: deepDecision === "allow",
      stage: "deep-check",
      escalated: true,
      needsDeepCheck: false,
      finalDecision: deepDecision,
      reason: extractGateReason(deepCheckResponse) || extractGateReason(quickCheckResponse),
      quickCheck: quickCheckResponse,
      deepCheck: deepCheckResponse,
      receipt: extractTrustReceipt(deepCheckResponse) || extractTrustReceipt(quickCheckResponse),
    };
  }

  return Object.freeze({
    baseUrl,
    get,
    post,
    verifyDelegation,
    attestIdentity,
    enforceMemoryPolicy,
    quickCheck,
    createWalletChallenge,
    verifyWalletProof,
    issueDelegation,
    revokeDelegation,
    registerManifest,
    revokeManifest,
    revokeWalletProof,
    writeDecisionMemory,
    getLatestDecision,
    getDecisionHistory,
    checkDecisionConsistency,
    verifyTrustReceipt,
    gateAction,
  });
}

module.exports = {
  MERCURY_TRUST_DEFAULT_BASE_URL,
  MERCURY_TRUST_DEFAULT_TIMEOUT_MS,
  MERCURY_TRUST_DEFAULT_X402_MAX_AMOUNT_ATOMIC,
  MERCURY_TRUST_DEFAULT_X402_RUNNER,
  MERCURY_TRUST_DEFAULT_X402_AWAL_PACKAGE,
  TRUST_MODES,
  MercuryTrustError,
  MercuryTrustValidationError,
  MercuryTrustHttpError,
  MercuryTrustNetworkError,
  createTrustClient,
};
