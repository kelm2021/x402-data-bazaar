/**
 * Validation tests for the generic parameter simulation API.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

process.env.METRICS_DASHBOARD_PASSWORD = "test-password";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.METRICS_STORE_FILE;
process.env.METRICS_NAMESPACE = "generic-parameter-sim:test";

const app = require("./index");
const { createApp } = require("./app");
const {
  runBatchProbability,
  runCompare,
  runForecast,
  runSimulation,
  runSensitivity,
  normalizeScenario,
} = require("./sim/engine");
const {
  buildStructuredReport,
  createChartHint,
  createHeadlineMetric,
  createTable,
} = require("../../lib/report-builder");

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
  outcome_noise: 0,
  threshold: 0,
});
assert(alwaysSuccess.outcome_probability === 1, "Deterministic positive score yields probability 1.0");

const alwaysFail = runSimulation(1000, {
  parameters: { signal: -1 },
  weights: { signal: 1 },
  uncertainty: { signal: 0 },
  outcome_noise: 0,
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
assert(
  balanced.simulation_meta?.calibration?.outcome_noise > 0,
  "Centered distribution reports applied default outcome noise",
);

const prodLikeBaseline = runSimulation(20000, {
  parameters: {
    demand_signal: 0.65,
    execution_quality: 0.6,
    pricing_pressure: -0.25,
  },
  threshold: 0.25,
});
const prodLikeCandidate = runSimulation(20000, {
  parameters: {
    demand_signal: 0.78,
    execution_quality: 0.68,
    pricing_pressure: -0.2,
  },
  threshold: 0.25,
});
assert(
  prodLikeBaseline.outcome_probability < 0.95,
  `Default calibration prevents baseline saturation (actual ${prodLikeBaseline.outcome_probability})`,
);
assert(
  prodLikeCandidate.outcome_probability < 0.97,
  `Default calibration prevents candidate saturation (actual ${prodLikeCandidate.outcome_probability})`,
);
assert(
  prodLikeCandidate.outcome_probability > prodLikeBaseline.outcome_probability,
  "Default calibration preserves relative ordering for prod-like scenarios",
);
assert(
  prodLikeBaseline.diagnostics?.effective_score_stddev > 0,
  "Probability result includes effective score diagnostics",
);
assert(
  prodLikeBaseline.effective_score_distribution?.p95 !== undefined,
  "Probability result includes effective score distribution",
);
assert(
  prodLikeBaseline.risk_metrics?.expected_shortfall_05 !== undefined,
  "Probability result includes tail-risk metrics",
);
assert(
  prodLikeBaseline.diagnostics?.saturation_risk === "moderate"
  || prodLikeBaseline.diagnostics?.saturation_risk === "elevated",
  "Prod-like scenario reports saturation diagnostics",
);

const batch = runBatchProbability(5000, {
  scenarios: [
    {
      label: "strong",
      parameters: { signal: 1 },
      weights: { signal: 1 },
      uncertainty: { signal: 0 },
      threshold: 0,
    },
    {
      label: "balanced",
      parameters: { signal: 0 },
      weights: { signal: 1 },
      uncertainty: { signal: 1 },
      threshold: 0,
    },
    {
      label: "weak",
      parameters: { signal: -1 },
      weights: { signal: 1 },
      uncertainty: { signal: 0 },
      threshold: 0,
    },
  ],
});
assert(batch.batch_meta?.scenario_count === 3, "Batch simulation reports scenario count");
assert(batch.scenarios?.length === 3, "Batch simulation returns one result per scenario");
assert(batch.ranking?.[0]?.label === "strong", "Batch ranking sorts strongest scenario first");
assert(batch.ranking?.[2]?.label === "weak", "Batch ranking sorts weakest scenario last");

const deterministicCompare = runCompare(5000, {
  baseline: {
    parameters: { signal: 0.1 },
    uncertainty: { signal: 0 },
    outcome_noise: 0,
    threshold: 0,
  },
  candidate: {
    parameters: { signal: 0.4 },
    uncertainty: { signal: 0 },
    outcome_noise: 0,
    threshold: 0,
  },
});
assert(
  deterministicCompare.decision_summary?.preferred_scenario === "candidate",
  "Compare identifies the preferred scenario",
);
assert(
  deterministicCompare.decision_summary?.probability_candidate_outperforms === 1,
  "Compare reports deterministic outperformance probability",
);
assert(
  deterministicCompare.paired_score_distribution?.mean > 0,
  "Compare returns paired score-gap distribution",
);
assert(
  deterministicCompare.paired_score_distribution?.p95 !== undefined,
  "Compare score-gap distribution includes richer percentiles",
);

const increasingSensitivity = runSensitivity(10000, {
  scenario: {
    parameters: { signal: 0.2 },
    uncertainty: { signal: 0.4 },
    outcome_noise: 0.5,
    threshold: 0,
  },
  parameter: "signal",
  delta: 0.25,
  mode: "relative",
});
assert(
  increasingSensitivity.sensitivity?.direction === "increasing",
  "Sensitivity classifies the response direction",
);
assert(
  increasingSensitivity.response_curve?.span > 0,
  "Sensitivity returns a response curve summary",
);
assert(
  increasingSensitivity.sensitivity?.midpoint_elasticity !== undefined,
  "Sensitivity returns midpoint elasticity",
);

const forecastWithBands = runForecast(5000, {
  scenario: {
    parameters: { signal: 0.2 },
    uncertainty: { signal: 0.4 },
    outcome_noise: 0.5,
    threshold: 0,
  },
  periods: 2,
  drift: { signal: 0.05 },
});
assert(
  forecastWithBands.timeline?.[0]?.effective_score_distribution?.p95 !== undefined,
  "Forecast timeline includes effective score distribution",
);
assert(
  forecastWithBands.timeline?.[0]?.risk_metrics?.expected_shortfall_05 !== undefined,
  "Forecast timeline includes tail-risk metrics",
);

const seededScenario = {
  parameters: {
    demand_signal: 0.65,
    execution_quality: 0.6,
    pricing_pressure: -0.25,
  },
  threshold: 0.25,
};
const seededFirst = runSimulation(5000, seededScenario, { seed: 424242 });
const seededSecond = runSimulation(5000, seededScenario, { seed: 424242 });
const seededThird = runSimulation(5000, seededScenario, { seed: 777777 });
assert(
  JSON.stringify(seededFirst) === JSON.stringify(seededSecond),
  "Same seed reproduces identical simulation output",
);
assert(
  JSON.stringify(seededFirst) !== JSON.stringify(seededThird),
  "Different seeds produce different simulation output",
);

const canaryScenarios = [
  {
    name: "baseline",
    scenario: seededScenario,
    expectedRange: [0.74, 0.85],
  },
  {
    name: "candidate",
    scenario: {
      parameters: {
        demand_signal: 0.78,
        execution_quality: 0.68,
        pricing_pressure: -0.2,
      },
      threshold: 0.25,
    },
    expectedRange: [0.82, 0.91],
  },
];
for (const canary of canaryScenarios) {
  const result = runSimulation(10000, canary.scenario, { seed: 20260403 });
  assert(
    result.outcome_probability >= canary.expectedRange[0]
      && result.outcome_probability <= canary.expectedRange[1],
    `Canary ${canary.name} probability stays in expected range`,
  );
}

console.log("\n=== Engine Validation Tests ===\n");

const noParameters = runSimulation(1000, {});
assert(noParameters.error === "invalid_parameters", "Missing parameters rejected");

const unknownWeight = runSimulation(1000, {
  parameters: { known: 1 },
  weights: { unknown: 1 },
});
assert(unknownWeight.error === "invalid_weights", "Unknown weight key rejected");

const badOutcomeNoise = normalizeScenario({
  parameters: { signal: 1 },
  outcome_noise: -0.1,
});
assert(
  badOutcomeNoise.error?.error === "invalid_outcome_noise",
  "Negative outcome noise rejected",
);

const badUncertainty = normalizeScenario({
  parameters: { signal: 1 },
  uncertainty: { signal: -1 },
});
assert(badUncertainty.error?.error === "invalid_uncertainty", "Negative uncertainty rejected");

const invalidBatch = runBatchProbability(1000, {
  scenarios: [{ label: "missing-params" }],
});
assert(invalidBatch.error === "invalid_parameters", "Batch simulation rejects invalid scenario payloads");

console.log("\n=== Report Builder Tests ===\n");

const genericReport = buildStructuredReport({
  reportMeta: {
    report_type: "vendor-brief",
    title: "Vendor onboarding brief",
  },
  executiveSummary: ["Counterparty appears operationally viable."],
  headlineMetrics: [
    createHeadlineMetric("Risk tier", "medium", "label"),
    createHeadlineMetric("Screened lists", 4, "count"),
  ],
  tables: {
    counterparties: createTable(
      ["name", "country", "status"],
      [{ name: "Example Co", country: "US", status: "review" }],
    ),
  },
  chartHints: [
    createChartHint("status_breakdown", "counterparties", "name", "status"),
  ],
  result: {
    status: "review",
  },
});
assert(genericReport.report_meta?.report_type === "vendor-brief", "Generic report builder preserves report metadata");
assert(
  genericReport.tables?.counterparties?.rows?.[0]?.name === "Example Co",
  "Generic report builder preserves table rows",
);
assert(
  genericReport.export_artifacts?.chart_hints?.[0]?.chart === "status_breakdown",
  "Generic report builder preserves chart hints",
);

console.log("\n=== Seller Metadata Tests ===\n");

const {
  createApp: createAppFromIndex,
  routeConfig,
  sellerConfig,
  simulationRequestSchema,
  normalizeEnvValue,
  normalizePrivateKey,
  parseSimParams,
} = app;
const configuredSellerRoutes = getSellerRoutes(sellerConfig);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);

assert(configuredSellerRoutes.length >= 1, "Seller config defines one or more paid simulation routes");
for (const route of configuredSellerRoutes) {
  assert(routeConfig[route.key] !== undefined, `Paid route is configured: ${route.key}`);
}
assert(
  configuredSellerRoutes.some((route) => route.routePath === "/api/sim/report"),
  "Seller config includes simulation report route",
);
assert(simulationRequestSchema.required.includes("parameters"), "Request schema requires parameters");
assert(
  simulationRequestSchema.properties.parameters.additionalProperties.type === "number",
  "Parameters schema allows numeric values",
);
assert(normalizeEnvValue("\"quoted-value\"") === "quoted-value", "Env normalizer strips wrapping quotes");
assert(normalizePrivateKey("line1\\nline2") === "line1\nline2", "Private key normalizer restores escaped newlines");
assert(
  packageJson.scripts?.["test:paid-canary"] !== undefined,
  "Package exposes a paid canary script",
);

const validParams = parseSimParams({ query: { sims: "5000" }, body: { parameters: { a: 1 } } });
assert(validParams.numSims === 5000, "parseSimParams accepts explicit sim count");
assert(validParams.seed === undefined, "parseSimParams leaves seed undefined when omitted");

const validSeedParams = parseSimParams({
  query: { sims: "5000", seed: "12345" },
  body: { parameters: { a: 1 } },
});
assert(validSeedParams.seed === 12345, "parseSimParams accepts explicit seed");

const invalidSims = parseSimParams({ query: { sims: "25" }, body: { parameters: { a: 1 } } });
assert(invalidSims.error?.error === "invalid_sims", "parseSimParams enforces simulation count bounds");

const invalidSeed = parseSimParams({
  query: { seed: "not-an-int" },
  body: { parameters: { a: 1 } },
});
assert(invalidSeed.error?.error === "invalid_seed", "parseSimParams enforces seed integer format");

async function runHttpSmokeTests() {
  console.log("\n=== HTTP Smoke Tests ===\n");

  const server = http.createServer(createApp({ enableOpsDashboards: true }));
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

async function runBatchRouteTests() {
  console.log("\n=== Batch Route Tests ===\n");

  const localApp = createApp({
    enableOpsDashboards: true,
    paymentGate: (_req, _res, next) => next(),
  });
  const server = http.createServer(localApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/sim/batch-probability?sims=2000`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scenarios: [
          {
            label: "strong",
            parameters: { signal: 1 },
            weights: { signal: 1 },
            uncertainty: { signal: 0 },
            outcome_noise: 0,
            threshold: 0,
          },
          {
            label: "weak",
            parameters: { signal: -1 },
            weights: { signal: 1 },
            uncertainty: { signal: 0 },
            outcome_noise: 0,
            threshold: 0,
          },
        ],
      }),
    });
    const payload = await response.json();
    assert(response.status === 200, "Batch probability route responds");
    assert(payload.batch_meta?.scenario_count === 2, "Batch route returns scenario count");
    assert(payload.ranking?.[0]?.label === "strong", "Batch route returns ranked scenarios");
    assert(payload.scenarios?.[1]?.result?.outcome_probability === 0, "Batch route includes per-scenario results");

    const seededResponseA = await fetch(`${baseUrl}/api/sim/probability?sims=2000&seed=123456`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parameters: { signal: 0.2 },
        uncertainty: { signal: 0.5 },
        threshold: 0,
      }),
    });
    const seededPayloadA = await seededResponseA.json();
    const seededResponseB = await fetch(`${baseUrl}/api/sim/probability?sims=2000&seed=123456`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parameters: { signal: 0.2 },
        uncertainty: { signal: 0.5 },
        threshold: 0,
      }),
    });
    const seededPayloadB = await seededResponseB.json();
    assert(
      JSON.stringify(seededPayloadA) === JSON.stringify(seededPayloadB),
      "Probability route is reproducible when seed is supplied",
    );

    const reportResponse = await fetch(`${baseUrl}/api/sim/report?sims=2000&seed=24680`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        analysis_type: "compare",
        title: "Candidate vs baseline decision memo",
        summary_focus: "decision",
        request: {
          baseline: {
            parameters: {
              demand_signal: 0.65,
              execution_quality: 0.6,
              pricing_pressure: -0.25,
            },
            threshold: 0.25,
          },
          candidate: {
            parameters: {
              demand_signal: 0.78,
              execution_quality: 0.68,
              pricing_pressure: -0.2,
            },
            threshold: 0.25,
          },
        },
      }),
    });
    const reportPayload = await reportResponse.json();
    assert(reportResponse.status === 200, "Simulation report route responds");
    assert(
      reportPayload.report_meta?.analysis_type === "compare",
      "Simulation report identifies analysis type",
    );
    assert(
      Array.isArray(reportPayload.headline_metrics) && reportPayload.headline_metrics.length >= 3,
      "Simulation report includes headline metrics",
    );
    assert(
      Array.isArray(reportPayload.tables?.scenario_summary?.rows)
        && reportPayload.tables.scenario_summary.rows.length >= 2,
      "Simulation report includes scenario summary rows",
    );
    assert(
      Array.isArray(reportPayload.export_artifacts?.workbook_rows?.scenario_summary),
      "Simulation report includes workbook-ready rows",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  await runHttpSmokeTests();
  await runBatchRouteTests();

  console.log("\n=== Test Summary ===\n");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
})();
