#!/usr/bin/env node

const liveSellers = require("../portfolio/live-sellers.json");
const { createPortfolioReport } = require("../portfolio");
const { fetchDiscoveryResources, fetchMetricsSummary } = require("./lib/live-signals");

const PROBE_GATE_COUNT = 10;
const PROBE_GATE_SOURCES = 3;
const PAID_GATE_COUNT = 5;
const REPEAT_GATE_BUYERS = 2;

function sumValues(entries, key) {
  return entries.reduce((total, entry) => total + (Number(entry?.[key]) || 0), 0);
}

function findCoreServices(report, metricsSummary) {
  const servicesByHost = new Map(
    (metricsSummary.services || []).map((entry) => [entry.serviceHost, entry]),
  );

  return report.sellers
    .filter((seller) => seller.track === "core")
    .map((seller) => {
      const liveSeller = liveSellers.find((entry) => entry.id === seller.id) || null;
      const serviceMetrics = liveSeller ? servicesByHost.get(liveSeller.domain) || null : null;

      return {
        seller,
        liveSeller,
        serviceMetrics,
      };
    });
}

function summarizeSourceSignals(metricsSummary, seller) {
  const sources = Array.isArray(metricsSummary.sources) ? metricsSummary.sources : [];
  const matchingSources = sources.filter((source) => source.lastRouteKey === seller.heroRoute.key);
  const anonymousSources = matchingSources.filter((source) => source.sourceKind === "anonymous");
  const selfTaggedSources = matchingSources.filter((source) => source.sourceKind === "self-tagged");

  return {
    anonymousSources,
    selfTaggedSources,
    anonymousSourceCount: anonymousSources.length,
    selfTaggedSourceCount: selfTaggedSources.length,
    externalProbeCountLowerBound: sumValues(anonymousSources, "paymentRequired"),
    externalPaidCountLowerBound: sumValues(anonymousSources, "externalPaidSuccess"),
    repeatBuyerCountLowerBound: anonymousSources.filter(
      (source) => (source.externalPaidSuccess ?? source.paidSuccess ?? 0) >= 2,
    ).length,
  };
}

function toGateStatus(passed, current, target, note) {
  return {
    passed,
    current,
    target,
    note,
  };
}

function buildCoreGateSummary(coreService, metricsSummary) {
  const { seller, liveSeller, serviceMetrics } = coreService;
  const sourceSignals = summarizeSourceSignals(metricsSummary, seller);
  const routeMetrics = seller.heroMetrics || seller.metrics;
  const probeGatePassed =
    sourceSignals.externalProbeCountLowerBound >= PROBE_GATE_COUNT &&
    sourceSignals.anonymousSourceCount >= PROBE_GATE_SOURCES;
  const paidGatePassed = sourceSignals.externalPaidCountLowerBound >= PAID_GATE_COUNT;
  const repeatGatePassed = sourceSignals.repeatBuyerCountLowerBound >= REPEAT_GATE_BUYERS;

  return {
    sellerId: seller.id,
    serviceName: seller.serviceName,
    domain: liveSeller?.domain ?? null,
    action: seller.action,
    indexed: seller.discovery.indexed,
    launchChecklist: {
      liveDomain: Boolean(liveSeller?.domain),
      unpaid402Verified: (routeMetrics?.paymentRequired ?? 0) >= 1,
      paid200Verified: (routeMetrics?.paidSuccess ?? 0) >= 1,
      indexed: seller.discovery.indexed,
    },
    gates: {
      discovery: toGateStatus(
        probeGatePassed,
        `${sourceSignals.externalProbeCountLowerBound} external probes from ${sourceSignals.anonymousSourceCount} source(s)`,
        `${PROBE_GATE_COUNT} external probes from ${PROBE_GATE_SOURCES} source(s)`,
        "Lower-bound estimate from source-attributed metrics filtered to the core route.",
      ),
      paid: toGateStatus(
        paidGatePassed,
        `${sourceSignals.externalPaidCountLowerBound} external paid call(s)`,
        `${PAID_GATE_COUNT} external paid call(s)`,
        "Self-tagged launch checks do not count toward the gate.",
      ),
      repeat: toGateStatus(
        repeatGatePassed,
        `${sourceSignals.repeatBuyerCountLowerBound} repeat buyer(s)`,
        `${REPEAT_GATE_BUYERS} repeat buyer(s)`,
        "Lower-bound estimate based on anonymous sources with at least two paid successes.",
      ),
    },
    currentMetrics: {
      total: serviceMetrics?.total ?? routeMetrics?.total ?? 0,
      paymentRequired: routeMetrics?.paymentRequired ?? 0,
      paidSuccess: routeMetrics?.paidSuccess ?? 0,
      externalPaidSuccess: routeMetrics?.externalPaidSuccess ?? serviceMetrics?.externalPaidSuccess ?? 0,
      selfTaggedPaidSuccess:
        routeMetrics?.selfTaggedPaidSuccess ?? serviceMetrics?.selfTaggedPaidSuccess ?? 0,
      serverErrors: routeMetrics?.serverErrors ?? 0,
    },
  };
}

function decideImmediateNextStep(coreSummaries) {
  const firstCore = coreSummaries[0];
  if (!firstCore) {
    return "No core seller is configured yet.";
  }

  if (!firstCore.launchChecklist.indexed && firstCore.launchChecklist.paid200Verified) {
    return "Keep rechecking Bazaar indexing, push Payments MCP distribution for wedge #1, and do not build wedge #2 yet.";
  }

  if (!firstCore.gates.discovery.passed) {
    return "Push distribution and probe acquisition for the core wedge before building anything else.";
  }

  if (!firstCore.gates.paid.passed) {
    return "Tighten offer packaging and get the first non-self paid buyers for the core wedge.";
  }

  if (!firstCore.gates.repeat.passed) {
    return "Stay focused on repeat usage for the core wedge before expanding.";
  }

  return "The core wedge has cleared the initial gates. You can consider shipping the next adjacent product.";
}

function printGate(name, gate) {
  console.log(
    `- ${name}: ${gate.passed ? "PASS" : "PENDING"} | ${gate.current} | target ${gate.target}`,
  );
  console.log(`  note: ${gate.note}`);
}

async function main() {
  const [metricsResult, discoveryResult] = await Promise.all([
    fetchMetricsSummary(),
    fetchDiscoveryResources(),
  ]);

  if (!metricsResult.ok) {
    throw new Error(`Unable to load metrics summary (status ${metricsResult.status})`);
  }

  if (!discoveryResult.ok) {
    throw new Error(`Unable to load discovery resources (status ${discoveryResult.status})`);
  }

  const report = createPortfolioReport({
    metricsSummary: metricsResult.body,
    discoverySummary: discoveryResult.body,
  });
  const coreServices = findCoreServices(report, metricsResult.body);
  const coreSummaries = coreServices.map((service) =>
    buildCoreGateSummary(service, metricsResult.body),
  );

  console.log(
    `Rebuild status (${report.metricsGeneratedAt ?? report.generatedAt}) with ${report.discoveryCount} discovery resources checked`,
  );

  for (const summary of coreSummaries) {
    console.log("");
    console.log(`${summary.serviceName} [${summary.sellerId}]`);
    console.log(`- domain: ${summary.domain ?? "unlinked"}`);
    console.log(`- action: ${summary.action}`);
    console.log(
      `- launch: live=${summary.launchChecklist.liveDomain ? "yes" : "no"}, 402=${summary.launchChecklist.unpaid402Verified ? "yes" : "no"}, paid=${summary.launchChecklist.paid200Verified ? "yes" : "no"}, indexed=${summary.launchChecklist.indexed ? "yes" : "no"}`,
    );
    console.log(
      `- metrics: ${summary.currentMetrics.paymentRequired} 402 | ${summary.currentMetrics.paidSuccess} paid | ${summary.currentMetrics.externalPaidSuccess} external paid | ${summary.currentMetrics.serverErrors} 5xx`,
    );
    printGate("14-day discovery gate", summary.gates.discovery);
    printGate("21-day paid gate", summary.gates.paid);
    printGate("30-day repeat gate", summary.gates.repeat);
  }

  const legacyKeep = report.sellers.filter((seller) => seller.track === "legacy-keep");
  const legacyKill = report.sellers.filter((seller) => seller.track === "legacy-kill");

  console.log("");
  console.log(`Immediate next step: ${decideImmediateNextStep(coreSummaries)}`);
  console.log("");
  console.log(`Legacy keep sellers: ${legacyKeep.map((seller) => seller.id).join(", ")}`);
  console.log(`Legacy kill sellers: ${legacyKill.map((seller) => seller.id).join(", ")}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
