const assert = require("node:assert/strict");
const test = require("node:test");
const fetch = require("node-fetch");

const { createApp } = require("../app");

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

function buildReceipt(overrides = {}) {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  return {
    type: "mercury-trust-receipt",
    version: "1.0",
    receiptId: "receipt_test_1",
    issuedAt,
    expiresAt,
    serviceId: "trust-identity-attest",
    mode: "identity",
    verification: {
      endpoint: "/api/trust/receipts/verify",
    },
    decision: {
      normalized: "allow",
    },
    guarantee: {
      code: "execution-allowed",
    },
    canonicalIdentity: {
      required: true,
      verified: true,
    },
    subject: {
      wallet: "0x1234",
      targetAgentId: "agent-b",
    },
    ...overrides,
  };
}

function buildReviewReceipt(overrides = {}) {
  return buildReceipt({
    decision: {
      normalized: "review",
    },
    guarantee: {
      code: "review-required",
    },
    ...overrides,
  });
}

function createPassingPaymentGate() {
  return (_req, _res, next) => next();
}

test("payment gate still runs before Merc-Trust enforcement", async () => {
  let verifyCalls = 0;
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
    },
    paymentGate: (_req, res) => res.status(402).json({ error: "Payment required" }),
    mercTrustClient: {
      verifyTrustReceipt: async () => {
        verifyCalls += 1;
        return {
          valid: true,
          signatureAlgorithm: "hmac-sha256",
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        };
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`);
    const body = await response.json();

    assert.equal(response.status, 402);
    assert.equal(body.error, "Payment required");
    assert.equal(verifyCalls, 0);
  });
});

test("missing receipt is blocked when Merc-Trust enforcement is enabled", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "merc-trust-receipt-rejected");
    assert.equal(body.reason, "missing-receipt");
  });
});

test("verification failures are blocked with 403", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: false,
        reason: "signature-mismatch",
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(buildReceipt()),
      },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "merc-trust-receipt-rejected");
    assert.equal(body.reason, "verification-failed");
  });
});

test("quick-check receipts are rejected by default allowlist", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(
          buildReceipt({
            serviceId: "trust-quick-check",
          }),
        ),
      },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "merc-trust-receipt-rejected");
    assert.equal(body.reason, "service-not-allowed");
  });
});

test("valid deep-check receipts pass through to route handlers", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(buildReceipt()),
      },
    });
    const body = await response.json();

    // The route runs and returns its own validation error (not a trust gate failure).
    assert.equal(response.status, 400);
    assert.equal(body.error, "date must be in YYYY-MM-DD format");
  });
});

test("review-required receipts pass on low-risk Merc-Trust paths", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
      MERC_TRUST_ENFORCED_PATH_PREFIXES: "/api/business-days/next,/api/holidays/today",
      MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES: "/api/business-days/next,/api/holidays/today",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(buildReviewReceipt()),
      },
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "date must be in YYYY-MM-DD format");
  });
});

test("review-required receipts still fail on stricter enforced routes", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
      MERC_TRUST_ENFORCED_PATH_PREFIXES: "/api/business-days/next,/api/weather/current",
      MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES: "/api/business-days/next",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/current`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(buildReviewReceipt()),
      },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "merc-trust-receipt-rejected");
    assert.equal(body.reason, "decision-not-allowed");
  });
});

test("fail-open allows execution when verification service errors", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
      MERC_TRUST_FAIL_OPEN: "true",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => {
        throw new Error("verification service timeout");
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/business-days/next/US/not-a-date`, {
      headers: {
        "x-merc-trust-receipt": JSON.stringify(buildReceipt()),
      },
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "date must be in YYYY-MM-DD format");
  });
});

test("non-enforced paid routes bypass Merc-Trust receipt policy", async () => {
  const app = createApp({
    enableDebugRoutes: false,
    env: {
      MERC_TRUST_ENFORCEMENT_ENABLED: "true",
      MERC_TRUST_ENFORCED_PATH_PREFIXES: "/api/business-days/next,/api/holidays/today",
    },
    paymentGate: createPassingPaymentGate(),
    mercTrustClient: {
      verifyTrustReceipt: async () => ({
        valid: true,
        signatureAlgorithm: "hmac-sha256",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/not-real`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(body.includes("merc-trust-receipt-rejected"), false);
  });
});
