const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BASE_URL = "https://x402.aurelianflo.com";
const MAX_AMOUNT = "0.5";
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const CONCURRENCY = Math.max(1, Math.min(32, Number.parseInt(process.env.PROBE_CONCURRENCY || "8", 10) || 8));
const PROGRESS_EVERY = Math.max(1, Number.parseInt(process.env.PROBE_PROGRESS_EVERY || "20", 10) || 20);
const PROBE_LIMIT = Math.max(0, Number.parseInt(process.env.PROBE_LIMIT || "0", 10) || 0);
const catalog = require("../routes/generated-catalog.json");

function nowIso() {
  return new Date().toISOString();
}

function isBodyMethod(method) {
  return new Set(["POST", "PUT", "PATCH", "DELETE"]).has(String(method || "").toUpperCase());
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDefaultInputExample(body) {
  return isObject(body) && isObject(body.input) && /replace with real request body/i.test(String(body.input.note || ""));
}

function extractFirstJsonObject(text) {
  const input = String(text || "");
  const start = input.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }
  return null;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    try {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
      });

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ error, stdout, stderr, status: null, signal: null });
      });
      child.on("close", (status, signal) => {
        if (settled) return;
        settled = true;
        resolve({ error: null, stdout, stderr, status, signal });
      });
    } catch (error) {
      resolve({ error, stdout, stderr, status: null, signal: null });
    }
  });
}

function toWindowsCommandString(parts) {
  return parts
    .map((part) => {
      const value = String(part);
      if (!/[\s"]/g.test(value)) return value;
      return `"${value.replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}

function sanitizeWindowsBodyValue(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeWindowsBodyValue(entry));
  if (isObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeWindowsBodyValue(entry);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/[^A-Za-z0-9._:\/-]/g, "_");
  }
  return value;
}

function buildRequestBody(route) {
  const routePath = String(route?.routePath || route?.resourcePath || "").toLowerCase();
  const input = isObject(route?.inputExample) && !isDefaultInputExample(route.inputExample) ? route.inputExample : {};

  // Some document routes reject JSON bodies in production; probe them with empty POST bodies.
  if (routePath.includes("/pdf/") || routePath.includes("/invoice/") || routePath.includes("/receipt/") || routePath.includes("/contract/")) {
    return {};
  }
  if (routePath.includes("/docx/")) return {};
  if (routePath.includes("/xlsx/")) return {};

  if (routePath.includes("/qr/")) return { text: "https://x402.aurelianflo.com", size: 256 };
  if (routePath.includes("/barcode/")) return { value: "123456789012", type: "code128" };
  if (routePath.includes("/placeholder/")) return { size: "320x200", text: "demo" };
  if (routePath.includes("/image/")) return { imageUrl: "https://example.com/image.png", width: 320, height: 240 };
  if (routePath.includes("/colors/")) return { imageUrl: "https://example.com/image.png" };
  if (routePath.includes("/chart/")) return { labels: ["A", "B", "C"], values: [10, 20, 15], type: "bar" };

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
  if (routePath.includes("/text/detect-language")) return { text: "Hello world" };
  if (routePath.includes("/email/subject")) return { text: "Quarterly roadmap and release update" };

  if (routePath.includes("/convert/json-to-csv")) return { rows: [{ name: "Alice", score: 91 }, { name: "Bob", score: 88 }] };
  if (routePath.includes("/convert/json-to-xml")) return { json: { name: "Alice", score: 91 } };
  if (routePath.includes("/convert/xml-to-json")) return { xml: "<root><name>Alice</name><score>91</score></root>" };
  if (routePath.includes("/convert/html-to-md")) return { html: "<h1>Title</h1><p>Hello world</p>" };
  if (routePath.includes("/convert/csv-to-json")) return { csv: "name,age\nAlice,30\nBob,25" };
  if (routePath.includes("/convert/units")) return { value: 10, from: "km", to: "mi" };
  if (routePath.includes("/convert/timezone")) return { datetime: "2026-01-01T12:00:00Z", from: "UTC", to: "America/Chicago" };
  if (routePath.includes("/convert/currency")) return { amount: 100, from: "USD", to: "EUR" };
  if (routePath.includes("/convert/color")) return { color: "#3366ff", from: "hex", to: "rgb" };
  if (routePath.includes("/convert/html-table")) return { html: "<table><tr><th>name</th><th>score</th></tr><tr><td>Alice</td><td>91</td></tr></table>" };
  if (routePath.includes("/convert/toml-to-json")) return { toml: "title='example'" };
  if (routePath.includes("/convert/yaml-to-json")) return { yaml: "name: Alice\nscore: 91" };
  if (routePath.includes("/convert/json-to-yaml")) return { json: { name: "Alice", score: 91 } };

  if (routePath.includes("/json/flatten")) return { json: { user: { name: "Alice", city: "Austin" } } };
  if (routePath.includes("/json/diff")) return { a: { x: 1, y: 2 }, b: { x: 1, y: 3 } };
  if (routePath.includes("/json/validate")) return { jsonText: "{\"x\":1}" };
  if (routePath.includes("/json/schema")) return { json: { x: 1, ok: true } };
  if (routePath.includes("/decode/base64")) return { base64: "aGVsbG8=" };

  if (routePath.endsWith("/hash")) return { algorithm: "sha256", text: "hello" };
  if (routePath.includes("/jwt/sign")) return { payload: { userId: "u_123" } };
  if (routePath.includes("/jwt/decode") || routePath.includes("/jwt/verify")) {
    return { token: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ1XzEyMyJ9.local" };
  }
  if (routePath.includes("/regex/test")) return { pattern: "x402", text: "x402 bazaar x402", flags: "g" };
  if (routePath.includes("/uuid/bulk")) return { count: 3 };
  if (routePath.includes("/password/strength")) return { password: "Strong#Pass123" };
  if (routePath.includes("/password/generate")) return { length: 20, complexity: "high" };
  if (routePath.includes("/url/shorten")) return { url: "https://example.com/path?utm=probe" };
  if (routePath.includes("/url/expand")) return { url: "https://bit.ly/x402" };
  if (routePath.includes("/url/parse") || routePath.includes("/url/validate") || routePath.includes("/url/redirects")) return { url: "https://x402.aurelianflo.com/path?x=1" };
  if (routePath.includes("/ip/validate")) return { ip: "8.8.8.8" };
  if (routePath.includes("/headers/security")) return { headers: { "strict-transport-security": "max-age=31536000", "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" } };
  if (routePath.includes("/headers/inspect")) return { url: "https://example.com" };
  if (routePath.includes("/robots/")) return { domain: "example.com" };
  if (routePath.includes("/ssl/check")) return { domain: "example.com" };

  if (routePath.includes("/util/num-to-words")) return { number: 42 };
  if (routePath.includes("/util/roman")) return { number: 49 };
  if (routePath.includes("/util/luhn")) return { value: "79927398713" };
  if (routePath.includes("/util/fibonacci")) return { count: 7 };
  if (routePath.includes("/util/wordcount")) return { text: "One two three.\n\nFour five six." };
  if (routePath.includes("/util/date-diff")) return { startDate: "2026-01-01", endDate: "2026-01-15" };
  if (routePath.includes("/util/age")) return { birthdate: "1990-01-01" };
  if (routePath.includes("/util/license-plate")) return { plate: "ABC123", state: "CA" };

  if (routePath.includes("/edu/math")) return { expression: "2+2*5" };
  if (routePath.includes("/edu/quiz")) return { topic: "algebra basics", count: 4 };
  if (routePath.includes("/edu/flashcards")) return { topic: "networking", terms: ["latency", "throughput"] };
  if (routePath.includes("/edu/study-plan")) return { topic: "algebra basics", days: 7 };
  if (routePath.includes("/edu/explain")) return { topic: "CAP theorem" };
  if (routePath.includes("/edu/essay-outline")) return { topic: "software quality" };
  if (routePath.includes("/edu/cite")) return { author: "Doe, J.", year: 2024, title: "Demo Source", style: "APA" };
  if (routePath.includes("/edu/history")) return { topic: "internet" };
  if (routePath.includes("/edu/analogy")) return { topic: "event loop", target: "a restaurant kitchen" };
  if (routePath.includes("/edu/vocab")) return { topic: "databases", words: ["index", "replica"] };

  if (routePath.includes("/hr/interview-questions")) return { role: "backend engineer" };
  if (routePath.includes("/hr/feedback")) return { role: "backend engineer" };
  if (routePath.includes("/hr/onboarding")) return { role: "backend engineer" };
  if (routePath.includes("/hr/comp-benchmark")) return { role: "backend engineer", level: "mid" };
  if (routePath.includes("/hr/org-chart")) return { team: "platform" };
  if (routePath.includes("/hr/performance-review")) return { role: "backend engineer" };
  if (routePath.includes("/hr/policy")) return { topic: "remote work" };
  if (routePath.includes("/hr/termination")) return { role: "contractor" };
  if (routePath.includes("/hr/benefits")) return { role: "employee" };

  if (routePath.includes("/productivity/meeting")) return { topic: "weekly sync" };
  if (routePath.includes("/productivity/prioritize")) return { items: ["auth", "billing", "onboarding"] };
  if (routePath.includes("/productivity/time-estimate")) return { task: "build endpoint", complexity: "medium" };
  if (routePath.includes("/productivity/okr")) return { objective: "Improve reliability" };
  if (routePath.includes("/productivity/timeline")) return { milestones: ["design", "build", "test"] };
  if (routePath.includes("/productivity/standup")) return { notes: "Finished parser. Starting validator. Waiting on one dependency." };
  if (routePath.includes("/productivity/sprint")) return { goal: "ship endpoint pack" };
  if (routePath.includes("/productivity/retro")) return { sprint: "2026-03" };
  if (routePath.includes("/productivity/decision-log")) return { decision: "Use deterministic local handlers" };
  if (routePath.includes("/productivity/sow")) return { project: "x402 stabilization" };

  if (routePath.includes("/marketing/ab-test")) return { topic: "pricing page headline" };
  if (routePath.includes("/marketing/email-campaign")) return { topic: "api onboarding" };
  if (routePath.includes("/marketing/landing-page")) return { topic: "x402 payments" };
  if (routePath.includes("/marketing/persona")) return { topic: "developer tools" };
  if (routePath.includes("/marketing/pitch-deck")) return { topic: "x402 platform" };
  if (routePath.includes("/marketing/press-release")) return { topic: "new endpoint launch" };
  if (routePath.includes("/marketing/seo-keywords")) return { topic: "x402 api" };
  if (routePath.includes("/marketing/social-caption")) return { topic: "x402 launch" };
  if (routePath.includes("/marketing/growth-hacks")) return { topic: "developer acquisition" };
  if (routePath.includes("/marketing/hashtags")) return { topic: "x402 api marketplace", platform: "instagram", count: 8 };

  if (routePath.includes("/lang/acronym")) return { text: "secure hypertext transfer protocol" };
  if (routePath.includes("/lang/formality")) return { text: "dont ship late", tone: "formal" };
  if (routePath.includes("/lang/dialect")) return { text: "hello friend", target: "uk" };
  if (routePath.includes("/lang/idiom")) return { idiom: "break the ice" };
  if (routePath.includes("/lang/jargon")) return { text: "latency budget", audience: "non-technical" };

  if (routePath.includes("/mock/generate")) return { schema: { id: "number", name: "string" }, count: 3 };
  if (routePath.includes("/cron/parse")) return { expression: "0 9 * * 1-5" };
  if (routePath.includes("/cron/next")) return { expression: "0 9 * * 1-5", count: 3 };
  if (routePath.includes("/diff/text")) return { left: "hello world", right: "hello x402 world" };
  if (routePath.includes("/seo/meta")) return { html: "<title>Demo</title><meta name=\"description\" content=\"desc\">" };
  if (routePath.includes("/seo/wordcount")) return { text: "one two three four" };
  if (routePath.includes("/links/check")) return { html: "<a href=\"https://example.com\">x</a>" };
  if (routePath.includes("/perf/speed")) return { url: "https://example.com" };
  if (routePath.includes("/cookies/audit")) return { cookies: [{ name: "sid", secure: true, httpOnly: true, sameSite: "Lax" }] };
  if (routePath.includes("/a11y/check")) return { html: "<img src=\"x.png\"><button>OK</button>" };
  if (routePath.includes("/tech/detect")) return { html: "<script src=\"/react.js\"></script>" };

  return isObject(input) ? input : {};
}

async function runAgentcashFetch(url, method, body) {
  const normalizedBody = process.platform === "win32" ? sanitizeWindowsBodyValue(body || {}) : (body || {});
  const args = [
    "agentcash@latest",
    "fetch",
    String(url),
    "--format",
    "json",
    "--max-amount",
    String(MAX_AMOUNT),
    ...(method === "GET" ? [] : ["-m", method]),
  ];
  if (isBodyMethod(method) && normalizedBody && Object.keys(normalizedBody).length) {
    args.push("-b", JSON.stringify(normalizedBody));
  }

  if (process.platform === "win32") {
    let command = toWindowsCommandString(["npx", ...args]);
    if (isBodyMethod(method) && normalizedBody && Object.keys(normalizedBody).length) {
      const bodyEscaped = JSON.stringify(normalizedBody).replace(/"/g, '\\"');
      command = `npx agentcash@latest fetch ${String(url)} --format json --max-amount ${String(MAX_AMOUNT)} -m ${method} -b ${bodyEscaped}`;
    }
    return runCommand("cmd.exe", ["/d", "/s", "/c", command]);
  }

  return runCommand(NPX_BIN, args);
}

function summarize(results) {
  const summary = {
    total: results.length,
    success: 0,
    failed: 0,
    nonStubSuccess: 0,
    stubSuccess: 0,
    estimatedSpendUsd: 0,
  };

  for (const row of results) {
    if (!row.ok) {
      summary.failed += 1;
      continue;
    }
    summary.success += 1;
    if (row.nonStub) {
      summary.nonStubSuccess += 1;
    } else {
      summary.stubSuccess += 1;
    }
    summary.estimatedSpendUsd += Number(row.priceUsd || 0);
  }
  summary.estimatedSpendUsd = Number(summary.estimatedSpendUsd.toFixed(4));
  return summary;
}

async function main() {
  let routes = (Array.isArray(catalog.routes) ? catalog.routes : [])
    .filter((route) => route && route.handlerId === "auto_local")
    .sort((a, b) => (a.source?.ideaId || 0) - (b.source?.ideaId || 0));
  if (PROBE_LIMIT > 0) {
    routes = routes.slice(0, PROBE_LIMIT);
  }

  if (!routes.length) {
    throw new Error("No auto_local routes found.");
  }

  const startedAt = nowIso();
  const startedAtMs = Date.now();
  const results = new Array(routes.length);
  let nextIndex = 0;
  let completed = 0;

  async function runOne(index) {
    const route = routes[index];
    const method = String(route.method || "GET").toUpperCase();
    const url = `${BASE_URL}${route.resourcePath}`;
    const requestBody = isBodyMethod(method) ? buildRequestBody(route) : null;

    const row = {
      index: index + 1,
      ideaId: route.source?.ideaId || null,
      key: route.key,
      method,
      url,
      requestBody,
      ok: false,
      nonStub: false,
      source: null,
      priceUsd: null,
      paymentTx: null,
      error: null,
      preview: null,
    };

    const run = await runAgentcashFetch(url, method, requestBody);
    if (run.error) {
      row.error = `spawn_error: ${String(run.error.message || run.error)}`;
      return row;
    }

    const combined = `${run.stdout || ""}\n${run.stderr || ""}`;
    const jsonText = extractFirstJsonObject(combined);
    if (!jsonText) {
      row.error = `no_json_output: ${combined.slice(0, 300)}`;
      return row;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
    } catch (error) {
      row.error = `json_parse_error: ${String(error.message || error)} :: ${jsonText.slice(0, 240)}`;
      return row;
    }

    const endpointPayload = parsed?.data;
    row.ok = Boolean(parsed?.success && endpointPayload?.success);
    row.nonStub = row.ok && endpointPayload?.data?.status !== "stub";
    row.source = endpointPayload?.source || null;
    row.preview = endpointPayload ? JSON.stringify(endpointPayload).slice(0, 420) : null;
    const parsedPrice = Number.parseFloat(String(parsed?.metadata?.price || "").replace(/[^0-9.]/g, ""));
    row.priceUsd = Number.isFinite(parsedPrice) ? parsedPrice : null;
    row.paymentTx = parsed?.metadata?.payment?.transactionHash || null;
    if (!row.ok) {
      row.error = JSON.stringify(parsed).slice(0, 500);
    }
    return row;
  }

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= routes.length) return;

      results[index] = await runOne(index);
      completed += 1;
      if (completed % PROGRESS_EVERY === 0 || completed === routes.length) {
        const partial = results.filter(Boolean);
        const s = summarize(partial);
        const elapsed = ((Date.now() - startedAtMs) / 1000).toFixed(1);
        process.stdout.write(
          `Progress ${completed}/${routes.length} success=${s.success} failed=${s.failed} nonStub=${s.nonStubSuccess} elapsed=${elapsed}s\n`,
        );
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, routes.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const finishedAt = nowIso();
  const elapsedSeconds = Number(((Date.now() - startedAtMs) / 1000).toFixed(2));
  const summary = summarize(results);
  const failures = results.filter((row) => !row.ok);
  const sampleResponses = results
    .filter((row) => row.nonStub && row.preview)
    .slice(0, 12)
    .map((row) => ({
      ideaId: row.ideaId,
      key: row.key,
      url: row.url,
      source: row.source,
      preview: row.preview,
      paymentTx: row.paymentTx,
    }));

  const report = {
    generatedAt: finishedAt,
    startedAt,
    elapsedSeconds,
    concurrency: Math.min(CONCURRENCY, routes.length),
    probeLimit: PROBE_LIMIT || null,
    baseUrl: BASE_URL,
    selectedCount: routes.length,
    summary,
    failures,
    sampleResponses,
    results,
  };

  const outDir = path.join(process.cwd(), "tmp", "probe-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = finishedAt.replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `probe-auto-local-prod-agentcash-v2-${stamp}.json`);
  const latestPath = path.join(outDir, "probe-auto-local-prod-agentcash-v2-latest.json");
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
        sampleResponses,
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
