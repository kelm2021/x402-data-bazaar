#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_PAY_TO = "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d";
const DEFAULT_BASE_URL = "https://x402.aurelianflo.com";
const DEFAULT_PREFIX = "vm";
const DEFAULT_OUT_ROOT = path.resolve(process.cwd(), "apps", "generated");
const DEFAULT_WORK_ROOT = path.resolve(process.cwd(), "tmp", "endpoint-pipeline");

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

function printHelp() {
  console.log(`Bulk endpoint scaffold pipeline

Usage:
  node scripts/scaffold_endpoint_pipeline.js --source <path> [options]

Required:
  --source <path>              Markdown list file ("# | Tool Name | Endpoint | ...")

Optional:
  --apply                      Actually scaffold endpoints (default is dry-run)
  --max <number>               Limit entries processed
  --start-at <number>          Start from Nth parsed row (1-based)
  --prefix <slug>              Package prefix (default: ${DEFAULT_PREFIX})
  --out-root <dir>             Where generated seller apps are created
  --work-root <dir>            Where manifests/configs are written
  --batch-name <slug>          Stable batch folder name
  --base-url <url>             Fixed base URL stored in each seller config (default: ${DEFAULT_BASE_URL})
  --pay-to <address>           payTo wallet address
  --force                      Overwrite existing target app directories
  --emit-configs               Write config JSON files during dry-run
  --category <slug>            Only process matching category
  --help                       Show this help

Examples:
  node scripts/scaffold_endpoint_pipeline.js --source C:/path/vending-machine-ideas.md
  node scripts/scaffold_endpoint_pipeline.js --source C:/path/vending-machine-ideas.md --max 25 --emit-configs
  node scripts/scaffold_endpoint_pipeline.js --source C:/path/vending-machine-ideas.md --apply --max 10 --prefix tools
`);
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function parsePositiveInteger(value, fallback) {
  if (value == null) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }

  return parsed;
}

function cleanText(value) {
  const normalized = String(value || "")
    .replace(/â†’/g, "->")
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/Ã—/g, "x")
    .replace(/â€œ|â€/g, "\"")
    .replace(/â€˜|â€™/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");

  return normalized.trim();
}

function parseEndpoint(value) {
  const match = cleanText(value).match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[\S]*)$/i);
  if (!match) {
    throw new Error(`Invalid endpoint descriptor: ${value}`);
  }

  const normalizedPath = String(match[2] || "")
    .trim()
    .replace(/^\/api\/do(?=\/|$)/i, "/api/tools");

  return {
    method: String(match[1] || "").toUpperCase(),
    path: normalizedPath,
  };
}

function parsePrice(value) {
  const normalized = cleanText(value).replace(/^\$/, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid price value: ${value}`);
  }

  return parsed.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function tryParseIdeaLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) {
    return null;
  }

  const segments = line.split("|").map((segment) => segment.trim());
  if (segments.length < 7) {
    return null;
  }

  const indexText = segments[0];
  if (!/^\d+$/.test(indexText)) {
    return null;
  }

  const toolName = cleanText(segments[1]);
  const endpointDescriptor = cleanText(segments[2]);
  const description = cleanText(segments.slice(3, -3).join(" | "));
  const priceText = cleanText(segments[segments.length - 3]);
  const buildText = cleanText(segments[segments.length - 2]);
  const category = slugify(segments[segments.length - 1]);

  if (!toolName || !endpointDescriptor || !description || !priceText || !category) {
    return null;
  }

  const endpoint = parseEndpoint(endpointDescriptor);

  return {
    index: Number.parseInt(indexText, 10),
    toolName,
    endpoint,
    description,
    price: parsePrice(priceText),
    buildComplexity: /^\d+$/.test(buildText) ? Number.parseInt(buildText, 10) : null,
    category,
    sourceLine: line,
  };
}

function parseIdeaList(rawText) {
  const entries = [];
  const lines = String(rawText || "").split(/\r?\n/);

  for (const line of lines) {
    const parsed = tryParseIdeaLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }

  if (!entries.length) {
    throw new Error("No valid idea rows were parsed. Check the input format.");
  }

  return entries;
}

function sampleValueForParam(paramName) {
  const normalized = slugify(paramName);

  if (normalized.includes("ticker")) return "AAPL";
  if (normalized.includes("zip")) return "10001";
  if (normalized.includes("vin")) return "1HGCM82633A004352";
  if (normalized.includes("domain")) return "example.com";
  if (normalized.includes("address")) return "0x1111111111111111111111111111111111111111";
  if (normalized.includes("country")) return "US";
  if (normalized.includes("code")) return "USD";
  if (normalized.includes("size")) return "512x512";
  if (normalized.includes("agent")) return "agent-123";
  return "sample";
}

function buildResourcePath(routePath) {
  const parts = String(routePath || "")
    .split("/")
    .filter((part, index) => !(index === 0 && part === ""));

  const resolved = parts.map((part) => {
    if (part === "*") {
      return "sample";
    }

    if (part.startsWith(":")) {
      return sampleValueForParam(part.slice(1));
    }

    return part;
  });

  return `/${resolved.join("/")}`;
}

function buildExpressPath(routePath) {
  const parts = String(routePath || "")
    .split("/")
    .filter((part, index) => !(index === 0 && part === ""));

  let wildcardIndex = 0;
  const resolved = parts.map((part) => {
    if (part === "*") {
      wildcardIndex += 1;
      return `:value${wildcardIndex}`;
    }

    return part;
  });

  return `/${resolved.join("/")}`;
}

function createQueryExample() {
  return {};
}

function createInputExample(entry) {
  if (entry.endpoint.method === "GET" || entry.endpoint.method === "HEAD") {
    return null;
  }

  return {
    tool: entry.toolName,
    input: {
      note: "replace with real request body",
    },
  };
}

function toConfigEntry(entry, options = {}) {
  const indexLabel = String(entry.index).padStart(3, "0");
  const shortSlug = slugify(entry.toolName) || `endpoint-${indexLabel}`;
  const packageName = `${options.prefix}-${indexLabel}-${shortSlug}`;
  const routePath = entry.endpoint.path;
  const expressPath = buildExpressPath(routePath);
  const resourcePath = buildResourcePath(routePath);
  const queryExample = createQueryExample(routePath);
  const inputExample = createInputExample(entry);

  return {
    source: {
      index: entry.index,
      toolName: entry.toolName,
      category: entry.category,
      buildComplexity: entry.buildComplexity,
      endpoint: `${entry.endpoint.method} ${entry.endpoint.path}`,
      description: entry.description,
    },
    config: {
      packageName,
      payTo: options.payTo,
      serviceName: entry.toolName,
      serviceDescription: `Paid x402 API for ${entry.description}`,
      baseUrl: options.baseUrl,
      route: {
        key: `${entry.endpoint.method} ${routePath}`,
        expressPath,
        resourcePath,
        price: entry.price,
        category: `vending/${entry.category}`,
        tags: ["vending", entry.category, ...shortSlug.split("-").slice(0, 3)],
        description: entry.description,
        queryExample,
        ...(inputExample ? { inputExample } : {}),
        outputExample: {
          success: true,
          data: {
            status: "stub",
            tool: entry.toolName,
            message: "Replace handlers/primary.js with production logic.",
          },
          source: "stub-provider",
        },
      },
    },
  };
}

function runScaffold(configPath, outDir) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "scaffold_bazaar_seller.js"), "--config", configPath, "--out", outDir],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Scaffold failed for ${outDir} with exit code ${result.status}`);
  }
}

async function ensureCleanTargetDir(targetDir, force) {
  try {
    await fs.stat(targetDir);
  } catch (_error) {
    return;
  }

  if (!force) {
    throw new Error(`Target already exists: ${targetDir}. Use --force to replace it.`);
  }

  await fs.rm(targetDir, { recursive: true, force: true });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildBatchName(sourcePath, overrideName) {
  if (overrideName) {
    return slugify(overrideName);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const sourceSlug = slugify(path.basename(sourcePath, path.extname(sourcePath))) || "ideas";
  return `${sourceSlug}-${stamp.toLowerCase()}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.source) {
    throw new Error("--source is required. Pass a markdown idea list path.");
  }

  const sourcePath = path.resolve(String(args.source));
  const sourceRaw = await fs.readFile(sourcePath, "utf8");
  let entries = parseIdeaList(sourceRaw);

  if (args.category) {
    const wantedCategory = slugify(args.category);
    entries = entries.filter((entry) => entry.category === wantedCategory);
    if (!entries.length) {
      throw new Error(`No entries found for category ${wantedCategory}`);
    }
  }

  const startAt = parsePositiveInteger(args.startAt, 1);
  const max = args.max ? parsePositiveInteger(args.max) : null;

  entries = entries
    .filter((entry) => entry.index >= startAt)
    .sort((left, right) => left.index - right.index);

  if (max != null) {
    entries = entries.slice(0, max);
  }

  if (!entries.length) {
    throw new Error("No entries selected after filters.");
  }

  const dryRun = !args.apply;
  const emitConfigs = Boolean(args.emitConfigs || args.apply);
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL);
  const payTo = String(args.payTo || process.env.PAY_TO || DEFAULT_PAY_TO).trim();
  const prefix = slugify(args.prefix || DEFAULT_PREFIX) || DEFAULT_PREFIX;
  const outRoot = path.resolve(String(args.outRoot || DEFAULT_OUT_ROOT));
  const workRoot = path.resolve(String(args.workRoot || DEFAULT_WORK_ROOT));
  const batchName = buildBatchName(sourcePath, args.batchName);
  const batchRoot = path.join(workRoot, batchName);
  const configsDir = path.join(batchRoot, "configs");
  const manifestPath = path.join(batchRoot, "manifest.json");

  const planned = entries.map((entry) => {
    const configEntry = toConfigEntry(entry, {
      prefix,
      payTo,
      baseUrl,
    });
    const appDir = path.join(outRoot, configEntry.config.packageName);
    const configPath = path.join(configsDir, `${configEntry.config.packageName}.json`);

    return {
      ...configEntry,
      appDir,
      configPath,
      canonicalUrl: `${baseUrl}${configEntry.config.route.resourcePath}`,
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    dryRun,
    batchName,
    options: {
      startAt,
      max,
      category: args.category ? slugify(args.category) : null,
      prefix,
      outRoot,
      baseUrl,
      payTo,
    },
    total: planned.length,
    entries: planned.map((entry) => ({
      index: entry.source.index,
      toolName: entry.source.toolName,
      packageName: entry.config.packageName,
      appDir: entry.appDir,
      configPath: entry.configPath,
      routeKey: entry.config.route.key,
      expressPath: entry.config.route.expressPath,
      resourcePath: entry.config.route.resourcePath,
      canonicalUrl: entry.canonicalUrl,
      price: entry.config.route.price,
      category: entry.source.category,
      buildComplexity: entry.source.buildComplexity,
    })),
  };

  await writeJson(manifestPath, manifest);

  if (emitConfigs) {
    for (const entry of planned) {
      await writeJson(entry.configPath, entry.config);
    }
  }

  if (!dryRun) {
    for (const entry of planned) {
      await ensureCleanTargetDir(entry.appDir, Boolean(args.force));
      runScaffold(entry.configPath, entry.appDir);
    }
  }

  console.log(`Batch: ${batchName}`);
  console.log(`Parsed entries: ${planned.length}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Manifest: ${manifestPath}`);
  if (emitConfigs) {
    console.log(`Configs: ${configsDir}`);
  }
  if (!dryRun) {
    console.log(`Scaffolded apps under: ${outRoot}`);
  }

  const preview = planned.slice(0, 8);
  console.log("Preview:");
  for (const entry of preview) {
    console.log(
      `- #${entry.source.index} | ${entry.config.packageName} | ${entry.config.route.key} | ${entry.canonicalUrl}`,
    );
  }
  if (planned.length > preview.length) {
    console.log(`... and ${planned.length - preview.length} more`);
  }

  if (dryRun) {
    console.log("Dry-run only. Re-run with --apply to scaffold endpoints.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
