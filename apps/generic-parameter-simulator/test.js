/**
 * Validation tests for the generic parameter simulation API.
 */

const http = require("node:http");

process.env.METRICS_DASHBOARD_PASSWORD = "test-password";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.METRICS_STORE_FILE;
process.env.METRICS_NAMESPACE = "generic-parameter-sim:test";

const app = require("./index");
const { runSimulation, normalizeScenario } = require("./sim/engine");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

function getSellerRoutes(config) {
  if (Array.isArray(config?.routes) && config.routes.length) {
    return config.routes;
  }

  return config?.route ? [config.route] : [];
}

console.log("\n=== Engine Determinism Tests ===\n");

const alwaysSuccess = runSimulation(1000, {
  parameters: { signal: 1 },
  weights: { signal: 1 },
  uncertainty: { signal: 0 },
  threshold: 0,
});
assert(alwaysSuccess.outcome_probability === 1, "Deterministic positive score yields probability 1.0");

const alwaysFail = runSimulation(1000, {
  parameters: { signal: -1 },
  weights: { signal: 1 },
  uncertainty: { signal: 0 },
  threshold: 0,
});
assert(alwaysFail.outcome_probability === 0, "Deterministic negative score yields probability 0.0");

const balanced = runSimulation(10000, {
  parameters: { signal: 0 },
  weights: { signal: 1 },
  uncertainty: { signal: 1 },
  threshold: 0,
});
assert(
  balanced.outcome_probability > 0.45 && balanced.outcome_probability < 0.55,
  `Centered distribution yields ~50% success (actual ${balanced.outcome_probability})`,
);

console.log("\n=== Engine Validation Tests ===\n");

const noParameters = runSimulation(1000, {});
assert(noParameters.error === "invalid_parameters", "Missing parameters rejected");

const unknownWeight = runSimulation(1000, {
  parameters: { known: 1 },
  weights: { unknown: 1 },
});
assert(unknownWeight.error === "invalid_weights", "Unknown weight key rejected");

const badUncertainty = normalizeScenario({
  parameters: { signal: 1 },
  uncertainty: { signal: -1 },
});
assert(badUncertainty.error?.error === "invalid_uncertainty", "Negative uncertainty rejected");

console.log("\n=== Seller Metadata Tests ===\n");

const {
  routeConfig,
  sellerConfig,
  simulationRequestSchema,
  normalizeEnvValue,
  normalizePrivateKey,
  parseSimParams,
} = app;
const configuredSellerRoutes = getSellerRoutes(sellerConfig);

assert(configuredSellerRoutes.length >= 1, "Seller config defines one or more paid simulation routes");
for (const route of configuredSellerRoutes) {
  assert(routeConfig[route.key] !== undefined, `Paid route is configured: ${route.key}`);
}
assert(simulationRequestSchema.required.includes("parameters"), "Request schema requires parameters");
assert(
  simulationRequestSchema.properties.parameters.additionalProperties.type === "number",
  "Parameters schema allows numeric values",
);
assert(normalizeEnvValue("\"quoted-value\"") === "quoted-value", "Env normalizer strips wrapping quotes");
assert(normalizePrivateKey("line1\\nline2") === "line1\nline2", "Private key normalizer restores escaped newlines");

const validParams = parseSimParams({ query: { sims: "5000" }, body: { parameters: { a: 1 } } });
assert(validParams.numSims === 5000, "parseSimParams accepts explicit sim count");

const invalidSims = parseSimParams({ query: { sims: "25" }, body: { parameters: { a: 1 } } });
assert(invalidSims.error?.error === "invalid_sims", "parseSimParams enforces simulation count bounds");

async function runHttpSmokeTests() {
  console.log("\n=== HTTP Smoke Tests ===\n");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeader = `Basic ${Buffer.from("metrics:test-password").toString("base64")}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();
    assert(healthResponse.status === 200, "Health endpoint responds");
    assert(health.name === "Generic Parameter Simulator", "Health endpoint reports generic simulator service");

    const rootResponse = await fetch(`${baseUrl}/`);
    const root = await rootResponse.json();
    assert(rootResponse.status === 200, "Root endpoint responds");
    assert(Array.isArray(root.catalog), "Root endpoint includes route catalog");
    assert(
      root.catalog.length === configuredSellerRoutes.length,
      "Root endpoint advertises all configured paid endpoints",
    );

    const methodologyResponse = await fetch(`${baseUrl}/methodology`, {
      headers: {
        "x-metrics-source": "self",
      },
    });
    const methodology = await methodologyResponse.json();
    assert(methodologyResponse.status === 200, "Methodology endpoint responds");
    assert(methodology.quick_start?.path === "/api/sim/probability", "Methodology points to generic probability route");

    const discoveryResponse = await fetch(`${baseUrl}/api`);
    const discovery = await discoveryResponse.json();
    assert(discoveryResponse.status === 200, "API discovery endpoint responds");
    assert(
      discovery.catalog?.length === configuredSellerRoutes.length,
      "API discovery includes all configured simulation endpoints",
    );

    const integrationResponse = await fetch(`${baseUrl}/integrations/payments-mcp`);
    const integration = await integrationResponse.json();
    assert(integrationResponse.status === 200, "Payments MCP integration endpoint responds");
    assert(integration.integration?.installerPackage === "@coinbase/payments-mcp", "Payments MCP integration payload is present");

    for (const route of configuredSellerRoutes) {
      const guideResponse = await fetch(`${baseUrl}${route.routePath}`);
      const guide = await guideResponse.json();
      assert(guideResponse.status === 200, `GET guide responds for ${route.routePath}`);
      assert(
        guide?.canonical_request?.method === route.method,
        `Guide advertises canonical ${route.method} request for ${route.routePath}`,
      );
    }

    const unauthorizedMetricsResponse = await fetch(`${baseUrl}/ops/metrics/data`);
    assert(
      unauthorizedMetricsResponse.status === 401,
      "Metrics JSON feed requires Basic auth",
    );

    const metricsResponse = await fetch(`${baseUrl}/ops/metrics/data`, {
      headers: {
        authorization: authHeader,
      },
    });
    const metrics = await metricsResponse.json();
    assert(metricsResponse.status === 200, "Metrics JSON feed returns with auth");

    const methodologyRoute = (metrics.routes || []).find(
      (route) => route.key === "GET /methodology",
    );
    assert(methodologyRoute !== undefined, "Metrics feed includes methodology route");

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  await runHttpSmokeTests();

  console.log("\n=== Test Summary ===\n");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
})();
