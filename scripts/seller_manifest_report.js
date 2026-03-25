#!/usr/bin/env node

const manifest = require("../portfolio/seller-manifest.json");

function groupByClassification(items) {
  return items.reduce((groups, item) => {
    const key = item.classification || "unclassified";
    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(item);
    return groups;
  }, {});
}

function main() {
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const groups = groupByClassification(items);
  const order = ["core", "legacy-keep", "legacy-kill", "unclassified"];

  for (const classification of order) {
    const entries = groups[classification];
    if (!entries || !entries.length) {
      continue;
    }

    console.log(`${classification} (${entries.length})`);
    for (const item of entries) {
      console.log(`- ${item.id} | ${item.status} | ${item.operatingMode} | ${item.path}`);
    }
  }
}

main();
