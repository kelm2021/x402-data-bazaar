#!/usr/bin/env node

const liveSellers = require("../portfolio/live-sellers.json");
const { fetchDiscoveryResources, fetchMetricsSummary } = require("./lib/live-signals");

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

function collectDiscoveryMatches(domain, items = []) {
  return items.filter((item) => {
    const resources = [item.resource, ...(Array.isArray(item.accepts) ? item.accepts : [item.accepts])]
      .map((value) => (value && typeof value === "object" ? value.resource : value))
      .filter(Boolean);
    return resources.some((resource) => String(resource).includes(domain));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

  const serviceMap = new Map(
    (metricsResult.body.services || []).map((entry) => [entry.serviceHost, entry]),
  );
  const discoveryItems = discoveryResult.body.items || [];
  const report = liveSellers.map((seller) => {
    const serviceMetrics = serviceMap.get(seller.domain) || null;
    const discoveryMatches = collectDiscoveryMatches(seller.domain, discoveryItems);

    return {
      ...seller,
      metrics: serviceMetrics,
      indexed: discoveryMatches.length > 0,
      discoveryMatches: discoveryMatches.map((entry) => ({
        resource: entry.resource,
        lastUpdated: entry.lastUpdated,
      })),
    };
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  report.forEach((seller, index) => {
    const metrics = seller.metrics;
    console.log(
      `${index + 1}. ${seller.serviceName} [${seller.domain}] - ${seller.track ?? "unclassified"} - ${seller.indexed ? "indexed" : "not indexed"}`,
    );
    console.log(`   canonical: ${seller.canonicalUrl}`);
    if (seller.operatingMode) {
      console.log(`   mode: ${seller.operatingMode}`);
    }
    console.log(
      `   metrics: ${
        metrics
          ? `${metrics.total} requests | ${metrics.paidSuccess} paid | ${metrics.paymentRequired} 402`
          : "no host-level metrics yet"
      }`,
    );
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
