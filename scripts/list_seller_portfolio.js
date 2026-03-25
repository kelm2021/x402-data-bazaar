#!/usr/bin/env node

const { createSellerPortfolio } = require("../portfolio");

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

function formatSellerRow(seller) {
  return [
    seller.id,
    seller.track,
    seller.operatingMode,
    seller.launchTier,
    seller.category,
    seller.heroRoute.key,
    `${seller.routes.length} route${seller.routes.length === 1 ? "" : "s"}`,
  ].join(" | ");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const portfolio = createSellerPortfolio();

  if (args.json) {
    console.log(JSON.stringify(portfolio, null, 2));
    return;
  }

  console.log("id | track | mode | tier | category | hero route | scope");
  for (const seller of portfolio) {
    console.log(formatSellerRow(seller));
  }
}

main();
