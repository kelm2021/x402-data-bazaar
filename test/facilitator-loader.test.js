const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_AUTO_FACILITATORS,
  getConfiguredFacilitatorUrl,
  getFacilitatorCandidates,
  getFacilitatorMode,
  getFacilitatorProvider,
  loadFacilitator,
} = require("../lib/facilitator-loader");

test("facilitator provider defaults to auto", () => {
  assert.equal(getFacilitatorProvider({}), "auto");
});

test("facilitator provider parsing is case-insensitive", () => {
  assert.equal(
    getFacilitatorProvider({ X402_FACILITATOR: "  PayAi  " }),
    "payai",
  );
});

test("configured facilitator URL prefers explicit override", () => {
  assert.equal(
    getConfiguredFacilitatorUrl({
      X402_FACILITATOR: "auto",
      X402_FACILITATOR_URL: "https://custom.facilitator.example/x402",
    }),
    "https://custom.facilitator.example/x402",
  );
});

test("configured facilitator URL resolves known providers", () => {
  assert.equal(
    getConfiguredFacilitatorUrl({ X402_FACILITATOR: "daydreams" }),
    "https://facilitator.daydreams.systems",
  );
  assert.equal(
    getConfiguredFacilitatorUrl({ X402_FACILITATOR: "dexter" }),
    "https://x402.dexter.cash",
  );
});

test("auto mode resolves to first app-managed fallback URL", () => {
  assert.equal(
    getConfiguredFacilitatorUrl({ X402_FACILITATOR: "auto" }),
    "https://facilitator.payai.network",
  );
});

test("facilitator candidate chain expands auto and appends fallbacks", () => {
  assert.deepEqual(
    getFacilitatorCandidates({
      X402_FACILITATOR: "auto",
      X402_FACILITATOR_FALLBACKS: "coinbase",
      CDP_API_KEY_ID: "id",
      CDP_API_KEY_SECRET: "secret",
    }),
    [...DEFAULT_AUTO_FACILITATORS, "coinbase"],
  );
});

test("auto facilitator chain excludes daydreams and openx402 by default", () => {
  assert.deepEqual(
    getFacilitatorCandidates({ X402_FACILITATOR: "auto" }),
    ["payai", "dexter"],
  );
});

test("facilitator mode defaults to failover", () => {
  assert.equal(getFacilitatorMode({}), "failover");
});

test("loadFacilitator resolves first candidate when probe is disabled", async () => {
  const facilitator = await loadFacilitator(
    { X402_FACILITATOR: "auto" },
    { probeFacilitator: false },
  );
  assert.equal(facilitator.url, "https://facilitator.payai.network");
});

test("loadFacilitator supports dexter when selected", async () => {
  const facilitator = await loadFacilitator(
    { X402_FACILITATOR: "dexter" },
    { probeFacilitator: false },
  );
  assert.equal(facilitator.url, "https://x402.dexter.cash");
});

test("loadFacilitator rejects unsupported providers", async () => {
  await assert.rejects(
    () => loadFacilitator({ X402_FACILITATOR: "invalid-provider" }),
    /Unsupported X402_FACILITATOR/,
  );
});
