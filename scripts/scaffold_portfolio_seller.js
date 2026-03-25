#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildSellerScaffoldConfig, createSellerPortfolio } = require("../portfolio");
const { installPortfolioTemplate } = require("../portfolio/templates");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
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

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runScaffold(configPath, outDir) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "scaffold_bazaar_seller.js"), "--config", configPath, "--out", outDir],
    {
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Scaffold command failed with exit code ${result.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const seller of createSellerPortfolio()) {
      console.log(`${seller.id} | ${seller.serviceName} | ${seller.heroRoute.key}`);
    }
    return;
  }

  if (!args.seller) {
    throw new Error("--seller is required. Use --list to inspect seller ids.");
  }

  const config = buildSellerScaffoldConfig(args.seller, {
    packageName: args.packageName,
    serviceName: args.serviceName,
    serviceDescription: args.serviceDescription,
    baseUrl: args.baseUrl,
  });

  if (!args.configOut && !args.out) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  let tempDir = null;
  let configPath = args.configOut ? path.resolve(args.configOut) : null;

  if (!configPath) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bazaar-seller-portfolio-"));
    configPath = path.join(tempDir, `${config.packageName}.json`);
  }

  await writeJson(configPath, config);
  console.log(`Wrote seller config to ${configPath}`);

  if (args.out) {
    const sellerDir = path.resolve(args.out);
    runScaffold(configPath, sellerDir);
    const installResult = await installPortfolioTemplate({
      sellerId: args.seller,
      sellerDir,
    });
    if (installResult.installed) {
      console.log(`Installed portfolio handler template: ${installResult.templatePath}`);
    }
  }

  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
