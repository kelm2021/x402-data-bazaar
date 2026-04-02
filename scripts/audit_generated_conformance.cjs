const fs = require("node:fs");
const path = require("node:path");
const fetch = require("node-fetch");

const { createApp } = require("../app");
const catalog = require("../routes/generated-catalog.json");

function nowIso() {
  return new Date().toISOString();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(result);
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

function isBodyMethod(method) {
  return new Set(["POST", "PUT", "PATCH", "DELETE"]).has(String(method || "").toUpperCase());
}

function isDefaultInputExample(body) {
  return isObject(body) && isObject(body.input) && /replace with real request body/i.test(String(body.input.note || ""));
}

function buildRequestBody(route) {
  const routePath = String(route.routePath || "").toLowerCase();
  const input = isObject(route.inputExample) && !isDefaultInputExample(route.inputExample) ? route.inputExample : {};
  const sampleImageUrl = "https://picsum.photos/seed/aurelianflo/640/360";

  if (routePath.includes("/edu/math")) return { expression: "2+2*5" };
  if (routePath.includes("/convert/json-to-csv")) return { rows: [{ name: "Alice", score: 91 }, { name: "Bob", score: 88 }] };
  if (routePath.includes("/convert/json-to-xml")) return { json: { name: "Alice", score: 91 } };
  if (routePath.includes("/convert/xml-to-json")) return { xml: "<root><name>Alice</name><score>91</score></root>" };
  if (routePath.includes("/convert/html-to-md")) return { html: "<h1>Title</h1><p>Hello world</p>" };
  if (routePath.includes("/json/flatten")) return { json: { user: { name: "Alice", city: "Austin" } } };
  if (routePath.includes("/json/diff")) return { a: { x: 1, y: 2 }, b: { x: 1, y: 3 } };
  if (routePath.includes("/json/validate")) return { jsonText: "{\"x\":1}" };
  if (routePath.includes("/json/schema")) return { json: { x: 1, ok: true } };
  if (routePath.includes("/decode/base64")) return { base64: "aGVsbG8=" };
  if (routePath.includes("/text/keywords")) return { text: "x402 endpoint quality quality audit" };
  if (routePath.includes("/text/entities")) return { text: "OpenAI met Kent Egan in Chicago." };
  if (routePath.includes("/text/similarity")) return { textA: "alpha beta gamma", textB: "beta gamma delta" };
  if (routePath.includes("/text/classify")) return { text: "Need a refund", labels: ["support", "sales", "general"] };
  if (routePath.includes("/text/pii")) return { text: "Email me at user@example.com and call +1 312 555 0199", action: "detect" };
  if (routePath.includes("/text/detect-pii")) return { text: "Email me at user@example.com and call +1 312 555 0199" };
  if (routePath.includes("/text/redact-pii")) return { text: "Contact user@example.com or +1 312 555 0199" };
  if (routePath.includes("/text/paraphrase")) return { text: "A quick and important update to use immediately." };
  if (routePath.includes("/text/headline")) return { text: "Product roadmap update for enterprise users" };
  if (routePath.includes("/text/tweet-thread")) return { text: "Line one. Line two. Line three. Line four." };
  if (routePath.includes("/text/normalize")) return { text: "teh team dont ship   late" };
  if (routePath.includes("/url/parse")) return { url: "https://x402.aurelianflo.com/path?x=1" };
  if (routePath.includes("/url/validate")) return { url: "https://x402.aurelianflo.com/path?x=1" };
  if (routePath.includes("/regex/test")) return { pattern: "x402", text: "x402 bazaar x402", flags: "g" };
  if (routePath.includes("/password/strength")) return { password: "Strong#Pass123" };
  if (routePath.includes("/photo/composition")) return { image_url: sampleImageUrl };
  if (routePath.includes("/photo/exif")) return { image_url: sampleImageUrl };
  if (routePath.includes("/photo/style")) return { image_url: sampleImageUrl, style: "cinematic" };
  if (routePath.includes("/photo/hash")) return { image_url: sampleImageUrl };
  if (routePath.includes("/photo/exposure")) return { aperture: 2.8, shutter: "1/125" };
  if (routePath.includes("/design/logo-colors")) return { image_url: sampleImageUrl };
  if (routePath.includes("/drinks/cocktail")) return { ingredients: ["gin", "lemon", "sugar"] };
  if (routePath.includes("/fashion/outfit")) return { colors: ["navy", "white"], occasion: "business-casual" };
  if (routePath.includes("/gif/compose")) {
    return {
      image_urls: [
        "https://dummyimage.com/480x270/111111/ffffff.png&text=frame1",
        "https://dummyimage.com/480x270/222222/ffffff.png&text=frame2",
        "https://dummyimage.com/480x270/333333/ffffff.png&text=frame3",
      ],
      width: 480,
      height: 270,
      fps: 3,
      fit: "cover",
    };
  }
  if (routePath.endsWith("/hash")) return { algorithm: "sha256", text: "hello" };
  if (routePath.includes("/jwt/sign")) return { payload: { userId: "u_123" } };
  if (routePath.includes("/jwt/decode") || routePath.includes("/jwt/verify")) {
    return { token: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ1XzEyMyJ9.local" };
  }
  if (routePath.includes("/uuid/bulk")) return { count: 3 };
  if (routePath.includes("/fibonacci")) return { count: 7 };
  if (routePath.includes("/roman")) return { number: 49 };
  if (routePath.includes("/luhn")) return { value: "79927398713" };
  if (routePath.includes("/num-to-words")) return { number: 42 };
  if (routePath.includes("/chart/")) return { labels: ["A", "B", "C"], values: [10, 20, 15], type: "bar" };
  if (routePath.includes("/barcode/")) return { value: "123456789012", type: "code128" };
  if (routePath.includes("/image/")) return { imageUrl: "https://example.com/image.png", width: 320, height: 240 };
  if (routePath.includes("/colors/")) return { imageUrl: "https://example.com/image.png" };
  if (routePath.includes("/pdf/") || routePath.includes("/docx/") || routePath.includes("/xlsx/")) return { title: "Generated Doc" };

  return input;
}

function validateByPath(route, payload) {
  const routePath = String(route.routePath || "").toLowerCase();
  const data = payload?.data || {};
  const checks = [];

  function expect(condition, message) {
    checks.push({ ok: Boolean(condition), message });
  }

  if (
    routePath.includes("/pdf/") ||
    routePath.includes("/docx/") ||
    routePath.includes("/xlsx/") ||
    routePath.includes("/invoice/") ||
    routePath.includes("/receipt/") ||
    routePath.includes("/contract/") ||
    routePath.includes("/certificate/") ||
    routePath.includes("/resume/") ||
    routePath.includes("/report/") ||
    routePath.includes("/label/") ||
    routePath.includes("/bizcard/")
  ) {
    expect(isObject(data.artifact), "document artifact object present");
    expect(typeof data.artifact?.contentBase64 === "string", "document artifact contentBase64 present");
  } else if (routePath.includes("/qr/")) {
    expect(typeof data.qrImageUrl === "string" || typeof data.svgDataUri === "string", "qr output present");
  } else if (routePath.includes("/barcode/")) {
    expect(Array.isArray(data.bars), "barcode bars array present");
  } else if (routePath.includes("/placeholder/")) {
    expect(typeof data.svgDataUri === "string", "placeholder svgDataUri present");
  } else if (routePath.includes("/colors/")) {
    expect(Array.isArray(data.palette), "color palette array present");
  } else if (routePath.includes("/chart/")) {
    expect(Array.isArray(data.labels) && Array.isArray(data.values), "chart labels+values arrays present");
  } else if (routePath.includes("/text/keywords")) {
    expect(Array.isArray(data.keywords), "keywords array present");
  } else if (routePath.includes("/text/entities")) {
    expect(Array.isArray(data.entities), "entities array present");
  } else if (routePath.includes("/text/similarity")) {
    expect(typeof data.similarity === "number", "similarity number present");
  } else if (routePath.includes("/text/classify")) {
    expect(typeof data.label === "string", "classify label present");
  } else if (routePath.includes("/text/pii")) {
    expect(typeof data.hasPii === "boolean", "hasPii boolean present");
    expect(typeof data.mode === "string", "pii mode present");
  } else if (routePath.includes("/text/detect-pii")) {
    expect(typeof data.hasPii === "boolean", "hasPii boolean present");
  } else if (routePath.includes("/text/redact-pii")) {
    expect(typeof data.redactedText === "string", "redactedText present");
  } else if (routePath.includes("/text/paraphrase")) {
    expect(typeof data.paraphrasedText === "string", "paraphrasedText present");
  } else if (routePath.includes("/text/headline") || routePath.includes("/email/subject")) {
    expect(typeof data.headline === "string", "headline present");
  } else if (routePath.includes("/text/tweet-thread")) {
    expect(Array.isArray(data.thread), "thread array present");
  } else if (routePath.includes("/text/normalize")) {
    expect(typeof data.normalizedText === "string", "normalizedText present");
  } else if (routePath.includes("/convert/json-to-csv")) {
    expect(typeof data.csv === "string", "csv string present");
  } else if (routePath.includes("/convert/xml-to-json")) {
    expect(isObject(data.json), "json object present");
  } else if (routePath.includes("/convert/json-to-xml")) {
    expect(typeof data.xml === "string", "xml string present");
  } else if (routePath.includes("/convert/html-to-md")) {
    expect(typeof data.markdown === "string", "markdown string present");
  } else if (routePath.includes("/json/flatten")) {
    expect(isObject(data.flattened), "flattened object present");
  } else if (routePath.includes("/json/diff")) {
    expect(Array.isArray(data.changes), "changes array present");
  } else if (routePath.includes("/json/validate")) {
    expect(typeof data.valid === "boolean", "json validity boolean present");
  } else if (routePath.includes("/json/schema")) {
    expect(isObject(data.schema), "json schema object present");
  } else if (routePath.includes("/decode/base64")) {
    expect(typeof data.decoded === "string", "decoded string present");
  } else if (routePath.includes("/uuid/bulk")) {
    expect(Array.isArray(data.uuids), "uuids array present");
  } else if (routePath.includes("/password/strength")) {
    expect(typeof data.score === "number", "password score number present");
  } else if (routePath.includes("/photo/hash")) {
    expect(typeof data.sha256 === "string", "photo sha256 string present");
  } else if (routePath.endsWith("/hash")) {
    expect(typeof data.hash === "string", "hash string present");
  } else if (routePath.includes("/jwt/sign")) {
    expect(typeof data.token === "string", "jwt token present");
  } else if (routePath.includes("/jwt/decode") || routePath.includes("/jwt/verify")) {
    expect(typeof data.valid === "boolean", "jwt valid boolean present");
  } else if (routePath.includes("/regex/test")) {
    expect(Array.isArray(data.matches), "regex matches array present");
  } else if (routePath.includes("/url/parse")) {
    expect(typeof data.hostname === "string", "parsed hostname present");
  } else if (routePath.includes("/url/validate")) {
    expect(typeof data.valid === "boolean", "url valid boolean present");
  } else if (routePath.includes("/ip/validate")) {
    expect(typeof data.valid === "boolean", "ip valid boolean present");
  } else if (routePath.includes("/seo/meta")) {
    expect(typeof data.title === "string", "seo title present");
  } else if (routePath.includes("/seo/wordcount")) {
    expect(typeof data.words === "number", "word count number present");
  } else if (routePath.includes("/ssl/check")) {
    expect(typeof data.validTo === "string", "ssl validTo present");
  } else if (routePath.includes("/robots/")) {
    expect(typeof data.robotsTxt === "string", "robotsTxt string present");
  } else if (routePath.includes("/headers/security")) {
    expect(isObject(data.checks), "security checks object present");
  } else if (routePath.includes("/util/num-to-words")) {
    expect(typeof data.words === "string", "num-to-words output present");
  } else if (routePath.includes("/util/roman")) {
    expect(typeof data.roman === "string", "roman numeral output present");
  } else if (routePath.includes("/util/luhn")) {
    expect(typeof data.valid === "boolean", "luhn validity present");
  } else if (routePath.includes("/util/fibonacci")) {
    expect(Array.isArray(data.sequence), "fibonacci sequence array present");
  } else if (routePath.includes("/edu/math")) {
    expect(typeof data.result === "number", "math numeric result present");
  } else if (routePath.includes("/edu/quiz")) {
    expect(Array.isArray(data.questions), "quiz questions array present");
  } else if (routePath.includes("/edu/flashcards")) {
    expect(Array.isArray(data.flashcards), "flashcards array present");
  } else if (routePath.includes("/edu/study-plan")) {
    expect(Array.isArray(data.plan), "study plan array present");
  } else if (routePath.includes("/edu/explain")) {
    expect(typeof data.explanation === "string", "explanation string present");
  } else if (routePath.includes("/edu/essay-outline")) {
    expect(Array.isArray(data.sections), "essay sections array present");
  } else if (routePath.includes("/edu/cite")) {
    expect(typeof data.citation === "string", "citation string present");
  } else if (routePath.includes("/edu/history")) {
    expect(Array.isArray(data.timeline), "history timeline present");
  } else if (routePath.includes("/edu/analogy")) {
    expect(typeof data.analogy === "string", "analogy string present");
  } else if (routePath.includes("/edu/vocab")) {
    expect(Array.isArray(data.vocab), "vocab array present");
  } else if (routePath.includes("/hr/interview-questions")) {
    expect(Array.isArray(data.behavioral), "behavioral questions array present");
    expect(Array.isArray(data.technical), "technical questions array present");
  } else if (routePath.includes("/hr/comp-benchmark")) {
    expect(isObject(data.salaryRangeUsd), "salary range object present");
  } else if (routePath.includes("/hr/feedback")) {
    expect(Array.isArray(data.improvements), "feedback improvements array present");
  } else if (routePath.includes("/hr/onboarding")) {
    expect(Array.isArray(data.phases), "onboarding phases array present");
  } else if (routePath.includes("/hr/org-chart")) {
    expect(Array.isArray(data.nodes), "org chart nodes array present");
    expect(Array.isArray(data.edges), "org chart edges array present");
  } else if (routePath.includes("/hr/performance-review")) {
    expect(isObject(data.ratings), "performance ratings object present");
  } else if (routePath.includes("/hr/policy")) {
    expect(Array.isArray(data.sections), "policy sections array present");
  } else if (routePath.includes("/hr/termination")) {
    expect(Array.isArray(data.checklist), "termination checklist present");
  } else if (routePath.includes("/hr/benefits")) {
    expect(Array.isArray(data.benefits), "benefits array present");
  } else if (routePath.includes("/productivity/meeting")) {
    expect(Array.isArray(data.agenda), "meeting agenda present");
  } else if (routePath.includes("/productivity/prioritize")) {
    expect(Array.isArray(data.prioritized), "prioritized list present");
  } else if (routePath.includes("/productivity/time-estimate")) {
    expect(typeof data.estimateHours === "number", "estimate hours number present");
  } else if (routePath.includes("/productivity/okr")) {
    expect(Array.isArray(data.keyResults), "okr key results present");
  } else if (routePath.includes("/productivity/timeline")) {
    expect(Array.isArray(data.timeline), "timeline milestones present");
  } else if (routePath.includes("/productivity/standup")) {
    expect(Array.isArray(data.yesterday), "standup yesterday array present");
    expect(Array.isArray(data.today), "standup today array present");
  } else if (routePath.includes("/productivity/sprint")) {
    expect(Array.isArray(data.backlog), "sprint backlog array present");
  } else if (routePath.includes("/productivity/retro")) {
    expect(Array.isArray(data.actions), "retro actions array present");
  } else if (routePath.includes("/productivity/decision-log")) {
    expect(Array.isArray(data.entries), "decision log entries present");
  } else if (routePath.includes("/productivity/sow")) {
    expect(Array.isArray(data.deliverables), "sow deliverables array present");
  } else if (routePath.includes("/marketing/ab-test")) {
    expect(Array.isArray(data.variants), "ab-test variants present");
  } else if (routePath.includes("/marketing/email-campaign")) {
    expect(typeof data.subject === "string", "email campaign subject present");
  } else if (routePath.includes("/marketing/landing-page")) {
    expect(isObject(data.sections), "landing page sections object present");
  } else if (routePath.includes("/marketing/persona")) {
    expect(isObject(data.persona), "persona object present");
  } else if (routePath.includes("/marketing/pitch-deck")) {
    expect(Array.isArray(data.slides), "pitch deck slides array present");
  } else if (routePath.includes("/marketing/press-release")) {
    expect(typeof data.headline === "string", "press release headline present");
  } else if (routePath.includes("/marketing/seo-keywords")) {
    expect(Array.isArray(data.keywords), "seo keywords array present");
  } else if (routePath.includes("/marketing/social-caption")) {
    expect(Array.isArray(data.captions), "social captions array present");
  } else if (routePath.includes("/marketing/growth-hacks")) {
    expect(Array.isArray(data.experiments), "growth experiments array present");
  } else if (routePath.includes("/marketing/hashtags")) {
    expect(Array.isArray(data.suggestions), "hashtag suggestions array present");
  } else if (routePath.includes("/lang/acronym")) {
    expect(typeof data.acronym === "string", "acronym string present");
  } else if (routePath.includes("/lang/dialect")) {
    expect(typeof data.convertedText === "string", "dialect converted text present");
  } else if (routePath.includes("/lang/formality")) {
    expect(typeof data.rewrittenText === "string", "formality rewritten text present");
  } else if (routePath.includes("/lang/idiom")) {
    expect(typeof data.meaning === "string", "idiom meaning present");
  } else if (routePath.includes("/lang/jargon")) {
    expect(typeof data.translatedText === "string", "jargon translated text present");
  } else if (routePath.includes("/misc/iching")) {
    expect(typeof data.hexagram === "number", "iching hexagram present");
  } else if (routePath.includes("/misc/pickup-line")) {
    expect(typeof data.line === "string", "pickup line present");
  } else if (routePath.includes("/misc/astrology")) {
    expect(typeof data.reading === "string", "astrology reading present");
  } else if (routePath.includes("/misc/numerology")) {
    expect(typeof data.lifePath === "number", "numerology lifePath present");
  } else if (routePath.includes("/misc/biorhythm")) {
    expect(isObject(data.cycles), "biorhythm cycles object present");
  } else if (routePath.includes("/misc/mbti")) {
    expect(typeof data.type === "string", "mbti type present");
  } else if (routePath.includes("/misc/gift")) {
    expect(Array.isArray(data.recommendations), "gift recommendations present");
  } else if (routePath.includes("/misc/baby-name")) {
    expect(Array.isArray(data.names), "baby names array present");
  } else if (routePath.includes("/misc/compliment")) {
    expect(typeof data.compliment === "string", "compliment string present");
  } else if (routePath.includes("/misc/excuse")) {
    expect(typeof data.excuse === "string", "excuse string present");
  } else if (data.template === true) {
    return { status: "warn", checks, note: "template_content_output" };
  }

  if (!checks.length) {
    return { status: "pass", checks, note: "no_specific_path_validator" };
  }
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    return { status: "fail", checks, note: "path_validator_failed" };
  }
  return { status: "pass", checks, note: "path_validator_passed" };
}

async function callRoute(baseUrl, route) {
  const method = String(route.method || "GET").toUpperCase();
  let resourcePath = String(route.resourcePath || "");
  const routePath = String(route.routePath || "").toLowerCase();
  if (routePath.includes("/music/tuning/*") && resourcePath.endsWith("/sample")) {
    resourcePath = `${resourcePath.slice(0, -"/sample".length)}/A4`;
  }
  const endpoint = `${baseUrl}${resourcePath}`;
  const headers = { accept: "application/json" };
  const options = { method, headers };
  if (isBodyMethod(method)) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(buildRequestBody(route));
  }

  const response = await fetch(endpoint, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    payload = null;
  }

  if (response.status !== 200) {
    return {
      status: "fail",
      reason: `http_${response.status}`,
      details: text.slice(0, 300),
      responseStatus: response.status,
      payload: payload,
    };
  }

  if (!isObject(payload) || payload.success !== true) {
    return {
      status: "fail",
      reason: "invalid_success_envelope",
      details: text.slice(0, 300),
      responseStatus: response.status,
      payload: payload,
    };
  }

  if (!isObject(payload.data)) {
    return {
      status: "fail",
      reason: "missing_data_object",
      details: text.slice(0, 300),
      responseStatus: response.status,
      payload: payload,
    };
  }

  if (payload.data.status === "stub") {
    return {
      status: "fail",
      reason: "stub_payload",
      details: text.slice(0, 300),
      responseStatus: response.status,
      payload: payload,
    };
  }

  const specific = validateByPath(route, payload);
  return {
    status: specific.status,
    reason: specific.note,
    checks: specific.checks,
    responseStatus: response.status,
    payload,
  };
}

async function main() {
  const routes = Array.isArray(catalog.routes) ? catalog.routes : [];
  if (!routes.length) {
    throw new Error("No generated routes found in routes/generated-catalog.json");
  }

  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  const startedAt = nowIso();
  const rows = await withServer(app, async (baseUrl) => {
    const out = [];
    for (let i = 0; i < routes.length; i += 1) {
      const route = routes[i];
      const result = await callRoute(baseUrl, route);
      out.push({
        index: i + 1,
        ideaId: route.source?.ideaId || null,
        key: route.key,
        routePath: route.routePath,
        method: route.method,
        category: route.source?.category || null,
        handlerId: route.handlerId || null,
        buildMode: route.source?.buildMode || null,
        status: result.status,
        reason: result.reason,
        checks: result.checks || [],
        responseStatus: result.responseStatus || null,
        outputSource: result.payload?.source || null,
        preview: result.payload ? JSON.stringify(result.payload).slice(0, 420) : (result.details || null),
      });
      if ((i + 1) % 25 === 0) {
        const passCount = out.filter((row) => row.status === "pass").length;
        const warnCount = out.filter((row) => row.status === "warn").length;
        const failCount = out.filter((row) => row.status === "fail").length;
        process.stdout.write(
          `Progress ${i + 1}/${routes.length} pass=${passCount} warn=${warnCount} fail=${failCount}\n`,
        );
      }
    }
    return out;
  });

  const summary = {
    total: rows.length,
    pass: rows.filter((row) => row.status === "pass").length,
    warn: rows.filter((row) => row.status === "warn").length,
    fail: rows.filter((row) => row.status === "fail").length,
  };

  const byCategory = {};
  for (const row of rows) {
    const key = String(row.category || "unknown");
    if (!byCategory[key]) {
      byCategory[key] = { total: 0, pass: 0, warn: 0, fail: 0 };
    }
    byCategory[key].total += 1;
    byCategory[key][row.status] += 1;
  }

  const report = {
    generatedAt: nowIso(),
    startedAt,
    routeCount: routes.length,
    summary,
    byCategory,
    failures: rows.filter((row) => row.status === "fail"),
    warnings: rows.filter((row) => row.status === "warn"),
    rows,
  };

  const outDir = path.join(process.cwd(), "tmp", "conformance");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `generated-conformance-${stamp}.json`);
  const latestPath = path.join(outDir, "generated-conformance-latest.json");
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        fullPath,
        latestPath,
        summary,
        topFailures: report.failures.slice(0, 10).map((row) => ({
          ideaId: row.ideaId,
          key: row.key,
          reason: row.reason,
        })),
        topWarnings: report.warnings.slice(0, 10).map((row) => ({
          ideaId: row.ideaId,
          key: row.key,
          reason: row.reason,
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
