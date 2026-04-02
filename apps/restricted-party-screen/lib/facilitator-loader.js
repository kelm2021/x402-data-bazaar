"use strict";

const DEFAULT_COINBASE_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const FACILITATOR_URLS = Object.freeze({
  payai: "https://facilitator.payai.network",
  openx402: "https://open.x402.host",
  daydreams: "https://facilitator.daydreams.systems",
  dexter: "https://x402.dexter.cash",
});
const DEFAULT_AUTO_FACILITATORS = Object.freeze(["payai", "dexter"]);
const SUPPORTED_X402_FACILITATORS = Object.freeze([
  "auto",
  "coinbase",
  "payai",
  "openx402",
  "daydreams",
  "dexter",
]);
const roundRobinOffsets = new Map();

function normalizeProvider(value) {
  const normalized = String(value == null ? "auto" : value)
    .trim()
    .toLowerCase();
  return normalized || "auto";
}

function normalizeUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function getFacilitatorProvider(env = process.env) {
  const normalized = String(env.X402_FACILITATOR == null ? "auto" : env.X402_FACILITATOR)
    .split(",")
    .map((entry) => normalizeProvider(entry))
    .find(Boolean);
  return normalized || "auto";
}

function parseProviderList(value) {
  return String(value == null ? "" : value)
    .split(",")
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => normalizeProvider(entry))
    .filter(Boolean);
}

function expandProvider(provider, env = process.env) {
  if (provider !== "auto") {
    return [provider];
  }

  const expanded = [...DEFAULT_AUTO_FACILITATORS];
  if (normalizeUrl(env.CDP_API_KEY_ID) && normalizeUrl(env.CDP_API_KEY_SECRET)) {
    expanded.push("coinbase");
  }
  return expanded;
}

function dedupeProviders(providers) {
  const seen = new Set();
  const ordered = [];
  for (const provider of providers) {
    if (seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    ordered.push(provider);
  }
  return ordered;
}

function getFacilitatorCandidates(env = process.env) {
  const primaries = parseProviderList(env.X402_FACILITATOR);
  const fallbacks = parseProviderList(env.X402_FACILITATOR_FALLBACKS);
  const merged = [...(primaries.length ? primaries : ["auto"]), ...fallbacks];
  return dedupeProviders(
    merged.flatMap((provider) => expandProvider(provider, env)),
  );
}

function getFacilitatorMode(env = process.env) {
  const mode = String(env.X402_FACILITATOR_MODE == null ? "failover" : env.X402_FACILITATOR_MODE)
    .trim()
    .toLowerCase();
  return mode === "round_robin" ? "round_robin" : "failover";
}

function maybeRotateCandidates(candidates, env = process.env) {
  if (!Array.isArray(candidates) || candidates.length <= 1) {
    return candidates;
  }

  if (getFacilitatorMode(env) !== "round_robin") {
    return candidates;
  }

  const key = candidates.join(",");
  const offset = roundRobinOffsets.get(key) || 0;
  const nextOffset = (offset + 1) % candidates.length;
  roundRobinOffsets.set(key, nextOffset);
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}

function getFacilitatorUrl(provider) {
  if (provider === "coinbase") {
    return DEFAULT_COINBASE_FACILITATOR_URL;
  }
  return FACILITATOR_URLS[provider] || null;
}

async function withTimeout(promise, ms, context) {
  const timeoutMs = Math.max(1000, Number(ms || 10000));
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${context} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function assertFacilitatorHealthy(facilitator, options = {}) {
  const timeoutMs = options.probeTimeoutMs ?? 10000;
  let client = facilitator;

  if (
    !client ||
    typeof client.getSupported !== "function"
  ) {
    const { HTTPFacilitatorClient } = require("@x402/core/server");
    client = new HTTPFacilitatorClient(facilitator);
  }

  const supported = await withTimeout(
    Promise.resolve(client.getSupported()),
    timeoutMs,
    "Facilitator getSupported",
  );
  if (!supported || !Array.isArray(supported.kinds) || supported.kinds.length === 0) {
    throw new Error("Facilitator returned no supported payment kinds");
  }
}

function formatFailoverErrors(errors) {
  return errors
    .map((entry) => `${entry.provider}: ${entry.error?.message || String(entry.error)}`)
    .join("; ");
}

function getConfiguredFacilitatorUrl(env = process.env) {
  const explicitUrl = normalizeUrl(env.X402_FACILITATOR_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const candidates = getFacilitatorCandidates(env);
  return getFacilitatorUrl(candidates[0]);
}

async function loadCoinbaseFacilitator(env = process.env, options = {}) {
  const normalizeCredential =
    typeof options.normalizeCredential === "function"
      ? options.normalizeCredential
      : (value) => value;
  const normalizeSecret =
    typeof options.normalizeSecret === "function"
      ? options.normalizeSecret
      : normalizeCredential;

  const { createFacilitatorConfig } = await import("@coinbase/x402");
  return createFacilitatorConfig(
    normalizeCredential(env.CDP_API_KEY_ID),
    normalizeSecret(env.CDP_API_KEY_SECRET),
  );
}

async function loadSingleFacilitator(provider, env = process.env, options = {}) {
  if (!SUPPORTED_X402_FACILITATORS.includes(provider)) {
    throw new Error(
      `Unsupported X402_FACILITATOR: ${provider}. Supported values: ${SUPPORTED_X402_FACILITATORS.join(", ")}`,
    );
  }

  if (provider === "coinbase") {
    return loadCoinbaseFacilitator(env, options);
  }

  if (provider === "auto") {
    throw new Error("Provider 'auto' must be expanded before loading");
  }

  if (provider === "dexter") {
    return { url: getFacilitatorUrl(provider) };
  }

  const facilitators = await import("@swader/x402facilitators");
  const facilitator = facilitators[provider];
  if (!facilitator) {
    const facilitatorUrl = getFacilitatorUrl(provider);
    if (facilitatorUrl) {
      return { url: facilitatorUrl };
    }

    throw new Error(`Facilitator provider "${provider}" is not available`);
  }

  return facilitator;
}

async function loadFacilitator(env = process.env, options = {}) {
  const probe = options.probeFacilitator !== false;
  const candidates = maybeRotateCandidates(getFacilitatorCandidates(env), env);
  const errors = [];

  for (const provider of candidates) {
    try {
      const facilitator = await loadSingleFacilitator(provider, env, options);
      if (probe) {
        await assertFacilitatorHealthy(facilitator, options);
      }
      return facilitator;
    } catch (error) {
      errors.push({ provider, error });
    }
  }

  if (!candidates.length) {
    throw new Error(
      `No facilitator candidates resolved from X402_FACILITATOR${env.X402_FACILITATOR_FALLBACKS ? " and X402_FACILITATOR_FALLBACKS" : ""}`,
    );
  }

  throw new Error(
    `All facilitator candidates failed (${candidates.join(", ")}): ${formatFailoverErrors(errors)}`,
  );
}

module.exports = {
  DEFAULT_AUTO_FACILITATORS,
  DEFAULT_COINBASE_FACILITATOR_URL,
  SUPPORTED_X402_FACILITATORS,
  getFacilitatorCandidates,
  getFacilitatorMode,
  getConfiguredFacilitatorUrl,
  getFacilitatorProvider,
  loadCoinbaseFacilitator,
  loadFacilitator,
};
