#!/usr/bin/env node

const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { decodePaymentResponseHeader } = require("@x402/core/http");
const { toClientEvmSigner } = require("@x402/evm");
const { registerExactEvmScheme } = require("@x402/evm/exact/client");
const { createSIWxClientHook, SIGN_IN_WITH_X } = require("@x402/extensions/sign-in-with-x");
const { createPublicClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base, baseSepolia } = require("viem/chains");
const sellerConfig = require("../apps/restricted-party-screen/seller.config.json");

const sellerRoutes =
  Array.isArray(sellerConfig.routes) && sellerConfig.routes.length
    ? sellerConfig.routes
    : [sellerConfig.route];
const primaryRoute = sellerRoutes[0];
const DEFAULT_URL = `${sellerConfig.baseUrl}${primaryRoute.canonicalPath || primaryRoute.resourcePath}`;
const DEFAULT_MAX_AMOUNT_ATOMIC = 10000n;

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function normalizePrivateKey(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function resolveChain(chainIdValue) {
  const chainId = Number(chainIdValue || 8453);
  if (chainId === 84532) {
    return baseSepolia;
  }

  return base;
}

function createHeaderSnapshot(headers) {
  return Object.fromEntries(headers.entries());
}

async function readJsonMaybe(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchSnapshot(url, init = {}) {
  const response = await fetch(url, init);
  const body = await readJsonMaybe(response.clone());

  return {
    status: response.status,
    statusText: response.statusText,
    headers: createHeaderSnapshot(response.headers),
    body,
  };
}

function getPaymentRequiredFromSnapshot(httpClient, snapshot) {
  if (snapshot.status !== 402) {
    return null;
  }

  return httpClient.getPaymentRequiredResponse((name) => snapshot.headers[name.toLowerCase()], snapshot.body);
}

function getAcceptedAmountAtomic(paymentRequired) {
  const accepted = paymentRequired?.accepts?.[0];
  if (!accepted?.amount) {
    return null;
  }

  try {
    return BigInt(accepted.amount);
  } catch {
    return null;
  }
}

function getSettlement(snapshot) {
  const encoded = snapshot.headers["payment-response"];
  if (!encoded) {
    return null;
  }

  return decodePaymentResponseHeader(encoded);
}

async function buildHttpClient({ chain, privateKey, rpcUrl }) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl || undefined);
  const publicClient = createPublicClient({
    chain,
    transport,
  });
  const paymentSigner = toClientEvmSigner(account, publicClient);

  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: paymentSigner,
    networks: [`eip155:${chain.id}`],
  });

  const httpClient = new x402HTTPClient(client).onPaymentRequired(createSIWxClientHook(account));

  return {
    account,
    httpClient,
    publicClient,
  };
}

async function runDemo(options) {
  const url = options.url;
  const maxAmountAtomic = BigInt(options.maxAmountAtomic);
  const { account, httpClient, publicClient } = await buildHttpClient(options);
  const result = {
    url,
    account: account.address,
    chainId: options.chain.id,
    firstCycle: {},
    secondCycle: {},
  };

  const firstAttempt = await fetchSnapshot(url);
  result.firstCycle.firstAttempt = firstAttempt;
  if (firstAttempt.status !== 402) {
    throw new Error(`Expected first attempt to return 402, got ${firstAttempt.status}`);
  }

  const firstPaymentRequired = getPaymentRequiredFromSnapshot(httpClient, firstAttempt);
  const acceptedAmountAtomic = getAcceptedAmountAtomic(firstPaymentRequired);
  result.acceptedAmountAtomic = acceptedAmountAtomic ? acceptedAmountAtomic.toString() : null;
  result.supportedChains =
    firstPaymentRequired?.extensions?.[SIGN_IN_WITH_X]?.supportedChains?.map((entry) => entry.chainId) ?? [];

  if (acceptedAmountAtomic !== null && acceptedAmountAtomic > maxAmountAtomic) {
    throw new Error(
      `Route price ${acceptedAmountAtomic.toString()} exceeds max ${maxAmountAtomic.toString()} atomic units.`,
    );
  }

  const firstSIWxHeaders = await httpClient.handlePaymentRequired(firstPaymentRequired);
  result.firstCycle.siwxHeadersGenerated = Boolean(firstSIWxHeaders?.[SIGN_IN_WITH_X]);
  if (!firstSIWxHeaders) {
    throw new Error("SIWX headers were not generated from the initial 402 response.");
  }

  const firstSIWxRetry = await fetchSnapshot(url, {
    headers: firstSIWxHeaders,
  });
  result.firstCycle.siwxRetry = firstSIWxRetry;
  if (firstSIWxRetry.status !== 402) {
    throw new Error(`Expected pre-payment SIWX retry to remain 402, got ${firstSIWxRetry.status}.`);
  }

  const paymentPayload = await httpClient.createPaymentPayload(firstPaymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const firstPaidResponse = await fetchSnapshot(url, {
    headers: paymentHeaders,
  });
  result.firstCycle.paymentRetry = firstPaidResponse;
  result.firstCycle.settlement = getSettlement(firstPaidResponse);
  if (firstPaidResponse.status !== 200) {
    throw new Error(`Expected payment retry to return 200, got ${firstPaidResponse.status}.`);
  }
  if (!result.firstCycle.settlement?.transaction) {
    throw new Error("First paid response did not include a PAYMENT-RESPONSE settlement header.");
  }

  const nativeBalance = await publicClient.getBalance({
    address: account.address,
  });
  result.accountNativeBalanceWei = nativeBalance.toString();

  const secondAttempt = await fetchSnapshot(url);
  result.secondCycle.firstAttempt = secondAttempt;
  if (secondAttempt.status !== 402) {
    throw new Error(`Expected second fresh attempt to return 402, got ${secondAttempt.status}.`);
  }

  const secondPaymentRequired = getPaymentRequiredFromSnapshot(httpClient, secondAttempt);
  const secondSIWxHeaders = await httpClient.handlePaymentRequired(secondPaymentRequired);
  result.secondCycle.siwxHeadersGenerated = Boolean(secondSIWxHeaders?.[SIGN_IN_WITH_X]);
  if (!secondSIWxHeaders) {
    throw new Error("SIWX headers were not generated for the reclaim attempt.");
  }

  const secondSIWxRetry = await fetchSnapshot(url, {
    headers: secondSIWxHeaders,
  });
  result.secondCycle.siwxRetry = secondSIWxRetry;
  result.secondCycle.settlement = getSettlement(secondSIWxRetry);
  result.secondCycle.reclaimed = secondSIWxRetry.status === 200 && !result.secondCycle.settlement;

  if (!result.secondCycle.reclaimed) {
    throw new Error(
      `SIWX reclaim failed. Retry status: ${secondSIWxRetry.status}. New settlement: ${Boolean(
        result.secondCycle.settlement?.transaction,
      )}.`,
    );
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = normalizePrivateKey(
    args["private-key"] ??
      process.env.SIWX_DEMO_PRIVATE_KEY ??
      process.env.RESTRICTED_PARTY_SCREEN_DEMO_PRIVATE_KEY ??
      process.env.X402_DEMO_PRIVATE_KEY,
  );

  if (!privateKey) {
    throw new Error(
      "Missing demo private key. Set SIWX_DEMO_PRIVATE_KEY (or pass --private-key) to a funded Base wallet.",
    );
  }

  const chain = resolveChain(args["chain-id"] ?? process.env.SIWX_EVM_CHAIN_ID);
  const result = await runDemo({
    chain,
    maxAmountAtomic:
      args["max-amount-atomic"] ??
      process.env.SIWX_DEMO_MAX_AMOUNT_ATOMIC ??
      DEFAULT_MAX_AMOUNT_ATOMIC.toString(),
    privateKey,
    rpcUrl: args["rpc-url"] ?? process.env.SIWX_EVM_RPC_URL ?? "https://mainnet.base.org",
    url: args.url ?? process.env.SIWX_DEMO_URL ?? DEFAULT_URL,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
