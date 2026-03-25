#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REQUIRED_SOURCE_ENV_NAMES = [
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "METRICS_DASHBOARD_PASSWORD",
];
const OPTIONAL_SOURCE_ENV_NAMES = ["METRICS_SOURCE_SALT"];

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

function parseEnvFile(raw) {
  const values = {};

  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const unquoted = rawValue.replace(/^['"]|['"]$/g, "");
    values[key] = unquoted.replace(/\\n+$/g, "").trimEnd();
  }

  return values;
}

function ensureLinkedProject(sellerDir) {
  const projectPath = path.join(sellerDir, ".vercel", "project.json");
  if (!fs.existsSync(projectPath)) {
    throw new Error(
      `Expected a linked or deployed Vercel project at ${projectPath}. Deploy once before provisioning env vars.`,
    );
  }
}

function requireValue(values, name) {
  const value = values[name];
  if (!value) {
    throw new Error(`Missing ${name} in the source env file.`);
  }

  return value;
}

function runVercelEnvAdd({ sellerDir, name, value, environment }) {
  const tempFile = path.join(
    os.tmpdir(),
    `codex-vercel-env-${process.pid}-${name.toLowerCase()}.txt`,
  );
  fs.writeFileSync(tempFile, String(value), "utf8");

  try {
    const command = `vercel env add ${name} ${environment} --force < ${tempFile}`;
    const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", command], {
      cwd: sellerDir,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`vercel env add failed for ${name} with exit code ${result.status}`);
    }
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const sellerDir = args.sellerDir ? path.resolve(args.sellerDir) : null;
  const envFile = path.resolve(args.envFile || path.join(repoRoot, ".env.vercel.production.check"));
  const environment = String(args.environment || "production");
  const publicBaseUrl = String(args.publicBaseUrl || "").trim();

  if (!sellerDir) {
    throw new Error("--seller-dir is required.");
  }

  if (!publicBaseUrl) {
    throw new Error("--public-base-url is required.");
  }

  if (!fs.existsSync(envFile)) {
    throw new Error(`Source env file not found: ${envFile}`);
  }

  ensureLinkedProject(sellerDir);

  const sourceValues = parseEnvFile(fs.readFileSync(envFile, "utf8"));
  const envPairs = [
    ...REQUIRED_SOURCE_ENV_NAMES.map((name) => [name, requireValue(sourceValues, name)]),
    ...OPTIONAL_SOURCE_ENV_NAMES
      .map((name) => [name, sourceValues[name]])
      .filter(([, value]) => Boolean(value)),
    ["PUBLIC_BASE_URL", publicBaseUrl],
  ];

  console.log(
    `Provisioning ${envPairs.length} environment variables to the Vercel project in ${sellerDir}`,
  );

  for (const [name, value] of envPairs) {
    console.log(`- ${name}`);
    runVercelEnvAdd({
      sellerDir,
      name,
      value,
      environment,
    });
  }

  console.log("Environment provisioning complete. Redeploy the seller before live verification.");
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
