const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const BASE_URL = process.env.QUICKWINS_BASE_URL || "https://x402.aurelianflo.com";
const MAX_AMOUNT = process.env.QUICKWINS_MAX_AMOUNT || "0.5";
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const catalog = require("../routes/generated-catalog.json");

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBodyMethod(method) {
  return new Set(["POST", "PUT", "PATCH", "DELETE"]).has(String(method || "").toUpperCase());
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value) {
  return typeof value === "string";
}

function str(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function calculateAgeYears(birthdateIso, referenceDate = new Date()) {
  const birthDate = new Date(`${birthdateIso}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const now = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  let years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDelta = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    years -= 1;
  }
  return years;
}

function countWords(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

function parsePriceUsd(metadata) {
  const parsedPrice = Number.parseFloat(String(metadata?.price || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsedPrice) ? parsedPrice : 0;
}

function extractFirstJsonObject(text) {
  const input = String(text || "");
  const start = input.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function runAgentcashFetch(url, method, body) {
  if (process.platform === "win32") {
    const parts = [
      "npx",
      "agentcash@latest",
      "fetch",
      `"${String(url).replace(/"/g, '\\"')}"`,
      "--format",
      "json",
      "--max-amount",
      String(MAX_AMOUNT),
    ];
    if (method !== "GET") {
      parts.push("-m", method);
    }
    if (body && isBodyMethod(method)) {
      parts.push("-H", "'content-type: application/json'");
      const json = JSON.stringify(body).replace(/'/g, "''");
      parts.push("-b", `'${json}'`);
    }
    const command = parts.join(" ");
    return spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  }

  const args = [
    "agentcash@latest",
    "fetch",
    String(url),
    "--format",
    "json",
    "--max-amount",
    String(MAX_AMOUNT),
  ];
  if (method !== "GET") {
    args.push("-m", method);
  }
  if (body && isBodyMethod(method)) {
    args.push("-H", "content-type: application/json");
    args.push("-b", JSON.stringify(body));
  }
  return spawnSync(NPX_BIN, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

const PROBE_OVERRIDES = {
  qr_generate: {
    body: {
      text: "https://example.com/semantic-check",
      size: 320,
      margin: 4,
    },
  },
  text_sentiment: {
    body: {
      text: "This launch is good, stable, and useful.",
    },
  },
  text_translate: {
    body: {
      text: "hello world",
      targetLanguage: "es",
    },
  },
  text_grammar: {
    body: {
      text: "teh endpoint dont fail .",
    },
  },
  text_readability: {
    body: {
      text: "This is a short sentence. This is another short sentence.",
    },
  },
  convert_csv_to_json: {
    body: {
      csv: "name,age\nAlice,30\nBob,25",
    },
  },
  convert_md_to_html: {
    body: {
      markdown: "# Title\n\n- alpha\n- beta",
    },
  },
  encode_base64: {
    body: {
      text: "semantic-check",
    },
  },
  password_generate: {
    body: {
      length: 20,
      symbols: true,
      complexity: "high",
    },
  },
  url_shorten: {
    body: {
      url: "https://example.com/path?utm=quickwin",
    },
  },
  text_slug: {
    body: {
      text: "Hello Semantic Check",
    },
  },
  marketing_hashtags: {
    body: {
      topic: "x402 api marketplace",
      platform: "instagram",
      count: 8,
    },
  },
  util_wordcount: {
    body: {
      text: "One two three.\n\nFour five six.",
    },
  },
  util_date_diff: {
    body: {
      startDate: "2026-01-01",
      endDate: "2026-01-15",
    },
  },
  util_age: {
    body: {
      birthdate: "1990-01-01",
    },
  },
};

function buildProbeRequest(route) {
  const method = String(route.method || "GET").toUpperCase();
  const override = PROBE_OVERRIDES[route.handlerId] || {};
  const body = isBodyMethod(method)
    ? (override.body || (route.inputExample && typeof route.inputExample === "object" ? route.inputExample : null))
    : null;
  const query = override.query || null;
  const base = `${BASE_URL}${route.resourcePath}`;
  if (!query || typeof query !== "object" || !Object.keys(query).length) {
    return { url: base, method, body };
  }
  const parsed = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    parsed.searchParams.set(key, String(value));
  }
  return { url: parsed.toString(), method, body };
}

function semanticCheck(checks, sample) {
  const failed = checks.find((item) => !item.pass);
  if (failed) {
    return {
      pass: false,
      reason: failed.reason,
      checks,
      sample,
    };
  }
  return {
    pass: true,
    reason: "semantic_ok",
    checks,
    sample,
  };
}

function check(condition, reason) {
  return {
    pass: Boolean(condition),
    reason,
  };
}

function validateQuickWin(route, data, probeRequest) {
  const handlerId = route.handlerId;
  const body = probeRequest.body || {};

  switch (handlerId) {
    case "qr_generate": {
      return semanticCheck(
        [
          check(isString(data?.qrImageUrl) && data.qrImageUrl.startsWith("https://quickchart.io/qr?"), "qrImageUrl missing/invalid"),
          check(data?.text === body.text, "echoed text mismatch"),
          check(isNumber(data?.size) && data.size === body.size, "size mismatch"),
        ],
        {
          text: data?.text,
          size: data?.size,
          qrImageUrl: data?.qrImageUrl,
        },
      );
    }
    case "text_sentiment": {
      return semanticCheck(
        [
          check(["positive", "neutral", "negative"].includes(data?.sentiment), "invalid sentiment label"),
          check(isNumber(data?.score) && data.score >= -1 && data.score <= 1, "score out of range"),
          check(isNumber(data?.metrics?.words) && data.metrics.words >= 1, "word metrics missing"),
        ],
        {
          sentiment: data?.sentiment,
          score: data?.score,
          metrics: data?.metrics,
        },
      );
    }
    case "text_translate": {
      return semanticCheck(
        [
          check(isString(data?.translatedText) && data.translatedText.length > 0, "translatedText missing"),
          check(data?.targetLanguage === body.targetLanguage, "targetLanguage mismatch"),
          check(isNumber(data?.coveragePct) && data.coveragePct >= 0 && data.coveragePct <= 100, "coveragePct invalid"),
        ],
        {
          sourceLanguage: data?.sourceLanguage,
          targetLanguage: data?.targetLanguage,
          translatedText: data?.translatedText,
          coveragePct: data?.coveragePct,
        },
      );
    }
    case "text_grammar": {
      return semanticCheck(
        [
          check(isString(data?.correctedText) && data.correctedText.length > 0, "correctedText missing"),
          check(isNumber(data?.correctionCount) && data.correctionCount >= 0, "correctionCount invalid"),
          check(typeof data?.changed === "boolean", "changed flag missing"),
        ],
        {
          originalText: data?.originalText,
          correctedText: data?.correctedText,
          correctionCount: data?.correctionCount,
        },
      );
    }
    case "text_readability": {
      return semanticCheck(
        [
          check(isNumber(data?.fleschReadingEase), "fleschReadingEase missing"),
          check(isNumber(data?.fleschKincaidGrade), "fleschKincaidGrade missing"),
          check(isNumber(data?.words) && isNumber(data?.sentences) && data.words >= data.sentences, "word/sentence metrics invalid"),
        ],
        {
          words: data?.words,
          sentences: data?.sentences,
          fleschReadingEase: data?.fleschReadingEase,
          fleschKincaidGrade: data?.fleschKincaidGrade,
          gradeBand: data?.gradeBand,
        },
      );
    }
    case "convert_csv_to_json": {
      return semanticCheck(
        [
          check(Array.isArray(data?.rows), "rows missing"),
          check(isNumber(data?.rowCount) && data.rowCount === data.rows.length, "rowCount mismatch"),
          check(Array.isArray(data?.headers) && data.headers.length >= 2, "headers missing"),
          check(data?.rows?.[0]?.name === "Alice", "parsed row content unexpected"),
        ],
        {
          headers: data?.headers,
          rowCount: data?.rowCount,
          firstRow: data?.rows?.[0] || null,
        },
      );
    }
    case "convert_md_to_html": {
      return semanticCheck(
        [
          check(isString(data?.html) && data.html.includes("<h1>") && data.html.includes("<li>"), "html rendering mismatch"),
          check(isNumber(data?.lineCount) && data.lineCount >= 1, "lineCount invalid"),
        ],
        {
          lineCount: data?.lineCount,
          htmlSnippet: isString(data?.html) ? data.html.slice(0, 120) : null,
        },
      );
    }
    case "encode_base64": {
      const decoded = isString(data?.base64) ? Buffer.from(data.base64, "base64").toString("utf8") : null;
      return semanticCheck(
        [
          check(isString(data?.base64) && data.base64.length > 0, "base64 missing"),
          check(decoded === data?.input, "base64 does not decode back to input"),
          check(isNumber(data?.byteLength) && data.byteLength === Buffer.byteLength(String(data?.input || ""), "utf8"), "byteLength mismatch"),
        ],
        {
          input: data?.input,
          base64: data?.base64,
          decoded,
        },
      );
    }
    case "uuid_generate": {
      return semanticCheck(
        [
          check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(data?.uuid)), "uuid format invalid"),
          check(data?.version === "v4", "uuid version mismatch"),
        ],
        {
          uuid: data?.uuid,
          version: data?.version,
        },
      );
    }
    case "password_generate": {
      return semanticCheck(
        [
          check(isString(data?.password) && data.password.length === body.length, "password length mismatch"),
          check(isNumber(data?.entropyBits) && data.entropyBits > 0, "entropyBits invalid"),
          check(data?.complexity === body.complexity, "complexity echo mismatch"),
        ],
        {
          length: data?.length,
          complexity: data?.complexity,
          entropyBits: data?.entropyBits,
          passwordPreview: isString(data?.password) ? `${data.password.slice(0, 4)}...` : null,
        },
      );
    }
    case "url_shorten": {
      const original = str(data?.originalUrl);
      let expectedShortCode = null;
      try {
        const normalized = new URL(original).toString();
        expectedShortCode = crypto.createHash("sha256").update(normalized).digest("base64url").replace(/[-_]/g, "").slice(0, 8).toLowerCase();
      } catch (_error) {
        expectedShortCode = null;
      }
      return semanticCheck(
        [
          check(original === body.url, "originalUrl mismatch"),
          check(isString(data?.shortCode) && data.shortCode.length === 8, "shortCode invalid"),
          check(isString(data?.shortUrl) && data.shortUrl.endsWith(`/${data?.shortCode}`), "shortUrl format invalid"),
          check(!expectedShortCode || data.shortCode === expectedShortCode, "shortCode not deterministic"),
        ],
        {
          originalUrl: data?.originalUrl,
          shortCode: data?.shortCode,
          shortUrl: data?.shortUrl,
          expectedShortCode,
        },
      );
    }
    case "text_slug": {
      return semanticCheck(
        [
          check(isString(data?.slug) && data.slug.length > 0, "slug missing"),
          check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str(data?.slug)), "slug format invalid"),
          check(isNumber(data?.length) && data.length === str(data?.slug).length, "slug length mismatch"),
        ],
        {
          text: data?.text,
          slug: data?.slug,
          length: data?.length,
        },
      );
    }
    case "random_joke": {
      return semanticCheck(
        [
          check(isString(data?.joke) && data.joke.length >= 20, "joke too short"),
          check(isString(data?.id) && data.id.length >= 6, "id missing"),
        ],
        {
          id: data?.id,
          joke: data?.joke,
        },
      );
    }
    case "random_quote": {
      return semanticCheck(
        [
          check(isString(data?.quote) && data.quote.length >= 10, "quote missing"),
          check(isString(data?.author) && data.author.length >= 2, "author missing"),
          check(Array.isArray(data?.tags), "tags missing"),
        ],
        {
          quote: data?.quote,
          author: data?.author,
          tags: data?.tags,
        },
      );
    }
    case "marketing_hashtags": {
      return semanticCheck(
        [
          check(Array.isArray(data?.suggestions) && data.suggestions.length > 0, "suggestions missing"),
          check(isNumber(data?.count) && data.count === data.suggestions.length, "count mismatch"),
          check(data.suggestions.every((item) => isString(item?.tag) && item.tag.startsWith("#")), "non-hashtag suggestion found"),
        ],
        {
          topic: data?.topic,
          platform: data?.platform,
          count: data?.count,
          firstSuggestion: data?.suggestions?.[0] || null,
        },
      );
    }
    case "util_wordcount": {
      const expectedWords = countWords(body.text);
      return semanticCheck(
        [
          check(isNumber(data?.words) && data.words === expectedWords, "word count mismatch"),
          check(isNumber(data?.sentences) && data.sentences >= 1, "sentence count invalid"),
          check(isNumber(data?.paragraphs) && data.paragraphs >= 1, "paragraph count invalid"),
        ],
        {
          expectedWords,
          words: data?.words,
          sentences: data?.sentences,
          paragraphs: data?.paragraphs,
        },
      );
    }
    case "util_date_diff": {
      return semanticCheck(
        [
          check(data?.startDate === body.startDate && data?.endDate === body.endDate, "date echo mismatch"),
          check(isNumber(data?.signedDays) && data.signedDays === 14, "signedDays mismatch"),
          check(isNumber(data?.absolute?.days) && data.absolute.days === Math.abs(data.signedDays), "absolute.days mismatch"),
        ],
        {
          startDate: data?.startDate,
          endDate: data?.endDate,
          signedDays: data?.signedDays,
          absoluteDays: data?.absolute?.days,
        },
      );
    }
    case "util_age": {
      const expectedYears = calculateAgeYears(body.birthdate);
      return semanticCheck(
        [
          check(data?.birthdate === body.birthdate, "birthdate echo mismatch"),
          check(isNumber(data?.age?.years) && data.age.years === expectedYears, "age.years mismatch"),
          check(isNumber(data?.daysUntilNextBirthday) && data.daysUntilNextBirthday >= 0 && data.daysUntilNextBirthday <= 366, "daysUntilNextBirthday out of range"),
        ],
        {
          birthdate: data?.birthdate,
          age: data?.age,
          expectedYears,
          daysUntilNextBirthday: data?.daysUntilNextBirthday,
        },
      );
    }
    default:
      return semanticCheck(
        [check(false, `No semantic validator implemented for handlerId=${handlerId}`)],
        { handlerId },
      );
  }
}

function summarize(results) {
  const summary = {
    total: results.length,
    pass: 0,
    fail: 0,
    transportFailures: 0,
    endpointFailures: 0,
    semanticFailures: 0,
    estimatedSpendUsd: 0,
  };

  for (const row of results) {
    if (row.ok) {
      summary.pass += 1;
    } else {
      summary.fail += 1;
      if (!row.transportOk) summary.transportFailures += 1;
      else if (!row.endpointOk) summary.endpointFailures += 1;
      else summary.semanticFailures += 1;
    }
    summary.estimatedSpendUsd += Number(row.priceUsd || 0);
  }
  summary.estimatedSpendUsd = Number(summary.estimatedSpendUsd.toFixed(4));
  return summary;
}

async function main() {
  const quickWinRoutes = (Array.isArray(catalog.routes) ? catalog.routes : [])
    .filter((route) => route && route.handlerId && route.handlerId !== "auto_local")
    .sort((a, b) => (a.source?.ideaId || 0) - (b.source?.ideaId || 0));

  if (quickWinRoutes.length !== 18) {
    throw new Error(`Expected 18 quick-win routes, found ${quickWinRoutes.length}`);
  }

  const startedAt = nowIso();
  const results = [];

  for (let index = 0; index < quickWinRoutes.length; index += 1) {
    const route = quickWinRoutes[index];
    const probeRequest = buildProbeRequest(route);
    const { method, url, body } = probeRequest;

    const row = {
      index: index + 1,
      ideaId: route.source?.ideaId || null,
      handlerId: route.handlerId,
      key: route.key,
      method,
      url,
      requestBody: body,
      ok: false,
      transportOk: false,
      endpointOk: false,
      semanticPass: false,
      source: null,
      priceUsd: null,
      paymentTx: null,
      reason: null,
      sample: null,
      checks: null,
      error: null,
    };

    const run = runAgentcashFetch(url, method, body);
    if (run.error) {
      row.error = `spawn_error: ${String(run.error.message || run.error)}`;
      row.reason = "spawn_failed";
      results.push(row);
      continue;
    }

    const combined = `${run.stdout || ""}\n${run.stderr || ""}`;
    const jsonText = extractFirstJsonObject(combined);
    if (!jsonText) {
      row.error = `no_json_output: ${combined.slice(0, 300)}`;
      row.reason = "agentcash_no_json_output";
      results.push(row);
      continue;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
    } catch (error) {
      row.error = `json_parse_error: ${String(error.message || error)}`;
      row.reason = "agentcash_json_parse_error";
      results.push(row);
      continue;
    }

    const endpointPayload = parsed?.data;
    const endpointData = endpointPayload?.data;
    row.transportOk = Boolean(parsed?.success);
    row.endpointOk = Boolean(endpointPayload?.success);
    row.source = endpointPayload?.source || null;
    row.priceUsd = parsePriceUsd(parsed?.metadata);
    row.paymentTx = parsed?.metadata?.payment?.transactionHash || null;

    if (!row.transportOk) {
      row.reason = "agentcash_transport_failed";
      row.error = JSON.stringify(parsed).slice(0, 500);
      results.push(row);
      process.stdout.write(`[${index + 1}/${quickWinRoutes.length}] FAIL ${route.handlerId} :: ${row.reason}\n`);
      await sleep(120);
      continue;
    }

    if (!row.endpointOk) {
      row.reason = `endpoint_error:${endpointPayload?.error || "unknown"}`;
      row.error = JSON.stringify(endpointPayload).slice(0, 500);
      results.push(row);
      process.stdout.write(`[${index + 1}/${quickWinRoutes.length}] FAIL ${route.handlerId} :: ${row.reason}\n`);
      await sleep(120);
      continue;
    }

    const semantic = validateQuickWin(route, endpointData, probeRequest);
    row.semanticPass = semantic.pass;
    row.ok = row.transportOk && row.endpointOk && row.semanticPass;
    row.reason = semantic.reason;
    row.sample = semantic.sample;
    row.checks = semantic.checks;
    if (!row.ok) {
      row.error = JSON.stringify(endpointData).slice(0, 700);
    }
    results.push(row);

    const statusLabel = row.ok ? "PASS" : "FAIL";
    process.stdout.write(
      `[${index + 1}/${quickWinRoutes.length}] ${statusLabel} ${route.handlerId} :: ${row.reason} :: sample=${JSON.stringify(row.sample)}\n`,
    );
    await sleep(120);
  }

  const finishedAt = nowIso();
  const summary = summarize(results);
  const failures = results.filter((row) => !row.ok);

  const report = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE_URL,
    maxAmount: MAX_AMOUNT,
    selectedCount: quickWinRoutes.length,
    summary,
    failures,
    results,
  };

  const outDir = path.join(process.cwd(), "tmp", "probe-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `probe-quickwins-prod-agentcash-${stamp}.json`);
  const latestPath = path.join(outDir, "probe-quickwins-prod-agentcash-latest.json");
  fs.writeFileSync(fullPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        fullPath,
        latestPath,
        summary,
        failureCount: failures.length,
        failuresByHandler: failures.map((item) => ({
          handlerId: item.handlerId,
          key: item.key,
          reason: item.reason,
          sample: item.sample,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
