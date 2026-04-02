#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SOURCE_PATH =
  "C:/Users/KentEgan/Downloads/38833FF26BA1D.UnigramPreview_g9c9v27vpyspw!App/vending-machine-ideas.md";
const DEFAULT_BASE_URL = "https://x402.aurelianflo.com";
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "routes", "generated-catalog.json");
const DEFAULT_REPORT_ROOT = path.resolve(process.cwd(), "tmp", "endpoint-pipeline");
const DEFAULT_POST_VERIFY_402INDEX_REPORT = path.resolve(
  process.cwd(),
  "tmp",
  "reports",
  `endpoints-added-today-${new Date().toISOString().slice(0, 10)}.json`,
);
const DEFAULT_CLASSIFICATION_PROFILE_PATH = path.resolve(
  process.cwd(),
  "tmp",
  "remaining-endpoint-feasibility-v2.json",
);

const PRESET_IDS = {
  "quickest-wins": [
    36, 37, 63, 65, 68, 69, 81, 85, 99, 100, 101, 102, 103, 114, 117, 128, 251, 252, 349,
    376, 381, 382,
  ],
  "quickest-wins-strict": [
    36, 63, 65, 68, 69, 81, 85, 99, 101, 103, 114, 117, 251, 252, 349, 376, 381, 382,
  ],
};

const QUICK_WIN_IMPLEMENTED_IDS = new Set(PRESET_IDS["quickest-wins-strict"]);
const DYNAMIC_PRESETS = new Set([
  "auto-local-remaining",
  "auto-local-all",
  "needs-infra-remaining",
  "needs-model-remaining",
  "needs-external-remaining",
]);
const AUTO_LOCAL_EXTERNAL_CATEGORIES = new Set([
  "communication",
  "finance",
  "identity",
  "logistics",
  "health",
  "legal",
  "crypto",
  "social",
  "gov",
  "ecommerce",
  "sports",
  "travel",
  "security",
  "intel",
  "automation",
  "market",
  "trade",
  "agentutil",
  "fintech",
  "env",
  "realestate",
  "entertainment",
  "ag",
  "insurance",
  "construction",
  "food",
  "pets",
  "gaming",
  "a2a",
  "pricing",
  "science",
]);
const AUTO_LOCAL_MODEL_CATEGORIES = new Set(["ai"]);
const AUTO_LOCAL_FRIENDLY_CATEGORIES = new Set([
  "document",
  "transform",
  "dev",
  "util",
  "random",
  "marketing",
  "productivity",
  "lang",
]);
const AUTO_LOCAL_SECONDARY_CATEGORIES = new Set(["media", "nlp", "web", "edu", "hr", "misc"]);
const AUTO_LOCAL_MODEL_PATTERN =
  /\b(llm|openai|anthropic|gemini|claude|gpt|embedding|rerank|vector|transcribe|tts|speech|image generate|video generate|voice clone|whisper)\b/i;
const AUTO_LOCAL_EXTERNAL_PATTERN =
  /\b(twilio|slack|discord|telegram|whatsapp|smtp|imap|oauth|auth0|clerk|firebase|stripe|paypal|plaid|coinbase|kraken|binance|wallet|onchain|blockchain|web3|token|exchange|kyc|aml|ofac|sec|finra|fred|census|bls|fda|nasa|epa|weather|sportsdb|odds|booking|airbnb|uber|lyft|shippo|easypost|ups|fedex|usps|whois|rdap|dns|screenshot|browser|crawl|scrape|crawler|search engine|real-?time|live data|market data|price feed|api key|webhook|send\s+email|send\s+sms|notification queued|queue|delivered)\b/i;
const AUTO_LOCAL_KEYWORD_PATTERN =
  /\b(pdf|docx|xlsx|invoice|receipt|contract|certificate|resume|report|cover-letter|meeting-minutes|privacy-policy|tos|proposal|ticket|qr|barcode|placeholder|color|palette|chart|summarize|summary|keywords|entities|similarity|classify|pii|toxicity|paraphrase|headline|tweet-thread|normalize|json|csv|xml|html|markdown|base64|slug|uuid|password|hash|jwt|regex|url|wordcount|date-diff|age|roman|luhn|fibonacci|hashtag|quiz|worksheet|lesson|checklist|seo|robots|headers|ssl)\b/i;

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
  console.log(`One-shot same-domain endpoint pipeline

Usage:
  node scripts/pipeline_domain_oneshot.js [options]

Optional:
  --source <path>              Ideas markdown list. Default: ${DEFAULT_SOURCE_PATH}
  --output <path>              Catalog JSON output path. Default: routes/generated-catalog.json
  --base-url <url>             Base domain metadata for generated catalog. Default: ${DEFAULT_BASE_URL}
  --preset <name>              quickest-wins | quickest-wins-strict | auto-local-remaining | auto-local-all | needs-infra-remaining | needs-model-remaining | needs-external-remaining
  --ids <csv>                  Explicit numeric idea ids (e.g. 36,63,81)
  --max <n>                    Limit selected rows after filtering
  --start-at <id>              Keep rows with idea id >= this value
  --category <slug>            Filter by category
  --payto-overrides <path>     JSON overrides to set per-endpoint payTo wallet(s)
  --classification-profile <path> Optional feasibility profile JSON for deterministic mode selection
  --truth-only                 Keep only truthy routes (deterministic local)
  --append                     Merge into existing catalog instead of replacing
  --dry-run                    Preview only; do not write output
  --verify                     Verify generated keys resolve via app route config
  --post-verify-402index       After successful --verify, run 402index category patch+verify sync
  --index-report <path>        Input report for post-verify 402index sync. Default: tmp/reports/endpoints-added-today-YYYY-MM-DD.json
  --index-domain <host>        Domain host for 402index sync. Default: host from --base-url
  --index-token <token>        402index verification token (optional; can use env)
  --batch-name <slug>          Report folder name (default autogenerated)
  --report-root <dir>          Report directory root (default: tmp/endpoint-pipeline)
  --help                       Show this help

Examples:
  node scripts/pipeline_domain_oneshot.js --preset quickest-wins-strict --verify
  node scripts/pipeline_domain_oneshot.js --preset auto-local-remaining --append --verify
  node scripts/pipeline_domain_oneshot.js --ids 541,543 --append --verify --payto-overrides tmp/endpoint-pipeline/payto-overrides.partner-template.json
  node scripts/pipeline_domain_oneshot.js --ids 508,509 --append --verify --post-verify-402index
  node scripts/pipeline_domain_oneshot.js --source C:/path/list.md --ids 36,63,81 --append --verify
`);
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

function cleanText(value) {
  return String(value || "")
    .replace(/→|â†’|Ã¢â€ â€™/g, "->")
    .replace(/–|â€“|Ã¢â‚¬â€œ/g, "-")
    .replace(/—|â€”|Ã¢â‚¬â€/g, "-")
    .replace(/×|Ã—|Ãƒâ€”/g, "x")
    .replace(/[“”]|â€œ|â€|Ã¢â‚¬Å“|Ã¢â‚¬Â/g, '"')
    .replace(/[‘’]|â€˜|â€™|Ã¢â‚¬Ëœ|Ã¢â‚¬â„¢/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseIdeaRows(sourceText) {
  const rows = [];
  const lines = String(sourceText || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) {
      continue;
    }

    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 7 || !/^\d+$/.test(parts[0])) {
      continue;
    }

    const id = Number.parseInt(parts[0], 10);
    const toolName = cleanText(parts[1]);
    const endpoint = parseEndpoint(parts[2]);
    const description = cleanText(parts.slice(3, -3).join(" | "));
    const price = parsePrice(parts[parts.length - 3]);
    const buildComplexity = /^\d+$/.test(parts[parts.length - 2])
      ? Number.parseInt(parts[parts.length - 2], 10)
      : null;
    const category = slugify(parts[parts.length - 1]);

    rows.push({ id, toolName, endpoint, description, price, buildComplexity, category, sourceLine: line });
  }

  if (!rows.length) {
    throw new Error("No parseable idea rows found in source file.");
  }

  return rows;
}

function parseIdList(raw) {
  return String(raw || "")
    .split(",")
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function getPresetName(args) {
  const preset = args.preset ? slugify(args.preset) : null;
  if (!preset) {
    return null;
  }

  if (PRESET_IDS[preset] || DYNAMIC_PRESETS.has(preset)) {
    return preset;
  }

  throw new Error(
    `Unknown preset ${args.preset}. Use quickest-wins, quickest-wins-strict, auto-local-remaining, auto-local-all, needs-infra-remaining, needs-model-remaining, or needs-external-remaining.`,
  );
}

function getSelectionIds(preset, explicitIds) {
  if (preset && PRESET_IDS[preset] && explicitIds.length) {
    return [...new Set([...PRESET_IDS[preset], ...explicitIds])];
  }
  if (preset && PRESET_IDS[preset]) {
    return PRESET_IDS[preset];
  }
  if (explicitIds.length) {
    return explicitIds;
  }
  return null;
}

async function loadClassificationProfile(profilePath) {
  if (!profilePath) {
    return null;
  }

  try {
    const raw = await fs.readFile(profilePath, "utf8");
    const parsed = JSON.parse(raw);
    const toSet = (value) =>
      new Set(Array.isArray(value) ? value.map((id) => Number.parseInt(String(id), 10)).filter(Number.isFinite) : []);

    const autoLocalIds = toSet(parsed.autoLocalIds);
    const needsModelIds = toSet(parsed.needsModelIds);
    const needsExternalIds = toSet(parsed.needsExternalIds);
    if (!autoLocalIds.size && !needsModelIds.size && !needsExternalIds.size) {
      return null;
    }

    return {
      path: profilePath,
      autoLocalIds,
      needsModelIds,
      needsExternalIds,
    };
  } catch (_error) {
    return null;
  }
}

function getRowSignalText(row) {
  return cleanText(
    `${row.toolName || ""} ${row.description || ""} ${row.endpoint?.path || ""} ${row.endpoint?.method || ""} ${
      row.category || ""
    }`,
  ).toLowerCase();
}

function classifyRowBuildMode(row, classificationProfile) {
  if (QUICK_WIN_IMPLEMENTED_IDS.has(row.id)) {
    return { mode: "quick_win", reason: "implemented_quick_win" };
  }

  if (classificationProfile) {
    if (classificationProfile.autoLocalIds.has(row.id)) {
      return { mode: "auto_local", reason: "profile_auto_local" };
    }
    if (classificationProfile.needsModelIds.has(row.id)) {
      return { mode: "needs_model", reason: "profile_needs_model" };
    }
    if (classificationProfile.needsExternalIds.has(row.id)) {
      return { mode: "needs_external", reason: "profile_needs_external" };
    }
  }

  const signal = getRowSignalText(row);

  if (AUTO_LOCAL_MODEL_CATEGORIES.has(row.category) || AUTO_LOCAL_MODEL_PATTERN.test(signal)) {
    return { mode: "needs_model", reason: "heuristic_model_signal" };
  }
  if (AUTO_LOCAL_EXTERNAL_CATEGORIES.has(row.category) || AUTO_LOCAL_EXTERNAL_PATTERN.test(signal)) {
    return { mode: "needs_external", reason: "heuristic_external_signal" };
  }
  if (
    AUTO_LOCAL_FRIENDLY_CATEGORIES.has(row.category) ||
    AUTO_LOCAL_SECONDARY_CATEGORIES.has(row.category) ||
    AUTO_LOCAL_KEYWORD_PATTERN.test(signal) ||
    (Number.isFinite(row.buildComplexity) && row.buildComplexity <= 2)
  ) {
    return { mode: "auto_local", reason: "heuristic_auto_local_signal" };
  }

  return { mode: "needs_external", reason: "heuristic_default_external" };
}

function dynamicPresetMatchesMode(preset, mode) {
  if (preset === "auto-local-remaining") {
    return mode === "auto_local";
  }
  if (preset === "auto-local-all") {
    return mode === "auto_local" || mode === "quick_win";
  }
  if (preset === "needs-infra-remaining") {
    return mode === "needs_external" || mode === "needs_model";
  }
  if (preset === "needs-model-remaining") {
    return mode === "needs_model";
  }
  if (preset === "needs-external-remaining") {
    return mode === "needs_external";
  }
  return true;
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
  return "sample";
}

function toWildcardRoutePath(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.includes("*")) {
    return normalized;
  }

  const paramIndex = normalized.indexOf("/:");
  if (paramIndex >= 0) {
    return `${normalized.slice(0, paramIndex)}/*`;
  }

  return normalized;
}

function wildcardToExpress(pathname) {
  let wildcardIndex = 0;
  return String(pathname || "").replace(/\*/g, () => `:value${++wildcardIndex}`);
}

function toResourcePath(pathname) {
  return String(pathname || "")
    .replace(/\*/g, "sample")
    .replace(/:([a-zA-Z0-9_]+)/g, (_full, paramName) => sampleValueForParam(paramName));
}

function isLikelyEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function normalizeRouteKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const method = String(match[1] || "").toUpperCase();
  const routePath = toWildcardRoutePath(String(match[2] || "").trim());
  if (!routePath.startsWith("/")) {
    return null;
  }

  return `${method} ${routePath}`;
}

function normalizeRoutePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (!raw.startsWith("/")) {
    return null;
  }
  return toWildcardRoutePath(raw);
}

async function loadPayToOverrides(overridePath) {
  if (!overridePath) {
    return {
      path: null,
      defaultPayTo: null,
      byId: new Map(),
      byKey: new Map(),
      byRoutePath: new Map(),
      warnings: [],
      rawCount: 0,
    };
  }

  const resolvedPath = path.resolve(String(overridePath));
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);

  const warnings = [];
  const byId = new Map();
  const byKey = new Map();
  const byRoutePath = new Map();
  const defaultPayTo = String(parsed?.defaultPayTo || "").trim() || null;

  if (defaultPayTo && !isLikelyEvmAddress(defaultPayTo)) {
    warnings.push(`defaultPayTo does not look like an EVM address: ${defaultPayTo}`);
  }

  const rows = Array.isArray(parsed?.endpointOverrides)
    ? parsed.endpointOverrides
    : Array.isArray(parsed?.overrides)
      ? parsed.overrides
      : [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object") {
      warnings.push(`override #${index + 1} is not an object and was ignored`);
      continue;
    }

    const payTo = String(row.payTo || "").trim();
    if (!payTo) {
      warnings.push(`override #${index + 1} missing payTo and was ignored`);
      continue;
    }

    if (!isLikelyEvmAddress(payTo)) {
      warnings.push(`override #${index + 1} payTo does not look like an EVM address: ${payTo}`);
    }

    const metadata = {
      payTo,
      owner: String(row.owner || row.partner || "").trim() || null,
      notes: String(row.notes || "").trim() || null,
      index: index + 1,
    };

    let matched = false;

    if (Number.isInteger(row.id)) {
      byId.set(Number(row.id), metadata);
      matched = true;
    }

    const normalizedKey = normalizeRouteKey(row.key);
    if (normalizedKey) {
      byKey.set(normalizedKey, metadata);
      matched = true;
    } else if (row.key != null) {
      warnings.push(`override #${index + 1} has invalid key format: ${String(row.key)}`);
    }

    const routePathCandidate = row.routePath ?? row.path ?? row.resourcePath;
    const normalizedRoutePath = normalizeRoutePath(routePathCandidate);
    if (normalizedRoutePath) {
      byRoutePath.set(normalizedRoutePath, metadata);
      matched = true;
    } else if (routePathCandidate != null) {
      warnings.push(
        `override #${index + 1} has invalid routePath/path/resourcePath: ${String(routePathCandidate)}`,
      );
    }

    if (!matched) {
      warnings.push(
        `override #${index + 1} had no usable selector (set one of: id, key, routePath/path/resourcePath)`,
      );
    }
  }

  return {
    path: resolvedPath,
    defaultPayTo,
    byId,
    byKey,
    byRoutePath,
    warnings,
    rawCount: rows.length,
  };
}

function resolvePayToOverride(row, route, payToOverrides) {
  if (!payToOverrides) {
    return null;
  }

  const byIdMatch = payToOverrides.byId.get(row.id);
  if (byIdMatch) {
    return byIdMatch;
  }

  const byKeyMatch = payToOverrides.byKey.get(route.key);
  if (byKeyMatch) {
    return byKeyMatch;
  }

  const byPathMatch = payToOverrides.byRoutePath.get(route.routePath);
  if (byPathMatch) {
    return byPathMatch;
  }

  if (payToOverrides.defaultPayTo) {
    return {
      payTo: payToOverrides.defaultPayTo,
      owner: null,
      notes: "defaultPayTo",
      index: null,
    };
  }

  return null;
}

function createDefaultInputExample(row) {
  return {
    tool: row.toolName,
    input: {
      note: "replace with real request body",
    },
  };
}

function createDefaultOutputExample(row) {
  return {
    success: true,
    data: {
      status: "stub",
      tool: row.toolName,
      message: "Generated route stub. Replace with provider-backed logic.",
    },
    source: "x402-generated-catalog",
  };
}

function getQuickWinOverrides(row) {
  switch (row.id) {
    case 36:
      return {
        handlerId: "qr_generate",
        inputExample: { text: "https://x402.aurelianflo.com", size: 256 },
        inputSchema: {
          properties: {
            text: { type: "string", description: "Text or URL to encode" },
            size: { type: "number", description: "Image size in pixels" },
          },
          additionalProperties: true,
        },
        outputExample: {
          success: true,
          data: { text: "https://x402.aurelianflo.com", size: 256, qrImageUrl: "https://quickchart.io/qr?..." },
          source: "quickchart-url-generator",
        },
      };
    case 63:
      return {
        handlerId: "text_sentiment",
        inputExample: { text: "This API is fast and useful." },
        inputSchema: { properties: { text: { type: "string" } }, required: ["text"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { sentiment: "positive", score: 0.4, emotions: { joy: 1 } },
          source: "local-lexicon-sentiment",
        },
      };
    case 65:
      return {
        handlerId: "text_translate",
        inputExample: { text: "hello world", targetLanguage: "es" },
        inputSchema: {
          properties: { text: { type: "string" }, targetLanguage: { type: "string" } },
          required: ["text"],
          additionalProperties: true,
        },
        outputExample: {
          success: true,
          data: { originalText: "hello world", translatedText: "hola mundo", targetLanguage: "es" },
          source: "local-rule-based-translation",
        },
      };
    case 68:
      return {
        handlerId: "text_grammar",
        inputExample: { text: "teh team dont ship late ." },
        inputSchema: { properties: { text: { type: "string" } }, required: ["text"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { originalText: "teh team dont ship late .", correctedText: "The team don't ship late." },
          source: "local-grammar-rules",
        },
      };
    case 69:
      return {
        handlerId: "text_readability",
        inputExample: { text: "Simple writing is easier to read." },
        inputSchema: { properties: { text: { type: "string" } }, required: ["text"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { words: 6, sentences: 1, fleschReadingEase: 75.2, fleschKincaidGrade: 5.1 },
          source: "local-readability-metrics",
        },
      };
    case 81:
      return {
        handlerId: "convert_csv_to_json",
        inputExample: { csv: "name,age\nAlice,30\nBob,25" },
        inputSchema: { properties: { csv: { type: "string" }, delimiter: { type: "string" } }, required: ["csv"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { rowCount: 2, rows: [{ name: "Alice", age: "30" }, { name: "Bob", age: "25" }] },
          source: "local-csv-parser",
        },
      };
    case 85:
      return {
        handlerId: "convert_md_to_html",
        inputExample: { markdown: "# Title\n\n- One\n- Two" },
        inputSchema: { properties: { markdown: { type: "string" } }, required: ["markdown"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { html: "<h1>Title</h1>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>" },
          source: "local-markdown-renderer",
        },
      };
    case 99:
      return {
        handlerId: "encode_base64",
        inputExample: { text: "hello" },
        inputSchema: { properties: { text: { type: "string" } }, additionalProperties: true },
        outputExample: { success: true, data: { input: "hello", base64: "aGVsbG8=" }, source: "node-buffer" },
      };
    case 101:
      return {
        handlerId: "uuid_generate",
        outputExample: {
          success: true,
          data: { uuid: "c50f1f9c-1f1c-4f0a-9c0e-2c8e6f5f5d8f", version: "v4" },
          source: "node-crypto",
        },
      };
    case 103:
      return {
        handlerId: "password_generate",
        inputExample: { length: 20, complexity: "high" },
        inputSchema: { properties: { length: { type: "number" }, complexity: { type: "string" } }, additionalProperties: true },
        outputExample: { success: true, data: { password: "u5A7#r2Q!p9T$e1N", length: 16 }, source: "crypto-random-password" },
      };
    case 114:
      return {
        handlerId: "url_shorten",
        inputExample: { url: "https://x402.aurelianflo.com/pricing" },
        inputSchema: { properties: { url: { type: "string" } }, required: ["url"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { originalUrl: "https://x402.aurelianflo.com/pricing", shortUrl: "https://x402.aurelianflo.com/u/ab12cd34" },
          source: "deterministic-sha256-shortener",
        },
      };
    case 117:
      return {
        handlerId: "text_slug",
        inputExample: { text: "Hello World from x402" },
        inputSchema: { properties: { text: { type: "string" }, maxLength: { type: "number" } }, required: ["text"], additionalProperties: true },
        outputExample: { success: true, data: { slug: "hello-world-from-x402" }, source: "local-slug-generator" },
      };
    case 251:
      return {
        handlerId: "random_joke",
        outputExample: { success: true, data: { joke: "Why do developers prefer dark mode? Because light attracts bugs." }, source: "local-joke-bank" },
      };
    case 252:
      return {
        handlerId: "random_quote",
        queryExample: { topic: "strategy" },
        outputExample: { success: true, data: { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupery" }, source: "local-quote-bank" },
      };
    case 349:
      return {
        handlerId: "marketing_hashtags",
        inputExample: { topic: "x402 api marketplace", platform: "linkedin", count: 12 },
        inputSchema: { properties: { topic: { type: "string" }, platform: { type: "string" }, count: { type: "number" } }, additionalProperties: true },
        outputExample: { success: true, data: { count: 12, suggestions: [{ tag: "#x402api", score: 82 }] }, source: "local-hashtag-generator" },
      };
    case 376:
      return {
        handlerId: "util_wordcount",
        inputExample: { text: "One short sentence." },
        inputSchema: { properties: { text: { type: "string" } }, required: ["text"], additionalProperties: true },
        outputExample: { success: true, data: { words: 3, sentences: 1, paragraphs: 1 }, source: "local-text-metrics" },
      };
    case 381:
      return {
        handlerId: "util_date_diff",
        inputExample: { startDate: "2026-03-01", endDate: "2026-03-31" },
        inputSchema: { properties: { startDate: { type: "string" }, endDate: { type: "string" } }, required: ["startDate", "endDate"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { startDate: "2026-03-01", endDate: "2026-03-31", signedDays: 30, absolute: { weeks: 4.29 } },
          source: "local-date-math",
        },
      };
    case 382:
      return {
        handlerId: "util_age",
        inputExample: { birthdate: "1990-01-15" },
        inputSchema: { properties: { birthdate: { type: "string" } }, required: ["birthdate"], additionalProperties: true },
        outputExample: {
          success: true,
          data: { birthdate: "1990-01-15", age: { years: 36, months: 0, days: 0 } },
          source: "local-age-calculator",
        },
      };
    default:
      return null;
  }
}

function createAutoLocalOutputExample(row) {
  return {
    success: true,
    data: {
      endpoint: row.endpoint.path,
      tool: row.toolName,
      handlerMode: "auto_local",
      previewToken: slugify(`${row.id}-${row.toolName}`).slice(0, 24),
    },
    source: "auto-local-engine",
  };
}

function getAutoLocalOverrides(row) {
  return {
    handlerId: "auto_local",
    outputExample: createAutoLocalOutputExample(row),
  };
}

function classifyTruthTier(route, buildModeInfo) {
  const handlerId = String(route?.handlerId || "");
  const path = String(route?.routePath || "").toLowerCase();
  const buildMode = String(buildModeInfo?.mode || "");

  if (handlerId && handlerId !== "auto_local") {
    return handlerId === "random_joke" || handlerId === "random_quote"
      ? "synthetic_content"
      : "deterministic_local";
  }

  if (buildMode !== "auto_local") {
    return "needs_external";
  }

  const deterministicPatterns = [
    "/convert/csv-to-json",
    "/convert/json-to-csv",
    "/convert/json-to-xml",
    "/convert/xml-to-json",
    "/convert/html-to-md",
    "/json/flatten",
    "/json/diff",
    "/json/validate",
    "/json/schema",
    "/decode/base64",
    "/uuid",
    "/password",
    "/hash",
    "/regex",
    "/url/validate",
    "/ip/validate",
    "/util/roman",
    "/util/luhn",
    "/util/fibonacci",
    "/edu/math",
  ];
  if (deterministicPatterns.some((pattern) => path.includes(pattern))) {
    return "deterministic_local";
  }

  const syntheticArtifactPatterns = [
    "/pdf/",
    "/docx/",
    "/xlsx/",
    "/invoice/",
    "/receipt/",
    "/contract/",
    "/certificate/",
    "/resume/",
    "/report/",
    "/label/",
    "/bizcard/",
    "/cover-letter/",
    "/meeting-minutes/",
    "/privacy-policy/",
    "/tos/",
    "/proposal/",
    "/ticket/",
    "/csv-to-pdf",
    "/html-to-pdf",
    "/markdown-to-pdf",
    "/image/",
    "/favicon/",
    "/signature/",
    "/colors/",
    "/chart/",
    "/placeholder/",
  ];
  if (syntheticArtifactPatterns.some((pattern) => path.includes(pattern))) {
    return "synthetic_artifact";
  }

  const syntheticContentPatterns = [
    "/seo/",
    "/links/",
    "/perf/",
    "/ssl/",
    "/robots/",
    "/headers/",
    "/tech/",
    "/cookies/",
    "/a11y/",
    "/edu/",
    "/hr/",
    "/productivity/",
    "/marketing/",
    "/lang/",
    "/misc/",
    "/random/",
  ];
  if (syntheticContentPatterns.some((pattern) => path.includes(pattern))) {
    return "synthetic_content";
  }

  return "generic_fallback";
}

function createCatalogRoute(row, buildModeInfo, payToOverrides) {
  const resolvedBuildModeInfo = buildModeInfo || { mode: "needs_external", reason: "unclassified" };
  const buildModeTag = String(resolvedBuildModeInfo.mode || "needs_external").replace(/_/g, "-");
  const routePath = toWildcardRoutePath(row.endpoint.path);
  const expressPath = wildcardToExpress(row.endpoint.path);
  const resourcePath = toResourcePath(expressPath);
  const routeSlug = `${String(row.id).padStart(3, "0")}-${slugify(row.toolName)}`;
  const quickWinOverrides = getQuickWinOverrides(row);
  const autoLocalOverrides =
    !quickWinOverrides && resolvedBuildModeInfo.mode === "auto_local" ? getAutoLocalOverrides(row) : null;
  const routeOverrides = quickWinOverrides || autoLocalOverrides || {};

  const route = {
    id: `generated-${routeSlug}`,
    key: `${row.endpoint.method} ${routePath}`,
    method: row.endpoint.method,
    routePath,
    expressPath,
    resourcePath,
    canonicalPath: resourcePath,
    price: row.price,
    category: `generated/${row.category}`,
    tags: ["generated", row.category, buildModeTag, ...slugify(row.toolName).split("-").slice(0, 3)],
    description: row.description,
    queryExample: {},
    ...((row.endpoint.method === "GET" || row.endpoint.method === "HEAD")
      ? {}
      : {
          inputExample: createDefaultInputExample(row),
          bodyType: "json",
        }),
    outputExample: createDefaultOutputExample(row),
    source: {
      ideaId: row.id,
      toolName: row.toolName,
      buildComplexity: row.buildComplexity,
      category: row.category,
      buildMode: resolvedBuildModeInfo.mode,
      buildReason: resolvedBuildModeInfo.reason,
    },
  };

  const mergedRoute = {
    ...route,
    ...routeOverrides,
    source: route.source,
  };
  const payToOverride = resolvePayToOverride(row, mergedRoute, payToOverrides);
  if (payToOverride?.payTo) {
    mergedRoute.payTo = payToOverride.payTo;
  }
  const truthTier = classifyTruthTier(mergedRoute, resolvedBuildModeInfo);

  return {
    ...mergedRoute,
    truthTier,
    source: {
      ...route.source,
      truthTier,
    },
  };
}

function mergeCatalogRoutes(existingRoutes, newRoutes) {
  const byKey = new Map();
  for (const route of existingRoutes || []) {
    if (route && route.key) {
      byKey.set(route.key, route);
    }
  }
  for (const route of newRoutes || []) {
    if (route && route.key) {
      byKey.set(route.key, route);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function spawnNode(commandArgs, options = {}) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (options.echo && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (options.echo && result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${commandArgs.join(" ")}) with exit code ${result.status}`);
  }

  return result;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const sourcePath = path.resolve(String(args.source || DEFAULT_SOURCE_PATH));
  const outputPath = path.resolve(String(args.output || DEFAULT_OUTPUT_PATH));
  const reportRoot = path.resolve(String(args.reportRoot || DEFAULT_REPORT_ROOT));
  const baseUrl = String(args.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const preset = getPresetName(args);
  const explicitIds = args.ids ? parseIdList(args.ids) : [];
  const selectedIds = getSelectionIds(preset, explicitIds);
  const classificationProfilePath = path.resolve(
    String(args.classificationProfile || DEFAULT_CLASSIFICATION_PROFILE_PATH),
  );
  const classificationProfile = await loadClassificationProfile(classificationProfilePath);
  const payToOverrides = await loadPayToOverrides(args.paytoOverrides);
  const dryRun = Boolean(args.dryRun);
  const verify = Boolean(args.verify);
  const postVerify402index = Boolean(args.postVerify402index);
  const append = Boolean(args.append);
  const truthOnly = Boolean(args.truthOnly);

  if (postVerify402index && !verify) {
    throw new Error("--post-verify-402index requires --verify.");
  }
  if (postVerify402index && dryRun) {
    throw new Error("--post-verify-402index cannot be used with --dry-run.");
  }

  const rawSource = await fs.readFile(sourcePath, "utf8");
  let rows = parseIdeaRows(rawSource);

  if (selectedIds && selectedIds.length) {
    const wanted = new Set(selectedIds);
    rows = rows.filter((row) => wanted.has(row.id));
  }

  if (args.category) {
    const wantedCategory = slugify(args.category);
    rows = rows.filter((row) => row.category === wantedCategory);
  }

  if (args.startAt) {
    const startAt = Number.parseInt(String(args.startAt), 10);
    if (!Number.isFinite(startAt)) {
      throw new Error(`Invalid --start-at value: ${args.startAt}`);
    }
    rows = rows.filter((row) => row.id >= startAt);
  }

  const rowBuildMode = new Map(
    rows.map((row) => [row.id, classifyRowBuildMode(row, classificationProfile)]),
  );

  if (preset && DYNAMIC_PRESETS.has(preset)) {
    rows = rows.filter((row) => dynamicPresetMatchesMode(preset, rowBuildMode.get(row.id)?.mode));
  }

  rows = rows.sort((left, right) => left.id - right.id);

  if (args.max) {
    const max = Number.parseInt(String(args.max), 10);
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error(`Invalid --max value: ${args.max}`);
    }
    rows = rows.slice(0, max);
  }

  if (!rows.length) {
    throw new Error("No rows selected after filters.");
  }

  const generatedRoutes = rows.map((row) =>
    createCatalogRoute(row, rowBuildMode.get(row.id), payToOverrides),
  );
  const truthOnlyAllow = new Set(["deterministic_local"]);
  const selectedRoutes = truthOnly
    ? generatedRoutes.filter((route) => truthOnlyAllow.has(String(route.truthTier || "")))
    : generatedRoutes;
  const selectedBuildModes = rows.reduce((acc, row) => {
    const mode = rowBuildMode.get(row.id)?.mode || "unknown";
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});

  let existingCatalog = { version: 1, generatedAt: null, source: null, baseUrl, routes: [] };
  if (append) {
    try {
      const rawExisting = await fs.readFile(outputPath, "utf8");
      existingCatalog = JSON.parse(rawExisting);
    } catch (_error) {
      existingCatalog = { version: 1, generatedAt: null, source: null, baseUrl, routes: [] };
    }
  }

  const finalRoutes = append
    ? mergeCatalogRoutes(existingCatalog.routes || [], selectedRoutes)
    : selectedRoutes;

  const finalCatalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    baseUrl,
    routeCount: finalRoutes.length,
    routes: finalRoutes,
  };

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const batchName = slugify(args.batchName || `domain-oneshot-${timestamp.toLowerCase()}`);
  const reportPath = path.join(reportRoot, batchName, "domain-oneshot-report.json");

  const report = {
    generatedAt: finalCatalog.generatedAt,
    sourcePath,
    outputPath,
    dryRun,
    append,
    baseUrl,
    selectedCount: rows.length,
    selectedIds: rows.map((row) => row.id),
    selectedRouteCount: selectedRoutes.length,
    truthOnly,
    selectedBuildModes,
    truthTierCounts: selectedRoutes.reduce((acc, route) => {
      const tier = String(route.truthTier || "unknown");
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {}),
    preset,
    classificationProfile: classificationProfile
      ? {
          path: classificationProfile.path,
          autoLocalIds: classificationProfile.autoLocalIds.size,
          needsModelIds: classificationProfile.needsModelIds.size,
          needsExternalIds: classificationProfile.needsExternalIds.size,
        }
      : null,
    payToOverrides: payToOverrides.path
      ? {
          path: payToOverrides.path,
          defaultPayTo: payToOverrides.defaultPayTo,
          rawCount: payToOverrides.rawCount,
          byId: payToOverrides.byId.size,
          byKey: payToOverrides.byKey.size,
          byRoutePath: payToOverrides.byRoutePath.size,
          warnings: payToOverrides.warnings,
          selectedRoutesWithExplicitPayTo: selectedRoutes.filter((route) => Boolean(route.payTo)).length,
        }
      : null,
    note:
      rows.some((row) => row.id === 251 || row.id === 252)
        ? "random joke/quote included as two endpoints"
        : null,
  };

  if (!dryRun) {
    await writeJson(outputPath, finalCatalog);
  }

  if (verify) {
    const verifyScript = `
const { createRouteConfig } = require('./app');
const catalog = require('./routes/generated-catalog.json');
const routes = createRouteConfig();
const missing = (Array.isArray(catalog.routes) ? catalog.routes : []).filter((entry) => !routes[entry.key]);
if (missing.length) {
  console.error('Missing generated route keys:', missing.map((entry) => entry.key).join(', '));
  process.exit(1);
}
console.log('Verified generated route keys:', (catalog.routes || []).length);
`;
    const verifyResult = spawnNode(["-e", verifyScript], { cwd: process.cwd(), echo: true });
    report.verify = {
      status: "ok",
      stdout: verifyResult.stdout || "",
    };
  }

  if (postVerify402index) {
    let indexDomain = String(args.indexDomain || "").trim();
    if (!indexDomain) {
      try {
        indexDomain = new URL(baseUrl).host;
      } catch (_error) {
        indexDomain = "x402.aurelianflo.com";
      }
    }
    const indexReportPath = path.resolve(String(args.indexReport || DEFAULT_POST_VERIFY_402INDEX_REPORT));
    const patchScriptPath = path.resolve(
      process.cwd(),
      "scripts",
      "patch_402index_categories_from_report.cjs",
    );
    const patchArgs = [patchScriptPath, "--report", indexReportPath, "--domain", indexDomain];
    if (args.indexToken) {
      patchArgs.push("--token", String(args.indexToken));
    }

    const patchResult = spawnNode(patchArgs, { cwd: process.cwd(), echo: true });
    let parsedPatchOutput = null;
    try {
      parsedPatchOutput = JSON.parse(String(patchResult.stdout || "").trim());
    } catch (_error) {
      parsedPatchOutput = null;
    }

    report.postVerify402index = parsedPatchOutput
      ? {
          status: "ok",
          ...parsedPatchOutput,
        }
      : {
          status: "ok",
          reportPath: indexReportPath,
          domain: indexDomain,
          stdout: patchResult.stdout || "",
        };
  }

  await writeJson(reportPath, report);

  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Selected rows: ${rows.length}`);
  console.log(`Selected routes after filters: ${selectedRoutes.length}`);
  console.log(`Selected build modes: ${JSON.stringify(selectedBuildModes)}`);
  if (payToOverrides.path) {
    console.log(
      `PayTo overrides loaded from ${payToOverrides.path} (id=${payToOverrides.byId.size}, key=${payToOverrides.byKey.size}, path=${payToOverrides.byRoutePath.size})`,
    );
    if (payToOverrides.warnings.length) {
      console.log(`PayTo override warnings (${payToOverrides.warnings.length}):`);
      for (const warning of payToOverrides.warnings.slice(0, 20)) {
        console.log(`- ${warning}`);
      }
      if (payToOverrides.warnings.length > 20) {
        console.log(`... and ${payToOverrides.warnings.length - 20} more`);
      }
    }
  }
  console.log(`Truth-only mode: ${truthOnly ? "on" : "off"}`);
  console.log(`Output catalog: ${outputPath}`);
  console.log(`Report: ${reportPath}`);
  console.log("Preview:");
  for (const route of selectedRoutes.slice(0, 10)) {
    console.log(
      `- #${route.source.ideaId} | ${route.source.buildMode} | ${route.truthTier || "unknown"} | ${route.key} | ${baseUrl}${route.resourcePath}`,
    );
  }
  if (selectedRoutes.length > 10) {
    console.log(`... and ${selectedRoutes.length - 10} more`);
  }
  if (dryRun) {
    console.log("Dry-run only. Re-run without --dry-run to write routes/generated-catalog.json.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
