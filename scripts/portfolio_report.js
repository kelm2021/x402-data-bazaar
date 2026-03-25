#!/usr/bin/env node

const { createPortfolioReport } = require("../portfolio");
const { fetchDiscoveryResources, fetchMetricsSummary } = require("./lib/live-signals");

function parseArgs(argv) {
  const parsed = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      parsed.json = true;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function formatMetrics(metrics) {
  return `${metrics.paymentRequired} 402 | ${metrics.paidSuccess} paid | ${metrics.serverErrors} 5xx`;
}

function formatDiscovery(discovery) {
  return discovery.indexed ? `indexed (${discovery.matchCount})` : "not indexed";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const metricsResult = await fetchMetricsSummary({
    url: args.metricsUrl,
  });
  const discoveryResult = await fetchDiscoveryResources({
    url: args.discoveryUrl,
  });

  if (!metricsResult.ok) {
    throw new Error(`Unable to load metrics from ${metricsResult.url} (status ${metricsResult.status})`);
  }

  if (!discoveryResult.ok) {
    throw new Error(
      `Unable to load discovery resources from ${discoveryResult.url} (status ${discoveryResult.status})`,
    );
  }

  const report = createPortfolioReport({
    metricsSummary: metricsResult.body,
    discoverySummary: discoveryResult.body,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `Seller portfolio report (${report.metricsGeneratedAt ?? report.generatedAt}) with ${report.discoveryCount} discovery resources checked`,
  );

  report.sellers.forEach((seller, index) => {
    console.log(
      `${index + 1}. ${seller.serviceName} [${seller.id}] - ${seller.track} - ${seller.action} - score ${seller.score}`,
    );
    console.log(`   hero: ${seller.heroRoute.key} -> ${seller.heroRoute.resourcePath}`);
    console.log(`   metrics: ${formatMetrics(seller.metrics)}`);
    console.log(`   discovery: ${formatDiscovery(seller.discovery)}`);
    console.log(`   mode: ${seller.operatingMode}`);
    console.log(`   why: ${seller.why}`);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
