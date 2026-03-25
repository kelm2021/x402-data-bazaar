const test = require("node:test");
const assert = require("node:assert/strict");
const { base, baseSepolia } = require("viem/chains");

const { createSIWxVerifyOptions, resolveEvmChain } = require("../lib/siwx");

test("resolveEvmChain defaults to Base mainnet", () => {
  assert.equal(resolveEvmChain().id, base.id);
});

test("resolveEvmChain supports Base Sepolia override", () => {
  assert.equal(resolveEvmChain({ chainId: 84532 }).id, baseSepolia.id);
});

test("createSIWxVerifyOptions provides an EVM verifier by default", () => {
  const verifyOptions = createSIWxVerifyOptions();

  assert.equal(typeof verifyOptions.evmVerifier, "function");
});

test("createSIWxVerifyOptions preserves a caller-supplied verifier", () => {
  const customVerifier = async () => true;
  const verifyOptions = createSIWxVerifyOptions({
    verifyOptions: {
      evmVerifier: customVerifier,
    },
  });

  assert.equal(verifyOptions.evmVerifier, customVerifier);
});
