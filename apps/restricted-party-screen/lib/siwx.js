const { Redis } = require("@upstash/redis");
const { createPublicClient, http } = require("viem");
const { base, baseSepolia } = require("viem/chains");
const {
  InMemorySIWxStorage,
  createSIWxRequestHook,
  createSIWxSettleHook,
  declareSIWxExtension,
  siwxResourceServerExtension,
} = require("@x402/extensions/sign-in-with-x");

const SIWX_NAMESPACE = "siwx:v1";
const DEFAULT_NONCE_TTL_SECONDS = 15 * 60;
const DEFAULT_STATEMENT =
  "Sign in with your wallet to access previously purchased restricted-party screening results.";
const DEFAULT_EVM_CHAIN_ID = 8453;

function resolveEvmChain(options = {}) {
  const env = options.env ?? process.env;
  const chainId = Number(options.chainId ?? env.SIWX_EVM_CHAIN_ID ?? DEFAULT_EVM_CHAIN_ID);

  if (chainId === 84532) {
    return baseSepolia;
  }

  return base;
}

function createSIWxVerifyOptions(options = {}) {
  const env = options.env ?? process.env;
  const chain = options.chain ?? resolveEvmChain(options);
  const rpcUrl = options.rpcUrl ?? env.SIWX_EVM_RPC_URL ?? null;
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl || undefined),
  });

  return {
    ...options.verifyOptions,
    evmVerifier: options.verifyOptions?.evmVerifier ?? client.verifyMessage,
  };
}

function normalizeAddress(address) {
  return String(address ?? "").trim().toLowerCase();
}

function createRedisClient(options = {}) {
  const env = options.env ?? process.env;
  const url = options.url ?? env.KV_REST_API_URL ?? null;
  const token = options.token ?? env.KV_REST_API_TOKEN ?? null;

  if (!url || !token) {
    return null;
  }

  return new Redis({
    url,
    token,
  });
}

class RedisSIWxStorage {
  constructor(options = {}) {
    this.redis = options.redis;
    this.namespace = options.namespace ?? SIWX_NAMESPACE;
    this.nonceTtlSeconds = Math.max(
      60,
      Number(options.nonceTtlSeconds ?? DEFAULT_NONCE_TTL_SECONDS) || DEFAULT_NONCE_TTL_SECONDS,
    );
  }

  getPaymentKey(resource) {
    return `${this.namespace}:resource:${resource}`;
  }

  getNonceKey(nonce) {
    return `${this.namespace}:nonce:${nonce}`;
  }

  async hasPaid(resource, address) {
    const normalizedAddress = normalizeAddress(address);
    if (!resource || !normalizedAddress) {
      return false;
    }

    return Boolean(await this.redis.sismember(this.getPaymentKey(resource), normalizedAddress));
  }

  async recordPayment(resource, address) {
    const normalizedAddress = normalizeAddress(address);
    if (!resource || !normalizedAddress) {
      return;
    }

    await this.redis.sadd(this.getPaymentKey(resource), normalizedAddress);
  }

  async hasUsedNonce(nonce) {
    if (!nonce) {
      return false;
    }

    return Boolean(await this.redis.get(this.getNonceKey(nonce)));
  }

  async recordNonce(nonce) {
    if (!nonce) {
      return;
    }

    await this.redis.set(this.getNonceKey(nonce), "1", {
      ex: this.nonceTtlSeconds,
    });
  }
}

function createSIWxStorage(options = {}) {
  const redis = options.redis ?? createRedisClient(options);

  if (!redis) {
    return {
      storage: new InMemorySIWxStorage(),
      backend: "memory",
    };
  }

  return {
    storage: new RedisSIWxStorage({
      redis,
      namespace: options.namespace,
      nonceTtlSeconds: options.nonceTtlSeconds,
    }),
    backend: "upstash-redis",
  };
}

function createSIWxRouteExtension(options = {}) {
  const statement = options.statement ?? DEFAULT_STATEMENT;

  return declareSIWxExtension({
    statement,
  });
}

function createSIWxHooks(options = {}) {
  const { storage, backend } = createSIWxStorage(options);
  const onEvent = options.onEvent;

  return {
    backend,
    requestHook: createSIWxRequestHook({
      storage,
      onEvent,
      verifyOptions: createSIWxVerifyOptions(options),
    }),
    settleHook: createSIWxSettleHook({
      storage,
      onEvent,
    }),
    routeExtension: createSIWxRouteExtension(options),
    resourceServerExtension: siwxResourceServerExtension,
  };
}

function createSIWxPublicConfig(options = {}) {
  const nonceTtlSeconds =
    Math.max(
      60,
      Number(options.nonceTtlSeconds ?? DEFAULT_NONCE_TTL_SECONDS) || DEFAULT_NONCE_TTL_SECONDS,
    ) || DEFAULT_NONCE_TTL_SECONDS;

  return {
    enabled: true,
    statement: options.statement ?? DEFAULT_STATEMENT,
    storage: options.backend ?? "memory",
    nonceTtlSeconds,
  };
}

module.exports = {
  DEFAULT_NONCE_TTL_SECONDS,
  DEFAULT_STATEMENT,
  RedisSIWxStorage,
  createSIWxHooks,
  createSIWxPublicConfig,
  createSIWxRouteExtension,
  createSIWxStorage,
  createSIWxVerifyOptions,
  resolveEvmChain,
};
