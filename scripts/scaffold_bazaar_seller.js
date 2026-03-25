#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const skillScript = path.resolve(
  "C:\\Users\\KentEgan\\.codex\\skills\\bazaar-seller-factory\\scripts\\scaffold_bazaar_seller.js",
);

const result = spawnSync(process.execPath, [skillScript, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
