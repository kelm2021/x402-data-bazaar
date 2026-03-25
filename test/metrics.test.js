const assert = require("node:assert/strict");
const test = require("node:test");
const fetch = require("node-fetch");

const { X402_NETWORK, createApp, createMetricsStore } = require("../app");

function createStubFacilitator() {
  return {
    verify: async () => ({ isValid: true }),
    settle: async () => ({
      success: true,
      transaction: "0x123",
      network: X402_NETWORK,
    }),
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }],
      extensions: [],
      signers: {},
    }),
  };
}

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }

          resolve(result);
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

function findRouteMetrics(summary, key) {
  const route = summary.routes.find((entry) => entry.key === key);
  assert.ok(route, `Expected metrics for route ${key}`);
  return route;
}

class FakeRedisPipeline {
  constructor(redis) {
    this.redis = redis;
    this.operations = [];
  }

  setnx(key, value) {
    this.operations.push(() => this.redis.setnx(key, value));
    return this;
  }

  set(key, value) {
    this.operations.push(() => this.redis.set(key, value));
    return this;
  }

  hincrby(key, field, amount) {
    this.operations.push(() => this.redis.hincrby(key, field, amount));
    return this;
  }

  sadd(key, value) {
    this.operations.push(() => this.redis.sadd(key, value));
    return this;
  }

  hset(key, values) {
    this.operations.push(() => this.redis.hset(key, values));
    return this;
  }

  hgetall(key) {
    this.operations.push(() => this.redis.hgetall(key));
    return this;
  }

  smembers(key) {
    this.operations.push(() => this.redis.smembers(key));
    return this;
  }

  expire(key, ttlSeconds) {
    this.operations.push(() => this.redis.expire(key, ttlSeconds));
    return this;
  }

  async exec() {
    return Promise.all(this.operations.map((operation) => operation()));
  }
}

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.hashes = new Map();
    this.sets = new Map();
  }

  pipeline() {
    return new FakeRedisPipeline(this);
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    this.values.set(key, String(value));
    return "OK";
  }

  async setnx(key, value) {
    if (this.values.has(key)) {
      return 0;
    }

    this.values.set(key, String(value));
    return 1;
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async smembers(key) {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sadd(key, value) {
    const entries = this.sets.get(key) ?? new Set();
    const previousSize = entries.size;
    entries.add(String(value));
    this.sets.set(key, entries);
    return entries.size > previousSize ? 1 : 0;
  }

  async hset(key, values) {
    const entry = { ...(this.hashes.get(key) ?? {}) };
    for (const [field, value] of Object.entries(values ?? {})) {
      entry[field] = String(value);
    }

    this.hashes.set(key, entry);
    return 1;
  }

  async hincrby(key, field, amount) {
    const entry = { ...(this.hashes.get(key) ?? {}) };
    entry[field] = String(Number(entry[field] ?? 0) + Number(amount));
    this.hashes.set(key, entry);
    return Number(entry[field]);
  }

  async expire() {
    return 1;
  }
}

function createStaticMetricsStore(summary) {
  return {
    storage: summary.storage,
    async record() {},
    async getSummary() {
      return summary;
    },
  };
}

test("metrics feed counts payment challenges by canonical route key", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/vin/1HGCM82633A004352`);
    assert.equal(apiResponse.status, 402);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const vinMetrics = findRouteMetrics(summary, "GET /api/vin/*");

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.total, 1);
    assert.equal(summary.totals.paymentRequired, 1);
    assert.equal(summary.totals.uniqueCallersSeen, 1);
    assert.equal(vinMetrics.total, 1);
    assert.equal(vinMetrics.paymentRequired, 1);
    assert.equal(summary.storage.persistent, false);
  });
});

test("metrics feed groups path-based weather challenges under the wildcard route key", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/weather/current/40.7128/-74.0060`);
    assert.equal(apiResponse.status, 402);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const weatherMetrics = findRouteMetrics(summary, "GET /api/weather/current/*");

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.total, 1);
    assert.equal(summary.totals.paymentRequired, 1);
    assert.equal(weatherMetrics.total, 1);
    assert.equal(weatherMetrics.paymentRequired, 1);
    assert.equal(weatherMetrics.lastPath, "/api/weather/current/40.7128/-74.0060");
  });
});

test("metrics fold paid head probes into the protected get route key", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    facilitatorLoader: async () => createStubFacilitator(),
  });

  await withServer(app, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      method: "HEAD",
    });
    assert.equal(apiResponse.status, 402);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const holidayMetrics = findRouteMetrics(summary, "GET /api/holidays/today/*");

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.total, 1);
    assert.equal(summary.totals.paymentRequired, 1);
    assert.equal(holidayMetrics.total, 1);
    assert.equal(holidayMetrics.paymentRequired, 1);
    assert.equal(
      summary.routes.some((entry) => entry.key === "HEAD /api/holidays/today/US"),
      false,
    );
  });
});

test("metrics dashboard renders successful route volume", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/holidays/today/US`);
    assert.equal(apiResponse.status, 200);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const holidayMetrics = findRouteMetrics(summary, "GET /api/holidays/today/*");

    assert.equal(summary.totals.total, 1);
    assert.equal(summary.totals.success, 1);
    assert.equal(holidayMetrics.total, 1);
    assert.equal(holidayMetrics.success, 1);

    const dashboardResponse = await fetch(`${baseUrl}/ops/metrics`);
    const html = await dashboardResponse.text();

    assert.equal(dashboardResponse.status, 200);
    assert.match(html, /Revenue &amp; Demand Dashboard|Revenue & Demand Dashboard/);
    assert.match(html, /All settled revenue/);
    assert.match(html, /Paid requests/);
    assert.match(html, /GET \/api\/holidays\/today\/\*/);
  });
});

test("metrics feed separates external paid usd from self-tagged verifications", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    metricsSourceSalt: "test-metrics-salt",
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const externalPaidResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "x-forwarded-for": "203.0.113.50",
        "user-agent": "curl/8.7.1",
        "x-payment": "paid",
      },
    });
    assert.equal(externalPaidResponse.status, 200);

    const selfTaggedPaidResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "x-forwarded-for": "198.51.100.22",
        "user-agent": "node-fetch/1.0",
        "x-metrics-source": "self",
        "x-payment": "paid",
      },
    });
    assert.equal(selfTaggedPaidResponse.status, 200);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const holidayMetrics = findRouteMetrics(summary, "GET /api/holidays/today/*");

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.paidSuccess, 2);
    assert.equal(summary.totals.externalPaidSuccess, 1);
    assert.equal(summary.totals.selfTaggedPaidSuccess, 1);
    assert.equal(summary.totals.externalPaidUsd, 0.008);
    assert.equal(summary.totals.selfTaggedPaidUsd, 0.008);
    assert.equal(summary.totals.paidUsd, 0.016);
    assert.equal(holidayMetrics.externalPaidSuccess, 1);
    assert.equal(holidayMetrics.externalPaidUsd, 0.008);
    assert.equal(holidayMetrics.selfTaggedPaidUsd, 0.008);
  });
});

test("metrics dashboard hides legacy free probe rows and groups routes by type", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    metricsStore: createStaticMetricsStore({
      generatedAt: "2026-03-16T16:20:00.000Z",
      startedAt: "2026-03-16T15:00:00.000Z",
      updatedAt: "2026-03-16T16:19:00.000Z",
      storage: {
        kind: "redis",
        persistent: true,
        label: "Upstash Redis via Vercel integration",
      },
      totals: {
        total: 42,
        success: 10,
        paidSuccess: 8,
        externalPaidSuccess: 7,
        selfTaggedPaidSuccess: 1,
        paymentRequired: 28,
        clientErrors: 3,
        serverErrors: 1,
        paidUsd: 0.021,
        externalPaidUsd: 0.018,
        selfTaggedPaidUsd: 0.003,
        averageLatencyMs: 91,
        uniqueCallersSeen: 3,
        uniqueServicesSeen: 2,
        selfTaggedRequests: 1,
        anonymousRequests: 41,
        uniqueRoutesSeen: 4,
      },
      routes: [
        {
          key: "GET /api/weather/current/*",
          method: "GET",
          routePath: "/api/weather/current/*",
          description: "Current weather conditions for exact coordinates.",
          priceLabel: "$0.003 USDC",
          total: 12,
          success: 3,
          paidSuccess: 3,
          externalPaidSuccess: 2,
          selfTaggedPaidSuccess: 1,
          paymentRequired: 9,
          clientErrors: 0,
          serverErrors: 0,
          paidUsd: 0.009,
          externalPaidUsd: 0.006,
          selfTaggedPaidUsd: 0.003,
          averageLatencyMs: 40,
          lastSeenAt: "2026-03-16T16:10:00.000Z",
          lastStatus: 402,
          lastPath: "/api/weather/current/40.7128/-74.0060",
        },
        {
          key: "GET /api/bls/cpi",
          method: "GET",
          routePath: "/api/bls/cpi",
          description: "Consumer Price Index history.",
          priceLabel: "$0.005 USDC",
          total: 8,
          success: 2,
          paidSuccess: 2,
          externalPaidSuccess: 2,
          selfTaggedPaidSuccess: 0,
          paymentRequired: 6,
          clientErrors: 0,
          serverErrors: 0,
          paidUsd: 0.01,
          externalPaidUsd: 0.01,
          selfTaggedPaidUsd: 0,
          averageLatencyMs: 120,
          lastSeenAt: "2026-03-16T16:11:00.000Z",
          lastStatus: 200,
          lastPath: "/api/bls/cpi",
        },
        {
          key: "GET /api/holidays/today/*",
          method: "GET",
          routePath: "/api/holidays/today/*",
          description: "Holiday and business-day intelligence.",
          priceLabel: "$0.002 USDC",
          total: 7,
          success: 1,
          paidSuccess: 1,
          externalPaidSuccess: 1,
          selfTaggedPaidSuccess: 0,
          paymentRequired: 6,
          clientErrors: 0,
          serverErrors: 0,
          paidUsd: 0.002,
          externalPaidUsd: 0.002,
          selfTaggedPaidUsd: 0,
          averageLatencyMs: 50,
          lastSeenAt: "2026-03-16T16:12:00.000Z",
          lastStatus: 402,
          lastPath: "/api/holidays/today/US",
        },
        {
          key: "HEAD /api/weather/current",
          method: "HEAD",
          routePath: "/api/weather/current",
          description: "Unconfigured route",
          priceLabel: "Free",
          total: 6,
          success: 0,
          paidSuccess: 0,
          paymentRequired: 0,
          clientErrors: 6,
          serverErrors: 0,
          averageLatencyMs: 1,
          lastSeenAt: "2026-03-16T16:13:00.000Z",
          lastStatus: 400,
          lastPath: "/api/weather/current",
        },
      ],
      services: [
        {
          serviceHost: "x402-data-bazaar.vercel.app",
          total: 21,
          success: 4,
          paidSuccess: 3,
          externalPaidSuccess: 2,
          selfTaggedPaidSuccess: 1,
          paymentRequired: 16,
          clientErrors: 1,
          serverErrors: 0,
          paidUsd: 0.008,
          externalPaidUsd: 0.005,
          selfTaggedPaidUsd: 0.003,
          averageLatencyMs: 82,
          lastSeenAt: "2026-03-16T16:14:00.000Z",
          lastRouteKey: "GET /api/weather/current/*",
          lastPath: "/api/weather/current/40.7128/-74.0060",
          routeCount: 3,
          routeKeys: [
            "GET /api/weather/current/*",
            "GET /api/holidays/today/*",
            "GET /api/bls/cpi",
          ],
        },
        {
          serviceHost: "x402-weather-decision.vercel.app",
          total: 9,
          success: 3,
          paidSuccess: 3,
          externalPaidSuccess: 3,
          selfTaggedPaidSuccess: 0,
          paymentRequired: 6,
          clientErrors: 0,
          serverErrors: 0,
          paidUsd: 0.009,
          externalPaidUsd: 0.009,
          selfTaggedPaidUsd: 0,
          averageLatencyMs: 679,
          lastSeenAt: "2026-03-16T16:15:00.000Z",
          lastRouteKey: "GET /api/weather/current/*",
          lastPath: "/api/weather/current/40.7128/-74.0060",
          routeCount: 1,
          routeKeys: ["GET /api/weather/current/*"],
        },
      ],
      callers: [],
      hourly: [],
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ops/metrics`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Weather &amp; Environment/);
    assert.match(html, /Government &amp; Civic Data/);
    assert.match(html, /Calendar &amp; Scheduling/);
    assert.match(html, /All settled revenue/);
    assert.match(html, /Paid requests/);
    assert.match(html, /\$0\.021/);
    assert.match(html, /legacy or retired rows hidden/i);
    assert.doesNotMatch(html, /HEAD \/api\/weather\/current/);
  });
});

test("metrics feed groups caller fingerprints without storing raw IPs or raw user agents", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    metricsSourceSalt: "test-metrics-salt",
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const selfTaggedResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "user-agent": "node-fetch/1.0",
        "x-forwarded-for": "198.51.100.10",
        "x-metrics-source": "self",
      },
    });
    assert.equal(selfTaggedResponse.status, 200);

    const anonymousResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "user-agent": "curl/8.7.1",
        "x-forwarded-for": "203.0.113.25",
      },
    });
    assert.equal(anonymousResponse.status, 200);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();
    const selfTaggedCaller = summary.callers.find(
      (entry) => entry.sourceKind === "self-tagged",
    );
    const anonymousCaller = summary.callers.find(
      (entry) => entry.sourceKind === "anonymous",
    );

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.attribution.mode, "salted-fingerprint");
    assert.equal(summary.totals.uniqueCallersSeen, 2);
    assert.equal(summary.totals.selfTaggedRequests, 1);
    assert.equal(summary.totals.anonymousRequests, 1);
    assert.ok(selfTaggedCaller);
    assert.ok(anonymousCaller);
    assert.match(selfTaggedCaller.sourceId, /^self_[0-9a-f]{12}$/);
    assert.match(anonymousCaller.sourceId, /^anon_[0-9a-f]{12}$/);
    assert.equal(selfTaggedCaller.agentClass, "node-fetch");
    assert.equal(anonymousCaller.agentClass, "curl");
    assert.equal(selfTaggedCaller.lastRouteKey, "GET /api/holidays/today/*");

    const summaryJson = JSON.stringify(summary);
    assert.equal(summaryJson.includes("198.51.100.10"), false);
    assert.equal(summaryJson.includes("203.0.113.25"), false);
    assert.equal(summaryJson.includes("node-fetch/1.0"), false);
    assert.equal(summaryJson.includes("curl/8.7.1"), false);
  });
});

test("metrics feed groups shared-store traffic by seller host", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const mainResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "x-forwarded-host": "x402-data-bazaar.vercel.app",
      },
    });
    assert.equal(mainResponse.status, 200);

    const sellerResponse = await fetch(`${baseUrl}/api/holidays/today/US`, {
      headers: {
        "x-forwarded-host": "x402-business-day-planner.vercel.app",
      },
    });
    assert.equal(sellerResponse.status, 200);

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.uniqueServicesSeen, 2);
    assert.equal(summary.services.length, 2);
    assert.deepEqual(
      summary.services.map((entry) => entry.serviceHost).sort(),
      ["x402-business-day-planner.vercel.app", "x402-data-bazaar.vercel.app"],
    );
    assert.equal(summary.services[0].routeCount, 1);
  });
});

test("metrics feed canonicalizes observed hosts and merges port variants", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const requests = [
      {
        url: `${baseUrl}/api/holidays/today/US`,
        headers: { "x-forwarded-host": "127.0.0.1:53183" },
      },
      {
        url: `${baseUrl}/api/holidays/today/US`,
        headers: { "x-forwarded-host": "127.0.0.1:53088" },
      },
      {
        url: `${baseUrl}/api/holidays/today/US`,
        headers: { "x-forwarded-host": "x402-data-bazaar.vercel.app:443" },
      },
      {
        url: `${baseUrl}/api/holidays/today/US`,
        headers: { "x-forwarded-host": "https://x402-data-bazaar.vercel.app:8443" },
      },
    ];

    for (const request of requests) {
      const response = await fetch(request.url, { headers: request.headers });
      assert.equal(response.status, 200);
    }

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    const summary = await metricsResponse.json();

    const hostTotals = Object.fromEntries(
      summary.services.map((entry) => [entry.serviceHost, entry.total]),
    );

    assert.equal(metricsResponse.status, 200);
    assert.equal(summary.totals.uniqueServicesSeen, 2);
    assert.equal(summary.services.length, 2);
    assert.equal(hostTotals["127.0.0.1"], 2);
    assert.equal(hostTotals["x402-data-bazaar.vercel.app"], 2);
  });
});

test("metrics summary backfills historical paid usd from route prices", async () => {
  const redisClient = new FakeRedis();
  const routeKey = "GET /api/holidays/today/*";
  const routeHashKey = `metrics:v1:route:${encodeURIComponent(routeKey)}`;

  await redisClient.sadd("metrics:v1:route-keys", routeKey);
  await redisClient.sadd("metrics:v1:source-keys", "anon_hist");
  await redisClient.sadd("metrics:v1:source-keys", "self_hist");
  await redisClient.hset("metrics:v1:totals", {
    total: "5",
    success: "2",
    paidSuccess: "2",
    paymentRequired: "3",
  });
  await redisClient.hset(routeHashKey, {
    key: routeKey,
    method: "GET",
    routePath: "/api/holidays/today/*",
    description: "Business-day intelligence for a country.",
    priceLabel: "$0.002 USDC",
    total: "5",
    success: "2",
    paidSuccess: "2",
    paymentRequired: "3",
    lastSeenAt: "2026-03-16T18:00:00.000Z",
    lastStatus: "200",
    lastPath: "/api/holidays/today/US",
  });
  await redisClient.hset("metrics:v1:source:anon_hist", {
    sourceId: "anon_hist",
    sourceKind: "anonymous",
    agentClass: "other",
    total: "2",
    success: "1",
    paidSuccess: "1",
  });
  await redisClient.hset("metrics:v1:source:self_hist", {
    sourceId: "self_hist",
    sourceKind: "self-tagged",
    agentClass: "other",
    total: "1",
    success: "1",
    paidSuccess: "1",
  });

  const store = createMetricsStore({
    redisClient,
    routeCatalog: [
      {
        key: routeKey,
        method: "GET",
        routePath: "/api/holidays/today/*",
        description: "Business-day intelligence for a country.",
        priceLabel: "$0.002 USDC",
      },
    ],
  });
  const summary = await store.getSummary();
  const route = findRouteMetrics(summary, routeKey);

  assert.equal(route.paidUsd, 0.004);
  assert.equal(summary.totals.paidUsd, 0.004);
  assert.equal(summary.totals.externalPaidSuccess, 0);
  assert.equal(summary.totals.selfTaggedPaidSuccess, 0);
  assert.equal(summary.totals.historicalPaidRevenueBackfilled, true);
  assert.equal(summary.totals.unattributedHistoricalPaidSuccess, 2);
});

test("metrics summary keeps metadata for routes recorded by generated sellers sharing redis", async () => {
  const redisClient = new FakeRedis();
  const generatedRouteKey = "GET /api/sun/times";
  const generatedStore = createMetricsStore({
    redisClient,
    routeCatalog: [
      {
        key: generatedRouteKey,
        method: "GET",
        routePath: "/api/sun/times",
        description: "Solar times for exact coordinates and date.",
        priceLabel: "$0.003 USDC",
      },
    ],
  });

  await generatedStore.record({
    at: "2026-03-16T15:00:00.000Z",
    durationMs: 42,
    method: "GET",
    path: "/api/sun/times",
    routeKey: generatedRouteKey,
    statusCode: 402,
    wasPaid: false,
    serviceHost: "20260313-131854-solar-times.vercel.app",
    sourceId: "anon_generated",
    sourceKind: "anonymous",
    agentClass: "other",
  });

  const mainDashboardStore = createMetricsStore({
    redisClient,
    routeCatalog: [],
  });
  const summary = await mainDashboardStore.getSummary();
  const route = findRouteMetrics(summary, generatedRouteKey);

  assert.equal(route.routePath, "/api/sun/times");
  assert.equal(route.description, "Solar times for exact coordinates and date.");
  assert.equal(route.priceLabel, "$0.003 USDC");
  assert.equal(route.paymentRequired, 1);
  assert.equal(summary.totals.uniqueServicesSeen, 0);
  assert.equal(summary.services.length, 0);
});

test("metrics summary excludes retired fec routes and sanitizes retired route references", async () => {
  const redisClient = new FakeRedis();
  const retiredRouteKey = "GET /api/fec/candidates";
  const activeRouteKey = "GET /api/vin/*";
  const hostKey = "x402-data-bazaar.vercel.app";
  const updatedAt = "2026-03-21T19:30:00.000Z";

  await redisClient.set("metrics:v1:started-at", "2026-03-21T18:00:00.000Z");
  await redisClient.set("metrics:v1:updated-at", updatedAt);
  await redisClient.sadd("metrics:v1:route-keys", retiredRouteKey);
  await redisClient.sadd("metrics:v1:route-keys", activeRouteKey);
  await redisClient.sadd("metrics:v1:source-keys", "anon_retired");
  await redisClient.sadd("metrics:v1:source-keys", "anon_active");
  await redisClient.sadd("metrics:v1:service-keys", hostKey);

  await redisClient.hset("metrics:v1:totals", {
    total: "16",
    success: "2",
    paidSuccess: "2",
    externalPaidSuccess: "2",
    selfTaggedPaidSuccess: "0",
    paymentRequired: "14",
    paidUsdMicros: "7000",
    externalPaidUsdMicros: "7000",
  });

  await redisClient.hset(`metrics:v1:route:${encodeURIComponent(retiredRouteKey)}`, {
    key: retiredRouteKey,
    method: "GET",
    routePath: "/api/fec/candidates",
    description: "Federal election candidate filings.",
    priceLabel: "$0.005 USDC",
    priceUsdMicros: "5000",
    total: "11",
    success: "1",
    paidSuccess: "1",
    externalPaidSuccess: "1",
    paymentRequired: "10",
    paidUsdMicros: "5000",
    externalPaidUsdMicros: "5000",
    lastSeenAt: updatedAt,
    lastStatus: "402",
    lastPath: "/api/fec/candidates",
  });
  await redisClient.hset(`metrics:v1:route:${encodeURIComponent(activeRouteKey)}`, {
    key: activeRouteKey,
    method: "GET",
    routePath: "/api/vin/*",
    description: "Decode a VIN and return standardized vehicle metadata.",
    priceLabel: "$0.002 USDC",
    priceUsdMicros: "2000",
    total: "5",
    success: "1",
    paidSuccess: "1",
    externalPaidSuccess: "1",
    paymentRequired: "4",
    paidUsdMicros: "2000",
    externalPaidUsdMicros: "2000",
    lastSeenAt: updatedAt,
    lastStatus: "200",
    lastPath: "/api/vin/1HGCM82633A004352",
  });

  await redisClient.hset("metrics:v1:source:anon_retired", {
    sourceId: "anon_retired",
    sourceKind: "anonymous",
    agentClass: "curl",
    total: "11",
    success: "1",
    paidSuccess: "1",
    externalPaidSuccess: "1",
    paymentRequired: "10",
    lastSeenAt: updatedAt,
    lastRouteKey: retiredRouteKey,
    lastPath: "/api/fec/candidates",
  });
  await redisClient.hset("metrics:v1:source:anon_active", {
    sourceId: "anon_active",
    sourceKind: "anonymous",
    agentClass: "curl",
    total: "5",
    success: "1",
    paidSuccess: "0",
    externalPaidSuccess: "0",
    paymentRequired: "4",
    lastSeenAt: updatedAt,
    lastRouteKey: activeRouteKey,
    lastPath: "/api/vin/1HGCM82633A004352",
  });

  await redisClient.hset(`metrics:v1:service:${encodeURIComponent(hostKey)}`, {
    serviceHost: hostKey,
    total: "16",
    success: "2",
    paidSuccess: "2",
    externalPaidSuccess: "2",
    paymentRequired: "14",
    paidUsdMicros: "7000",
    externalPaidUsdMicros: "7000",
    lastSeenAt: updatedAt,
    lastRouteKey: retiredRouteKey,
    lastPath: "/api/fec/candidates",
  });
  await redisClient.sadd(`metrics:v1:service-routes:${encodeURIComponent(hostKey)}`, retiredRouteKey);
  await redisClient.sadd(`metrics:v1:service-routes:${encodeURIComponent(hostKey)}`, activeRouteKey);

  const store = createMetricsStore({
    redisClient,
    routeCatalog: [
      {
        key: activeRouteKey,
        method: "GET",
        routePath: "/api/vin/*",
        description: "Decode a VIN and return standardized vehicle metadata.",
        priceLabel: "$0.002 USDC",
      },
    ],
  });
  const summary = await store.getSummary();

  assert.equal(summary.routes.some((entry) => entry.key === retiredRouteKey), false);
  assert.equal(summary.routes.some((entry) => entry.key === activeRouteKey), true);
  assert.equal(summary.totals.uniqueRoutesSeen, 1);
  assert.equal(summary.totals.retiredRoutesRemoved, 1);
  assert.equal(summary.totals.retiredRouteRequests, 11);
  assert.equal(summary.totals.retiredRoutePaymentRequired, 10);

  assert.equal(summary.callers.length, 0);
  assert.equal(summary.services.length, 0);
  assert.equal(summary.trafficQuality.sources.total, 0);
  assert.equal(summary.trafficQuality.sources.paying, 0);
  assert.equal(summary.trafficQuality.sources.nonPaying, 0);
  assert.equal(summary.trafficQuality.sources.activePaying24h, 0);
  assert.equal(summary.trafficQuality.requests.shareNonPaying, 0);
  assert.equal(summary.trafficQuality.paymentRequired.shareFromNonPayingSources, 0);
});

test("metrics summary excludes retired legacy vendor brief post routes without hiding active get routes", async () => {
  const redisClient = new FakeRedis();
  const retiredRouteKey = "POST /api/vendor-entity-brief";
  const activeRouteKey = "GET /api/vendor-entity-brief";
  const hostKey = "restricted-party-screen.vercel.app";
  const updatedAt = "2026-03-25T06:15:00.000Z";

  await redisClient.set("metrics:v1:started-at", "2026-03-25T05:00:00.000Z");
  await redisClient.set("metrics:v1:updated-at", updatedAt);
  await redisClient.sadd("metrics:v1:route-keys", retiredRouteKey);
  await redisClient.sadd("metrics:v1:route-keys", activeRouteKey);
  await redisClient.sadd("metrics:v1:source-keys", "anon_vendor");
  await redisClient.sadd("metrics:v1:service-keys", hostKey);

  await redisClient.hset("metrics:v1:totals", {
    total: "4",
    success: "0",
    paidSuccess: "0",
    paymentRequired: "4",
  });

  await redisClient.hset(`metrics:v1:route:${encodeURIComponent(retiredRouteKey)}`, {
    key: retiredRouteKey,
    method: "POST",
    routePath: "/api/vendor-entity-brief",
    description: "Premium vendor entity brief.",
    priceLabel: "$25 USDC",
    priceUsdMicros: "25000000",
    total: "2",
    paymentRequired: "2",
    lastSeenAt: updatedAt,
    lastStatus: "402",
    lastPath: "/api/vendor-entity-brief",
  });
  await redisClient.hset(`metrics:v1:route:${encodeURIComponent(activeRouteKey)}`, {
    key: activeRouteKey,
    method: "GET",
    routePath: "/api/vendor-entity-brief",
    description: "Short vendor entity brief.",
    priceLabel: "$0.25 USDC",
    priceUsdMicros: "250000",
    total: "2",
    paymentRequired: "2",
    lastSeenAt: updatedAt,
    lastStatus: "402",
    lastPath: "/api/vendor-entity-brief",
  });

  await redisClient.hset("metrics:v1:source:anon_vendor", {
    sourceId: "anon_vendor",
    sourceKind: "anonymous",
    agentClass: "browser",
    total: "4",
    paymentRequired: "4",
    lastSeenAt: updatedAt,
    lastRouteKey: retiredRouteKey,
    lastPath: "/api/vendor-entity-brief",
  });

  await redisClient.hset(`metrics:v1:service:${encodeURIComponent(hostKey)}`, {
    serviceHost: hostKey,
    total: "4",
    paymentRequired: "4",
    lastSeenAt: updatedAt,
    lastRouteKey: retiredRouteKey,
    lastPath: "/api/vendor-entity-brief",
  });
  await redisClient.sadd(`metrics:v1:service-routes:${encodeURIComponent(hostKey)}`, retiredRouteKey);
  await redisClient.sadd(`metrics:v1:service-routes:${encodeURIComponent(hostKey)}`, activeRouteKey);

  const store = createMetricsStore({
    redisClient,
    routeCatalog: [],
  });
  const summary = await store.getSummary();

  assert.equal(summary.routes.some((entry) => entry.key === retiredRouteKey), false);
  assert.equal(summary.routes.some((entry) => entry.key === activeRouteKey), true);
  assert.equal(summary.totals.retiredRoutesRemoved, 1);
  assert.equal(summary.totals.retiredRouteRequests, 2);
  assert.equal(summary.totals.retiredRoutePaymentRequired, 2);
  assert.equal(summary.callers.length, 0);
  assert.equal(summary.services.length, 0);
});
