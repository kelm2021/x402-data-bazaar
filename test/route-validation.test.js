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
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("weather air-quality alias rejects missing zip query", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/air-quality`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(String(body.error || ""), /zip/i);
  });
});

test("uv index route validates numeric coordinates", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uv-index/not-a-lat/not-a-lon`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(String(body.error || ""), /lat|lon/i);
  });
});

test("weather extremes route requires valid coordinates", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/weather/extremes?lat=abc&lon=-74`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(String(body.error || ""), /lat|lon|coordinate/i);
  });
});

test("fed funds route requires FRED API key when no fallback is available", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/fed-funds-rate`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(String(body.error || ""), /fred/i);
  });
});

test("vix route requires FRED API key when no fallback is available", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vix`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(String(body.error || ""), /fred/i);
  });
});

test("credit spreads route requires FRED API key when no fallback is available", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/credit-spreads`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(String(body.error || ""), /fred/i);
  });
});

test("SEC filings route requires SEC_USER_AGENT", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sec/filings/AAPL`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(String(body.error || ""), /sec_user_agent|user agent/i);
  });
});

test("sports odds route returns config error when no provider keys are configured", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sports/odds/nfl`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(String(body.error || ""), /api key|configured|odds/i);
  });
});
