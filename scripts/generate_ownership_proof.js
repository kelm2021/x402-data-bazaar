#!/usr/bin/env node

const fetch = require("node-fetch");
const { privateKeyToAccount } = require("viem/accounts");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (!token.startsWith("--")) {
      continue;
    }

    const separatorIndex = token.indexOf("=");
    if (separatorIndex >= 0) {
      const key = token.slice(2, separatorIndex);
      parsed[key] = token.slice(separatorIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function normalizeOrigin(value) {
  const fallback = process.env.PUBLIC_BASE_URL || "https://x402.aurelianflo.com";
  const candidate = String(value || fallback).trim();
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return url.origin;
  } catch (_error) {
    return null;
  }
}

function normalizePrivateKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/^0x[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }

  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return `0x${normalized}`;
  }

  return null;
}

async function verifyProof({ proof, origin, payTo }) {
  const input = {
    json: {
      ownershipProofs: [proof],
      origin,
      payToAddresses: [payTo],
    },
  };
  const encodedInput = encodeURIComponent(JSON.stringify(input));
  const response = await fetch(
    `https://www.x402scan.com/api/trpc/public.resources.verifyOwnership?input=${encodedInput}`,
    {
      headers: {
        accept: "application/json",
      },
    },
  );
  return response.json();
}

async function main() {
  const args = parseArgs();
  const origin = normalizeOrigin(args.origin);
  const privateKey = normalizePrivateKey(
    args["private-key"] ||
      process.env.PAY_TO_PRIVATE_KEY ||
      process.env.X402_PAY_TO_PRIVATE_KEY ||
      process.env.EVM_PRIVATE_KEY,
  );

  if (!origin) {
    throw new Error("Invalid origin URL. Pass --origin https://your-domain.");
  }

  if (!privateKey) {
    throw new Error(
      "Missing private key. Pass --private-key <0x...> or set PAY_TO_PRIVATE_KEY.",
    );
  }

  const account = privateKeyToAccount(privateKey);
  const ownershipProof = await account.signMessage({ message: origin });

  const output = {
    origin,
    payTo: account.address,
    ownershipProof,
    ownershipProofsEnvValue: JSON.stringify([ownershipProof]),
  };

  if (String(args.verify || "").toLowerCase() === "true") {
    output.verification = await verifyProof({
      proof: ownershipProof,
      origin,
      payTo: account.address,
    });
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
