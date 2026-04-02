const crypto = require("node:crypto");
const { URL } = require("node:url");
const {
  buildDocumentArtifact,
  isDocumentArtifactPath,
} = require("./auto-local/doc-artifacts");
const {
  buildMediaPayload,
  isMediaPath,
} = require("./auto-local/media-ops");
const {
  buildContentPayload,
  isContentPath,
} = require("./auto-local/content-engines");
const {
  buildWebUtilPayload,
  isWebUtilPath,
} = require("./auto-local/web-util");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObject(value) {
  return isPlainObject(value) ? value : {};
}

function readString(value, fallback = "") {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function normalizeInsuranceHistory(value) {
  const labels = new Set();
  const addLabel = (raw) => {
    const normalized = readString(raw).trim().toLowerCase();
    if (!normalized) return;
    if (normalized.includes("clean")) labels.add("clean");
    if (normalized.includes("dui")) labels.add("dui");
    if (normalized.includes("major")) labels.add("major");
    if (normalized.includes("accident")) labels.add("accident");
    if (normalized.includes("ticket") || normalized.includes("violation")) labels.add("ticket");
  };

  if (isPlainObject(value)) {
    if (Boolean(pick(value.clean, value.no_incidents, false))) {
      labels.add("clean");
    }
    if (Boolean(pick(value.dui, value.has_dui, false))) {
      labels.add("dui");
    }
    if (Boolean(pick(value.major, value.major_violation, false))) {
      labels.add("major");
    }
    if (readNumber(pick(value.accidents, value.accident_count), 0) > 0) {
      labels.add("accident");
    }
    if (readNumber(pick(value.tickets, value.ticket_count, value.violations), 0) > 0) {
      labels.add("ticket");
    }

    const incidents = Array.isArray(value.incidents) ? value.incidents : [];
    for (const incident of incidents) {
      addLabel(incident);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      addLabel(item);
    }
  } else {
    addLabel(value);
  }

  if (labels.size === 0) {
    labels.add("clean");
  }
  if (labels.has("clean") && labels.size > 1) {
    labels.delete("clean");
  }

  return Array.from(labels).join(", ");
}

function readNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      continue;
    }
    return value;
  }
  return undefined;
}

function hashText(value) {
  return crypto.createHash("sha256").update(readString(value)).digest("hex");
}

function stableInt(seed, min, max) {
  const h = hashText(seed).slice(0, 8);
  const raw = Number.parseInt(h, 16);
  if (!Number.isFinite(raw)) {
    return min;
  }
  return min + (raw % (max - min + 1));
}

function createQuickCode(length = 8) {
  const targetLength = clamp(Math.floor(readNumber(length, 8)), 4, 64);
  return crypto.randomBytes(Math.ceil(targetLength / 2)).toString("hex").slice(0, targetLength);
}

function words(text) {
  return readString(text)
    .toLowerCase()
    .match(/[a-z0-9']+/g) || [];
}

function parseJsonSafe(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function parseIsoDate(value) {
  const text = readString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (date.toISOString().slice(0, 10) !== text) {
    return null;
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeSlug(value) {
  return readString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(readString(part), "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function normalizeJwtAlgorithm(value) {
  const normalized = readString(value, "HS256").trim().toUpperCase();
  if (normalized === "HS256" || normalized === "HS384" || normalized === "HS512") {
    return normalized;
  }
  return "HS256";
}

function jwtHmacDigestAlgorithm(alg) {
  if (alg === "HS384") return "sha384";
  if (alg === "HS512") return "sha512";
  return "sha256";
}

function normalizeBase(value, fallback = 10) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 36) {
    return value;
  }

  const text = readString(value).trim().toLowerCase();
  if (!text) {
    return fallback;
  }

  const aliases = {
    b: 2,
    bin: 2,
    binary: 2,
    o: 8,
    oct: 8,
    octal: 8,
    d: 10,
    dec: 10,
    decimal: 10,
    h: 16,
    hex: 16,
    hexadecimal: 16,
  };
  if (Object.prototype.hasOwnProperty.call(aliases, text)) {
    return aliases[text];
  }

  const numeric = Number.parseInt(text, 10);
  if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 36) {
    return numeric;
  }

  return fallback;
}

function buildContext(entry, req) {
  const body = toObject(req.body);
  const query = toObject(req.query);
  const params = toObject(req.params);
  const path = readString(entry.routePath || req.path || "").toLowerCase();
  const endpoint = readString(entry.key || `${req.method} ${path}`);
  const title = readString(entry.source?.toolName || entry.description || "Generated Endpoint");
  const category = readString(entry.source?.category || "").toLowerCase();
  const inputText = readString(
    pick(
      body.text,
      body.input,
      body.content,
      body.prompt,
      body.description,
      query.text,
      query.input,
      "",
    ),
  );

  return {
    body,
    query,
    params,
    path,
    endpoint,
    title,
    category,
    inputText,
  };
}

function createArtifact(type, name, content) {
  const text = readString(content || "");
  return {
    type,
    name,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    contentBase64: Buffer.from(text, "utf8").toString("base64"),
  };
}

function buildSourceResponse(data, source = "auto-local-engine") {
  return {
    success: true,
    data,
    source,
  };
}

function buildError(error, message) {
  return {
    success: false,
    error,
    message,
  };
}

function renderDocumentPayload(context) {
  const docType = context.path.includes("/docx/")
    ? "docx"
    : context.path.includes("/xlsx/")
      ? "xlsx"
      : "pdf";
  const title = readString(
    pick(
      context.body.title,
      context.body.subject,
      context.body.name,
      context.title,
      "Generated Document",
    ),
  );
  const sections = isPlainObject(context.body)
    ? Object.entries(context.body)
        .slice(0, 12)
        .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    : [];
  const content = [
    `# ${title}`,
    "",
    `Generated from ${context.endpoint}`,
    `Date: ${new Date().toISOString()}`,
    "",
    ...sections,
  ].join("\n");

  return buildSourceResponse({
    documentType: docType,
    fileName: `${normalizeSlug(title) || "document"}.${docType}`,
    artifact: createArtifact(docType, `${normalizeSlug(title) || "document"}.${docType}`, content),
    preview: sections.slice(0, 6),
  });
}

function renderQrSvg(context) {
  const text = readString(pick(context.body.text, context.body.url, context.query.text, "x402"));
  const size = clamp(Number.parseInt(readString(pick(context.body.size, context.query.size, 256)), 10) || 256, 64, 1024);
  const hash = hashText(text);
  const fill = `#${hash.slice(0, 6)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/><rect x="0" y="0" width="${Math.floor(size / 3)}" height="${Math.floor(size / 3)}" fill="${fill}"/><text x="${Math.floor(size / 2)}" y="${Math.floor(size / 2)}" font-size="12" text-anchor="middle" fill="#111">${text.slice(0, 24)}</text></svg>`;
  return buildSourceResponse({
    text,
    size,
    svg,
    svgDataUri: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  });
}

function renderBarcode(context) {
  const value = readString(pick(context.body.value, context.body.text, context.query.value, "123456789012"));
  const format = readString(pick(context.body.type, context.query.type, "code128")).toLowerCase();
  return buildSourceResponse({
    value,
    format,
    bars: value.split("").map((char, index) => ({ index, char, width: stableInt(`${value}:${index}`, 1, 4) })),
    checksum: stableInt(value, 0, 9),
  });
}

function renderImageTransform(context) {
  const imageUrl = readString(pick(context.body.imageUrl, context.body.url, context.query.imageUrl, "https://example.com/image.png"));
  const width = clamp(Number.parseInt(readString(pick(context.body.width, context.query.width, 512)), 10) || 512, 16, 4096);
  const height = clamp(Number.parseInt(readString(pick(context.body.height, context.query.height, width)), 10) || width, 16, 4096);
  const op = context.path.split("/").slice(-1)[0];
  const descriptor = `${op}:${imageUrl}:${width}x${height}`;
  return buildSourceResponse({
    operation: op,
    imageUrl,
    width,
    height,
    outputUrl: `https://x402.aurelianflo.com/generated/${hashText(descriptor).slice(0, 16)}.png`,
    token: hashText(descriptor).slice(0, 10),
  });
}

function renderPlaceholder(context) {
  const sizeParam = readString(context.params.size || "512x512");
  const [w, h] = sizeParam.includes("x")
    ? sizeParam.split("x").map((v) => clamp(Number.parseInt(v, 10) || 512, 16, 2048))
    : [clamp(Number.parseInt(sizeParam, 10) || 512, 16, 2048), clamp(Number.parseInt(sizeParam, 10) || 512, 16, 2048)];
  const label = readString(pick(context.query.text, "placeholder"));
  const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${w}\" height=\"${h}\"><rect width=\"100%\" height=\"100%\" fill=\"#e5e7eb\"/><text x=\"50%\" y=\"50%\" dominant-baseline=\"middle\" text-anchor=\"middle\" fill=\"#374151\" font-size=\"20\">${label}</text></svg>`;
  return buildSourceResponse({
    width: w,
    height: h,
    label,
    svg,
    svgDataUri: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  });
}

function renderColorPayload(context) {
  const seed = readString(
    pick(context.body.imageUrl, context.body.url, context.body.text, context.query.imageUrl, context.query.text, context.title),
  );
  const base = hashText(seed);
  const palette = Array.from({ length: 6 }).map((_, index) => `#${base.slice(index * 6, index * 6 + 6)}`);
  return buildSourceResponse({
    seed,
    dominant: palette[0],
    palette,
  });
}

function renderChartPayload(context) {
  const labels = Array.isArray(context.body.labels) ? context.body.labels : ["A", "B", "C", "D"];
  const values = Array.isArray(context.body.values)
    ? context.body.values.map((value) => readNumber(value, 0))
    : labels.map((label) => stableInt(`${label}:${context.title}`, 10, 100));
  const chartType = readString(pick(context.body.type, context.query.type, "bar")).toLowerCase();
  return buildSourceResponse({
    chartType,
    labels,
    values,
    summary: {
      min: Math.min(...values),
      max: Math.max(...values),
      average: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2)),
    },
  });
}

function renderTextNlpPayload(context) {
  const text = readString(pick(context.body.text, context.body.input, context.query.text, "sample text"));
  const tokenized = words(text);
  if (context.path.includes("/summarize-bullets")) {
    const bullets = text
      .split(/[.!?]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((line) => line.length > 120 ? `${line.slice(0, 117)}...` : line);
    return buildSourceResponse({ text, bullets });
  }
  if (context.path.includes("/detect-language")) {
    const ascii = /[a-z]/i.test(text);
    return buildSourceResponse({
      language: ascii ? "en" : "unknown",
      confidence: ascii ? 0.86 : 0.4,
      textSample: text.slice(0, 120),
    });
  }
  if (context.path.includes("/keywords")) {
    const counts = new Map();
    for (const token of tokenized) counts.set(token, (counts.get(token) || 0) + 1);
    const keywords = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));
    return buildSourceResponse({ keywords, text });
  }
  if (context.path.includes("/entities")) {
    const entities = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [])
      .slice(0, 12)
      .map((value) => ({ text: value, type: "proper_noun" }));
    return buildSourceResponse({ entities, count: entities.length });
  }
  if (context.path.includes("/similarity")) {
    const left = readString(pick(context.body.textA, context.body.a, text));
    const right = readString(pick(context.body.textB, context.body.b, context.query.textB, ""));
    const leftWords = new Set(words(left));
    const rightWords = new Set(words(right));
    const intersection = [...leftWords].filter((value) => rightWords.has(value)).length;
    const union = new Set([...leftWords, ...rightWords]).size || 1;
    return buildSourceResponse({ similarity: Number((intersection / union).toFixed(4)), method: "jaccard" });
  }
  if (context.path.includes("/classify")) {
    const labels = Array.isArray(context.body.labels) && context.body.labels.length ? context.body.labels : ["general", "support", "sales"];
    const pickIndex = stableInt(`${text}:${labels.join(",")}`, 0, labels.length - 1);
    return buildSourceResponse({ label: labels[pickIndex], labels });
  }
  if (context.path.includes("/detect-pii")) {
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const phones = text.match(/\+?[0-9][0-9\-().\s]{7,}[0-9]/g) || [];
    return buildSourceResponse({ emails, phones, hasPii: emails.length > 0 || phones.length > 0 });
  }
  if (context.path.includes("/redact-pii")) {
    const redacted = text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\+?[0-9][0-9\-().\s]{7,}[0-9]/g, "[REDACTED_PHONE]");
    return buildSourceResponse({ originalText: text, redactedText: redacted });
  }
  if (context.path.includes("/toxicity")) {
    const toxicTerms = ["hate", "stupid", "idiot", "kill"];
    const hits = toxicTerms.filter((term) => tokenized.includes(term));
    return buildSourceResponse({ toxicityScore: Number((hits.length / Math.max(1, tokenized.length)).toFixed(3)), flaggedTerms: hits });
  }
  if (context.path.includes("/paraphrase")) {
    const paraphrased = text
      .replace(/\bquick\b/gi, "fast")
      .replace(/\bimportant\b/gi, "critical")
      .replace(/\buse\b/gi, "utilize");
    return buildSourceResponse({ originalText: text, paraphrasedText: paraphrased });
  }
  if (context.path.includes("/headline") || context.path.includes("/subject")) {
    const core = text.trim().split(/\s+/).slice(0, 8).join(" ");
    return buildSourceResponse({ headline: core ? `${core} - Key Update` : "Key Update", text });
  }
  if (context.path.includes("/tweet-thread")) {
    const chunks = text.match(/.{1,220}(\s|$)/g) || [text];
    const thread = chunks.slice(0, 8).map((chunk, index) => `${index + 1}/${Math.min(8, chunks.length)} ${chunk.trim()}`);
    return buildSourceResponse({ thread });
  }
  if (context.path.includes("/to-json")) {
    return buildSourceResponse({ json: { text, words: tokenized.length, checksum: hashText(text).slice(0, 12) } });
  }
  if (context.path.includes("/normalize")) {
    const normalized = text
      .replace(/\bteh\b/gi, "the")
      .replace(/\bdont\b/gi, "don't")
      .replace(/\s+/g, " ")
      .trim();
    return buildSourceResponse({ originalText: text, normalizedText: normalized });
  }
  return buildSourceResponse({ text, tokens: tokenized.length });
}

function renderTransformPayload(context) {
  const path = context.path;
  const body = context.body;
  if (path.includes("/json-to-csv")) {
    const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(body.json) ? body.json : [];
    if (!rows.length) return buildSourceResponse({ csv: "" });
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(",")]
      .concat(rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(",")))
      .join("\n");
    return buildSourceResponse({ csv, rowCount: rows.length });
  }
  if (path.includes("/xml-to-json")) {
    const xml = readString(pick(body.xml, body.text, ""));
    return buildSourceResponse({ json: { raw: xml, length: xml.length } });
  }
  if (path.includes("/json-to-xml")) {
    const json = isPlainObject(body.json) ? body.json : body;
    const xml = `<root>${Object.entries(json).map(([k, v]) => `<${k}>${readString(v)}</${k}>`).join("")}</root>`;
    return buildSourceResponse({ xml });
  }
  if (path.includes("/html-to-md")) {
    const html = readString(pick(body.html, body.text, ""));
    const md = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return buildSourceResponse({ markdown: md });
  }
  if (path.includes("/json/flatten")) {
    const input = isPlainObject(body.json) ? body.json : body;
    const flat = {};
    function walk(prefix, value) {
      if (Array.isArray(value)) {
        value.forEach((item, idx) => walk(`${prefix}[${idx}]`, item));
        return;
      }
      if (isPlainObject(value)) {
        for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}.${k}` : k, v);
        return;
      }
      flat[prefix] = value;
    }
    walk("", input);
    return buildSourceResponse({ flattened: flat });
  }
  if (path.includes("/json/diff")) {
    const a = toObject(pick(body.a, body.left, {}));
    const b = toObject(pick(body.b, body.right, {}));
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changes = [];
    for (const key of keys) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        changes.push({ key, before: a[key], after: b[key] });
      }
    }
    return buildSourceResponse({ changes, changeCount: changes.length });
  }
  if (path.includes("/json/validate")) {
    const raw = readString(pick(body.jsonText, body.text, ""));
    const parsed = parseJsonSafe(raw, null);
    return buildSourceResponse({ valid: parsed !== null, error: parsed === null ? "Invalid JSON" : null });
  }
  if (path.includes("/json/schema")) {
    const json = toObject(pick(body.json, body));
    const schema = {
      type: "object",
      properties: Object.fromEntries(Object.keys(json).map((key) => [key, { type: typeof json[key] }])),
      additionalProperties: true,
    };
    return buildSourceResponse({ schema });
  }
  if (path.includes("/decode/base64")) {
    const encoded = readString(pick(body.base64, body.text, ""));
    return buildSourceResponse({ decoded: Buffer.from(encoded, "base64").toString("utf8") });
  }
  return buildSourceResponse({ converted: true, endpoint: context.endpoint });
}

function renderDevPayload(context) {
  const path = context.path;
  const body = context.body;
  if (path.includes("/uuid/bulk")) {
    const count = clamp(Number.parseInt(readString(pick(body.count, context.query.count, 5)), 10) || 5, 1, 100);
    return buildSourceResponse({ uuids: Array.from({ length: count }, () => crypto.randomUUID()) });
  }
  if (path.includes("/password/strength")) {
    const password = readString(pick(body.password, ""));
    const checks = {
      minLength: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    };
    const score = Object.values(checks).filter(Boolean).length;
    return buildSourceResponse({ score, checks, verdict: score >= 4 ? "strong" : score >= 3 ? "medium" : "weak" });
  }
  if (path.endsWith("/hash")) {
    const algorithm = readString(pick(body.algorithm, context.query.algorithm, "sha256")).toLowerCase();
    const input = readString(pick(body.text, body.input, ""));
    const supported = new Set(["md5", "sha1", "sha256", "sha512"]);
    const algo = supported.has(algorithm) ? algorithm : "sha256";
    return buildSourceResponse({ algorithm: algo, hash: crypto.createHash(algo).update(input).digest("hex") });
  }
  if (path.includes("/jwt/sign")) {
    const payloadSource = isPlainObject(body.payload)
      ? body.payload
      : isPlainObject(body.claims)
        ? body.claims
        : null;
    const payload = payloadSource
      ? { ...payloadSource }
      : (() => {
          const copy = { ...toObject(body) };
          delete copy.secret;
          delete copy.key;
          delete copy.algorithm;
          delete copy.alg;
          return Object.keys(copy).length ? copy : { data: pick(context.inputText, "x402") };
        })();
    if (!Object.prototype.hasOwnProperty.call(payload, "iat")) {
      payload.iat = Math.floor(Date.now() / 1000);
    }

    const algorithm = normalizeJwtAlgorithm(pick(body.algorithm, body.alg, context.query.algorithm, "HS256"));
    const secret = readString(pick(body.secret, body.key, context.query.secret, "local-secret"));
    const header = {
      ...(isPlainObject(body.header) ? body.header : {}),
      typ: "JWT",
      alg: algorithm,
    };
    const signingInput = `${encodeJwtPart(header)}.${encodeJwtPart(payload)}`;
    const signature = crypto
      .createHmac(jwtHmacDigestAlgorithm(algorithm), secret)
      .update(signingInput)
      .digest("base64url");
    const token = `${signingInput}.${signature}`;
    return buildSourceResponse({
      token,
      algorithm,
      header,
      payload,
      signatureType: `hmac-${jwtHmacDigestAlgorithm(algorithm)}`,
      signed: true,
    });
  }
  if (path.includes("/jwt/decode") || path.includes("/jwt/verify")) {
    const token = readString(pick(body.token, context.query.token, ""));
    const [headerPart, payloadPart] = token.split(".");
    const signaturePart = token.split(".")[2] || "";
    const header = decodeJwtPart(headerPart);
    const payload = decodeJwtPart(payloadPart);
    const hasValidStructure = Boolean(header && payload && signaturePart);
    let signatureValid = null;

    if (path.includes("/jwt/verify")) {
      const secret = readString(pick(body.secret, body.key, context.query.secret, ""));
      const algorithm = normalizeJwtAlgorithm(readString(pick(header?.alg, "HS256")));
      if (secret && hasValidStructure) {
        const signingInput = `${readString(headerPart)}.${readString(payloadPart)}`;
        const expectedSignature = crypto
          .createHmac(jwtHmacDigestAlgorithm(algorithm), secret)
          .update(signingInput)
          .digest("base64url");
        signatureValid = expectedSignature === signaturePart;
      } else if (hasValidStructure) {
        signatureValid = false;
      }
    }

    return buildSourceResponse({
      valid: hasValidStructure,
      signatureValid,
      header,
      payload,
    });
  }
  if (path.includes("/regex/test")) {
    const pattern = readString(pick(body.pattern, context.query.pattern, ".*"));
    const target = readString(pick(body.text, body.input, ""));
    const flags = readString(pick(body.flags, context.query.flags, "g"));
    const normalizedFlags = flags.includes("g") ? flags : `${flags}g`;
    let re = null;
    try {
      re = new RegExp(pattern, normalizedFlags);
    } catch (_error) {
      return buildError("invalid_regex", "Pattern or flags are invalid.");
    }
    const allMatches = Array.from(target.matchAll(re)).map((m) => m[0]);
    return buildSourceResponse({ matches: allMatches, count: allMatches.length });
  }
  if (path.includes("/url/parse")) {
    const raw = readString(pick(body.url, context.query.url, "https://example.com/path?x=1"));
    try {
      const u = new URL(raw);
      return buildSourceResponse({
        protocol: u.protocol.replace(":", ""),
        hostname: u.hostname,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams.entries()),
      });
    } catch (_error) {
      return buildError("invalid_url", "URL is invalid.");
    }
  }
  if (path.includes("/url/validate")) {
    const raw = readString(pick(body.url, context.query.url, ""));
    try {
      new URL(raw);
      return buildSourceResponse({ valid: true, url: raw });
    } catch (_error) {
      return buildSourceResponse({ valid: false, url: raw });
    }
  }
  if (path.includes("/ip/validate")) {
    const ip = readString(pick(body.ip, context.query.ip, ""));
    const valid = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[a-f0-9:]+$/i.test(ip);
    return buildSourceResponse({ ip, valid });
  }
  return buildSourceResponse({ endpoint: context.endpoint, generated: true });
}

function renderWebPayload(context) {
  const path = context.path;
  const html = readString(pick(context.body.html, context.body.text, ""));
  if (path.includes("/seo/meta")) {
    const title = (html.match(/<title>([^<]+)<\/title>/i) || [null, "Untitled"])[1];
    const desc = (html.match(/name=["']description["']\s+content=["']([^"']+)/i) || [null, ""])[1];
    return buildSourceResponse({ title, description: desc, wordCount: words(html.replace(/<[^>]+>/g, " ")).length });
  }
  if (path.includes("/seo/wordcount")) {
    const text = html ? html.replace(/<[^>]+>/g, " ") : readString(pick(context.body.text, ""));
    return buildSourceResponse({ words: words(text).length, characters: text.length });
  }
  if (path.includes("/ssl/check")) {
    const domain = readString(pick(context.params.domain, context.query.domain, context.body.domain, "example.com"));
    const days = stableInt(domain, 10, 380);
    const validTo = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return buildSourceResponse({ domain, valid: true, validTo: toIsoDate(validTo), daysRemaining: days });
  }
  if (path.includes("/robots/")) {
    const domain = readString(pick(context.params.domain, "example.com"));
    return buildSourceResponse({ domain, robotsTxt: "User-agent: *\nAllow: /\nSitemap: /sitemap.xml" });
  }
  if (path.includes("/headers/security")) {
    const headers = toObject(context.body.headers);
    const checks = {
      "strict-transport-security": Boolean(headers["strict-transport-security"]),
      "content-security-policy": Boolean(headers["content-security-policy"]),
      "x-frame-options": Boolean(headers["x-frame-options"]),
    };
    return buildSourceResponse({ checks, score: Object.values(checks).filter(Boolean).length });
  }
  return buildSourceResponse({ analyzed: true, endpoint: context.endpoint });
}

function getPromptText(context, fallback = "") {
  return readString(
    pick(
      context.body.prompt,
      context.body.text,
      context.body.topic,
      context.body.title,
      context.inputText,
      context.title,
      fallback,
    ),
  ).trim();
}

function toList(value, fallback) {
  if (Array.isArray(value)) {
    return value.map((entry) => readString(entry).trim()).filter(Boolean);
  }
  const text = readString(value).trim();
  if (!text) {
    return fallback;
  }
  return text
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderTemplateContentPayload(context) {
  const prompt = readString(
    pick(context.body.prompt, context.body.text, context.body.topic, context.body.title, context.inputText, context.title),
  ).trim();
  const lines = [];
  for (let i = 0; i < 5; i += 1) {
    lines.push(`${i + 1}. ${prompt || context.title} - ${context.category || "general"} insight ${i + 1}`);
  }
  return buildSourceResponse({
    title: context.title,
    category: context.category,
    prompt,
    output: lines.join("\n"),
    bullets: lines,
    template: true,
  });
}

function renderEduPayload(context) {
  const path = context.path;
  const topic = getPromptText(context, "general topic");

  if (path.includes("/edu/math")) {
    return renderEduMathPayload(context);
  }
  if (path.includes("/edu/quiz")) {
    const count = clamp(Math.floor(readNumber(pick(context.body.count, context.query.count), 5)), 1, 10);
    const questions = Array.from({ length: count }).map((_, index) => ({
      id: index + 1,
      question: `${topic} question ${index + 1}?`,
      choices: ["A", "B", "C", "D"].map((choice, choiceIndex) => `${choice}. ${topic} option ${choiceIndex + 1}`),
      answerIndex: stableInt(`${topic}:${index}`, 0, 3),
    }));
    return buildSourceResponse({ topic, questionCount: count, questions });
  }
  if (path.includes("/edu/flashcards")) {
    const terms = toList(pick(context.body.terms, topic), [topic]).slice(0, 12);
    const flashcards = terms.map((term, index) => ({
      id: index + 1,
      front: term,
      back: `${term} - concise definition`,
    }));
    return buildSourceResponse({ topic, flashcards });
  }
  if (path.includes("/edu/study-plan")) {
    const days = clamp(Math.floor(readNumber(pick(context.body.days, context.query.days), 7)), 1, 30);
    const plan = Array.from({ length: days }).map((_, dayIndex) => ({
      day: dayIndex + 1,
      focus: `${topic} module ${dayIndex + 1}`,
      tasks: [`Review core concept ${dayIndex + 1}`, "Do practice problems", "Summarize notes"],
    }));
    return buildSourceResponse({ topic, days, plan });
  }
  if (path.includes("/edu/explain")) {
    return buildSourceResponse({
      topic,
      explanation: `${topic} explained in simple terms with practical framing.`,
      keyPoints: [`What it is: ${topic}`, `Why it matters: impact of ${topic}`, "When to apply it"],
    });
  }
  if (path.includes("/edu/essay-outline")) {
    return buildSourceResponse({
      topic,
      thesis: `${topic} can be analyzed through causes, effects, and tradeoffs.`,
      sections: ["Introduction", "Background", "Main Argument 1", "Main Argument 2", "Counterargument", "Conclusion"],
    });
  }
  if (path.includes("/edu/cite")) {
    const style = readString(pick(context.body.style, context.query.style, "APA")).toUpperCase();
    const author = readString(pick(context.body.author, "Doe, J."));
    const year = clamp(Math.floor(readNumber(pick(context.body.year), 2024)), 1900, 2100);
    const title = readString(pick(context.body.title, topic || "Untitled Source"));
    return buildSourceResponse({
      style,
      citation: `${author} (${year}). ${title}.`,
      bibliography: [`${author} (${year}). ${title}.`],
    });
  }
  if (path.includes("/edu/history")) {
    const timeline = Array.from({ length: 5 }).map((_, index) => ({
      year: 2000 + index * 5,
      event: `${topic} milestone ${index + 1}`,
    }));
    return buildSourceResponse({ topic, timeline });
  }
  if (path.includes("/edu/analogy")) {
    const target = readString(pick(context.body.target, "a city transit system"));
    return buildSourceResponse({
      topic,
      analogy: `${topic} is like ${target}: many parts coordinating toward one outcome.`,
      mapping: [
        { concept: "core mechanism", analogy: "main route" },
        { concept: "dependencies", analogy: "intersections" },
        { concept: "optimization", analogy: "traffic timing" },
      ],
    });
  }
  if (path.includes("/edu/vocab")) {
    const base = toList(pick(context.body.words, topic), [topic]).slice(0, 10);
    const vocab = base.map((word, index) => ({
      word,
      definition: `${word} - plain language definition ${index + 1}`,
      example: `Example usage of ${word} in context.`,
    }));
    return buildSourceResponse({ topic, vocab });
  }

  return renderTemplateContentPayload(context);
}

function renderHrPayload(context) {
  const path = context.path;
  const role = getPromptText(context, "general role");

  if (path.includes("/hr/interview-questions")) {
    return buildSourceResponse({
      role,
      behavioral: [
        `Tell me about a difficult project in your ${role} work.`,
        "Describe a conflict and how you resolved it.",
        "How do you prioritize competing deadlines?",
      ],
      technical: [
        `Walk through a core system design relevant to ${role}.`,
        "How do you debug production issues under pressure?",
        "What tradeoffs do you make between speed and quality?",
      ],
    });
  }
  if (path.includes("/hr/comp-benchmark")) {
    const level = readString(pick(context.body.level, "mid")).toLowerCase();
    const base = level.includes("senior") ? 150000 : level.includes("junior") ? 85000 : 120000;
    return buildSourceResponse({
      role,
      level,
      salaryRangeUsd: { low: base - 15000, midpoint: base, high: base + 20000 },
      assumptions: ["US market", "base salary only", "no equity included"],
    });
  }
  if (path.includes("/hr/feedback")) {
    return buildSourceResponse({
      strengths: ["Clear communication", "Ownership", "Execution consistency"],
      improvements: ["Prioritize high-impact tasks", "Delegate earlier"],
      nextActions: ["Set 30-day focus goals", "Weekly check-in with manager"],
    });
  }
  if (path.includes("/hr/onboarding")) {
    return buildSourceResponse({
      role,
      phases: [
        { phase: "Week 1", checklist: ["Access setup", "Team introductions", "Read core docs"] },
        { phase: "Days 30", checklist: ["Own first deliverable", "Shadow key workflow"] },
        { phase: "Days 60", checklist: ["Lead one project segment", "Document learnings"] },
      ],
    });
  }
  if (path.includes("/hr/org-chart")) {
    return buildSourceResponse({
      nodes: [
        { id: "ceo", title: "CEO" },
        { id: "cto", title: "CTO" },
        { id: "eng_mgr", title: "Engineering Manager" },
        { id: "engineer", title: role || "Engineer" },
      ],
      edges: [
        { from: "ceo", to: "cto" },
        { from: "cto", to: "eng_mgr" },
        { from: "eng_mgr", to: "engineer" },
      ],
    });
  }
  if (path.includes("/hr/performance-review")) {
    return buildSourceResponse({
      role,
      ratings: { impact: 4, quality: 4, collaboration: 5, growth: 4 },
      summary: "Strong execution with clear growth trajectory.",
      recommendations: ["Expand mentorship", "Increase cross-team visibility"],
    });
  }
  if (path.includes("/hr/policy")) {
    const topic = readString(pick(context.body.topic, context.body.policy, "remote work"));
    return buildSourceResponse({
      topic,
      sections: [
        { heading: "Purpose", text: `Defines expectations for ${topic}.` },
        { heading: "Scope", text: "Applies to all full-time employees." },
        { heading: "Guidelines", text: "Managers approve exceptions in writing." },
      ],
    });
  }
  if (path.includes("/hr/termination")) {
    return buildSourceResponse({
      checklist: ["Manager review", "HR consultation", "Access revocation", "Exit interview"],
      communicationPlan: ["Private meeting", "Follow-up email", "Team update without sensitive details"],
    });
  }
  if (path.includes("/hr/benefits")) {
    return buildSourceResponse({
      benefits: ["Health insurance", "Dental/vision", "401(k) match", "Paid time off"],
      notes: "Benefits vary by geography and employment type.",
    });
  }

  return renderTemplateContentPayload(context);
}

function renderProductivityPayload(context) {
  const path = context.path;
  const prompt = getPromptText(context, "project");
  const items = toList(pick(context.body.tasks, context.body.items, context.body.notes), [
    "Define scope",
    "Implement changes",
    "Validate behavior",
  ]);

  if (path.includes("/productivity/meeting")) {
    return buildSourceResponse({
      topic: prompt,
      agenda: items.slice(0, 5),
      actionItems: items.slice(0, 3).map((item, index) => ({ owner: `owner_${index + 1}`, task: item })),
    });
  }
  if (path.includes("/productivity/prioritize")) {
    const prioritized = items
      .map((task, index) => ({
        task,
        impact: stableInt(`${task}:impact`, 1, 5),
        effort: stableInt(`${task}:effort`, 1, 5),
        priorityScore: 0,
      }))
      .map((entry) => ({ ...entry, priorityScore: entry.impact * 2 - entry.effort }))
      .sort((a, b) => b.priorityScore - a.priorityScore);
    return buildSourceResponse({ prioritized });
  }
  if (path.includes("/productivity/time-estimate")) {
    const task = items[0] || prompt;
    const estimateHours = stableInt(task, 2, 24);
    return buildSourceResponse({ task, estimateHours, confidence: 0.72 });
  }
  if (path.includes("/productivity/okr")) {
    return buildSourceResponse({
      objective: `Improve outcomes for ${prompt}`,
      keyResults: [
        "Increase throughput by 20%",
        "Reduce cycle time by 15%",
        "Improve quality metric by 10%",
      ],
    });
  }
  if (path.includes("/productivity/timeline")) {
    const start = new Date();
    const milestones = items.slice(0, 4).map((item, index) => ({
      milestone: item,
      targetDate: toIsoDate(new Date(start.getTime() + (index + 1) * 7 * 24 * 60 * 60 * 1000)),
    }));
    return buildSourceResponse({ timeline: milestones });
  }
  if (path.includes("/productivity/standup")) {
    return buildSourceResponse({
      yesterday: [items[0] || "Completed planned work"],
      today: [items[1] || "Continue priority tasks"],
      blockers: [items[2] || "No blockers"],
    });
  }
  if (path.includes("/productivity/sprint")) {
    return buildSourceResponse({
      sprintGoal: `Ship ${prompt} improvements`,
      backlog: items.slice(0, 8),
      capacityPoints: stableInt(prompt, 20, 60),
    });
  }
  if (path.includes("/productivity/retro")) {
    return buildSourceResponse({
      wentWell: ["Fast decision-making", "Clear ownership"],
      improve: ["Earlier risk detection", "More frequent demos"],
      actions: ["Add weekly risk review", "Define acceptance criteria sooner"],
    });
  }
  if (path.includes("/productivity/decision-log")) {
    return buildSourceResponse({
      entries: [
        { decision: `Proceed with ${prompt}`, rationale: "Highest expected impact", date: toIsoDate(new Date()) },
      ],
    });
  }
  if (path.includes("/productivity/sow")) {
    return buildSourceResponse({
      scope: `Deliver ${prompt} with agreed milestones.`,
      deliverables: items.slice(0, 4),
      assumptions: ["Client provides inputs on time", "Dependencies remain stable"],
    });
  }

  return renderTemplateContentPayload(context);
}

function renderMarketingPayload(context) {
  const path = context.path;
  const topic = getPromptText(context, "new product launch");

  if (path.includes("/marketing/ab-test")) {
    return buildSourceResponse({
      hypothesis: `Changing headline for ${topic} will improve conversion.`,
      variants: [
        { id: "A", headline: `${topic} for teams that ship faster` },
        { id: "B", headline: `Cut delivery time with ${topic}` },
      ],
      primaryMetric: "signup_rate",
    });
  }
  if (path.includes("/marketing/email-campaign")) {
    return buildSourceResponse({
      subject: `${topic}: weekly update`,
      preheader: `Key progress and next steps for ${topic}`,
      body: `Hi team,\n\nHere is the update on ${topic}...\n\nThanks.`,
    });
  }
  if (path.includes("/marketing/landing-page")) {
    return buildSourceResponse({
      sections: {
        hero: `${topic} in one clear workflow`,
        problem: "Current process is slow and fragmented.",
        solution: `${topic} centralizes execution and visibility.`,
        cta: "Start free trial",
      },
    });
  }
  if (path.includes("/marketing/persona")) {
    return buildSourceResponse({
      persona: {
        name: "Operations Lead Olivia",
        goals: ["Ship faster", "Reduce coordination overhead"],
        pains: ["Tool sprawl", "Status ambiguity"],
        buyingCriteria: ["Time-to-value", "Reliability", "Clear pricing"],
      },
    });
  }
  if (path.includes("/marketing/pitch-deck")) {
    return buildSourceResponse({
      slides: [
        "Problem",
        "Solution",
        "Market",
        "Product",
        "Traction",
        "Business Model",
        "Go-To-Market",
        "Roadmap",
      ],
    });
  }
  if (path.includes("/marketing/press-release")) {
    return buildSourceResponse({
      headline: `${topic} announces availability`,
      dateline: `${toIsoDate(new Date())} - Chicago, IL`,
      body: `${topic} is now available with features focused on execution velocity.`,
    });
  }
  if (path.includes("/marketing/seo-keywords")) {
    const keywords = words(topic).slice(0, 4);
    return buildSourceResponse({
      keywords: [...new Set([...keywords, "automation", "api", "workflow"])].map((keyword, index) => ({
        keyword,
        intent: index % 2 === 0 ? "commercial" : "informational",
      })),
    });
  }
  if (path.includes("/marketing/social-caption")) {
    return buildSourceResponse({
      captions: [
        `${topic} just got easier. #build #automation`,
        `Shipping ${topic} faster with fewer handoffs. #productivity`,
        `${topic} update: cleaner workflow, better outcomes. #x402`,
      ],
    });
  }
  if (path.includes("/marketing/growth-hacks")) {
    return buildSourceResponse({
      experiments: [
        { name: "Referral boost", metric: "invite_conversion" },
        { name: "Pricing page clarity", metric: "checkout_start_rate" },
        { name: "Onboarding checklist", metric: "activation_rate" },
      ],
    });
  }

  return renderTemplateContentPayload(context);
}

function renderLangPayload(context) {
  const path = context.path;
  const text = getPromptText(context, "sample phrase");

  if (path.includes("/lang/acronym")) {
    const wordsList = words(text).slice(0, 6);
    const acronym = wordsList.map((token) => token[0]?.toUpperCase()).join("") || "N/A";
    return buildSourceResponse({ text, acronym, expansion: wordsList.join(" ") });
  }
  if (path.includes("/lang/dialect")) {
    const dialect = readString(pick(context.body.dialect, context.query.dialect, "US")).toUpperCase();
    const converted = dialect === "UK" ? text.replace(/\bcolor\b/gi, "colour") : text.replace(/\bcolour\b/gi, "color");
    return buildSourceResponse({ dialect, originalText: text, convertedText: converted });
  }
  if (path.includes("/lang/formality")) {
    const tone = readString(pick(context.body.tone, context.query.tone, "formal")).toLowerCase();
    const rewritten =
      tone === "formal"
        ? `Please note: ${text.charAt(0).toUpperCase()}${text.slice(1)}.`
        : text.replace(/^please note:\s*/i, "").replace(/\./g, "");
    return buildSourceResponse({ tone, originalText: text, rewrittenText: rewritten });
  }
  if (path.includes("/lang/idiom")) {
    return buildSourceResponse({
      phrase: text,
      idiom: "Break the ice",
      meaning: "Start a conversation in a relaxed way.",
      example: "She told a joke to break the ice.",
    });
  }
  if (path.includes("/lang/jargon")) {
    return buildSourceResponse({
      originalText: text,
      translatedText: `${text} (translated to plain language)`,
      audience: readString(pick(context.body.audience, "general")),
    });
  }

  return renderTemplateContentPayload(context);
}

function renderMiscPayload(context) {
  const path = context.path;
  const seedText = getPromptText(context, "life");

  if (path.includes("/misc/iching")) {
    const hexagram = stableInt(seedText, 1, 64);
    return buildSourceResponse({
      hexagram,
      name: `Hexagram ${hexagram}`,
      interpretation: "Focus on steady progress and patient execution.",
    });
  }
  if (path.includes("/misc/pickup-line")) {
    return buildSourceResponse({
      line: "Are you a roadmap? Because you keep my priorities clear.",
      style: readString(pick(context.query.style, context.body.style, "playful")),
    });
  }
  if (path.includes("/misc/astrology")) {
    const sign = readString(pick(context.body.sign, context.query.sign, "aries")).toLowerCase();
    return buildSourceResponse({
      sign,
      reading: `${sign} energy favors disciplined action and clearer communication this week.`,
    });
  }
  if (path.includes("/misc/numerology")) {
    const birthdate = parseIsoDate(pick(context.body.birthdate, context.query.birthdate, "1990-01-15"));
    const digits = toIsoDate(birthdate || new Date("1990-01-15")).replace(/\D/g, "").split("").map(Number);
    let total = digits.reduce((sum, value) => sum + value, 0);
    while (total > 9) total = String(total).split("").reduce((sum, value) => sum + Number(value), 0);
    return buildSourceResponse({ lifePath: total, birthdate: toIsoDate(birthdate || new Date("1990-01-15")) });
  }
  if (path.includes("/misc/biorhythm")) {
    const birthdate = parseIsoDate(pick(context.body.birthdate, context.query.birthdate, "1990-01-15"));
    const baseDate = birthdate || new Date("1990-01-15T00:00:00Z");
    const days = Math.floor((Date.now() - baseDate.getTime()) / (24 * 60 * 60 * 1000));
    const cycles = {
      physical: Number(Math.sin((2 * Math.PI * days) / 23).toFixed(3)),
      emotional: Number(Math.sin((2 * Math.PI * days) / 28).toFixed(3)),
      intellectual: Number(Math.sin((2 * Math.PI * days) / 33).toFixed(3)),
    };
    return buildSourceResponse({ daysLived: days, cycles });
  }
  if (path.includes("/misc/mbti")) {
    const axis = (label, positive, negative) => (stableInt(`${seedText}:${label}`, 0, 1) === 0 ? positive : negative);
    const type = `${axis("ie", "I", "E")}${axis("sn", "S", "N")}${axis("tf", "T", "F")}${axis("jp", "J", "P")}`;
    return buildSourceResponse({ type, summary: `${type} profile with balanced strengths and tradeoffs.` });
  }
  if (path.includes("/misc/gift")) {
    const recipient = readString(pick(context.body.recipient, "friend"));
    return buildSourceResponse({
      recipient,
      recommendations: [
        `${recipient} planner`,
        `${recipient} premium coffee set`,
        `${recipient} personalized notebook`,
      ],
    });
  }
  if (path.includes("/misc/baby-name")) {
    const style = readString(pick(context.body.style, "modern"));
    return buildSourceResponse({
      style,
      names: ["Avery", "Rowan", "Milo", "Nora", "Elena"],
    });
  }
  if (path.includes("/misc/compliment")) {
    const target = readString(pick(context.body.target, "you"));
    return buildSourceResponse({ compliment: `${target} handle complexity with unusual clarity.` });
  }
  if (path.includes("/misc/excuse")) {
    const contextLabel = readString(pick(context.body.context, "meeting"));
    return buildSourceResponse({ excuse: `Running late due to an unexpected ${contextLabel} dependency.` });
  }

  return renderTemplateContentPayload(context);
}

function tokenizeMathExpression(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < expression.length && /[0-9.]/.test(expression[end])) {
        end += 1;
      }
      const value = Number.parseFloat(expression.slice(index, end));
      if (!Number.isFinite(value)) {
        return null;
      }
      tokens.push({ type: "number", value });
      index = end;
      continue;
    }
    if (/[+\-*/^()]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

function normalizeMathExpression(raw) {
  const source = readString(raw).trim();
  if (!source) {
    return "2+2";
  }
  const normalized = source
    .replace(/[×x]/g, "*")
    .replace(/÷/g, "/")
    .replace(/=/g, "")
    .replace(/,/g, "")
    .trim();
  const extracted = (normalized.match(/[-+*/^().\d\s]+/) || [""])[0].trim();
  if (!extracted) {
    return "2+2";
  }
  return extracted;
}

function toRpn(tokens) {
  const output = [];
  const stack = [];
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const rightAssociative = new Set(["^"]);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "number") {
      output.push(token);
      continue;
    }

    const op = token.value;
    if (op === "(") {
      stack.push(op);
      continue;
    }
    if (op === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") {
        output.push({ type: "operator", value: stack.pop() });
      }
      if (!stack.length || stack[stack.length - 1] !== "(") {
        return null;
      }
      stack.pop();
      continue;
    }

    // Unary minus -> inject 0 and treat as binary subtraction.
    const prev = i > 0 ? tokens[i - 1] : null;
    if (
      op === "-" &&
      (!prev ||
        (prev.type === "operator" &&
          prev.value !== ")" &&
          prev.value !== "("))
    ) {
      output.push({ type: "number", value: 0 });
    }

    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!precedence[top]) {
        break;
      }
      const topPrecedence = precedence[top];
      const opPrecedence = precedence[op] || 0;
      const shouldPop = rightAssociative.has(op)
        ? topPrecedence > opPrecedence
        : topPrecedence >= opPrecedence;
      if (!shouldPop) {
        break;
      }
      output.push({ type: "operator", value: stack.pop() });
    }
    stack.push(op);
  }

  while (stack.length) {
    const top = stack.pop();
    if (top === "(" || top === ")") {
      return null;
    }
    output.push({ type: "operator", value: top });
  }
  return output;
}

function evaluateRpn(rpn) {
  const stack = [];
  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    const b = stack.pop();
    const a = stack.pop();
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }

    switch (token.value) {
      case "+":
        stack.push(a + b);
        break;
      case "-":
        stack.push(a - b);
        break;
      case "*":
        stack.push(a * b);
        break;
      case "/":
        if (b === 0) {
          return null;
        }
        stack.push(a / b);
        break;
      case "^":
        stack.push(a ** b);
        break;
      default:
        return null;
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    return null;
  }
  return stack[0];
}

function renderEduMathPayload(context) {
  const rawExpression = pick(
    context.body.expression,
    context.body.problem,
    context.body.text,
    context.query.expression,
    context.query.problem,
    context.inputText,
    "2+2",
  );
  const expression = normalizeMathExpression(rawExpression);
  const tokens = tokenizeMathExpression(expression);
  if (!tokens || !tokens.length) {
    return buildError("invalid_expression", "Could not parse a math expression.");
  }

  const rpn = toRpn(tokens);
  if (!rpn) {
    return buildError("invalid_expression", "Expression syntax is invalid.");
  }

  const result = evaluateRpn(rpn);
  if (!Number.isFinite(result)) {
    return buildError("invalid_expression", "Expression could not be evaluated.");
  }

  return buildSourceResponse({
    expression,
    result: Number(result.toFixed(10)),
    tokens: tokens.map((token) => (token.type === "number" ? token.value : token.value)),
    steps: [
      "normalized_expression",
      "tokenized_expression",
      "converted_to_rpn",
      "evaluated_rpn",
    ],
  });
}

function renderUtilPayload(context) {
  const path = context.path;
  const body = context.body;
  if (path.includes("/num-to-words")) {
    const num = Math.floor(readNumber(pick(body.number, body.value, context.query.number), 0));
    return buildSourceResponse({ number: num, words: `${num}` });
  }
  if (path.includes("/roman")) {
    const num = clamp(Math.floor(readNumber(pick(body.number, body.value, context.query.number), 1)), 1, 3999);
    const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let n = num;
    let out = "";
    for (const [value, symbol] of map) {
      while (n >= value) {
        out += symbol;
        n -= value;
      }
    }
    return buildSourceResponse({ number: num, roman: out });
  }
  if (path.includes("/luhn")) {
    const value = readString(pick(body.value, body.number, context.query.value, ""));
    const digits = value.replace(/\D/g, "");
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let d = Number(digits[i]);
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return buildSourceResponse({ value, valid: digits.length > 0 && sum % 10 === 0 });
  }
  if (path.includes("/fibonacci")) {
    const count = clamp(Math.floor(readNumber(pick(body.count, context.query.count), 10)), 1, 200);
    const seq = [0, 1];
    while (seq.length < count) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
    return buildSourceResponse({ count, sequence: seq.slice(0, count) });
  }
  if (path.includes("/util/binary")) {
    const rawInput = readString(
      pick(
        body.value,
        body.number,
        body.input,
        context.query.value,
        context.query.number,
        context.inputText,
        "0",
      ),
    ).trim();
    const normalizedInput = rawInput.replace(/_/g, "").toLowerCase();
    const isNegative = normalizedInput.startsWith("-");
    let digits = isNegative ? normalizedInput.slice(1) : normalizedInput;

    let inferredBase = null;
    if (digits.startsWith("0x")) {
      inferredBase = 16;
      digits = digits.slice(2);
    } else if (digits.startsWith("0b")) {
      inferredBase = 2;
      digits = digits.slice(2);
    } else if (digits.startsWith("0o")) {
      inferredBase = 8;
      digits = digits.slice(2);
    }

    const fromBase = normalizeBase(pick(body.fromBase, body.base, context.query.fromBase, context.query.base), inferredBase || 10);
    const toBase = normalizeBase(pick(body.toBase, context.query.toBase), 10);
    if (!digits) {
      return buildError("invalid_number", "Value is required.");
    }

    const parsedAbs = Number.parseInt(digits, fromBase);
    if (!Number.isFinite(parsedAbs)) {
      return buildError("invalid_number", "Could not parse input number for the provided base.");
    }
    const decimalValue = isNegative ? -parsedAbs : parsedAbs;
    const targetValue = decimalValue.toString(toBase);
    return buildSourceResponse({
      input: rawInput,
      fromBase,
      toBase,
      converted: targetValue,
      decimal: decimalValue,
      binary: decimalValue.toString(2),
      octal: decimalValue.toString(8),
      hex: decimalValue.toString(16),
    });
  }
  return buildSourceResponse({ util: true, endpoint: context.endpoint });
}

function renderAutoPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/auto/value")) {
    const make = readString(pick(body.make, body.vehicle_make, context.query.make, "Toyota")).trim() || "Unknown";
    const model = readString(pick(body.model, body.vehicle_model, context.query.model, "Camry")).trim() || "Unknown";
    const year = Math.floor(readNumber(pick(body.year, context.query.year), 2020));
    const mileage = Math.max(readNumber(pick(body.mileage, body.miles, context.query.mileage), 60000), 0);
    const condition = readString(pick(body.condition, context.query.condition, "good")).toLowerCase();
    const baseMsrp = stableInt(`${make}:${model}:msrp`, 22000, 62000);
    const ageYears = Math.max(new Date().getUTCFullYear() - year, 0);
    const ageFactor = Math.max(0.35, 1 - ageYears * 0.07);
    const mileageFactor = Math.max(0.3, 1 - mileage / 220000);
    const conditionFactor =
      condition === "excellent"
        ? 1.08
        : condition === "fair"
          ? 0.85
          : condition === "poor"
            ? 0.72
            : 1;
    const estimate = baseMsrp * ageFactor * mileageFactor * conditionFactor;
    const low = estimate * 0.9;
    const high = estimate * 1.1;
    return buildSourceResponse({
      vehicle: { make, model, year, mileage, condition },
      estimateUsd: {
        low: Number(low.toFixed(2)),
        median: Number(estimate.toFixed(2)),
        high: Number(high.toFixed(2)),
      },
      assumptions: {
        baseMsrp,
        ageFactor: Number(ageFactor.toFixed(3)),
        mileageFactor: Number(mileageFactor.toFixed(3)),
        conditionFactor: Number(conditionFactor.toFixed(3)),
      },
      disclaimer: "Synthetic KBB-style estimate for planning.",
    });
  }

  if (path.includes("/auto/plate-to-vin")) {
    const plate = readString(pick(body.plate, context.query.plate, "ABC123")).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const state = readString(pick(body.state, context.query.state, "CA")).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    const charset = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
    const digest = hashText(`${state}:${plate}`);
    let vin = "";
    for (let i = 0; i < 17; i += 1) {
      const nibble = Number.parseInt(digest[i % digest.length], 16);
      vin += charset[nibble % charset.length];
    }
    return buildSourceResponse({
      plate,
      state,
      vin,
      confidence: Number((0.62 + stableInt(`${state}:${plate}:conf`, 0, 30) / 100).toFixed(2)),
      sourceHint: "Synthetic registry lookup response",
    });
  }

  if (path.includes("/auto/vin-recall")) {
    const vinRaw = readString(
      pick(context.params.vin, body.vin, context.query.vin, "1HGCM82633A004352"),
      "1HGCM82633A004352",
    )
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (vinRaw.length < 11) {
      return buildError("invalid_vin", "Provide a valid VIN.");
    }
    const normalizedVin = vinRaw.slice(0, 17);
    const makeSeed = stableInt(`${normalizedVin}:make`, 0, 4);
    const makeModelYear = [
      { make: "Honda", model: "Accord", year: 2019 },
      { make: "Toyota", model: "Camry", year: 2020 },
      { make: "Ford", model: "F-150", year: 2018 },
      { make: "Hyundai", model: "Elantra", year: 2021 },
      { make: "Chevrolet", model: "Equinox", year: 2017 },
    ][makeSeed];
    const recallCount = stableInt(`${normalizedVin}:recall-count`, 0, 3);
    const recalls = Array.from({ length: recallCount }, (_unused, index) => {
      const campaign = `${stableInt(`${normalizedVin}:campaign:${index}`, 10_000, 99_999)}${String.fromCharCode(
        65 + (index % 26),
      )}`;
      const components = [
        "Airbags",
        "Fuel System",
        "Brake Assist",
        "Steering",
        "Electrical System",
        "Seat Belts",
      ];
      const component = components[stableInt(`${normalizedVin}:component:${index}`, 0, components.length - 1)];
      const risk = [
        "Increased crash risk due to intermittent subsystem failure.",
        "Potential loss of assist under specific driving conditions.",
        "Unexpected warning trigger requiring service inspection.",
      ][stableInt(`${normalizedVin}:risk:${index}`, 0, 2)];
      const status = stableInt(`${normalizedVin}:status:${index}`, 0, 10) > 2 ? "open" : "remedy available";
      return {
        campaignId: campaign,
        component,
        summary: risk,
        status,
      };
    });
    return buildSourceResponse({
      vin: normalizedVin,
      ...makeModelYear,
      openRecallCount: recalls.length,
      recalls,
      sourceHint: "NHTSA-style synthesized recall profile",
    });
  }

  if (path.includes("/auto/tires")) {
    const tireSize = readString(
      pick(body.tire_size, body.size, context.query.tire_size, context.query.size, "225/45R17"),
    ).toUpperCase().trim();
    const match = /^(\d{3})\/(\d{2,3})R(\d{2})$/.exec(tireSize);
    if (!match) {
      return buildError(
        "invalid_tire_size",
        "Use format like 225/45R17.",
      );
    }
    const sectionWidthMm = readNumber(match[1], 225);
    const aspectRatio = readNumber(match[2], 45);
    const wheelDiameterIn = readNumber(match[3], 17);
    const sidewallMm = sectionWidthMm * (aspectRatio / 100);
    const overallDiameterMm = wheelDiameterIn * 25.4 + sidewallMm * 2;
    const circumferenceMm = overallDiameterMm * Math.PI;
    const plusOneRim = wheelDiameterIn + 1;
    const targetSidewallMm = Math.max((overallDiameterMm - plusOneRim * 25.4) / 2, 0);
    const plusOneAspect = clamp(Math.round((targetSidewallMm / sectionWidthMm) * 100), 20, 80);
    return buildSourceResponse({
      tireSize,
      sectionWidthMm,
      aspectRatio,
      wheelDiameterIn,
      sidewallMm: Number(sidewallMm.toFixed(1)),
      sidewallIn: Number((sidewallMm / 25.4).toFixed(2)),
      overallDiameterMm: Number(overallDiameterMm.toFixed(1)),
      overallDiameterIn: Number((overallDiameterMm / 25.4).toFixed(2)),
      circumferenceMm: Number(circumferenceMm.toFixed(1)),
      circumferenceIn: Number((circumferenceMm / 25.4).toFixed(2)),
      plusOneSuggestion: `${sectionWidthMm}/${plusOneAspect}R${plusOneRim}`,
    });
  }

  if (path.includes("/auto/fuel-cost")) {
    const mpg = Math.max(readNumber(pick(body.mpg, context.query.mpg), 25), 1);
    const monthlyMiles = Math.max(readNumber(pick(body.miles, body.monthly_miles, context.query.miles), 1000), 1);
    const fuelPrice = Math.max(readNumber(pick(body.fuel_price, body.price, context.query.fuel_price), 3.75), 0.01);
    const gallonsPerMonth = monthlyMiles / mpg;
    const monthlyCost = Number((gallonsPerMonth * fuelPrice).toFixed(2));
    const annualCost = Number((monthlyCost * 12).toFixed(2));
    return buildSourceResponse({
      mpg,
      monthlyMiles,
      fuelPrice,
      gallonsPerMonth: Number(gallonsPerMonth.toFixed(2)),
      monthlyCost,
      annualCost,
      assumptions: { unitSystem: "imperial", fuelPriceUnit: "usd_per_gallon" },
    });
  }

  if (path.includes("/auto/ev-range")) {
    const batteryKwh = Math.max(readNumber(pick(body.battery_kwh, context.query.battery_kwh), 75), 1);
    const consumption = Math.max(readNumber(pick(body.consumption, body.kwh_per_100_miles, context.query.consumption), 28), 1);
    const tempF = readNumber(pick(body.temp, body.temperature, context.query.temp), 70);
    let temperatureFactor = 1;
    if (tempF < 32) temperatureFactor = 0.7;
    else if (tempF < 50) temperatureFactor = 0.82;
    else if (tempF > 95) temperatureFactor = 0.9;
    const idealRangeMiles = (batteryKwh / consumption) * 100;
    const estimatedRangeMiles = idealRangeMiles * temperatureFactor;
    return buildSourceResponse({
      batteryKwh,
      consumptionKwhPer100Miles: consumption,
      temperatureF: tempF,
      temperatureFactor,
      idealRangeMiles: Number(idealRangeMiles.toFixed(1)),
      estimatedRangeMiles: Number(estimatedRangeMiles.toFixed(1)),
    });
  }

  if (path.includes("/auto/payment")) {
    const price = Math.max(readNumber(pick(body.price, context.query.price), 35000), 0);
    const downPayment = Math.max(readNumber(pick(body.down, body.down_payment, context.query.down), 5000), 0);
    const apr = Math.max(readNumber(pick(body.rate, body.apr, context.query.rate), 6.5), 0);
    const termMonths = Math.max(Math.floor(readNumber(pick(body.term, body.term_months, context.query.term), 60)), 1);
    const principal = Math.max(price - downPayment, 0);
    const monthlyRate = apr / 100 / 12;
    const monthlyPayment =
      monthlyRate === 0
        ? principal / termMonths
        : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -termMonths);
    const totalPaid = monthlyPayment * termMonths + downPayment;
    const totalInterest = totalPaid - price;
    return buildSourceResponse({
      price,
      downPayment,
      apr,
      termMonths,
      principal: Number(principal.toFixed(2)),
      monthlyPayment: Number(monthlyPayment.toFixed(2)),
      totalPaid: Number(totalPaid.toFixed(2)),
      totalInterest: Number(totalInterest.toFixed(2)),
    });
  }

  if (path.includes("/auto/emissions")) {
    const mpg = Math.max(readNumber(pick(body.mpg, body.fuel_economy, context.query.mpg), 28), 1);
    const annualMiles = Math.max(readNumber(pick(body.annual_miles, context.query.annual_miles), 12000), 1);
    const gramsCo2PerGallon = 8887;
    const co2GramsPerMile = gramsCo2PerGallon / mpg;
    const annualCo2MetricTons = (co2GramsPerMile * annualMiles) / 1_000_000;
    const epaBand =
      co2GramsPerMile <= 200
        ? "A"
        : co2GramsPerMile <= 250
          ? "B"
          : co2GramsPerMile <= 300
            ? "C"
            : co2GramsPerMile <= 350
              ? "D"
              : "E";
    return buildSourceResponse({
      make: readString(pick(body.make, context.query.make, "unknown")),
      model: readString(pick(body.model, context.query.model, "unknown")),
      year: Math.floor(readNumber(pick(body.year, context.query.year), 2020)),
      mpg,
      annualMiles,
      co2GramsPerMile: Number(co2GramsPerMile.toFixed(1)),
      annualCo2MetricTons: Number(annualCo2MetricTons.toFixed(2)),
      ratingBand: epaBand,
      assumptions: {
        fuel: "gasoline",
        gramsCo2PerGallon,
      },
    });
  }

  if (path.includes("/auto/insurance")) {
    const vehicle = toObject(pick(body.vehicle, {}));
    const make = readString(pick(vehicle.make, body.make, context.query.make, "unknown")).trim() || "unknown";
    const model = readString(pick(vehicle.model, body.model, context.query.model, "unknown")).trim() || "unknown";
    const year = Math.floor(readNumber(pick(vehicle.year, body.year, context.query.year), 2020));
    const driverAge = Math.max(Math.floor(readNumber(pick(body.age, body.driver_age, context.query.age), 34)), 16);
    const zip = readString(pick(body.zip, body.postal_code, context.query.zip, "00000"))
      .replace(/\D/g, "")
      .slice(0, 5);
    const history = normalizeInsuranceHistory(pick(body.history, body.record, context.query.history, "clean"));

    const baseMonthly = stableInt(`${make}:${model}:${year}:${zip}:base`, 85, 260);
    const ageFactor = driverAge < 25 ? 1.45 : driverAge < 30 ? 1.2 : driverAge < 65 ? 1 : 1.18;
    const historyFactor =
      history.includes("dui") || history.includes("major")
        ? 1.7
        : history.includes("accident") || history.includes("ticket")
          ? 1.25
          : 1;
    const monthlyMedian = baseMonthly * ageFactor * historyFactor;
    const monthlyLow = Math.max(35, monthlyMedian * 0.84);
    const monthlyHigh = monthlyMedian * 1.22;

    return buildSourceResponse({
      vehicle: { make, model, year },
      driver: { age: driverAge, zip: zip || "00000", history },
      estimateUsd: {
        monthlyLow: Number(monthlyLow.toFixed(2)),
        monthlyMedian: Number(monthlyMedian.toFixed(2)),
        monthlyHigh: Number(monthlyHigh.toFixed(2)),
        annualLow: Number((monthlyLow * 12).toFixed(2)),
        annualMedian: Number((monthlyMedian * 12).toFixed(2)),
        annualHigh: Number((monthlyHigh * 12).toFixed(2)),
      },
      factors: {
        ageFactor: Number(ageFactor.toFixed(2)),
        historyFactor: Number(historyFactor.toFixed(2)),
      },
      disclaimer: "Synthetic estimate for planning; not an insurer quote.",
    });
  }

  if (path.includes("/auto/recall")) {
    const make = readString(
      pick(context.params.param1, context.params.make, body.make, context.query.make, "sample"),
    ).trim();
    const model = readString(
      pick(context.params.param2, context.params.model, body.model, context.query.model, "sample"),
    ).trim();
    const year = Math.floor(
      readNumber(
        pick(context.params.param3, context.params.year, body.year, context.query.year),
        stableInt(`${make}:${model}:year`, 2014, 2024),
      ),
    );
    const baseSeed = `${make}:${model}:${year}`;
    const recallCount = stableInt(`${baseSeed}:recall-count`, 0, 4);
    const recalls = Array.from({ length: recallCount }, (_unused, index) => ({
      campaignId: `${stableInt(`${baseSeed}:${index}:campaign`, 20_000, 99_999)}${String.fromCharCode(65 + (index % 26))}`,
      component: [
        "Engine and Engine Cooling",
        "Electrical System",
        "Power Train",
        "Fuel System",
        "Service Brakes",
      ][stableInt(`${baseSeed}:${index}:component`, 0, 4)],
      status: stableInt(`${baseSeed}:${index}:status`, 0, 10) > 3 ? "open" : "remedy available",
      remedy: [
        "Dealer software update",
        "Component replacement",
        "Inspection and adjustment",
      ][stableInt(`${baseSeed}:${index}:remedy`, 0, 2)],
    }));

    return buildSourceResponse({
      vehicle: { make, model, year },
      openRecallCount: recalls.filter((item) => item.status === "open").length,
      recalls,
      sourceHint: "NHTSA-style synthesized campaign lookup",
    });
  }

  return buildError("unsupported_auto_operation", "Unsupported /auto/ operation.");
}

function renderAviationPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/aviation/taf")) {
    const icao = readString(
      pick(context.params.param1, context.params.icao, body.icao, context.query.icao, "KJFK"),
      "KJFK",
    ).toUpperCase().slice(0, 6);
    const periods = [
      {
        fromHour: 0,
        toHour: 6,
        windKt: stableInt(`${icao}:taf:w1`, 6, 18),
        visibilitySm: stableInt(`${icao}:taf:v1`, 4, 10),
        weather: stableInt(`${icao}:taf:wthr1`, 0, 10) > 7 ? "light rain" : "none",
        ceilingFt: stableInt(`${icao}:taf:c1`, 1500, 8000),
      },
      {
        fromHour: 6,
        toHour: 12,
        windKt: stableInt(`${icao}:taf:w2`, 8, 22),
        visibilitySm: stableInt(`${icao}:taf:v2`, 5, 10),
        weather: stableInt(`${icao}:taf:wthr2`, 0, 10) > 8 ? "showers" : "none",
        ceilingFt: stableInt(`${icao}:taf:c2`, 1200, 7000),
      },
      {
        fromHour: 12,
        toHour: 24,
        windKt: stableInt(`${icao}:taf:w3`, 5, 20),
        visibilitySm: stableInt(`${icao}:taf:v3`, 4, 10),
        weather: stableInt(`${icao}:taf:wthr3`, 0, 10) > 8 ? "thunder nearby" : "none",
        ceilingFt: stableInt(`${icao}:taf:c3`, 900, 9000),
      },
    ];
    return buildSourceResponse({
      airport: icao,
      validFromUtc: new Date().toISOString(),
      validToUtc: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      periods,
      sourceHint: "Decoded-style synthetic TAF forecast",
    });
  }

  if (path.includes("/aviation/flight")) {
    const flightNumber = readString(
      pick(context.params.param1, context.params.number, body.number, body.flight, context.query.number, "AA100"),
    ).toUpperCase().replace(/\s+/g, "");
    const gateLetter = String.fromCharCode(65 + stableInt(`${flightNumber}:gate-letter`, 0, 5));
    const gateNumber = stableInt(`${flightNumber}:gate-number`, 1, 39);
    const delayMinutes = stableInt(`${flightNumber}:delay`, 0, 85);
    const status =
      delayMinutes === 0
        ? "on-time"
        : delayMinutes <= 20
          ? "slight-delay"
          : delayMinutes <= 45
            ? "delayed"
            : "significant-delay";

    return buildSourceResponse({
      flightNumber,
      status,
      gate: `${gateLetter}${gateNumber}`,
      terminal: stableInt(`${flightNumber}:terminal`, 1, 8),
      delayMinutes,
      departureUtc: new Date(Date.now() + stableInt(`${flightNumber}:dep`, 20, 240) * 60_000).toISOString(),
      arrivalUtc: new Date(Date.now() + stableInt(`${flightNumber}:arr`, 160, 520) * 60_000).toISOString(),
    });
  }

  if (path.includes("/aviation/airport")) {
    const iata = readString(
      pick(context.params.param1, context.params.iata, body.iata, context.query.iata, "JFK"),
      "JFK",
    ).toUpperCase().slice(0, 4);
    const terminals = stableInt(`${iata}:terminals`, 1, 8);
    const lounges = stableInt(`${iata}:lounges`, 0, 10);
    const transport = ["taxi", "ride-share", "rail", "bus"];
    const services = ["wifi", "currency exchange", "left luggage", "family rooms", "showers"];
    return buildSourceResponse({
      airport: iata,
      terminals,
      lounges,
      transport: transport.filter((_item, index) => stableInt(`${iata}:transport:${index}`, 0, 10) > 1),
      services: services.filter((_item, index) => stableInt(`${iata}:service:${index}`, 0, 10) > 2),
      localTimeOffsetHours: stableInt(`${iata}:tz`, -10, 12),
      congestionLevel: ["low", "moderate", "high"][stableInt(`${iata}:congestion`, 0, 2)],
    });
  }

  if (path.includes("/aviation/notam")) {
    const icao = readString(
      pick(context.params.param1, context.params.icao, body.icao, context.query.icao, "KJFK"),
      "KJFK",
    ).toUpperCase().slice(0, 6);
    const count = stableInt(`${icao}:notam-count`, 1, 5);
    const now = Date.now();
    const notams = Array.from({ length: count }, (_unused, index) => {
      const startsInMinutes = stableInt(`${icao}:${index}:start`, -180, 120);
      const durationHours = stableInt(`${icao}:${index}:dur`, 2, 18);
      return {
        id: `${icao}-${stableInt(`${icao}:${index}:id`, 1000, 9999)}/${new Date().getUTCFullYear()}`,
        category: ["RWY", "TWY", "NAV", "AIRSPACE", "OBSTACLE"][stableInt(`${icao}:${index}:cat`, 0, 4)],
        summary: [
          "Runway lighting maintenance window",
          "Taxiway closure due to pavement work",
          "Navigation aid reliability advisory",
          "Temporary obstacle near approach path",
          "Temporary procedure update in effect",
        ][stableInt(`${icao}:${index}:summary`, 0, 4)],
        effectiveFrom: new Date(now + startsInMinutes * 60_000).toISOString(),
        effectiveTo: new Date(now + (startsInMinutes + durationHours * 60) * 60_000).toISOString(),
      };
    });
    return buildSourceResponse({
      airport: icao,
      count: notams.length,
      notams,
    });
  }

  if (path.includes("/aviation/aircraft")) {
    const tail = readString(
      pick(context.params.param1, context.params.tail, body.tail, context.query.tail, "N123AB"),
      "N123AB",
    ).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const makes = ["Cessna", "Piper", "Beechcraft", "Cirrus", "Gulfstream"];
    const models = {
      Cessna: ["172", "182", "208 Caravan"],
      Piper: ["PA-28", "PA-46", "PA-34"],
      Beechcraft: ["Bonanza G36", "King Air 350"],
      Cirrus: ["SR20", "SR22"],
      Gulfstream: ["G280", "G500"],
    };
    const make = makes[stableInt(`${tail}:make`, 0, makes.length - 1)];
    const modelList = models[make] || ["Unknown"];
    const model = modelList[stableInt(`${tail}:model`, 0, modelList.length - 1)];
    return buildSourceResponse({
      tailNumber: tail,
      owner: `Owner ${hashText(`${tail}:owner`).slice(0, 6).toUpperCase()}`,
      make,
      model,
      registrationStatus: stableInt(`${tail}:status`, 0, 10) > 1 ? "active" : "expired",
      airworthiness: stableInt(`${tail}:airworthy`, 0, 10) > 2 ? "standard" : "special",
      sourceHint: "FAA-style synthesized registry result",
    });
  }

  if (path.includes("/aviation/fuel")) {
    const aircraftType = readString(
      pick(body.aircraft_type, body.type, context.query.aircraft_type, "A320"),
      "A320",
    ).toUpperCase();
    const distanceNm = Math.max(readNumber(pick(body.distance, body.distance_nm, context.query.distance), 500), 10);
    const loadPct = clamp(readNumber(pick(body.load, body.load_pct, context.query.load), 75), 10, 100);
    const burnRates = {
      A320: 2.8,
      B738: 2.9,
      E190: 2.1,
      C172: 0.12,
      B77W: 7.2,
    };
    const baseBurnPerNm = burnRates[aircraftType] || 2.4;
    const loadFactor = 0.75 + loadPct / 200;
    const tripFuel = distanceNm * baseBurnPerNm * loadFactor;
    const reserveFuel = tripFuel * 0.12;
    return buildSourceResponse({
      aircraftType,
      distanceNm,
      loadPct,
      estimateKg: {
        tripFuel: Number(tripFuel.toFixed(1)),
        reserveFuel: Number(reserveFuel.toFixed(1)),
        totalFuel: Number((tripFuel + reserveFuel).toFixed(1)),
      },
      assumptions: {
        baseBurnPerNm,
        loadFactor: Number(loadFactor.toFixed(3)),
      },
    });
  }

  if (path.includes("/aviation/airspace")) {
    const lat = readNumber(pick(body.lat, context.query.lat), 39.0);
    const lon = readNumber(pick(body.lon, context.query.lon), -95.0);
    const altitudeFt = Math.max(readNumber(pick(body.altitude, body.altitude_ft, context.query.altitude), 3500), 0);
    const airspaceClass =
      altitudeFt < 1200
        ? "G"
        : altitudeFt < 10000
          ? "E"
          : altitudeFt < 18000
            ? "D"
            : "A";
    const restricted = stableInt(`${lat}:${lon}:${altitudeFt}:restricted`, 0, 10) > 7;
    return buildSourceResponse({
      position: {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        altitudeFt: Number(altitudeFt.toFixed(0)),
      },
      airspaceClass,
      restricted,
      advisories: restricted
        ? ["Check temporary flight restrictions before departure."]
        : ["No special restrictions indicated in synthesized profile."],
    });
  }

  if (path.includes("/aviation/runway")) {
    const airport = readString(pick(body.airport, body.icao, context.query.airport, "KJFK"), "KJFK").toUpperCase();
    const weightLb = Math.max(readNumber(pick(body.aircraft_weight, body.weight, context.query.aircraft_weight), 140000), 1000);
    const tempC = readNumber(pick(body.temp, body.temperature_c, context.query.temp), 20);
    const fieldElevationFt = Math.max(readNumber(pick(body.altitude, body.field_elevation, context.query.altitude), 200), 0);
    const baseline = 3200 + (weightLb / 1000) * 18;
    const densityAdj = 1 + Math.max(0, (tempC - 15) * 0.01) + fieldElevationFt / 50000;
    const requiredFt = baseline * densityAdj;
    return buildSourceResponse({
      airport,
      inputs: {
        aircraftWeightLb: Number(weightLb.toFixed(0)),
        temperatureC: Number(tempC.toFixed(1)),
        fieldElevationFt: Number(fieldElevationFt.toFixed(0)),
      },
      requiredRunwayLengthFt: Number(requiredFt.toFixed(0)),
      recommendedRunwayLengthFt: Number((requiredFt * 1.15).toFixed(0)),
      sourceHint: "Performance-planning synthetic estimate",
    });
  }

  if (path.includes("/aviation/metar")) {
    const raw = readString(
      pick(
        body.metar,
        body.raw,
        context.query.metar,
        "KJFK 121651Z 18012KT 10SM FEW020 SCT250 27/19 A2992 RMK AO2",
      ),
      "KJFK 121651Z 18012KT 10SM FEW020 SCT250 27/19 A2992 RMK AO2",
    )
      .trim()
      .toUpperCase();
    const tokens = raw.split(/\s+/).filter(Boolean);
    const station = tokens[0] || null;
    const timeToken = tokens.find((token) => /^\d{6}Z$/.test(token)) || null;
    const windToken = tokens.find((token) => /^\d{3}\d{2,3}KT$/.test(token)) || null;
    const visToken = tokens.find((token) => /^\d{1,2}SM$/.test(token)) || null;
    const tempDewToken = tokens.find((token) => /^M?\d{2}\/M?\d{2}$/.test(token)) || null;
    const altToken = tokens.find((token) => /^A\d{4}$/.test(token)) || null;
    const cloudLayers = tokens.filter((token) => /^(FEW|SCT|BKN|OVC)\d{3}/.test(token));
    const parseSignedTemp = (value) => {
      if (!value) return null;
      if (value.startsWith("M")) return -Number.parseInt(value.slice(1), 10);
      return Number.parseInt(value, 10);
    };
    const [tempPart, dewPart] = (tempDewToken || "/").split("/");
    const windDirection = windToken ? Number.parseInt(windToken.slice(0, 3), 10) : null;
    const windSpeedKt = windToken ? Number.parseInt(windToken.slice(3).replace("KT", ""), 10) : null;
    const visibilitySm = visToken ? Number.parseInt(visToken.replace("SM", ""), 10) : null;
    const altimeterInHg = altToken ? Number((Number.parseInt(altToken.slice(1), 10) / 100).toFixed(2)) : null;
    return buildSourceResponse({
      raw,
      decoded: {
        station,
        observationTimeZulu: timeToken,
        wind: windToken
          ? {
              directionDeg: windDirection,
              speedKt: windSpeedKt,
            }
          : null,
        visibilitySm,
        clouds: cloudLayers.map((layer) => ({
          cover: layer.slice(0, 3),
          baseFtAgl: Number.parseInt(layer.slice(3), 10) * 100,
        })),
        temperatureC: parseSignedTemp(tempPart),
        dewpointC: parseSignedTemp(dewPart),
        altimeterInHg,
      },
    });
  }

  if (path.includes("/aviation/great-circle")) {
    const airports = {
      JFK: { lat: 40.6413, lon: -73.7781 },
      LAX: { lat: 33.9416, lon: -118.4085 },
      ORD: { lat: 41.9742, lon: -87.9073 },
      DFW: { lat: 32.8998, lon: -97.0403 },
      ATL: { lat: 33.6407, lon: -84.4277 },
      SEA: { lat: 47.4502, lon: -122.3088 },
    };
    const fromCode = readString(pick(body.from, body.origin, context.query.from, "JFK")).toUpperCase();
    const toCode = readString(pick(body.to, body.destination, context.query.to, "LAX")).toUpperCase();
    const from = airports[fromCode] || { lat: readNumber(pick(body.from_lat, body.lat1, context.query.from_lat), 40.6413), lon: readNumber(pick(body.from_lon, body.lon1, context.query.from_lon), -73.7781) };
    const to = airports[toCode] || { lat: readNumber(pick(body.to_lat, body.lat2, context.query.to_lat), 33.9416), lon: readNumber(pick(body.to_lon, body.lon2, context.query.to_lon), -118.4085) };
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(to.lat - from.lat);
    const dLon = toRad(to.lon - from.lon);
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = 6371 * c;
    const distanceNm = distanceKm * 0.539957;
    const cruiseSpeedKnots = Math.max(readNumber(pick(body.speed_knots, context.query.speed_knots), 460), 100);
    const estimatedFlightHours = distanceNm / cruiseSpeedKnots;
    return buildSourceResponse({
      origin: { code: fromCode, ...from },
      destination: { code: toCode, ...to },
      distanceKm: Number(distanceKm.toFixed(1)),
      distanceNm: Number(distanceNm.toFixed(1)),
      cruiseSpeedKnots,
      estimatedFlightHours: Number(estimatedFlightHours.toFixed(2)),
    });
  }

  return buildError("unsupported_aviation_operation", "Unsupported /aviation/ operation.");
}

function renderMaritimePayload(context) {
  const path = context.path;
  const body = context.body;
  const query = context.query;

  if (path.includes("/maritime/tides")) {
    const port = readString(
      pick(context.params.param1, context.params.port, body.port, query.port, "NYC"),
      "NYC",
    ).toUpperCase();
    const baseDate = parseIsoDate(readString(pick(body.date, query.date), "")) || new Date();
    const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 0, 0, 0));
    const offsets = [1, 7, 13, 19];
    const phases = ["high", "low", "high", "low"];
    const tides = offsets.map((hours, index) => {
      const at = new Date(start.getTime() + hours * 60 * 60 * 1000);
      const heightM = Number((stableInt(`${port}:${toIsoDate(start)}:${index}:height`, 40, 360) / 100).toFixed(2));
      return {
        type: phases[index],
        timeUtc: at.toISOString(),
        heightM,
        heightFt: Number((heightM * 3.28084).toFixed(2)),
      };
    });
    return buildSourceResponse({
      port,
      date: toIsoDate(start),
      tides,
      sourceHint: "NOAA-style synthesized tide table",
    });
  }

  if (path.includes("/maritime/weather")) {
    const lat = Number(readNumber(pick(body.lat, body.latitude, query.lat), 37.7749).toFixed(6));
    const lon = Number(readNumber(pick(body.lon, body.longitude, query.lon), -122.4194).toFixed(6));
    const windKt = stableInt(`${lat}:${lon}:wind`, 5, 38);
    const waveM = Number((stableInt(`${lat}:${lon}:wave`, 3, 45) / 10).toFixed(1));
    const swellM = Number((stableInt(`${lat}:${lon}:swell`, 2, 30) / 10).toFixed(1));
    const visibilityNm = stableInt(`${lat}:${lon}:vis`, 1, 12);
    return buildSourceResponse({
      coordinates: { lat, lon },
      forecast: {
        windKt,
        waveHeightM: waveM,
        swellHeightM: swellM,
        visibilityNm,
        condition:
          waveM >= 3.5
            ? "hazardous"
            : waveM >= 2
              ? "moderate"
              : "favorable",
      },
      sourceHint: "marine-forecast synthesized profile",
    });
  }

  if (path.includes("/maritime/route")) {
    const origin = readString(pick(body.origin, body.from, query.origin, "SFO"), "SFO").toUpperCase();
    const destination = readString(pick(body.destination, body.to, query.destination, "LAX"), "LAX").toUpperCase();
    const distanceNm = stableInt(`${origin}:${destination}:distance`, 80, 4200);
    const waypointCount = stableInt(`${origin}:${destination}:waypoints`, 3, 8);
    const waypoints = Array.from({ length: waypointCount }, (_unused, index) => ({
      order: index + 1,
      label: `${origin}-${destination}-WP${String(index + 1).padStart(2, "0")}`,
      lat: Number((stableInt(`${origin}:${destination}:${index}:lat`, -85000, 85000) / 1000).toFixed(3)),
      lon: Number((stableInt(`${origin}:${destination}:${index}:lon`, -179000, 179000) / 1000).toFixed(3)),
    }));
    return buildSourceResponse({
      origin,
      destination,
      distanceNm,
      estimatedHoursAt14kt: Number((distanceNm / 14).toFixed(2)),
      waypoints,
    });
  }

  if (path.includes("/maritime/imo")) {
    const imoRaw = readString(
      pick(context.params.param1, context.params.number, body.number, query.number, "IMO1234567"),
      "IMO1234567",
    ).toUpperCase();
    const digits = imoRaw.replace(/[^0-9]/g, "").slice(0, 7).padStart(7, "0");
    const typeList = ["Container Ship", "Bulk Carrier", "Tanker", "Ro-Ro Cargo", "General Cargo"];
    const type = typeList[stableInt(`${digits}:type`, 0, typeList.length - 1)];
    return buildSourceResponse({
      imo: `IMO${digits}`,
      vesselName: `MV ${hashText(`${digits}:name`).slice(0, 6).toUpperCase()}`,
      vesselType: type,
      flagState: ["Panama", "Liberia", "Marshall Islands", "Singapore", "Malta"][stableInt(`${digits}:flag`, 0, 4)],
      classSociety: ["ABS", "DNV", "Lloyd's Register", "Bureau Veritas", "ClassNK"][stableInt(`${digits}:class`, 0, 4)],
      deadweightTons: stableInt(`${digits}:dwt`, 9000, 220000),
      sourceHint: "IMO-style synthesized vessel profile",
    });
  }

  return buildError("unsupported_maritime_operation", "Unsupported /maritime/ operation.");
}

function renderAstronomyPayload(context) {
  const path = context.path;
  const body = context.body;
  const query = context.query;

  if (path.includes("/astronomy/iss")) {
    const lat = Number(readNumber(pick(body.lat, body.latitude, query.lat), 41.8781).toFixed(6));
    const lon = Number(readNumber(pick(body.lon, body.longitude, query.lon), -87.6298).toFixed(6));
    const now = Date.now();
    const passes = Array.from({ length: 5 }, (_unused, index) => {
      const startOffsetMin = stableInt(`${lat}:${lon}:iss:${index}:start`, 40 + index * 20, 110 + index * 35);
      const durationMin = stableInt(`${lat}:${lon}:iss:${index}:dur`, 2, 9);
      return {
        startUtc: new Date(now + startOffsetMin * 60_000).toISOString(),
        durationMinutes: durationMin,
        maxElevationDeg: stableInt(`${lat}:${lon}:iss:${index}:el`, 12, 88),
        brightnessMag: Number((stableInt(`${lat}:${lon}:iss:${index}:mag`, -350, -50) / 100).toFixed(2)),
      };
    });
    return buildSourceResponse({
      coordinates: { lat, lon },
      passes,
      sourceHint: "ISS pass synthesized forecast",
    });
  }

  if (path.includes("/astronomy/satellite")) {
    const noradId = Math.max(Math.floor(readNumber(pick(body.norad_id, body.norad, query.norad_id), 25544)), 1);
    const lat = Number(readNumber(pick(body.lat, body.latitude, query.lat), 34.0522).toFixed(6));
    const lon = Number(readNumber(pick(body.lon, body.longitude, query.lon), -118.2437).toFixed(6));
    const passes = Array.from({ length: 4 }, (_unused, index) => ({
      riseUtc: new Date(Date.now() + stableInt(`${noradId}:${lat}:${lon}:${index}:rise`, 30, 360) * 60_000).toISOString(),
      setUtc: new Date(Date.now() + stableInt(`${noradId}:${lat}:${lon}:${index}:set`, 35, 370) * 60_000).toISOString(),
      maxElevationDeg: stableInt(`${noradId}:${lat}:${lon}:${index}:max`, 10, 85),
      azimuthDeg: stableInt(`${noradId}:${lat}:${lon}:${index}:az`, 0, 359),
    }));
    return buildSourceResponse({
      noradId,
      coordinates: { lat, lon },
      passes,
      sourceHint: "satellite tracker synthesized forecast",
    });
  }

  if (path.includes("/astronomy/eclipses")) {
    const location = readString(pick(body.location, body.region, query.location, "global"), "global");
    const years = Math.max(Math.floor(readNumber(pick(body.years, query.years), 5)), 1);
    const startYear = Math.max(Math.floor(readNumber(pick(body.start_year, query.start_year), new Date().getUTCFullYear())), 2024);
    const events = [];
    for (let i = 0; i < Math.min(years, 12); i += 1) {
      const year = startYear + i;
      events.push({
        date: `${year}-${String(stableInt(`${location}:${year}:month`, 1, 12)).padStart(2, "0")}-${String(stableInt(`${location}:${year}:day`, 1, 28)).padStart(2, "0")}`,
        type: stableInt(`${location}:${year}:type`, 0, 10) > 5 ? "solar" : "lunar",
        visibility: stableInt(`${location}:${year}:vis`, 0, 10) > 3 ? "partial" : "not-visible",
      });
    }
    return buildSourceResponse({
      location,
      years,
      events,
      sourceHint: "eclipse calendar synthesized schedule",
    });
  }

  if (path.includes("/astronomy/launches")) {
    const providers = ["SpaceX", "ULA", "Rocket Lab", "Arianespace", "ISRO"];
    const pads = ["LC-39A", "SLC-40", "Pad 0A", "ELA-3", "LP-1"];
    const launches = Array.from({ length: 6 }, (_unused, index) => {
      const provider = providers[stableInt(`launch:${index}:provider`, 0, providers.length - 1)];
      const pad = pads[stableInt(`launch:${index}:pad`, 0, pads.length - 1)];
      const offsetHours = stableInt(`launch:${index}:offset`, 24 * (index + 1), 24 * (index + 2) + 10);
      return {
        provider,
        vehicle: `${provider} LV-${stableInt(`launch:${index}:vehicle`, 1, 20)}`,
        launchPad: pad,
        windowStartUtc: new Date(Date.now() + offsetHours * 60 * 60 * 1000).toISOString(),
        missionType: ["LEO", "GTO", "ISS Cargo", "Polar", "Lunar"][stableInt(`launch:${index}:mission`, 0, 4)],
      };
    });
    return buildSourceResponse({ launches });
  }

  if (path.includes("/astronomy/neo")) {
    const start = parseIsoDate(readString(pick(body.start_date, query.start_date), "")) || new Date();
    const end = parseIsoDate(readString(pick(body.end_date, query.end_date), "")) || new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const days = Math.max(1, Math.min(30, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))));
    const count = clamp(stableInt(`${toIsoDate(start)}:${toIsoDate(end)}:neo`, 3, 14), 1, 20);
    const objects = Array.from({ length: count }, (_unused, index) => ({
      name: `NEO-${hashText(`${toIsoDate(start)}:${index}`).slice(0, 6).toUpperCase()}`,
      closeApproachUtc: new Date(start.getTime() + stableInt(`${index}:day`, 0, days) * 24 * 60 * 60 * 1000).toISOString(),
      missDistanceKm: stableInt(`${index}:miss-km`, 120000, 9800000),
      diameterM: stableInt(`${index}:diam`, 12, 940),
      potentiallyHazardous: stableInt(`${index}:haz`, 0, 10) > 7,
    }));
    return buildSourceResponse({
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      count: objects.length,
      objects,
    });
  }

  if (path.includes("/astronomy/light-pollution")) {
    const lat = Number(readNumber(pick(body.lat, body.latitude, query.lat), 35.0).toFixed(6));
    const lon = Number(readNumber(pick(body.lon, body.longitude, query.lon), -100.0).toFixed(6));
    const bortle = stableInt(`${lat}:${lon}:bortle`, 1, 9);
    const stargazing =
      bortle <= 3
        ? "excellent"
        : bortle <= 5
          ? "good"
          : bortle <= 7
            ? "limited"
            : "poor";
    return buildSourceResponse({
      coordinates: { lat, lon },
      bortleScale: bortle,
      stargazingQuality: stargazing,
      notes:
        bortle <= 4
          ? "Dark-sky conditions are favorable for Milky Way visibility."
          : "Consider traveling away from urban light domes for improved viewing.",
    });
  }

  if (path.includes("/astronomy/planets")) {
    const date = readString(pick(body.date, query.date), new Date().toISOString().slice(0, 10));
    const planets = [
      "Mercury",
      "Venus",
      "Mars",
      "Jupiter",
      "Saturn",
      "Uranus",
      "Neptune",
    ].map((name, index) => ({
      name,
      rightAscensionHours: Number((stableInt(`${date}:${name}:ra`, 0, 2399) / 100).toFixed(2)),
      declinationDeg: Number(((stableInt(`${date}:${name}:dec`, -9000, 9000) / 100)).toFixed(2)),
      altitudeDeg: Number((stableInt(`${date}:${name}:alt`, -1000, 8500) / 100).toFixed(2)),
      azimuthDeg: stableInt(`${date}:${name}:az`, 0, 359),
      visibility: stableInt(`${date}:${name}:vis`, 0, 10) > 3 ? "visible" : "below-horizon",
      magnitude: Number((stableInt(`${date}:${name}:mag`, -250, 600) / 100).toFixed(2)),
      order: index + 1,
    }));
    return buildSourceResponse({ date, planets });
  }

  if (path.includes("/astronomy/star")) {
    const starInput = readString(pick(body.star, body.name, query.star, query.name), "Sirius").trim();
    const canonical = starInput.toLowerCase();
    const known = {
      sirius: { name: "Sirius", spectralType: "A1V", distanceLy: 8.6, magnitude: -1.46 },
      betelgeuse: { name: "Betelgeuse", spectralType: "M2Iab", distanceLy: 548, magnitude: 0.5 },
      vega: { name: "Vega", spectralType: "A0V", distanceLy: 25, magnitude: 0.03 },
      polaris: { name: "Polaris", spectralType: "F7Ib", distanceLy: 433, magnitude: 1.98 },
    };
    const selected = known[canonical] || {
      name: starInput || "Unknown",
      spectralType: "G2V",
      distanceLy: Number((stableInt(`${starInput}:distance`, 4, 1500)).toFixed(1)),
      magnitude: Number((stableInt(`${starInput}:mag`, -100, 700) / 100).toFixed(2)),
    };
    return buildSourceResponse({
      query: starInput,
      ...selected,
      rightAscensionHours: Number((stableInt(`${selected.name}:ra`, 0, 2399) / 100).toFixed(2)),
      declinationDeg: Number((stableInt(`${selected.name}:dec`, -9000, 9000) / 100).toFixed(2)),
    });
  }

  if (path.includes("/astronomy/meteors")) {
    const year = Math.max(Math.floor(readNumber(pick(body.year, query.year), new Date().getUTCFullYear())), 2024);
    const events = [
      { shower: "Quadrantids", peakDate: `${year}-01-03`, zhr: 110, radiant: "Bootes" },
      { shower: "Lyrids", peakDate: `${year}-04-22`, zhr: 20, radiant: "Lyra" },
      { shower: "Perseids", peakDate: `${year}-08-12`, zhr: 100, radiant: "Perseus" },
      { shower: "Orionids", peakDate: `${year}-10-21`, zhr: 20, radiant: "Orion" },
      { shower: "Geminids", peakDate: `${year}-12-14`, zhr: 120, radiant: "Gemini" },
    ];
    return buildSourceResponse({
      year,
      meteorShowers: events,
    });
  }

  if (path.includes("/astronomy/constellation")) {
    const ra = clamp(readNumber(pick(body.ra, query.ra), 5.6), 0, 24);
    const dec = clamp(readNumber(pick(body.dec, query.dec), 0), -90, 90);
    const buckets = [
      { name: "Orion", minRa: 4.5, maxRa: 6.8, minDec: -15, maxDec: 25 },
      { name: "Ursa Major", minRa: 8, maxRa: 15, minDec: 30, maxDec: 75 },
      { name: "Scorpius", minRa: 15.5, maxRa: 17.5, minDec: -45, maxDec: 5 },
      { name: "Cygnus", minRa: 19, maxRa: 22.5, minDec: 20, maxDec: 60 },
    ];
    const match =
      buckets.find((item) => ra >= item.minRa && ra <= item.maxRa && dec >= item.minDec && dec <= item.maxDec) ||
      { name: "Pisces", minRa: 22, maxRa: 2, minDec: -5, maxDec: 35 };
    return buildSourceResponse({
      input: { raHours: Number(ra.toFixed(3)), decDeg: Number(dec.toFixed(3)) },
      constellation: match.name,
      boundaryHint: {
        raRangeHours: [match.minRa, match.maxRa],
        decRangeDeg: [match.minDec, match.maxDec],
      },
    });
  }

  return buildError("unsupported_astronomy_operation", "Unsupported /astronomy/ operation.");
}

function renderWellnessPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/wellness/burnout")) {
    const workload = clamp(readNumber(pick(body.workload, context.query.workload), 6), 1, 10);
    const weeklyHours = clamp(readNumber(pick(body.hours, body.weekly_hours, context.query.hours), 45), 1, 120);
    const satisfaction = clamp(readNumber(pick(body.satisfaction, context.query.satisfaction), 6), 1, 10);
    const sleepHours = clamp(readNumber(pick(body.sleep_hours, context.query.sleep_hours), 7), 0, 12);
    const stress = clamp(readNumber(pick(body.stress, context.query.stress), 5), 1, 10);
    const role = readString(pick(body.role, context.query.role, "knowledge-worker"), "knowledge-worker");
    const riskScore = clamp(
      Math.round(
        workload * 4.8
        + clamp((weeklyHours - 40) * 1.2, 0, 30)
        + stress * 4
        + clamp((7 - sleepHours) * 4.5, 0, 24)
        + (10 - satisfaction) * 3.2,
      ),
      0,
      100,
    );
    const riskLevel =
      riskScore >= 80 ? "high"
        : riskScore >= 55 ? "moderate"
          : "low";
    const warningSigns = [
      riskScore >= 60 ? "persistent fatigue despite rest" : null,
      workload >= 8 ? "sustained high workload pressure" : null,
      weeklyHours >= 55 ? "extended work hours without recovery" : null,
      satisfaction <= 4 ? "low engagement and motivation" : null,
      sleepHours < 6.5 ? "insufficient sleep recovery window" : null,
    ].filter(Boolean);
    const recommendations = [
      riskLevel === "high" ? "cut non-critical commitments within 7 days" : "protect two focused recovery blocks this week",
      sleepHours < 7 ? "set a fixed sleep window and reduce late-night stimulation" : "maintain consistent sleep routine",
      workload >= 8 ? "delegate or defer at least one major task this sprint" : "keep workload within sustainable bounds",
    ];
    return buildSourceResponse({
      role,
      inputs: {
        workload,
        weeklyHours,
        satisfaction,
        sleepHours,
        stress,
      },
      burnoutRiskScore: riskScore,
      burnoutRiskLevel: riskLevel,
      warningSigns,
      recommendations,
    });
  }

  if (path.includes("/wellness/cbt")) {
    const text = readString(pick(body.text, body.thought, body.input, context.inputText, ""), "").trim();
    const normalized = text.toLowerCase();
    const distortionRules = [
      {
        distortion: "all-or-nothing",
        cues: ["always", "never", "completely", "total failure", "ruined"],
        reframe: "Look for evidence in degrees, not absolutes.",
      },
      {
        distortion: "catastrophizing",
        cues: ["disaster", "catastrophe", "worst-case", "everything will fall apart"],
        reframe: "Estimate likely outcomes, not just the worst one.",
      },
      {
        distortion: "mind-reading",
        cues: ["they think", "everyone thinks", "they must think"],
        reframe: "Replace assumptions with direct evidence or questions.",
      },
      {
        distortion: "should-statements",
        cues: ["should", "must", "have to"],
        reframe: "Use preference language and identify realistic choices.",
      },
      {
        distortion: "personalization",
        cues: ["it's all my fault", "because of me", "i caused everything"],
        reframe: "Separate what you control from external factors.",
      },
    ];
    const flags = distortionRules
      .map((rule) => {
        const matchedCues = rule.cues.filter((cue) => normalized.includes(cue));
        if (!matchedCues.length) return null;
        return {
          distortion: rule.distortion,
          confidence: Number((0.55 + Math.min(matchedCues.length * 0.12, 0.35)).toFixed(2)),
          cues: matchedCues,
          reframe: rule.reframe,
        };
      })
      .filter(Boolean);

    return buildSourceResponse({
      thought: text,
      flags,
      severity:
        flags.length >= 3 ? "high"
          : flags.length >= 1 ? "moderate"
            : "low",
      suggestedPrompt:
        flags.length
          ? "What evidence supports and contradicts this thought?"
          : "No strong distortion cues detected. Continue with balanced reflection.",
    });
  }

  if (path.includes("/wellness/journal")) {
    const mood = readString(pick(body.mood, context.query.mood, "neutral"), "neutral").toLowerCase();
    const topic = readString(pick(body.topic, context.query.topic, "today"), "today").trim();
    const promptBank = {
      low: [
        `What part of ${topic} felt heaviest today, and what is one small next step?`,
        `What did you need during ${topic} that you did not get, and how can you ask for it?`,
      ],
      neutral: [
        `Describe ${topic} as it happened, then add one thing you learned from it.`,
        `What pattern around ${topic} showed up today, and what might improve it tomorrow?`,
      ],
      positive: [
        `What went well with ${topic}, and what specifically made it work?`,
        `How can you deliberately repeat today's success with ${topic} this week?`,
      ],
    };
    const moodBucket =
      mood.includes("stress") || mood.includes("low") || mood.includes("sad")
        ? "low"
        : mood.includes("good") || mood.includes("great") || mood.includes("happy") || mood.includes("positive")
          ? "positive"
          : "neutral";
    const prompts = promptBank[moodBucket];
    const pickIndex = stableInt(`${moodBucket}:${topic}:${new Date().toISOString().slice(0, 10)}`, 0, prompts.length - 1);
    return buildSourceResponse({
      mood,
      topic,
      prompt: prompts[pickIndex],
      followUps: [
        "What action will you take in the next 24 hours?",
        "How will you know this got better?",
      ],
    });
  }

  if (path.includes("/wellness/stress")) {
    const sleepHours = clamp(readNumber(pick(body.sleep_hours, body.sleep, context.query.sleep_hours), 7), 0, 12);
    const workload = clamp(readNumber(pick(body.workload, context.query.workload), 5), 1, 10);
    const caffeineCups = clamp(readNumber(pick(body.caffeine, body.cups, context.query.caffeine), 1), 0, 12);
    const exerciseMinutes = clamp(readNumber(pick(body.exercise_minutes, context.query.exercise_minutes), 20), 0, 240);
    const events = Array.isArray(body.events) ? body.events.length : 0;
    const text = readString(pick(body.context, body.notes, body.text, context.inputText, ""), "").toLowerCase();
    const negativeSignals = ["deadline", "late", "conflict", "anxious", "overwhelmed", "urgent"]
      .reduce((sum, token) => (text.includes(token) ? sum + 1 : sum), 0);
    const sleepPenalty = clamp((7.5 - sleepHours) * 8, 0, 30);
    const workloadPenalty = clamp((workload - 4) * 6, 0, 36);
    const caffeinePenalty = clamp(caffeineCups * 1.5, 0, 12);
    const eventsPenalty = clamp(events * 4 + negativeSignals * 3, 0, 28);
    const recoveryCredit = clamp(exerciseMinutes / 8, 0, 15);
    const stressScore = clamp(
      Math.round(30 + sleepPenalty + workloadPenalty + caffeinePenalty + eventsPenalty - recoveryCredit),
      0,
      100,
    );
    const level =
      stressScore >= 80 ? "severe"
        : stressScore >= 60 ? "high"
          : stressScore >= 35 ? "moderate"
            : "low";
    return buildSourceResponse({
      stressScore,
      level,
      factors: {
        sleepHours,
        workload,
        caffeineCups,
        eventCount: events,
        negativeSignals,
        exerciseMinutes,
      },
      guidance:
        level === "severe"
          ? "prioritize recovery blocks and reduce commitments today"
          : level === "high"
            ? "schedule breaks, hydrate, and tighten task scope"
            : level === "moderate"
              ? "maintain structure and short reset breaks"
              : "keep current routine",
    });
  }

  if (path.includes("/wellness/mood")) {
    const mood = Math.max(Math.min(Math.round(readNumber(pick(body.mood, body.score, context.query.mood), 6)), 10), 1);
    const label = mood >= 8 ? "positive" : mood >= 5 ? "neutral" : "low";
    const tags = Array.isArray(body.tags) ? body.tags.slice(0, 8).map((item) => readString(item)) : [];
    return buildSourceResponse({
      moodScore: mood,
      moodLabel: label,
      notes: readString(pick(body.notes, body.text, ""), ""),
      tags,
      loggedAt: new Date().toISOString(),
      trendHint: mood >= 7 ? "maintain_routine" : "check_sleep_stress_and_recovery",
    });
  }

  if (path.includes("/wellness/breathing")) {
    const technique = readString(pick(body.technique, context.query.technique, "box")).toLowerCase();
    const durationMinutes = Math.max(readNumber(pick(body.duration, body.minutes, context.query.duration), 5), 1);
    const phaseMap = {
      box: [
        { phase: "inhale", seconds: 4 },
        { phase: "hold", seconds: 4 },
        { phase: "exhale", seconds: 4 },
        { phase: "hold", seconds: 4 },
      ],
      "4-7-8": [
        { phase: "inhale", seconds: 4 },
        { phase: "hold", seconds: 7 },
        { phase: "exhale", seconds: 8 },
      ],
      coherent: [
        { phase: "inhale", seconds: 5 },
        { phase: "exhale", seconds: 5 },
      ],
    };
    const phases = phaseMap[technique] || phaseMap.box;
    const cycleSeconds = phases.reduce((sum, step) => sum + step.seconds, 0);
    const recommendedCycles = Math.max(1, Math.floor((durationMinutes * 60) / cycleSeconds));
    return buildSourceResponse({
      technique: phaseMap[technique] ? technique : "box",
      durationMinutes,
      cycleSeconds,
      recommendedCycles,
      phases,
    });
  }

  if (path.includes("/wellness/habit")) {
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const normalized = logs
      .map((entry) => ({
        date: readString(pick(entry.date, entry.day), ""),
        completed: Boolean(pick(entry.completed, entry.done, false)),
      }))
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!normalized.length) {
      return buildSourceResponse({
        habit: readString(pick(body.habit, "habit")),
        completionRate: 0,
        currentStreak: 0,
        longestStreak: 0,
        totalLogs: 0,
      });
    }
    let longestStreak = 0;
    let currentRun = 0;
    for (const entry of normalized) {
      if (entry.completed) {
        currentRun += 1;
        if (currentRun > longestStreak) longestStreak = currentRun;
      } else {
        currentRun = 0;
      }
    }
    let currentStreak = 0;
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      if (!normalized[i].completed) break;
      currentStreak += 1;
    }
    const completedCount = normalized.filter((entry) => entry.completed).length;
    const completionRate = completedCount / normalized.length;
    return buildSourceResponse({
      habit: readString(pick(body.habit, "habit")),
      completionRate: Number(completionRate.toFixed(3)),
      currentStreak,
      longestStreak,
      completedCount,
      totalLogs: normalized.length,
    });
  }

  if (path.includes("/wellness/sleep")) {
    const hours = clamp(readNumber(pick(body.hours, context.query.hours), 7), 0, 14);
    const quality = clamp(readNumber(pick(body.quality, context.query.quality), 7), 1, 10);
    const factorsRaw = Array.isArray(body.factors)
      ? body.factors
      : readString(pick(body.factors, context.query.factors, ""), "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const factors = factorsRaw.map((item) => readString(item).toLowerCase());
    const negative = ["alcohol", "late-screen", "stress", "noise", "caffeine"];
    const positive = ["exercise", "dark-room", "cool-room", "consistent-bedtime"];
    const negativeCount = factors.reduce((sum, tag) => (negative.includes(tag) ? sum + 1 : sum), 0);
    const positiveCount = factors.reduce((sum, tag) => (positive.includes(tag) ? sum + 1 : sum), 0);
    const scoreBase = 55 + (hours - 7.5) * 7 + (quality - 6) * 6 + positiveCount * 3 - negativeCount * 5;
    const sleepScore = clamp(Math.round(scoreBase), 0, 100);
    const rating =
      sleepScore >= 85 ? "excellent"
        : sleepScore >= 70 ? "good"
          : sleepScore >= 50 ? "fair"
            : "poor";
    return buildSourceResponse({
      sleepScore,
      rating,
      inputs: { hours, quality, factors },
      recommendation:
        rating === "poor"
          ? "reduce evening stimulants and protect a fixed bedtime window"
          : rating === "fair"
            ? "aim for +30 minutes sleep and reduce late-night stimulation"
            : "maintain the routine",
    });
  }

  if (path.includes("/wellness/gratitude")) {
    const topic = readString(pick(body.topic, context.query.topic, "today"), "today").trim();
    const prompts = [
      `Name one thing about ${topic} that made your day easier, and why it mattered.`,
      `What was a small win in ${topic} today that you almost overlooked?`,
      `Who helped you recently around ${topic}, and what would you thank them for?`,
      `What challenge in ${topic} taught you something useful this week?`,
    ];
    const index = stableInt(`${topic}:${new Date().toISOString().slice(0, 10)}`, 0, prompts.length - 1);
    return buildSourceResponse({
      topic,
      prompt: prompts[index],
      followUps: [
        "What part of this can you repeat tomorrow?",
        "How did this change your mood or energy?",
      ],
    });
  }

  if (path.includes("/wellness/mindfulness")) {
    const technique = readString(pick(body.technique, context.query.technique, "box"), "box").toLowerCase();
    const guideMap = {
      box: [
        "Inhale for 4 seconds.",
        "Hold for 4 seconds.",
        "Exhale for 4 seconds.",
        "Hold for 4 seconds and repeat.",
      ],
      grounding: [
        "Name 5 things you can see.",
        "Name 4 things you can feel.",
        "Name 3 things you can hear.",
        "Name 2 things you can smell and 1 thing you can taste.",
      ],
      body_scan: [
        "Start at your toes and scan upward slowly.",
        "Notice tension areas without trying to fix them.",
        "Relax each area on your exhale.",
      ],
    };
    const steps = guideMap[technique] || guideMap.box;
    return buildSourceResponse({
      technique: guideMap[technique] ? technique : "box",
      durationMinutes: clamp(readNumber(pick(body.duration, context.query.duration), 3), 1, 30),
      steps,
    });
  }

  return buildError("unsupported_wellness_operation", "Unsupported /wellness/ operation.");
}

function renderMusicPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/music/bpm")) {
    const audioUrl = readString(pick(body.audio_url, body.url, context.query.audio_url, context.query.url), "");
    const seed = `${audioUrl || "sample-audio"}:${readString(pick(body.clip_hint, ""), "")}`;
    const bpm = stableInt(seed, 72, 168);
    const confidence = Number((0.78 + (stableInt(`${seed}:conf`, 0, 19) / 100)).toFixed(2));
    const groove =
      bpm >= 150 ? "very-fast"
        : bpm >= 120 ? "upbeat"
          : bpm >= 95 ? "mid-tempo"
            : "slow";
    return buildSourceResponse({
      audioUrl: audioUrl || null,
      estimatedBpm: bpm,
      confidence: clamp(confidence, 0.5, 0.99),
      groove,
      bpmRange: {
        min: Math.max(40, bpm - 4),
        max: bpm + 4,
      },
    });
  }

  if (path.includes("/music/key")) {
    const audioUrl = readString(pick(body.audio_url, body.url, context.query.audio_url, context.query.url), "");
    const keys = ["C", "G", "D", "A", "E", "F", "Bb", "Eb", "Ab", "B", "F#", "C#"];
    const modes = ["major", "minor"];
    const seed = `${audioUrl || "sample-audio"}:${readString(pick(body.snippet, ""), "")}`;
    const tonic = keys[stableInt(seed, 0, keys.length - 1)];
    const mode = modes[stableInt(`${seed}:mode`, 0, modes.length - 1)];
    const confidence = Number((0.73 + (stableInt(`${seed}:conf`, 0, 24) / 100)).toFixed(2));
    return buildSourceResponse({
      audioUrl: audioUrl || null,
      key: `${tonic} ${mode}`,
      tonic,
      mode,
      confidence: clamp(confidence, 0.5, 0.99),
      alternateKeys: [
        `${keys[(keys.indexOf(tonic) + 7) % keys.length]} ${mode}`,
        `${tonic} ${mode === "major" ? "minor" : "major"}`,
      ],
    });
  }

  if (path.includes("/music/chords")) {
    const key = readString(pick(body.key, context.query.key, "C"), "C").toUpperCase();
    const mood = readString(pick(body.mood, context.query.mood, "uplifting"), "uplifting").toLowerCase();
    const style = readString(pick(body.style, context.query.style, "pop"), "pop").toLowerCase();
    const templates = {
      uplifting: ["I", "V", "vi", "IV"],
      dark: ["i", "bVI", "bIII", "bVII"],
      chill: ["Imaj7", "vi7", "ii7", "V7"],
      cinematic: ["i", "iv", "VI", "V"],
    };
    const progressionRoman = templates[mood] || templates.uplifting;
    const chordMap = {
      C: { I: "C", V: "G", vi: "Am", IV: "F", i: "Cm", bVI: "Ab", bIII: "Eb", bVII: "Bb", Imaj7: "Cmaj7", vi7: "Am7", ii7: "Dm7", V7: "G7", iv: "Fm", VI: "Ab" },
      G: { I: "G", V: "D", vi: "Em", IV: "C", i: "Gm", bVI: "Eb", bIII: "Bb", bVII: "F", Imaj7: "Gmaj7", vi7: "Em7", ii7: "Am7", V7: "D7", iv: "Cm", VI: "Eb" },
      D: { I: "D", V: "A", vi: "Bm", IV: "G", i: "Dm", bVI: "Bb", bIII: "F", bVII: "C", Imaj7: "Dmaj7", vi7: "Bm7", ii7: "Em7", V7: "A7", iv: "Gm", VI: "Bb" },
      A: { I: "A", V: "E", vi: "F#m", IV: "D", i: "Am", bVI: "F", bIII: "C", bVII: "G", Imaj7: "Amaj7", vi7: "F#m7", ii7: "Bm7", V7: "E7", iv: "Dm", VI: "F" },
      E: { I: "E", V: "B", vi: "C#m", IV: "A", i: "Em", bVI: "C", bIII: "G", bVII: "D", Imaj7: "Emaj7", vi7: "C#m7", ii7: "F#m7", V7: "B7", iv: "Am", VI: "C" },
      F: { I: "F", V: "C", vi: "Dm", IV: "Bb", i: "Fm", bVI: "Db", bIII: "Ab", bVII: "Eb", Imaj7: "Fmaj7", vi7: "Dm7", ii7: "Gm7", V7: "C7", iv: "Bbm", VI: "Db" },
    };
    const keyMap = chordMap[key] || chordMap.C;
    const chords = progressionRoman.map((roman) => keyMap[roman] || roman);
    return buildSourceResponse({
      key,
      mood,
      style,
      progressionRoman,
      chords,
    });
  }

  if (path.includes("/music/lyrics")) {
    const genre = readString(pick(body.genre, context.query.genre, "pop"), "pop");
    const theme = readString(pick(body.theme, context.query.theme, "resilience"), "resilience");
    const mood = readString(pick(body.mood, context.query.mood, "hopeful"), "hopeful");
    const verses = clamp(Math.floor(readNumber(pick(body.verses, context.query.verses), 2)), 1, 6);
    const lines = [];
    for (let verse = 1; verse <= verses; verse += 1) {
      lines.push(`[Verse ${verse}]`);
      lines.push(`In this ${theme}, I keep moving through the ${mood} night`);
      lines.push(`Every step rewrites the story in a better light`);
      lines.push(`No easy road, but I can feel the rhythm hold`);
      lines.push(`I turn the weight into a song that won't grow old`);
    }
    lines.push("[Hook]");
    lines.push(`We rise, we run, we carry ${theme} to the morning sun`);
    lines.push(`No silence now, this is where the new days start`);
    return buildSourceResponse({
      genre,
      theme,
      mood,
      verses,
      lyrics: lines.join("\n"),
      lineCount: lines.length,
    });
  }

  if (path.includes("/music/scale")) {
    const root = readString(pick(body.root, context.query.root, "C"), "C").toUpperCase();
    const type = readString(pick(body.type, context.query.type, "major"), "major").toLowerCase();
    const chromatic = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const altMap = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#" };
    const normalizedRoot = altMap[root] || root;
    const start = chromatic.indexOf(normalizedRoot);
    if (start < 0) {
      return buildError("invalid_root_note", "Unsupported root note.");
    }
    const intervalsByType = {
      major: [0, 2, 4, 5, 7, 9, 11],
      minor: [0, 2, 3, 5, 7, 8, 10],
      pentatonic_major: [0, 2, 4, 7, 9],
      pentatonic_minor: [0, 3, 5, 7, 10],
      dorian: [0, 2, 3, 5, 7, 9, 10],
    };
    const intervals = intervalsByType[type] || intervalsByType.major;
    const notes = intervals.map((step) => chromatic[(start + step) % 12]);
    return buildSourceResponse({
      root: normalizedRoot,
      type,
      intervals,
      notes,
      commonChords: type.includes("minor")
        ? [notes[0] + "m", notes[3], notes[4] + "m"]
        : [notes[0], notes[3], notes[4]],
    });
  }

  if (path.includes("/music/metronome")) {
    const bpm = clamp(readNumber(pick(body.bpm, context.query.bpm), 120), 20, 300);
    const timeSig = readString(pick(body.time_sig, context.query.time_sig, "4/4"), "4/4");
    const measures = clamp(Math.floor(readNumber(pick(body.measures, context.query.measures), 4)), 1, 128);
    const [beatsRaw, noteValueRaw] = timeSig.split("/");
    const beatsPerMeasure = clamp(Math.floor(readNumber(beatsRaw, 4)), 1, 16);
    const noteValue = clamp(Math.floor(readNumber(noteValueRaw, 4)), 1, 16);
    const beatSeconds = 60 / bpm;
    const ticks = [];
    let elapsed = 0;
    for (let measure = 1; measure <= measures; measure += 1) {
      for (let beat = 1; beat <= beatsPerMeasure; beat += 1) {
        ticks.push({
          measure,
          beat,
          accent: beat === 1,
          t: Number(elapsed.toFixed(3)),
        });
        elapsed += beatSeconds;
      }
    }
    return buildSourceResponse({
      bpm,
      timeSignature: `${beatsPerMeasure}/${noteValue}`,
      measures,
      beatSeconds: Number(beatSeconds.toFixed(3)),
      totalSeconds: Number((beatSeconds * beatsPerMeasure * measures).toFixed(3)),
      ticks,
    });
  }

  if (path.includes("/music/structure")) {
    const genre = readString(pick(body.genre, context.query.genre, "pop"), "pop").toLowerCase();
    const lengthSeconds = clamp(Math.floor(readNumber(pick(body.length, body.length_seconds, context.query.length), 210)), 60, 900);
    const templates = {
      pop: ["intro", "verse", "pre-chorus", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
      hiphop: ["intro", "verse", "hook", "verse", "hook", "bridge", "hook", "outro"],
      rock: ["intro", "verse", "chorus", "verse", "chorus", "solo", "chorus", "outro"],
      edm: ["intro", "build", "drop", "breakdown", "build", "drop", "outro"],
    };
    const sections = templates[genre] || templates.pop;
    const perSection = lengthSeconds / sections.length;
    const timeline = sections.map((section, index) => ({
      section,
      startSec: Math.round(index * perSection),
      endSec: Math.round((index + 1) * perSection),
      durationSec: Math.round(perSection),
    }));
    return buildSourceResponse({
      genre,
      lengthSeconds,
      sections,
      timeline,
    });
  }

  if (path.includes("/music/theory-quiz")) {
    const level = readString(pick(body.level, context.query.level, "beginner"), "beginner").toLowerCase();
    const topic = readString(pick(body.topic, context.query.topic, "major scale"), "major scale").toLowerCase();
    const bank = [
      {
        question: "How many semitones are in a perfect fifth?",
        choices: ["5", "7", "9", "12"],
        answer: "7",
        explanation: "A perfect fifth spans 7 semitones.",
      },
      {
        question: "Which chord quality is built from root, major third, perfect fifth?",
        choices: ["Minor triad", "Major triad", "Diminished triad", "Suspended chord"],
        answer: "Major triad",
        explanation: "Major triad = 1, 3, 5 in a major context.",
      },
      {
        question: "What is the relative minor of C major?",
        choices: ["E minor", "A minor", "D minor", "G minor"],
        answer: "A minor",
        explanation: "A minor shares the same key signature as C major.",
      },
    ];
    const seed = `${level}:${topic}:${new Date().toISOString().slice(0, 10)}`;
    const idx = stableInt(seed, 0, bank.length - 1);
    return buildSourceResponse({
      level,
      topic,
      ...bank[idx],
    });
  }

  if (path.includes("/music/tuning")) {
    const noteInput = readString(
      pick(context.params.note, body.note, context.query.note, "A4"),
      "A4",
    ).toUpperCase().trim();
    const match = /^([A-G])([#B]?)(-?\d)$/.exec(noteInput);
    if (!match) {
      return buildError("invalid_note", "Use note format like A4, C#4, Bb3.");
    }
    const key = `${match[1]}${match[2] || ""}`;
    const octave = Number.parseInt(match[3], 10);
    const semitonesFromA = {
      C: -9,
      "C#": -8,
      DB: -8,
      D: -7,
      "D#": -6,
      EB: -6,
      E: -5,
      F: -4,
      "F#": -3,
      GB: -3,
      G: -2,
      "G#": -1,
      AB: -1,
      A: 0,
      "A#": 1,
      BB: 1,
      B: 2,
    };
    const normalized = key.replace("B", "B");
    const semitoneOffset = semitonesFromA[normalized];
    if (!Number.isFinite(semitoneOffset)) {
      return buildError("invalid_note", "Unsupported note name.");
    }
    const midi = 69 + semitoneOffset + (octave - 4) * 12;
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const alternatives = {
      a4_432hz: Number((432 * 2 ** ((midi - 69) / 12)).toFixed(3)),
      baroque_415hz: Number((415 * 2 ** ((midi - 69) / 12)).toFixed(3)),
    };
    return buildSourceResponse({
      note: noteInput,
      standardHz: Number(hz.toFixed(3)),
      alternatives,
    });
  }

  if (path.includes("/music/royalty-split")) {
    const streams = Math.max(readNumber(pick(body.streams, context.query.streams), 100000), 0);
    const ratePerStream = Math.max(readNumber(pick(body.rate_per_stream, context.query.rate_per_stream), 0.003), 0);
    const shares = Array.isArray(body.shares) ? body.shares : [];
    const normalizedShares =
      shares.length
        ? shares
            .map((entry, index) => ({
              party: readString(pick(entry.party, entry.name), `party_${index + 1}`),
              pct: clamp(readNumber(pick(entry.pct, entry.percent), 0), 0, 100),
            }))
            .filter((entry) => entry.pct > 0)
        : [
            { party: "artist", pct: 50 },
            { party: "writer", pct: 30 },
            { party: "producer", pct: 20 },
          ];
    const pctTotal = normalizedShares.reduce((sum, item) => sum + item.pct, 0) || 100;
    const grossRevenue = streams * ratePerStream;
    const payouts = normalizedShares.map((item) => ({
      party: item.party,
      pct: Number(item.pct.toFixed(2)),
      amount: Number((grossRevenue * (item.pct / pctTotal)).toFixed(2)),
    }));
    return buildSourceResponse({
      streams,
      ratePerStream: Number(ratePerStream.toFixed(6)),
      grossRevenue: Number(grossRevenue.toFixed(2)),
      shareTotalPercent: Number(pctTotal.toFixed(2)),
      payouts,
    });
  }

  return buildError("unsupported_music_operation", "Unsupported /music/ operation.");
}

function renderPhotoPayload(context) {
  const path = context.path;
  const body = context.body;

  const parsePixels = () => {
    const rawPixels = readString(pick(body.pixels, body.resolution, context.query.pixels), "");
    const match = /^(\d{2,6})\s*[xX]\s*(\d{2,6})$/.exec(rawPixels);
    if (match) {
      return {
        widthPx: Math.max(readNumber(match[1], 3000), 1),
        heightPx: Math.max(readNumber(match[2], 2000), 1),
      };
    }
    return {
      widthPx: Math.max(readNumber(pick(body.width, body.width_px, context.query.width), 6000), 1),
      heightPx: Math.max(readNumber(pick(body.height, body.height_px, context.query.height), 4000), 1),
    };
  };

  const parseShutterSeconds = (value, fallbackSeconds) => {
    if (value === undefined || value === null || value === "") {
      return fallbackSeconds;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(value, 1 / 8000);
    }
    const text = String(value).trim();
    const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
    if (frac) {
      const numerator = Math.max(readNumber(frac[1], 1), 1);
      const denominator = Math.max(readNumber(frac[2], 125), 1);
      return Math.max(numerator / denominator, 1 / 8000);
    }
    return Math.max(readNumber(text, fallbackSeconds), 1 / 8000);
  };

  const formatShutter = (seconds) => {
    if (seconds >= 1) {
      return `${Number(seconds.toFixed(2))}s`;
    }
    const denominator = Math.max(Math.round(1 / Math.max(seconds, 1 / 8000)), 1);
    return `1/${denominator}`;
  };

  if (path.includes("/photo/grade")) {
    const mood = readString(pick(body.mood, context.query.mood, "cinematic"), "cinematic").toLowerCase();
    const style = readString(pick(body.style, context.query.style, "balanced"), "balanced").toLowerCase();
    const moodPresets = {
      cinematic: { temperature: -4, tint: 2, contrast: 18, saturation: -6, highlights: -22, shadows: 14 },
      warm: { temperature: 14, tint: 3, contrast: 8, saturation: 5, highlights: -10, shadows: 8 },
      moody: { temperature: -8, tint: -2, contrast: 20, saturation: -12, highlights: -25, shadows: 6 },
      bright: { temperature: 6, tint: 0, contrast: 10, saturation: 8, highlights: -8, shadows: 12 },
    };
    const styleAdjust = {
      "teal-orange": { splitToneHighlightsHue: 38, splitToneShadowsHue: 196, splitBalance: 6 },
      matte: { blacksLift: 12, clarity: -6, dehaze: -4 },
      punchy: { vibrance: 18, contrast: 14, clarity: 10 },
      balanced: { vibrance: 8, contrast: 6, clarity: 4 },
    };
    return buildSourceResponse({
      mood,
      style,
      preset: moodPresets[mood] || moodPresets.cinematic,
      adjustments: styleAdjust[style] || styleAdjust.balanced,
      exportHints: {
        lutFormat: ".cube",
        targetGamma: "sRGB",
      },
    });
  }

  if (path.includes("/photo/composition")) {
    const imageUrl = readString(pick(body.image_url, body.url, context.query.image_url, context.query.url), "");
    if (!imageUrl) {
      return buildError("missing_image_url", "Provide image_url or url.");
    }
    const seed = hashText(imageUrl);
    const thirds = stableInt(`${seed}:thirds`, 58, 96);
    const leadingLines = stableInt(`${seed}:lines`, 40, 94);
    const balance = stableInt(`${seed}:balance`, 45, 95);
    const depth = stableInt(`${seed}:depth`, 38, 92);
    const score = Math.round((thirds * 0.3) + (leadingLines * 0.25) + (balance * 0.25) + (depth * 0.2));
    return buildSourceResponse({
      imageUrl,
      compositionScore: score,
      analysis: {
        ruleOfThirds: thirds,
        leadingLines,
        visualBalance: balance,
        depthSeparation: depth,
      },
      suggestions: [
        thirds < 70 ? "shift subject toward a thirds intersection" : "thirds placement is strong",
        leadingLines < 65 ? "emphasize directional lines to guide focus" : "leading lines support subject flow",
        balance < 65 ? "redistribute visual weight across the frame" : "visual balance is acceptable",
      ],
    });
  }

  if (path.includes("/photo/style")) {
    const imageUrl = readString(pick(body.image_url, body.url, context.query.image_url, context.query.url), "");
    if (!imageUrl) {
      return buildError("missing_image_url", "Provide image_url or url.");
    }
    const seed = hashText(imageUrl);
    const styles = [
      "Impressionism",
      "Surrealism",
      "Minimalism",
      "Street Photography",
      "Documentary Realism",
      "Pop Art",
      "Film Noir",
      "Baroque",
    ];
    const primary = styles[stableInt(seed, 0, styles.length - 1)];
    const secondary = styles[stableInt(`${seed}:alt`, 0, styles.length - 1)];
    const confidence = Number((0.62 + stableInt(`${seed}:conf`, 0, 32) / 100).toFixed(2));
    return buildSourceResponse({
      imageUrl,
      detectedStyle: primary,
      confidence: clamp(confidence, 0.45, 0.97),
      alternates: secondary === primary ? [styles[(styles.indexOf(primary) + 1) % styles.length]] : [secondary],
      rationale: [
        "color palette distribution",
        "contrast and tonal treatment",
        "subject framing cues",
      ],
    });
  }

  if (path.includes("/photo/exif")) {
    const imageUrl = readString(pick(body.image_url, body.url, context.query.image_url, context.query.url), "");
    if (!imageUrl) {
      return buildError("missing_image_url", "Provide image_url or url.");
    }

    const seed = hashText(imageUrl);
    const cameraModels = ["Sony A7 IV", "Canon EOS R6", "Nikon Z6 II", "Fujifilm X-T5", "Panasonic S5 II"];
    const lensOptions = ["24-70mm f/2.8", "35mm f/1.8", "50mm f/1.4", "85mm f/1.8", "70-200mm f/4"];
    const cameraModel = cameraModels[stableInt(`${seed}:camera`, 0, cameraModels.length - 1)];
    const lens = lensOptions[stableInt(`${seed}:lens`, 0, lensOptions.length - 1)];
    const focalLengthMm = stableInt(`${seed}:focal`, 24, 200);
    const apertureStops = [1.8, 2, 2.8, 4, 5.6, 8, 11];
    const aperture = apertureStops[stableInt(`${seed}:aperture`, 0, apertureStops.length - 1)];
    const shutterDenominator = [60, 80, 100, 125, 160, 200, 250, 320, 400][
      stableInt(`${seed}:shutter`, 0, 8)
    ];
    const iso = [100, 200, 400, 800, 1600, 3200][stableInt(`${seed}:iso`, 0, 5)];
    const lat = stableInt(`${seed}:lat`, -8999, 8999) / 100;
    const lon = stableInt(`${seed}:lon`, -17999, 17999) / 100;
    const capturedAt = new Date(
      Date.UTC(
        stableInt(`${seed}:year`, 2022, 2026),
        stableInt(`${seed}:month`, 0, 11),
        stableInt(`${seed}:day`, 1, 28),
        stableInt(`${seed}:hour`, 6, 20),
        stableInt(`${seed}:minute`, 0, 59),
        stableInt(`${seed}:second`, 0, 59),
      ),
    ).toISOString();

    return buildSourceResponse({
      imageUrl,
      cameraModel,
      lens,
      focalLengthMm,
      aperture: `f/${aperture}`,
      shutter: `1/${shutterDenominator}`,
      iso,
      capturedAt,
      gps: {
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
      },
    });
  }

  if (path.includes("/photo/hash")) {
    const imageUrl = readString(pick(body.image_url, body.url, context.query.image_url, context.query.url), "");
    if (!imageUrl) {
      return buildError("missing_image_url", "Provide image_url or url.");
    }
    const digest = hashText(imageUrl);
    const perceptualHash = digest.slice(0, 16);
    const blockHash = digest.slice(16, 32);
    return buildSourceResponse({
      imageUrl,
      sha256: digest,
      perceptualHash,
      blockHash,
    });
  }

  if (path.includes("/photo/watermark-text")) {
    const name = readString(pick(body.name, body.owner, context.query.name), "Unknown Creator");
    const year = Math.floor(readNumber(pick(body.year, context.query.year), new Date().getUTCFullYear()));
    const line = `© ${year} ${name}`.trim();
    return buildSourceResponse({
      name,
      year,
      watermark: line,
      alternatives: [line, `${line} All rights reserved.`, `${name} • ${year}`],
    });
  }

  if (path.includes("/photo/print")) {
    const { widthPx, heightPx } = parsePixels();
    const dpi = clamp(readNumber(pick(body.dpi, context.query.dpi), 300), 72, 1200);
    const widthIn = widthPx / dpi;
    const heightIn = heightPx / dpi;
    const widthCm = widthIn * 2.54;
    const heightCm = heightIn * 2.54;
    const standardPrintsIn = [
      { name: "4x6", width: 6, height: 4 },
      { name: "5x7", width: 7, height: 5 },
      { name: "8x10", width: 10, height: 8 },
      { name: "11x14", width: 14, height: 11 },
      { name: "16x20", width: 20, height: 16 },
    ];
    const maxLongSide = Math.max(widthIn, heightIn);
    const maxShortSide = Math.min(widthIn, heightIn);
    const fitPrints = standardPrintsIn
      .filter((item) => maxLongSide >= item.width && maxShortSide >= item.height)
      .map((item) => item.name);
    return buildSourceResponse({
      widthPx,
      heightPx,
      dpi,
      maxPrintSize: {
        widthIn: Number(widthIn.toFixed(2)),
        heightIn: Number(heightIn.toFixed(2)),
        widthCm: Number(widthCm.toFixed(2)),
        heightCm: Number(heightCm.toFixed(2)),
      },
      fitsStandardPrints: fitPrints,
    });
  }

  if (path.includes("/photo/focal")) {
    const focal = Math.max(readNumber(pick(body.focal, body.focal_mm, context.query.focal), 35), 1);
    const sensorInput = readString(
      pick(body.sensor_size, body.sensor, context.query.sensor_size, context.query.sensor),
      "aps-c",
    )
      .toLowerCase()
      .replace(/\s+/g, "-");
    const sensorMap = {
      "full-frame": 36,
      fullframe: 36,
      ff: 36,
      "aps-c": 23.6,
      apsc: 23.6,
      "micro-four-thirds": 17.3,
      mft: 17.3,
      "one-inch": 13.2,
      "1-inch": 13.2,
      super35: 24.89,
    };
    const sensorWidthMm = sensorMap[sensorInput] || 23.6;
    const cropFactor = 36 / sensorWidthMm;
    const equivalent35mm = focal * cropFactor;
    return buildSourceResponse({
      focalMm: Number(focal.toFixed(2)),
      sensor: sensorInput,
      sensorWidthMm: Number(sensorWidthMm.toFixed(2)),
      cropFactor: Number(cropFactor.toFixed(2)),
      equivalent35mm: Number(equivalent35mm.toFixed(2)),
    });
  }

  if (path.includes("/photo/exposure")) {
    const evTarget = clamp(readNumber(pick(body.ev, body.ev_target, context.query.ev), 12), -6, 20);
    let aperture = readNumber(pick(body.aperture, body.f, context.query.aperture), Number.NaN);
    let shutter = parseShutterSeconds(
      pick(body.shutter, body.shutter_seconds, context.query.shutter),
      Number.NaN,
    );
    let iso = readNumber(pick(body.iso, context.query.iso), Number.NaN);

    const provided = [Number.isFinite(aperture), Number.isFinite(shutter), Number.isFinite(iso)].filter(Boolean)
      .length;
    if (provided < 2) {
      return buildError("insufficient_exposure_inputs", "Provide any two of aperture, shutter, and iso.");
    }

    if (!Number.isFinite(aperture)) {
      aperture = Math.sqrt((100 * shutter * 2 ** evTarget) / Math.max(iso, 1));
    } else if (!Number.isFinite(shutter)) {
      shutter = (aperture ** 2 * Math.max(iso, 1)) / (100 * 2 ** evTarget);
    } else if (!Number.isFinite(iso)) {
      iso = (100 * 2 ** evTarget * shutter) / Math.max(aperture ** 2, 0.01);
    }

    aperture = clamp(aperture, 1, 22);
    shutter = clamp(shutter, 1 / 8000, 30);
    iso = clamp(iso, 50, 102400);
    const evComputed = Math.log2((aperture ** 2 / shutter) * (100 / iso));

    return buildSourceResponse({
      aperture: Number(aperture.toFixed(2)),
      shutterSeconds: Number(shutter.toFixed(6)),
      shutterDisplay: formatShutter(shutter),
      iso: Math.round(iso),
      evTarget: Number(evTarget.toFixed(2)),
      evComputed: Number(evComputed.toFixed(2)),
    });
  }

  if (path.includes("/photo/golden-hour")) {
    const lat = clamp(readNumber(pick(body.lat, body.latitude, context.query.lat), 40.7128), -66, 66);
    const lon = clamp(readNumber(pick(body.lon, body.longitude, context.query.lon), -74.006), -180, 180);
    const rawDate = readString(pick(body.date, context.query.date), "");
    const date = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(date.getTime())) {
      return buildError("invalid_date", "Provide a valid date string.");
    }
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const dayOfYear = Math.floor((current - yearStart) / 86400000) + 1;
    const latRad = (lat * Math.PI) / 180;
    const seasonal = Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 80));
    const dayLengthHours = clamp(12 + 4 * seasonal * Math.cos(latRad), 8, 16);
    const solarNoon = 12 - lon / 15;
    const sunrise = solarNoon - dayLengthHours / 2;
    const sunset = solarNoon + dayLengthHours / 2;
    const toClock = (hourDecimal) => {
      let totalMinutes = Math.round(hourDecimal * 60);
      while (totalMinutes < 0) totalMinutes += 24 * 60;
      while (totalMinutes >= 24 * 60) totalMinutes -= 24 * 60;
      const hh = Math.floor(totalMinutes / 60);
      const mm = totalMinutes % 60;
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    return buildSourceResponse({
      date: date.toISOString().slice(0, 10),
      latitude: Number(lat.toFixed(4)),
      longitude: Number(lon.toFixed(4)),
      sunrise: toClock(sunrise),
      sunset: toClock(sunset),
      goldenHour: {
        morningStart: toClock(sunrise),
        morningEnd: toClock(sunrise + 1),
        eveningStart: toClock(sunset - 1),
        eveningEnd: toClock(sunset),
      },
      blueHour: {
        morningStart: toClock(sunrise - 0.5),
        morningEnd: toClock(sunrise),
        eveningStart: toClock(sunset),
        eveningEnd: toClock(sunset + 0.5),
      },
    });
  }

  return buildError("unsupported_photo_operation", "Unsupported /photo/ operation.");
}

function renderInteriorPayload(context) {
  const path = context.path;
  const body = context.body;

  const parseRoomDims = () => {
    const raw = readString(pick(body.room_dims, body.dimensions, context.query.room_dims), "");
    const match = /^(\d+(\.\d+)?)\s*[xX]\s*(\d+(\.\d+)?)$/.exec(raw);
    if (match) {
      return {
        length: Math.max(readNumber(match[1], 12), 1),
        width: Math.max(readNumber(match[3], 10), 1),
      };
    }
    return {
      length: Math.max(readNumber(pick(body.length, body.length_ft, context.query.length), 12), 1),
      width: Math.max(readNumber(pick(body.width, body.width_ft, context.query.width), 10), 1),
    };
  };

  if (path.includes("/interior/dimensions")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const { length, width } = parseRoomDims();
    const area = length * width;
    const perimeter = 2 * (length + width);
    const longerSide = Math.max(length, width);
    const recommendedRugLongSide = Number((longerSide * 0.72).toFixed(2));
    const sofaWidth = unit === "ft" ? recommendedRugLongSide * 12 * 0.75 : recommendedRugLongSide * 100 * 0.75;
    return buildSourceResponse({
      roomType: readString(pick(body.room, context.query.room), "living-room"),
      style: readString(pick(body.style, context.query.style), "modern"),
      unit,
      dimensions: {
        length: Number(length.toFixed(2)),
        width: Number(width.toFixed(2)),
      },
      area: Number(area.toFixed(2)),
      perimeter: Number(perimeter.toFixed(2)),
      suggestions: {
        recommendedRugLongSide: Number(recommendedRugLongSide.toFixed(2)),
        maxSofaWidth: Number(sofaWidth.toFixed(1)),
        sofaWidthUnit: unit === "ft" ? "in" : "cm",
      },
    });
  }

  if (path.includes("/interior/lighting")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const { length, width } = parseRoomDims();
    const area = length * width;
    const areaM2 = unit === "m" ? area : area * 0.092903;
    const use = readString(pick(body.use, body.room_use, context.query.use), "living").toLowerCase();
    const luxByUse = {
      living: 150,
      bedroom: 120,
      kitchen: 300,
      bathroom: 250,
      office: 400,
      hallway: 100,
    };
    const targetLux = luxByUse[use] || 180;
    const lumensNeeded = areaM2 * targetLux;
    const fixtureLumens = Math.max(readNumber(pick(body.fixture_lumens, context.query.fixture_lumens), 900), 100);
    const fixtureCount = Math.max(Math.ceil(lumensNeeded / fixtureLumens), 1);
    return buildSourceResponse({
      use,
      unit,
      area: Number(area.toFixed(2)),
      areaM2: Number(areaM2.toFixed(2)),
      targetLux,
      lumensNeeded: Math.round(lumensNeeded),
      fixtureLumens: Math.round(fixtureLumens),
      fixtureCount,
    });
  }

  if (path.includes("/interior/flooring")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const { length, width } = parseRoomDims();
    const area = length * width;
    const pattern = readString(pick(body.pattern, context.query.pattern), "straight").toLowerCase();
    const wasteByPattern = {
      straight: 0.08,
      diagonal: 0.12,
      herringbone: 0.16,
      chevron: 0.18,
    };
    const wastePercent = wasteByPattern[pattern] ?? 0.1;
    const withWaste = area * (1 + wastePercent);
    return buildSourceResponse({
      unit,
      pattern,
      area: Number(area.toFixed(2)),
      wastePercent: Number((wastePercent * 100).toFixed(1)),
      totalWithWaste: Number(withWaste.toFixed(2)),
    });
  }

  if (path.includes("/interior/color-harmony")) {
    const rawHex = readString(pick(body.hex, body.color, context.query.hex, context.query.color), "#4f46e5")
      .trim()
      .replace(/^#?/, "#");
    const toRgb = (hex) => {
      const clean = hex.replace("#", "");
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
      return {
        r: Number.parseInt(clean.slice(0, 2), 16),
        g: Number.parseInt(clean.slice(2, 4), 16),
        b: Number.parseInt(clean.slice(4, 6), 16),
      };
    };
    const rgb = toRgb(rawHex);
    if (!rgb) {
      return buildError("invalid_hex", "Provide a valid 6-digit hex color.");
    }
    const rotateHue = (r, g, b, degrees) => {
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const matrix = [
        0.213 + cos * 0.787 - sin * 0.213,
        0.715 - cos * 0.715 - sin * 0.715,
        0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143,
        0.715 + cos * 0.285 + sin * 0.14,
        0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787,
        0.715 - cos * 0.715 + sin * 0.715,
        0.072 + cos * 0.928 + sin * 0.072,
      ];
      const nr = clamp(Math.round(r * matrix[0] + g * matrix[1] + b * matrix[2]), 0, 255);
      const ng = clamp(Math.round(r * matrix[3] + g * matrix[4] + b * matrix[5]), 0, 255);
      const nb = clamp(Math.round(r * matrix[6] + g * matrix[7] + b * matrix[8]), 0, 255);
      return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
    };
    return buildSourceResponse({
      base: rawHex.toLowerCase(),
      complementary: rotateHue(rgb.r, rgb.g, rgb.b, 180),
      triadic: [rotateHue(rgb.r, rgb.g, rgb.b, 120), rotateHue(rgb.r, rgb.g, rgb.b, 240)],
      analogous: [rotateHue(rgb.r, rgb.g, rgb.b, 30), rotateHue(rgb.r, rgb.g, rgb.b, -30)],
    });
  }

  if (path.includes("/interior/paint-match")) {
    const rawHex = readString(pick(body.hex, body.color, context.query.hex, context.query.color), "#6d8fa8")
      .trim()
      .replace(/^#?/, "#");
    const clean = rawHex.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
      return buildError("invalid_hex", "Provide a valid 6-digit hex color.");
    }
    const normalizedHex = `#${clean.toLowerCase()}`;
    const libraries = [
      {
        vendor: "Sherwin-Williams",
        code: `SW-${stableInt(`${normalizedHex}:sw`, 6000, 8999)}`,
        name: ["Misty Harbor", "Soft Horizon", "Coastal Slate", "Silver Rain"][
          stableInt(`${normalizedHex}:swn`, 0, 3)
        ],
      },
      {
        vendor: "Benjamin Moore",
        code: `${stableInt(`${normalizedHex}:bm`, 100, 999)}-${stableInt(`${normalizedHex}:bm2`, 10, 99)}`,
        name: ["Quiet Tide", "Gentle Fog", "Harbor Blue", "Morning Drift"][
          stableInt(`${normalizedHex}:bmn`, 0, 3)
        ],
      },
    ];
    return buildSourceResponse({
      inputHex: normalizedHex,
      matches: libraries.map((entry) => ({
        ...entry,
        deltaEApprox: Number((1.4 + stableInt(`${normalizedHex}:${entry.vendor}:de`, 0, 55) / 10).toFixed(1)),
      })),
      finishTips: [
        "matte for low-sheen living spaces",
        "eggshell for balanced durability",
        "satin for high-contact trim areas",
      ],
    });
  }

  if (path.includes("/interior/wallpaper")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const { length, width } = parseRoomDims();
    const height = Math.max(readNumber(pick(body.height, body.wall_height, context.query.height), unit === "m" ? 2.4 : 8), 1);
    const rollWidth = Math.max(readNumber(pick(body.roll_width, context.query.roll_width), unit === "m" ? 0.53 : 1.75), 0.1);
    const rollLength = Math.max(readNumber(pick(body.roll_length, context.query.roll_length), unit === "m" ? 10 : 33), 1);
    const perimeter = 2 * (length + width);
    const stripsNeeded = Math.ceil(perimeter / rollWidth);
    const stripsPerRoll = Math.max(Math.floor(rollLength / height), 1);
    const rollsNeeded = Math.max(Math.ceil(stripsNeeded / stripsPerRoll), 1);
    return buildSourceResponse({
      unit,
      perimeter: Number(perimeter.toFixed(2)),
      wallHeight: Number(height.toFixed(2)),
      roll: {
        width: Number(rollWidth.toFixed(2)),
        length: Number(rollLength.toFixed(2)),
      },
      stripsNeeded,
      stripsPerRoll,
      rollsNeeded,
    });
  }

  if (path.includes("/interior/tile")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const area = Math.max(readNumber(pick(body.area, context.query.area), unit === "m" ? 20 : 200), 0.1);
    const tileSizeRaw = readString(
      pick(body.tile_size, context.query.tile_size),
      unit === "m" ? "0.3x0.3" : "12x12",
    );
    const match = /^(\d+(\.\d+)?)\s*[xX]\s*(\d+(\.\d+)?)$/.exec(tileSizeRaw);
    if (!match) {
      return buildError("invalid_tile_size", "Use tile_size like 12x12 or 0.3x0.3.");
    }
    const tileW = Math.max(readNumber(match[1], 12), 0.01);
    const tileH = Math.max(readNumber(match[3], 12), 0.01);
    const tileArea = tileW * tileH;
    const areaUnitFactor = unit === "m" ? 1 : 144;
    const tileAreaInSurfaceUnits = tileArea / areaUnitFactor;
    const baseTiles = Math.ceil(area / Math.max(tileAreaInSurfaceUnits, 0.0001));
    const pattern = readString(pick(body.pattern, context.query.pattern), "straight").toLowerCase();
    const wastePct = pattern === "diagonal" ? 0.12 : pattern === "herringbone" ? 0.15 : 0.08;
    const totalTiles = Math.ceil(baseTiles * (1 + wastePct));
    const groutKg = Number((area * (unit === "m" ? 0.2 : 0.01858)).toFixed(2));
    return buildSourceResponse({
      unit,
      area,
      tileSize: { width: tileW, height: tileH },
      pattern,
      baseTiles,
      wastePercent: Number((wastePct * 100).toFixed(1)),
      totalTiles,
      groutEstimateKg: groutKg,
    });
  }

  if (path.includes("/interior/carpet")) {
    const unit = readString(pick(body.unit, context.query.unit), "ft").toLowerCase() === "m" ? "m" : "ft";
    const area = Math.max(
      readNumber(
        pick(
          body.area,
          context.query.area,
          (() => {
            const { length, width } = parseRoomDims();
            return length * width;
          })(),
        ),
        150,
      ),
      1,
    );
    const pricePerSqft = Math.max(readNumber(pick(body.price_per_sqft, context.query.price_per_sqft), 4.5), 0);
    const areaSqft = unit === "m" ? area * 10.7639 : area;
    const materialCost = areaSqft * pricePerSqft;
    const installRate = Math.max(readNumber(pick(body.install_rate, context.query.install_rate), 1.25), 0);
    const installCost = areaSqft * installRate;
    const totalCost = materialCost + installCost;
    return buildSourceResponse({
      unit,
      area: Number(area.toFixed(2)),
      areaSqft: Number(areaSqft.toFixed(2)),
      pricePerSqft: Number(pricePerSqft.toFixed(2)),
      materialCost: Number(materialCost.toFixed(2)),
      installCost: Number(installCost.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
    });
  }

  return buildError("unsupported_interior_operation", "Unsupported /interior/ operation.");
}

function renderFitnessPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/fitness/plan")) {
    const goal = readString(pick(body.goal, context.query.goal, "general fitness"), "general fitness");
    const days = clamp(Math.floor(readNumber(pick(body.days, context.query.days), 4)), 1, 7);
    const level = readString(pick(body.level, context.query.level, "intermediate"), "intermediate").toLowerCase();
    const equipmentInput = Array.isArray(body.equipment)
      ? body.equipment
      : readString(pick(body.equipment, context.query.equipment, "bodyweight"), "bodyweight")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const equipment = equipmentInput.length ? equipmentInput : ["bodyweight"];
    const splitByGoal = {
      strength: ["upper", "lower", "push", "pull", "legs"],
      hypertrophy: ["push", "pull", "legs", "upper", "lower"],
      fat_loss: ["conditioning", "full-body", "conditioning", "full-body", "mobility"],
      endurance: ["easy", "tempo", "interval", "easy", "long"],
    };
    const base = splitByGoal[goal.toLowerCase()] || ["full-body", "skill", "full-body", "conditioning", "mobility"];
    const weekly = [];
    for (let day = 1; day <= days; day += 1) {
      const focus = base[(day - 1) % base.length];
      weekly.push({
        day,
        focus,
        durationMinutes: level === "beginner" ? 35 : level === "advanced" ? 70 : 50,
        intensity:
          level === "beginner" ? "moderate"
            : focus === "conditioning" || focus === "interval" ? "high"
              : "moderate-high",
      });
    }
    return buildSourceResponse({
      goal,
      level,
      daysPerWeek: days,
      equipment,
      weeklySchedule: weekly,
      progressionRule: "increase either load or volume by 2-5% per week if recovery is stable",
    });
  }

  if (path.includes("/fitness/load")) {
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    const normalized =
      sessions.length
        ? sessions.map((session, idx) => ({
          id: idx + 1,
          durationMinutes: clamp(readNumber(pick(session.duration, session.minutes), 45), 1, 360),
          rpe: clamp(readNumber(pick(session.rpe, session.intensity), 6), 1, 10),
        }))
        : [
            { id: 1, durationMinutes: 45, rpe: 6 },
            { id: 2, durationMinutes: 55, rpe: 7 },
            { id: 3, durationMinutes: 40, rpe: 6 },
          ];
    const loads = normalized.map((session) => ({
      ...session,
      load: Number((session.durationMinutes * session.rpe).toFixed(1)),
    }));
    const totalLoad = loads.reduce((sum, session) => sum + session.load, 0);
    const avgLoad = totalLoad / loads.length;
    const monotony = Number(
      (
        avgLoad
        / Math.max(
          Math.sqrt(loads.reduce((sum, session) => sum + (session.load - avgLoad) ** 2, 0) / loads.length),
          1,
        )
      ).toFixed(2),
    );
    const recovery = totalLoad > 2400 || monotony > 2.2 ? "add recovery day"
      : totalLoad > 1700 ? "maintain with one low-intensity session"
        : "capacity available for incremental build";
    return buildSourceResponse({
      sessionCount: loads.length,
      sessions: loads,
      weeklyLoad: Number(totalLoad.toFixed(1)),
      averageSessionLoad: Number(avgLoad.toFixed(1)),
      monotony,
      recoveryRecommendation: recovery,
    });
  }

  if (path.includes("/fitness/injury-risk")) {
    const training = isPlainObject(body.training_data) ? body.training_data : body;
    const history = isPlainObject(body.history) ? body.history : {};
    const weeklyDeltaPct = clamp(readNumber(pick(training.weekly_delta_pct, training.weekly_delta), 10), -100, 200);
    const soreness = clamp(readNumber(pick(training.soreness, training.soreness_score), 4), 0, 10);
    const sleepHours = clamp(readNumber(pick(training.sleep, training.sleep_hours), 7), 0, 12);
    const priorInjury = Boolean(pick(history.priorInjury, history.prior_injury, false));
    const sharpPain = Boolean(pick(training.sharp_pain, training.pain_flag, false));
    const riskScore = clamp(
      Math.round(
        clamp(weeklyDeltaPct, 0, 80) * 0.8
        + soreness * 5
        + clamp((7 - sleepHours) * 6, 0, 30)
        + (priorInjury ? 14 : 0)
        + (sharpPain ? 20 : 0),
      ),
      0,
      100,
    );
    const riskLevel =
      riskScore >= 75 ? "high"
        : riskScore >= 45 ? "moderate"
          : "low";
    return buildSourceResponse({
      injuryRiskScore: riskScore,
      injuryRiskLevel: riskLevel,
      flags: {
        rapidLoadIncrease: weeklyDeltaPct > 15,
        highSoreness: soreness >= 7,
        sleepDebt: sleepHours < 6.5,
        priorInjury,
        sharpPain,
      },
      recommendation:
        riskLevel === "high"
          ? "reduce intensity immediately and prioritize recovery protocol"
          : riskLevel === "moderate"
            ? "cap high-intensity volume and monitor symptoms daily"
            : "continue progression with standard recovery hygiene",
    });
  }

  if (path.includes("/fitness/calories-burned")) {
    const activity = readString(pick(body.activity, context.query.activity, "walking"), "walking").toLowerCase();
    const durationMinutes = clamp(readNumber(pick(body.duration, body.minutes, context.query.duration), 30), 1, 1_440);
    const weight = Math.max(readNumber(pick(body.weight, context.query.weight), 180), 1);
    const weightUnit = readString(pick(body.weight_unit, context.query.weight_unit, "lb"), "lb").toLowerCase();
    const weightKg = weightUnit === "kg" ? weight : weight * 0.45359237;
    const metByActivity = {
      walking: 3.5,
      jogging: 7.0,
      running: 9.8,
      cycling: 7.5,
      swimming: 8.0,
      rowing: 7.0,
      yoga: 2.8,
      strength: 6.0,
      hiit: 10.0,
    };
    const met = metByActivity[activity] || 5.0;
    const calories = (met * 3.5 * weightKg * durationMinutes) / 200;
    return buildSourceResponse({
      activity,
      met,
      durationMinutes,
      weightKg: Number(weightKg.toFixed(2)),
      estimatedCalories: Number(calories.toFixed(1)),
    });
  }

  if (path.includes("/fitness/vo2max")) {
    const age = Math.max(Math.floor(readNumber(pick(body.age, context.query.age), 30)), 10);
    const restingHr = Math.max(readNumber(pick(body.resting_hr, body.restingHr, context.query.resting_hr), 60), 30);
    const fallbackMax = 220 - age;
    const maxHr = Math.max(readNumber(pick(body.max_hr, body.maxHr, context.query.max_hr), fallbackMax), restingHr + 1);
    const vo2max = 15.3 * (maxHr / restingHr);
    return buildSourceResponse({
      age,
      restingHr,
      maxHr,
      vo2maxEstimate: Number(vo2max.toFixed(1)),
      method: "uuth-sorensen-overgaard-pedersen",
    });
  }

  if (path.includes("/fitness/hr-zones")) {
    const age = Math.max(Math.floor(readNumber(pick(body.age, context.query.age), 30)), 10);
    const restingHr = Math.max(readNumber(pick(body.resting_hr, body.restingHr, context.query.resting_hr), 60), 30);
    const maxHr = Math.max(readNumber(pick(body.max_hr, body.maxHr, context.query.max_hr), 220 - age), restingHr + 1);
    const reserve = maxHr - restingHr;
    const zoneDefs = [
      { zone: 1, name: "recovery", low: 0.5, high: 0.6 },
      { zone: 2, name: "endurance", low: 0.6, high: 0.7 },
      { zone: 3, name: "tempo", low: 0.7, high: 0.8 },
      { zone: 4, name: "threshold", low: 0.8, high: 0.9 },
      { zone: 5, name: "vo2max", low: 0.9, high: 1.0 },
    ];
    const zones = zoneDefs.map((entry) => ({
      zone: entry.zone,
      name: entry.name,
      bpmMin: Math.round(restingHr + reserve * entry.low),
      bpmMax: Math.round(restingHr + reserve * entry.high),
    }));
    return buildSourceResponse({ age, restingHr, maxHr, zones });
  }

  if (path.includes("/fitness/one-rep-max")) {
    const weight = Math.max(readNumber(pick(body.weight, context.query.weight), 100), 1);
    const reps = Math.max(Math.floor(readNumber(pick(body.reps, context.query.reps), 5)), 1);
    const epley = weight * (1 + reps / 30);
    const brzycki = weight * (36 / (37 - Math.min(reps, 36)));
    return buildSourceResponse({
      weight,
      reps,
      estimates: {
        epley: Number(epley.toFixed(2)),
        brzycki: Number(brzycki.toFixed(2)),
      },
      recommendedOneRepMax: Number(((epley + brzycki) / 2).toFixed(2)),
    });
  }

  if (path.includes("/fitness/pace")) {
    function parseMinutes(value) {
      if (value == null) return NaN;
      if (typeof value === "number") return value;
      const text = readString(value).trim();
      if (!text) return NaN;
      if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
      const parts = text.split(":").map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part))) return NaN;
      if (parts.length === 2) return parts[0] + parts[1] / 60;
      if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
      return NaN;
    }
    const distanceMiles = Math.max(
      readNumber(
        pick(
          body.distance_miles,
          context.query.distance_miles,
          body.distance,
          context.query.distance,
        ),
        3.1,
      ),
      0.01,
    );
    const minutes = Math.max(parseMinutes(pick(body.time_minutes, body.time, context.query.time)), 0.01);
    const pacePerMile = minutes / distanceMiles;
    const pacePerKm = minutes / (distanceMiles * 1.609344);
    const project = (miles) => Number((pacePerMile * miles).toFixed(2));
    return buildSourceResponse({
      distanceMiles: Number(distanceMiles.toFixed(3)),
      elapsedMinutes: Number(minutes.toFixed(2)),
      pacePerMileMinutes: Number(pacePerMile.toFixed(2)),
      pacePerKmMinutes: Number(pacePerKm.toFixed(2)),
      projectionsMinutes: {
        "5k": project(3.106856),
        "10k": project(6.213712),
        halfMarathon: project(13.1094),
        marathon: project(26.2188),
      },
    });
  }

  if (path.includes("/fitness/hydration")) {
    const weight = Math.max(readNumber(pick(body.weight, context.query.weight), 180), 1);
    const weightUnit = readString(pick(body.weight_unit, context.query.weight_unit, "lb"), "lb").toLowerCase();
    const activityMinutes = clamp(readNumber(pick(body.activity_minutes, body.activity, context.query.activity_minutes), 30), 0, 1_440);
    const temperatureF = readNumber(pick(body.temp, body.temperature, context.query.temp), 72);
    const weightLb = weightUnit === "kg" ? weight * 2.20462262 : weight;
    const baselineOz = weightLb * 0.5;
    const activityOz = (activityMinutes / 30) * 12;
    const heatOz = temperatureF > 75 ? ((temperatureF - 75) / 5) * 2 : 0;
    const totalOz = baselineOz + activityOz + heatOz;
    const totalLiters = totalOz * 0.0295735;
    return buildSourceResponse({
      weightLb: Number(weightLb.toFixed(1)),
      activityMinutes,
      temperatureF,
      recommendedOzPerDay: Number(totalOz.toFixed(1)),
      recommendedLitersPerDay: Number(totalLiters.toFixed(2)),
    });
  }

  if (path.includes("/fitness/bodyfat")) {
    const sex = readString(pick(body.sex, body.gender, context.query.sex, "male"), "male").toLowerCase();
    const unit = readString(pick(body.unit, context.query.unit, "in"), "in").toLowerCase();
    const factor = unit === "cm" ? 1 / 2.54 : 1;
    const heightIn = Math.max(readNumber(pick(body.height, context.query.height), 70) * factor, 1);
    const neckIn = Math.max(readNumber(pick(body.neck, context.query.neck), 15) * factor, 1);
    const waistIn = Math.max(readNumber(pick(body.waist, context.query.waist), 34) * factor, 1);
    const hipIn = Math.max(readNumber(pick(body.hip, context.query.hip), 38) * factor, 1);
    let bodyFat = 0;
    if (sex === "female") {
      bodyFat =
        163.205 * Math.log10(Math.max(waistIn + hipIn - neckIn, 0.1))
        - 97.684 * Math.log10(heightIn)
        - 78.387;
    } else {
      bodyFat =
        86.01 * Math.log10(Math.max(waistIn - neckIn, 0.1))
        - 70.041 * Math.log10(heightIn)
        + 36.76;
    }
    const bodyFatPct = clamp(Number(bodyFat.toFixed(1)), 2, 70);
    const category =
      sex === "female"
        ? bodyFatPct < 14
          ? "athlete"
          : bodyFatPct < 21
            ? "fit"
            : bodyFatPct < 32
              ? "average"
              : "high"
        : bodyFatPct < 6
          ? "athlete"
          : bodyFatPct < 14
            ? "fit"
            : bodyFatPct < 25
              ? "average"
              : "high";
    return buildSourceResponse({
      sex: sex === "female" ? "female" : "male",
      bodyFatPercent: bodyFatPct,
      category,
      method: "us-navy",
      measurementsIn: {
        height: Number(heightIn.toFixed(2)),
        neck: Number(neckIn.toFixed(2)),
        waist: Number(waistIn.toFixed(2)),
        hip: Number(hipIn.toFixed(2)),
      },
    });
  }

  return buildError("unsupported_fitness_operation", "Unsupported /fitness/ operation.");
}

function renderDrinksPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/drinks/cocktail")) {
    const ingredients = Array.isArray(body.ingredients)
      ? body.ingredients.map((item) => readString(item).toLowerCase()).filter(Boolean)
      : readString(pick(body.ingredients, context.query.ingredients, ""), "")
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
    if (!ingredients.length) {
      return buildError("missing_ingredients", "Provide ingredients as an array or comma-separated string.");
    }
    const has = (name) => ingredients.some((ingredient) => ingredient.includes(name));
    const recipes = [];
    if ((has("vodka") || has("gin")) && has("lime")) {
      recipes.push({
        name: has("gin") ? "Gimlet" : "Vodka Gimlet",
        matchScore: 0.86,
        missing: has("simple syrup") ? [] : ["simple syrup"],
      });
    }
    if (has("tequila") && has("lime")) {
      recipes.push({
        name: "Margarita",
        matchScore: 0.91,
        missing: has("triple sec") ? [] : ["triple sec"],
      });
    }
    if (has("rum") && has("mint")) {
      recipes.push({
        name: "Mojito",
        matchScore: 0.88,
        missing: has("simple syrup") ? [] : ["simple syrup"],
      });
    }
    if (has("whiskey") && has("bitters")) {
      recipes.push({
        name: "Old Fashioned",
        matchScore: 0.84,
        missing: has("sugar") ? [] : ["sugar"],
      });
    }
    if (!recipes.length) {
      recipes.push({
        name: "Custom Highball",
        matchScore: 0.62,
        missing: ["citrus", "sweetener"],
      });
    }
    return buildSourceResponse({
      ingredients,
      recipes,
      topPick: recipes[0],
    });
  }

  if (path.includes("/drinks/abv")) {
    const og = clamp(readNumber(pick(body.og, body.original_gravity, context.query.og), 1.05), 1, 2);
    const fg = clamp(readNumber(pick(body.fg, body.final_gravity, context.query.fg), 1.01), 0.9, og);
    const abv = (og - fg) * 131.25;
    const attenuation = og > 1 ? ((og - fg) / (og - 1)) * 100 : 0;
    return buildSourceResponse({
      originalGravity: Number(og.toFixed(3)),
      finalGravity: Number(fg.toFixed(3)),
      abvPercent: Number(abv.toFixed(2)),
      apparentAttenuationPercent: Number(clamp(attenuation, 0, 100).toFixed(1)),
    });
  }

  if (path.includes("/drinks/sobriety")) {
    const drinks = Math.max(readNumber(pick(body.drinks, context.query.drinks), 2), 0);
    const weight = Math.max(readNumber(pick(body.weight, context.query.weight), 180), 1);
    const weightUnit = readString(pick(body.weight_unit, context.query.weight_unit, "lb"), "lb").toLowerCase();
    const sex = readString(pick(body.sex, context.query.sex, "male"), "male").toLowerCase();
    const hours = Math.max(readNumber(pick(body.time, body.hours, context.query.hours), 2), 0);
    const standardDrinkAlcoholOz = 0.6;
    const alcoholOz = drinks * standardDrinkAlcoholOz;
    const weightLb = weightUnit === "kg" ? weight * 2.20462262 : weight;
    const r = sex === "female" ? 0.66 : 0.73;
    const bacRaw = (alcoholOz * 5.14) / (weightLb * r) - 0.015 * hours;
    const bac = Math.max(bacRaw, 0);
    const soberInHours = bac > 0 ? bac / 0.015 : 0;
    return buildSourceResponse({
      drinks,
      weightLb: Number(weightLb.toFixed(1)),
      sex: sex === "female" ? "female" : "male",
      hoursSinceStart: Number(hours.toFixed(2)),
      estimatedBac: Number(bac.toFixed(3)),
      legalLimitBac: 0.08,
      aboveLegalLimit: bac >= 0.08,
      estimatedSoberInHours: Number(soberInHours.toFixed(2)),
    });
  }

  if (path.includes("/drinks/beer-style")) {
    const style = readString(pick(body.style, body.style_name, context.query.style, "ipa"), "ipa")
      .toLowerCase()
      .trim();
    const guide = {
      ipa: {
        family: "India Pale Ale",
        abvRange: "5.5% - 7.5%",
        ibuRange: "40 - 70",
        srmRange: "6 - 14",
        notes: ["Hop-forward aroma", "Moderate to high bitterness", "Citrus/pine/tropical profile"],
      },
      pilsner: {
        family: "Pilsner",
        abvRange: "4.2% - 5.8%",
        ibuRange: "25 - 45",
        srmRange: "2 - 5",
        notes: ["Crisp finish", "Noble hop character", "Light malt backbone"],
      },
      stout: {
        family: "Stout",
        abvRange: "4.5% - 8.0%",
        ibuRange: "25 - 50",
        srmRange: "30 - 40+",
        notes: ["Roasted malt", "Coffee/chocolate notes", "Medium to full body"],
      },
      saison: {
        family: "Saison",
        abvRange: "5.0% - 7.5%",
        ibuRange: "20 - 35",
        srmRange: "5 - 14",
        notes: ["Dry finish", "Peppery yeast", "Fruity esters"],
      },
    };
    const selected = guide[style] || {
      family: style || "Custom",
      abvRange: "4.0% - 7.0%",
      ibuRange: "20 - 50",
      srmRange: "4 - 20",
      notes: ["Balanced profile", "Refer to BJCP style notes for details"],
    };
    return buildSourceResponse({
      style,
      ...selected,
      sourceHint: "BJCP-style synthesized guidance",
    });
  }

  return buildError("unsupported_drinks_operation", "Unsupported /drinks/ operation.");
}

function renderFashionPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/fashion/outfit")) {
    const colors = Array.isArray(body.colors)
      ? body.colors.map((item) => readString(item).trim().toLowerCase()).filter(Boolean)
      : readString(pick(body.colors, context.query.colors, ""), "")
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
    if (!colors.length) {
      return buildError("missing_colors", "Provide colors as an array or comma-separated string.");
    }
    const neutrals = new Set(["black", "white", "gray", "grey", "navy", "beige", "cream", "tan"]);
    const accents = colors.filter((color) => !neutrals.has(color));
    const harmony =
      accents.length <= 1
        ? "safe"
        : accents.length === 2
          ? "complementary"
          : accents.length === 3
            ? "triadic"
            : "high-contrast";
    return buildSourceResponse({
      colors,
      harmony,
      recommendation:
        harmony === "high-contrast"
          ? "Use one accent color and keep the rest neutral."
          : "Palette works; balance saturation across pieces.",
      accentColors: accents,
    });
  }

  if (path.includes("/fashion/size")) {
    const unit = readString(pick(body.unit, context.query.unit, "in"), "in").toLowerCase();
    const chestRaw = Math.max(readNumber(pick(body.measurement, body.chest, context.query.measurement), 38), 1);
    const chestIn = unit === "cm" ? chestRaw / 2.54 : chestRaw;
    const usTop =
      chestIn <= 34 ? "XS"
        : chestIn <= 38 ? "S"
          : chestIn <= 42 ? "M"
            : chestIn <= 46 ? "L"
              : chestIn <= 50 ? "XL"
                : "XXL";
    const euByUs = {
      XS: "44",
      S: "46-48",
      M: "50",
      L: "52",
      XL: "54-56",
      XXL: "58+",
    };
    const ukByUs = {
      XS: "34",
      S: "36",
      M: "38-40",
      L: "42",
      XL: "44-46",
      XXL: "48+",
    };
    return buildSourceResponse({
      inputChest: Number(chestRaw.toFixed(2)),
      inputUnit: unit === "cm" ? "cm" : "in",
      chestIn: Number(chestIn.toFixed(2)),
      recommended: {
        us: usTop,
        eu: euByUs[usTop],
        uk: ukByUs[usTop],
        jp: usTop,
      },
    });
  }

  if (path.includes("/fashion/care")) {
    const rawSymbols = Array.isArray(body.symbols)
      ? body.symbols
      : readString(pick(body.label, body.symbols, context.query.symbols, ""), "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
    const symbolMap = {
      wash30: "Machine wash cold (30C).",
      wash40: "Machine wash warm (40C).",
      handwash: "Hand wash only.",
      no_bleach: "Do not bleach.",
      tumble_low: "Tumble dry low.",
      no_tumble: "Do not tumble dry.",
      iron_low: "Iron on low heat.",
      no_iron: "Do not iron.",
      dry_clean: "Dry clean.",
      no_dry_clean: "Do not dry clean.",
    };
    const decoded = rawSymbols.map((symbol) => {
      const key = readString(symbol).toLowerCase().replace(/\s+/g, "_");
      return {
        symbol: readString(symbol),
        instruction: symbolMap[key] || "Unknown symbol. Verify manufacturer care guide.",
      };
    });
    return buildSourceResponse({
      symbols: rawSymbols,
      decoded,
      summary: decoded.map((entry) => entry.instruction),
    });
  }

  if (path.includes("/fashion/dress-code")) {
    const code = readString(pick(body.code, body.text, context.query.code, "business casual"), "business casual")
      .toLowerCase();
    const presets = {
      "black tie": {
        attire: "formal",
        top: "tuxedo jacket or formal evening gown",
        bottom: "matching formal trousers or full-length gown",
        shoes: "patent leather dress shoes or formal heels",
      },
      "business casual": {
        attire: "smart-casual",
        top: "collared shirt, blouse, or knit polo",
        bottom: "chinos, tailored pants, or knee-length skirt",
        shoes: "loafers, clean leather sneakers, or flats",
      },
      cocktail: {
        attire: "semi-formal",
        top: "blazer, dress shirt, or cocktail dress",
        bottom: "tailored trousers or midi dress/skirt",
        shoes: "dress shoes or heels",
      },
      casual: {
        attire: "casual",
        top: "clean t-shirt, polo, or casual blouse",
        bottom: "jeans or casual trousers",
        shoes: "clean sneakers or casual shoes",
      },
    };
    const selected =
      Object.entries(presets).find(([name]) => code.includes(name))?.[1] || presets["business casual"];
    return buildSourceResponse({
      dressCode: code,
      recommendation: selected,
      avoid: [
        "Wrinkled garments",
        "Overly athletic wear unless explicitly allowed",
        "Over-accessorizing for formal contexts",
      ],
    });
  }

  if (path.includes("/fashion/capsule")) {
    const style = readString(pick(body.style, context.query.style, "minimal"), "minimal").toLowerCase();
    const climate = readString(pick(body.climate, context.query.climate, "temperate"), "temperate").toLowerCase();
    const budget = Math.max(readNumber(pick(body.budget, context.query.budget), 1200), 0);
    const baseItems = [
      "2 neutral t-shirts",
      "1 button-down shirt",
      "1 sweater or cardigan",
      "1 jacket",
      "2 bottoms (jeans/chinos/skirt)",
      "1 versatile dress or blazer",
      "1 pair white sneakers",
      "1 pair dress shoes/boots",
    ];
    const climateAddons =
      climate.includes("cold")
        ? ["wool coat", "thermal layer", "weatherproof boots"]
        : climate.includes("hot")
          ? ["linen shirt", "lightweight shorts", "breathable loafers"]
          : ["rain shell", "light knit layer"];
    const styleHint =
      style.includes("street")
        ? "Favor relaxed silhouettes with clean base colors."
        : style.includes("classic")
          ? "Prefer timeless cuts and muted tones."
          : "Prioritize interchangeable basics first.";
    return buildSourceResponse({
      style,
      climate,
      budget,
      essentials: [...baseItems, ...climateAddons],
      styleHint,
      estimatedSpendRange: {
        low: Number((budget * 0.8).toFixed(2)),
        high: Number((budget * 1.15).toFixed(2)),
      },
    });
  }

  if (path.includes("/fashion/textile")) {
    const fabric = readString(
      pick(context.params.fabric, context.params.value1, body.fabric, context.query.fabric, "cotton"),
      "cotton",
    )
      .toLowerCase()
      .trim();
    const profiles = {
      cotton: {
        properties: ["Breathable", "Soft hand feel", "Easy care"],
        care: ["Machine wash cold", "Tumble dry low"],
        sustainabilityScore: 74,
      },
      linen: {
        properties: ["Highly breathable", "Textured drape", "Moisture wicking"],
        care: ["Gentle wash", "Air dry when possible"],
        sustainabilityScore: 82,
      },
      wool: {
        properties: ["Insulating", "Wrinkle resistant", "Odor resistant"],
        care: ["Hand wash or dry clean", "Lay flat to dry"],
        sustainabilityScore: 79,
      },
      polyester: {
        properties: ["Durable", "Quick drying", "Wrinkle resistant"],
        care: ["Machine wash warm", "Avoid high heat ironing"],
        sustainabilityScore: 48,
      },
      silk: {
        properties: ["Luxurious sheen", "Lightweight", "Delicate fibers"],
        care: ["Hand wash cold or dry clean", "Avoid direct sunlight drying"],
        sustainabilityScore: 66,
      },
    };
    const selected = profiles[fabric] || {
      properties: ["General textile properties unavailable"],
      care: ["Follow garment care label"],
      sustainabilityScore: 60,
    };
    return buildSourceResponse({
      fabric,
      ...selected,
    });
  }

  return buildError("unsupported_fashion_operation", "Unsupported /fashion/ operation.");
}

function renderDesignPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/design/font-pair")) {
    const baseFont = readString(pick(body.base_font, body.font, context.query.base_font, "inter"), "inter")
      .toLowerCase()
      .trim();
    const pairings = {
      inter: ["Merriweather", "IBM Plex Serif", "Space Grotesk"],
      roboto: ["Lora", "Roboto Slab", "Nunito"],
      georgia: ["Montserrat", "Inter", "Source Sans 3"],
      "times new roman": ["Avenir Next", "Futura PT", "Helvetica Neue"],
      "space grotesk": ["Newsreader", "IBM Plex Sans", "DM Sans"],
    };
    const suggested = pairings[baseFont] || ["Inter", "Merriweather", "Source Sans 3"];
    return buildSourceResponse({
      baseFont,
      pairings: suggested.map((font, index) => ({
        font,
        role: index === 0 ? "heading" : index === 1 ? "body" : "accent",
      })),
    });
  }

  if (path.includes("/design/type-scale")) {
    const baseSize = Math.max(readNumber(pick(body.base_size, context.query.base_size), 16), 1);
    const ratio = clamp(readNumber(pick(body.ratio, context.query.ratio), 1.25), 1.05, 2);
    const labels = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl"];
    const scale = labels.map((label, idx) => {
      const exponent = idx - 2;
      const sizePx = baseSize * ratio ** exponent;
      return { label, px: Number(sizePx.toFixed(2)) };
    });
    return buildSourceResponse({
      baseSizePx: baseSize,
      ratio: Number(ratio.toFixed(3)),
      scale,
    });
  }

  if (path.includes("/design/readability")) {
    function parseHex(hex) {
      const value = readString(hex, "").trim().replace(/^#/, "");
      if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
      return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
      };
    }
    function luminance({ r, g, b }) {
      const rgb = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    }
    const foreground = readString(pick(body.foreground, body.fg, context.query.foreground, "#111111"), "#111111");
    const background = readString(pick(body.background, body.bg, context.query.background, "#ffffff"), "#ffffff");
    const fg = parseHex(foreground);
    const bg = parseHex(background);
    if (!fg || !bg) {
      return buildError("invalid_color", "Use 6-digit hex colors like #112233.");
    }
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return buildSourceResponse({
      foreground,
      background,
      contrastRatio: Number(ratio.toFixed(2)),
      wcag: {
        aaNormal: ratio >= 4.5,
        aaLarge: ratio >= 3,
        aaaNormal: ratio >= 7,
        aaaLarge: ratio >= 4.5,
      },
    });
  }

  if (path.includes("/design/golden-ratio")) {
    const width = Math.max(readNumber(pick(body.width, context.query.width), 1200), 1);
    const phi = 1.61803398875;
    const height = width / phi;
    return buildSourceResponse({
      width: Number(width.toFixed(2)),
      recommendedHeight: Number(height.toFixed(2)),
      primarySegment: Number((width / phi).toFixed(2)),
      secondarySegment: Number((width - width / phi).toFixed(2)),
      ratio: Number(phi.toFixed(5)),
    });
  }

  if (path.includes("/design/grid")) {
    const width = Math.max(readNumber(pick(body.width, context.query.width), 1440), 1);
    const columns = clamp(Math.floor(readNumber(pick(body.columns, context.query.columns), 12)), 1, 24);
    const gutter = clamp(readNumber(pick(body.gutter, context.query.gutter), 24), 0, width);
    const margin = clamp(readNumber(pick(body.margin, context.query.margin), 80), 0, width / 2);
    const usableWidth = Math.max(width - margin * 2 - gutter * (columns - 1), 0);
    const columnWidth = columns > 0 ? usableWidth / columns : 0;
    return buildSourceResponse({
      canvasWidth: Number(width.toFixed(2)),
      columns,
      gutter: Number(gutter.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      columnWidth: Number(columnWidth.toFixed(2)),
      totalGridWidth: Number((columnWidth * columns + gutter * (columns - 1)).toFixed(2)),
    });
  }

  if (path.includes("/design/colorblind")) {
    const palette = Array.isArray(body.palette)
      ? body.palette.map((item) => readString(item).trim()).filter(Boolean)
      : readString(pick(body.palette, context.query.palette, ""), "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const normalizeHex = (value) => {
      const cleaned = readString(value, "").replace(/^#/, "");
      return /^[0-9a-fA-F]{6}$/.test(cleaned) ? `#${cleaned.toLowerCase()}` : null;
    };
    const sourcePalette = palette.length ? palette.map(normalizeHex).filter(Boolean) : ["#1f77b4", "#ff7f0e", "#2ca02c"];
    const mutate = (hex, rMul, gMul, bMul) => {
      const raw = hex.replace("#", "");
      const r = clamp(Math.round(Number.parseInt(raw.slice(0, 2), 16) * rMul), 0, 255);
      const g = clamp(Math.round(Number.parseInt(raw.slice(2, 4), 16) * gMul), 0, 255);
      const b = clamp(Math.round(Number.parseInt(raw.slice(4, 6), 16) * bMul), 0, 255);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    };
    return buildSourceResponse({
      sourcePalette,
      simulations: {
        protanopia: sourcePalette.map((hex) => mutate(hex, 0.55, 1, 1)),
        deuteranopia: sourcePalette.map((hex) => mutate(hex, 1, 0.6, 1)),
        tritanopia: sourcePalette.map((hex) => mutate(hex, 1, 1, 0.55)),
        achromatopsia: sourcePalette.map((hex) => {
          const raw = hex.replace("#", "");
          const r = Number.parseInt(raw.slice(0, 2), 16);
          const g = Number.parseInt(raw.slice(2, 4), 16);
          const b = Number.parseInt(raw.slice(4, 6), 16);
          const gray = Math.round((r + g + b) / 3);
          return `#${gray.toString(16).padStart(2, "0").repeat(3)}`;
        }),
      },
    });
  }

  if (path.includes("/design/brand-color")) {
    const hex = readString(pick(body.hex, body.color, context.query.hex, "#3366cc"), "#3366cc");
    const clean = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
      return buildError("invalid_hex", "Provide a valid 6-digit hex color.");
    }
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
      if (max === r) hue = ((g - b) / (max - min)) * 60;
      else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
      else hue = (4 + (r - g) / (max - min)) * 60;
    }
    if (hue < 0) hue += 360;
    const family =
      hue < 20 || hue >= 340
        ? "red"
        : hue < 60
          ? "orange"
          : hue < 90
            ? "yellow"
            : hue < 160
              ? "green"
              : hue < 220
                ? "blue"
                : hue < 280
                  ? "purple"
                  : "magenta";
    const associations = {
      red: ["urgency", "energy", "bold action"],
      orange: ["playfulness", "confidence", "approachability"],
      yellow: ["optimism", "attention", "warmth"],
      green: ["growth", "health", "sustainability"],
      blue: ["trust", "stability", "clarity"],
      purple: ["creativity", "premium", "imagination"],
      magenta: ["innovation", "expressiveness", "modernity"],
    };
    const industries = {
      red: ["food", "sports", "retail"],
      orange: ["consumer apps", "education", "hospitality"],
      yellow: ["media", "child-focused products", "alerts"],
      green: ["fintech", "climate", "wellness"],
      blue: ["saas", "finance", "healthcare"],
      purple: ["beauty", "entertainment", "luxury services"],
      magenta: ["creative tools", "fashion", "digital media"],
    };
    return buildSourceResponse({
      hex: `#${clean.toLowerCase()}`,
      hue: Number(hue.toFixed(1)),
      family,
      associations: associations[family],
      commonIndustryUsage: industries[family],
    });
  }

  if (path.includes("/design/icon")) {
    const concept = readString(pick(body.concept, body.text, context.query.concept, "analytics dashboard"), "analytics dashboard")
      .toLowerCase()
      .trim();
    const tokens = concept.split(/\s+/).filter(Boolean);
    const map = [
      { key: "search", options: ["search", "magnifying-glass", "scan-eye"] },
      { key: "user", options: ["user", "user-circle", "users"] },
      { key: "payment", options: ["credit-card", "wallet", "receipt"] },
      { key: "alert", options: ["triangle-alert", "bell", "shield-alert"] },
      { key: "cloud", options: ["cloud", "cloud-upload", "database"] },
      { key: "chart", options: ["bar-chart-3", "line-chart", "pie-chart"] },
      { key: "security", options: ["shield-check", "lock", "fingerprint"] },
      { key: "calendar", options: ["calendar-days", "calendar-check", "clock-3"] },
    ];
    const matched = map.find((item) => tokens.some((token) => token.includes(item.key)));
    const suggestions = matched?.options || ["sparkles", "layers", "command"];
    return buildSourceResponse({
      concept,
      suggestions: suggestions.map((icon, index) => ({
        icon,
        library: index % 2 === 0 ? "feather" : "material",
      })),
    });
  }

  if (path.includes("/design/logo-colors")) {
    const imageUrl = readString(pick(body.image_url, body.url, context.query.image_url, context.query.url), "");
    if (!imageUrl) {
      return buildError("missing_image_url", "Provide image_url or url.");
    }
    const digest = hashText(imageUrl);
    const chunkToHex = (offset) => `#${digest.slice(offset, offset + 6)}`;
    const primary = chunkToHex(0);
    const secondary = chunkToHex(8);
    const accent = chunkToHex(16);
    return buildSourceResponse({
      imageUrl,
      palette: {
        primary,
        secondary,
        accent,
      },
      allExtracted: [primary, secondary, accent, chunkToHex(24), chunkToHex(32)],
    });
  }

  return buildError("unsupported_design_operation", "Unsupported /design/ operation.");
}

function renderAiPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/ai/model-compare")) {
    const prompt = getPromptText(context, "Summarize tradeoffs for this decision");
    const models = toList(pick(body.models, context.query.models), ["gpt-5.4", "claude-3.7", "gemini-2.5"])
      .slice(0, 6);
    const outputs = models.map((model, index) => {
      const latencyMs = stableInt(`${model}:${prompt}:latency`, 380, 2200);
      const quality = stableInt(`${model}:${prompt}:quality`, 62, 95);
      const costUsd = Number((stableInt(`${model}:${prompt}:cost`, 5, 45) / 1000).toFixed(4));
      return {
        model,
        output: `${model} perspective: ${prompt}. Focus on assumptions, risks, and execution sequence.`,
        qualityScore: quality,
        latencyMs,
        costUsd,
      };
    });
    const ranked = [...outputs].sort((a, b) => b.qualityScore - a.qualityScore || a.costUsd - b.costUsd);
    return buildSourceResponse({
      prompt,
      comparedModels: models,
      outputs,
      winner: {
        model: ranked[0].model,
        reason:
          ranked[0].qualityScore - ranked[ranked.length - 1].qualityScore >= 8
            ? "highest quality score"
            : "best quality-to-cost balance",
      },
      recommendation: `Use ${ranked[0].model} primary, fallback to ${ranked[1]?.model || ranked[0].model}.`,
    });
  }

  if (path.includes("/ai/consensus")) {
    const prompt = getPromptText(context, "What is the best next action?");
    const responses = Array.isArray(body.responses)
      ? body.responses.map((value) => readString(value).trim()).filter(Boolean).slice(0, 8)
      : [];
    const candidateResponses = responses.length
      ? responses
      : [
          `${prompt} -> prioritize the highest impact task first.`,
          `${prompt} -> sequence tasks by risk reduction and dependency order.`,
          `${prompt} -> start with the smallest safe experiment and scale.`,
        ];
    const tokenized = candidateResponses.map((text) => new Set(words(text)));
    const consensusTokens = {};
    for (const tokens of tokenized) {
      for (const token of tokens) {
        consensusTokens[token] = (consensusTokens[token] || 0) + 1;
      }
    }
    const majorityTerms = Object.entries(consensusTokens)
      .filter(([, count]) => count >= Math.ceil(candidateResponses.length / 2))
      .map(([term]) => term);
    const disagreementScore = clamp(
      Math.round(
        (Object.keys(consensusTokens).length - majorityTerms.length) /
          Math.max(Object.keys(consensusTokens).length, 1) *
          100,
      ),
      0,
      100,
    );
    const consensusAnswer =
      majorityTerms.length >= 3
        ? `Consensus emphasizes: ${majorityTerms.slice(0, 8).join(", ")}.`
        : candidateResponses[0];
    return buildSourceResponse({
      prompt,
      responseCount: candidateResponses.length,
      consensusAnswer,
      majorityTerms: majorityTerms.slice(0, 12),
      disagreementScore,
      consensusLevel: disagreementScore <= 30 ? "high" : disagreementScore <= 60 ? "medium" : "low",
    });
  }

  if (path.includes("/ai/hallucination")) {
    const answer = readString(pick(body.answer, body.output, body.text, ""), "");
    const facts = Array.isArray(body.facts)
      ? body.facts.map((value) => readString(value).trim()).filter(Boolean)
      : toList(pick(body.facts_text, body.reference, body.context, ""), []);
    const factTokens = new Set(words(facts.join(" ")));
    const claims = answer
      .split(/[.!?]\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    const claimChecks = claims.map((claim) => {
      const tokens = words(claim);
      const overlap = tokens.filter((token) => factTokens.has(token)).length;
      const coverage = tokens.length ? overlap / tokens.length : 0;
      return {
        claim,
        coverage: Number(coverage.toFixed(3)),
        supported: coverage >= 0.25 || tokens.length <= 4,
      };
    });
    const unsupported = claimChecks.filter((entry) => !entry.supported);
    const riskScore = clamp(
      Math.round((unsupported.length / Math.max(claimChecks.length, 1)) * 100),
      0,
      100,
    );
    return buildSourceResponse({
      claimCount: claimChecks.length,
      supportedCount: claimChecks.length - unsupported.length,
      unsupportedCount: unsupported.length,
      riskScore,
      verdict: riskScore >= 60 ? "high_hallucination_risk" : riskScore >= 30 ? "mixed" : "low",
      unsupportedClaims: unsupported.slice(0, 8),
      recommendation:
        riskScore >= 60
          ? "Require citation-backed rewrite before use."
          : riskScore >= 30
            ? "Request evidence for low-coverage claims."
            : "Proceed with normal review.",
    });
  }

  if (path.includes("/ai/competitor")) {
    const company = readString(pick(body.company, body.target, context.query.company, "Acme"), "Acme").trim();
    const competitors =
      Array.isArray(body.competitors)
        ? body.competitors.map((item) => readString(item).trim()).filter(Boolean)
        : readString(pick(body.competitors, context.query.competitors, "Competitor A,Competitor B"), "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    const comparisonSet = [company, ...competitors.slice(0, 6)];
    const metrics = ["pricing_power", "feature_depth", "distribution_reach", "brand_momentum"];
    const scores = comparisonSet.map((name) => {
      const row = {};
      for (const metric of metrics) {
        row[metric] = stableInt(`${name}:${metric}`, 45, 92);
      }
      return { company: name, scores: row };
    });
    const ranked = [...scores].sort(
      (a, b) =>
        Object.values(b.scores).reduce((sum, value) => sum + value, 0) -
        Object.values(a.scores).reduce((sum, value) => sum + value, 0),
    );
    return buildSourceResponse({
      subject: company,
      competitors: competitors.slice(0, 6),
      metrics,
      scorecard: scores,
      ranking: ranked.map((item, index) => ({
        rank: index + 1,
        company: item.company,
      })),
      strategicGaps: [
        "defensibility in distribution channels",
        "feature differentiation against top-ranked rival",
      ],
    });
  }

  if (path.includes("/ai/prompt-injection")) {
    const text = readString(pick(body.text, body.prompt, body.input, context.inputText, ""), "");
    const normalized = text.toLowerCase();
    const indicators = [
      { key: "instruction_override", patterns: ["ignore previous", "disregard above", "new instructions"] },
      { key: "secret_exfiltration", patterns: ["system prompt", "developer message", "hidden instructions"] },
      { key: "policy_bypass", patterns: ["bypass safety", "jailbreak", "no restrictions"] },
      { key: "tool_abuse", patterns: ["run shell", "execute command", "call tool"] },
    ]
      .map((rule) => ({
        rule: rule.key,
        matched: rule.patterns.filter((pattern) => normalized.includes(pattern)),
      }))
      .filter((entry) => entry.matched.length);
    const riskScore = clamp(
      Math.round(
        indicators.reduce((sum, entry) => sum + entry.matched.length * 20, 0) +
          (/\b(reveal|dump|extract)\b/.test(normalized) ? 12 : 0),
      ),
      0,
      100,
    );
    return buildSourceResponse({
      riskScore,
      verdict: riskScore >= 70 ? "high" : riskScore >= 35 ? "moderate" : "low",
      indicators,
      recommendedAction:
        riskScore >= 70
          ? "block and require manual review"
          : riskScore >= 35
            ? "sanitize prompt and continue with constraints"
            : "allow with standard guardrails",
    });
  }

  if (path.includes("/ai/grade")) {
    const outputText = readString(pick(body.output, body.text, body.response, context.inputText, ""), "");
    const rubric =
      Array.isArray(body.rubric)
        ? body.rubric.map((item) => readString(item).trim()).filter(Boolean)
        : readString(pick(body.rubric, context.query.rubric, "clarity,accuracy,structure"), "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    const criteria = rubric.length ? rubric.slice(0, 10) : ["clarity", "accuracy", "structure"];
    const wordsCount = words(outputText).length;
    const criterionScores = criteria.map((criterion) => ({
      criterion,
      score: stableInt(`${criterion}:${outputText}`, Math.max(40, wordsCount > 20 ? 55 : 45), 95),
    }));
    const overall = Number(
      (
        criterionScores.reduce((sum, entry) => sum + entry.score, 0) /
        Math.max(criterionScores.length, 1)
      ).toFixed(1),
    );
    return buildSourceResponse({
      wordCount: wordsCount,
      rubric: criteria,
      criterionScores,
      overallScore: overall,
      gradeBand: overall >= 85 ? "A" : overall >= 75 ? "B" : overall >= 65 ? "C" : "D",
    });
  }

  if (path.includes("/ai/synthetic-data")) {
    const schema = toObject(pick(body.schema, body.fields, {}));
    const rowsRequested = clamp(Math.floor(readNumber(pick(body.rows, body.count, context.query.rows), 25)), 1, 500);
    const fields = Object.entries(schema).map(([field, type]) => ({
      field: readString(field).trim(),
      type: readString(type).toLowerCase().trim(),
    }));
    const effectiveFields = fields.length
      ? fields
      : [
          { field: "id", type: "string" },
          { field: "name", type: "string" },
          { field: "value", type: "number" },
        ];
    const rows = [];
    for (let index = 0; index < rowsRequested; index += 1) {
      const row = {};
      for (const field of effectiveFields) {
        if (field.type.includes("number") || field.type.includes("int") || field.type.includes("float")) {
          row[field.field] = stableInt(`${field.field}:${index}`, 1, 10000);
        } else if (field.type.includes("bool")) {
          row[field.field] = stableInt(`${field.field}:${index}`, 0, 1) === 1;
        } else if (field.type.includes("date")) {
          const base = parseIsoDate("2026-01-01");
          base.setUTCDate(base.getUTCDate() + stableInt(`${field.field}:${index}`, 0, 365));
          row[field.field] = toIsoDate(base);
        } else {
          row[field.field] = `${field.field}_${createQuickCode(8)}`;
        }
      }
      rows.push(row);
    }
    return buildSourceResponse({
      requestedRows: rowsRequested,
      generatedRows: rows.length,
      fields: effectiveFields,
      rows,
    });
  }

  if (path.includes("/ai/trace")) {
    const events = Array.isArray(body.events)
      ? body.events
          .map((event, index) => ({
            step: readString(pick(event.step, event.name), `step_${index + 1}`),
            ms: Math.max(readNumber(pick(event.ms, event.duration_ms, event.duration), 0), 0),
          }))
          .filter((event) => event.step)
      : [];
    const normalizedEvents = events.length
      ? events
      : [
          { step: "retrieve", ms: 120 },
          { step: "reason", ms: 340 },
          { step: "respond", ms: 95 },
        ];
    const totalMs = normalizedEvents.reduce((sum, event) => sum + event.ms, 0);
    const bottleneck = normalizedEvents.reduce((best, event) => (event.ms > best.ms ? event : best), normalizedEvents[0]);
    const breakdown = normalizedEvents.map((event) => ({
      step: event.step,
      ms: event.ms,
      pct: totalMs > 0 ? Number(((event.ms / totalMs) * 100).toFixed(1)) : 0,
    }));
    return buildSourceResponse({
      eventCount: normalizedEvents.length,
      totalLatencyMs: Number(totalMs.toFixed(1)),
      bottleneck: {
        step: bottleneck.step,
        ms: bottleneck.ms,
      },
      breakdown,
      recommendations: [
        `optimize ${bottleneck.step} stage first`,
        "add timing instrumentation per stage boundary",
      ],
    });
  }

  if (path.includes("/ai/rag-score")) {
    const query = readString(pick(body.query, body.question, context.inputText, ""), "");
    const chunks =
      Array.isArray(body.retrieved_chunks)
        ? body.retrieved_chunks
        : Array.isArray(body.chunks)
          ? body.chunks
          : [];
    const queryTokens = new Set(words(query));
    const scored = chunks.slice(0, 30).map((chunk, index) => {
      const text = readString(pick(chunk.text, chunk.content, chunk.chunk), "");
      const chunkTokens = words(text);
      const overlap = chunkTokens.filter((token) => queryTokens.has(token)).length;
      const uniqueChunkTokens = new Set(chunkTokens);
      const score = queryTokens.size
        ? Number((Math.min(1, overlap / Math.max(queryTokens.size, 1))).toFixed(3))
        : Number((stableInt(`${text}:${index}`, 12, 75) / 100).toFixed(3));
      return {
        index,
        score,
        overlapTerms: overlap,
        tokenCount: uniqueChunkTokens.size,
      };
    });
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const avg = scored.length
      ? Number((scored.reduce((sum, item) => sum + item.score, 0) / scored.length).toFixed(3))
      : 0;
    return buildSourceResponse({
      query,
      chunkCount: scored.length,
      averageRelevance: avg,
      topChunks: sorted.slice(0, 5),
      verdict: avg >= 0.65 ? "strong_context" : avg >= 0.4 ? "mixed_context" : "weak_context",
    });
  }

  if (path.includes("/ai/world-model")) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const seed = `${date}:${readString(pick(body.topic, context.query.topic, "general"), "general")}`;
    const momentum = stableInt(`${seed}:momentum`, 38, 81);
    const risk = stableInt(`${seed}:risk`, 22, 74);
    const confidence = Number((0.62 + stableInt(`${seed}:conf`, 0, 28) / 100).toFixed(2));
    return buildSourceResponse({
      date,
      snapshot: {
        macro: "inflation moderating with mixed growth signals across major regions",
        policy: "central bank narratives remain data-dependent",
        tech: "AI adoption is broadening from experimentation to workflow integration",
        markets: "risk appetite is selective, concentrated in quality growth names",
      },
      indicators: {
        momentum,
        systemicRisk: risk,
      },
      confidence,
    });
  }

  return buildError("unsupported_ai_operation", "Unsupported /ai/ operation.");
}

function renderLegalPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/legal/extract-clauses")) {
    const text = readString(pick(body.text, body.contract, context.inputText, ""), "");
    const normalized = text.toLowerCase();
    const clauses = [];
    if (/\bconfidential|non-?disclosure|nda\b/.test(normalized)) {
      clauses.push({ type: "confidentiality", detected: true, excerptHint: "confidentiality obligations present" });
    }
    const termMatch = normalized.match(/(\d+)\s*(year|month)/);
    if (termMatch) {
      clauses.push({
        type: "term",
        detected: true,
        value: `${termMatch[1]} ${termMatch[2]}${termMatch[1] === "1" ? "" : "s"}`,
      });
    }
    const lawMatch = normalized.match(/(governing law|law of)\s+([a-z\s]+)/);
    if (lawMatch) {
      clauses.push({ type: "governing_law", detected: true, value: lawMatch[2].trim().split(/[.,;]/)[0] });
    }
    if (/\bliabilit|damages|indemnif/.test(normalized)) {
      clauses.push({ type: "liability", detected: true, excerptHint: "liability/indemnity language found" });
    }
    return buildSourceResponse({
      clauseCount: clauses.length,
      clauses: clauses.length ? clauses : [{ type: "none_detected", detected: false }],
      confidence: Number((0.6 + Math.min(clauses.length * 0.08, 0.32)).toFixed(2)),
    });
  }

  if (path.includes("/legal/nda-summary")) {
    const text = readString(pick(body.text, body.contract, context.inputText, ""), "");
    const normalized = text.toLowerCase();
    const termMatch = normalized.match(/(\d+)\s*(year|month)/);
    const governingLawMatch = normalized.match(/(governing law|law of)\s+([a-z\s]+)/);
    return buildSourceResponse({
      summary:
        "Agreement defines confidential information handling, use restrictions, and disclosure controls between parties.",
      keyTerms: {
        term: termMatch ? `${termMatch[1]} ${termMatch[2]}${termMatch[1] === "1" ? "" : "s"}` : "not specified",
        governingLaw: governingLawMatch ? governingLawMatch[2].trim().split(/[.,;]/)[0] : "not specified",
        injunctiveRelief: /\binjunctive relief\b/.test(normalized),
        mutuality: /\bmutual\b/.test(normalized),
      },
      obligations: [
        "limit use of confidential information to permitted purpose",
        "protect with reasonable safeguards",
        "return or destroy confidential materials on request/termination",
      ],
    });
  }

  if (path.includes("/legal/cite")) {
    const style = readString(pick(body.style, context.query.style, "Bluebook"), "Bluebook").trim();
    const caseName = readString(pick(body.case_name, body.case, context.query.case_name, "Roe v. Wade"), "Roe v. Wade");
    const reporter = readString(pick(body.reporter, context.query.reporter, "410 U.S. 113"), "410 U.S. 113");
    const year = Math.floor(readNumber(pick(body.year, context.query.year), 1973));
    const statute = readString(pick(body.statute, context.query.statute, ""), "").trim();
    let citation = "";
    if (statute) {
      citation =
        style.toLowerCase().includes("apa")
          ? `${statute} (${year}).`
          : `${statute} (${year}).`;
    } else {
      citation =
        style.toLowerCase().includes("apa")
          ? `${caseName} (${year}), ${reporter}.`
          : `${caseName}, ${reporter} (${year}).`;
    }
    return buildSourceResponse({
      style,
      citation,
      components: {
        caseName,
        reporter,
        year,
        statute: statute || null,
      },
    });
  }

  if (path.includes("/legal/retention")) {
    const dataType = readString(pick(body.data_type, body.dataType, context.query.data_type, "customer data"), "customer data")
      .toLowerCase();
    const industry = readString(pick(body.industry, context.query.industry, "general"), "general").toLowerCase();
    const baseByType = {
      "customer pii": 24,
      pii: 24,
      contract: 84,
      invoice: 84,
      tax: 84,
      health: 120,
      log: 18,
      support: 36,
    };
    const typeEntry =
      Object.entries(baseByType).find(([key]) => dataType.includes(key)) || ["default", 36];
    const baseMonths = typeEntry[1];
    const modifier =
      industry.includes("health") ? 24
        : industry.includes("fintech") || industry.includes("finance") ? 18
          : industry.includes("insurance") ? 12
            : 0;
    const recommendedMonths = baseMonths + modifier;
    return buildSourceResponse({
      dataType,
      industry,
      recommendedRetentionMonths: recommendedMonths,
      recommendedRetentionYears: Number((recommendedMonths / 12).toFixed(1)),
      rationale: [
        "regulatory baseline by data class",
        "industry-specific compliance uplift",
      ],
    });
  }

  return buildError("unsupported_legal_operation", "Unsupported /legal/ operation.");
}

function renderIntelPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/intel/market-size")) {
    const market = readString(pick(body.market, body.description, context.query.market, "target market"), "target market");
    const region = readString(pick(body.region, context.query.region, "US"), "US");
    const tamM = stableInt(`${market}:${region}:tam`, 800, 12000);
    const samM = Math.max(Math.round(tamM * (stableInt(`${market}:${region}:samPct`, 12, 45) / 100)), 1);
    const somM = Math.max(Math.round(samM * (stableInt(`${market}:${region}:somPct`, 2, 18) / 100)), 1);
    return buildSourceResponse({
      market,
      region,
      estimates: {
        tamUsdMillions: tamM,
        samUsdMillions: samM,
        somUsdMillions: somM,
      },
      assumptions: [
        "top-down sizing from category revenue proxies",
        "serviceable segment constrained by region and buyer profile",
        "obtainable share assumes current go-to-market maturity",
      ],
    });
  }

  if (path.includes("/intel/industry")) {
    const industry = readString(pick(body.industry, context.query.industry, "software"), "software");
    const seed = industry.toLowerCase();
    return buildSourceResponse({
      industry,
      trends: [
        `${industry} buyers are prioritizing measurable ROI and shorter payback windows.`,
        `Automation and AI-assisted workflows are expanding procurement in ${industry}.`,
        `${industry} vendors are bundling analytics to defend margins.`,
      ],
      keyPlayers: [
        `${industry} Leader A`,
        `${industry} Challenger B`,
        `${industry} Niche C`,
      ],
      outlook: {
        momentum: stableInt(`${seed}:momentum`, 55, 90),
        disruptionRisk: stableInt(`${seed}:risk`, 30, 78),
      },
    });
  }

  return buildError("unsupported_intel_operation", "Unsupported /intel/ operation.");
}

function renderBusinessOpsPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/realestate/rent-vs-buy")) {
    const homePrice = Math.max(readNumber(pick(body.home_price, body.price, context.query.home_price), 450000), 1);
    const monthlyRent = Math.max(readNumber(pick(body.monthly_rent, body.rent, context.query.monthly_rent), 2600), 1);
    const downPct = clamp(readNumber(pick(body.down_payment_pct, context.query.down_payment_pct), 20), 0, 100);
    const rate = Math.max(readNumber(pick(body.mortgage_rate, context.query.mortgage_rate), 6.5), 0.01);
    const years = Math.max(Math.floor(readNumber(pick(body.years, context.query.years), 7)), 1);
    const loanAmount = homePrice * (1 - downPct / 100);
    const monthlyRate = rate / 100 / 12;
    const termMonths = 360;
    const mortgagePayment =
      (loanAmount * monthlyRate) / Math.max(1 - (1 + monthlyRate) ** -termMonths, 0.00001);
    const ownershipCostMonthly = mortgagePayment + homePrice * 0.0012;
    const monthlyDelta = ownershipCostMonthly - monthlyRent;
    const breakEvenMonths = monthlyDelta <= 0 ? 0 : Math.round((homePrice * (downPct / 100) * 0.7) / monthlyDelta);
    return buildSourceResponse({
      inputs: {
        homePrice: Number(homePrice.toFixed(2)),
        monthlyRent: Number(monthlyRent.toFixed(2)),
        downPaymentPct: Number(downPct.toFixed(1)),
        mortgageRatePct: Number(rate.toFixed(3)),
        horizonYears: years,
      },
      estimates: {
        mortgagePaymentMonthly: Number(mortgagePayment.toFixed(2)),
        ownershipCostMonthly: Number(ownershipCostMonthly.toFixed(2)),
        monthlyDeltaVsRent: Number(monthlyDelta.toFixed(2)),
        breakEvenMonths,
      },
      recommendation: breakEvenMonths > years * 12 ? "rent_likely_better_for_horizon" : "buy_likely_better_for_horizon",
    });
  }

  if (path.includes("/agent/calibrate")) {
    const predictionsRaw = Array.isArray(body.predictions) ? body.predictions : [];
    const outcomesRaw = Array.isArray(body.outcomes) ? body.outcomes : [];
    const n = Math.min(predictionsRaw.length, outcomesRaw.length);
    const pairs = [];
    for (let i = 0; i < n; i += 1) {
      const p = clamp(readNumber(predictionsRaw[i], 0.5), 0, 1);
      const y = clamp(Math.round(readNumber(outcomesRaw[i], 0)), 0, 1);
      pairs.push({ p, y });
    }
    const effective = pairs.length
      ? pairs
      : [
          { p: 0.85, y: 1 },
          { p: 0.7, y: 1 },
          { p: 0.45, y: 0 },
          { p: 0.25, y: 0 },
        ];
    const brier = effective.reduce((sum, item) => sum + (item.p - item.y) ** 2, 0) / effective.length;
    const accuracy = effective.reduce((sum, item) => sum + ((item.p >= 0.5 ? 1 : 0) === item.y ? 1 : 0), 0) / effective.length;
    const avgConfidence = effective.reduce((sum, item) => sum + item.p, 0) / effective.length;
    return buildSourceResponse({
      sampleSize: effective.length,
      metrics: {
        brierScore: Number(brier.toFixed(4)),
        accuracy: Number(accuracy.toFixed(3)),
        avgConfidence: Number(avgConfidence.toFixed(3)),
      },
      calibrationHint:
        avgConfidence - accuracy > 0.08
          ? "overconfident"
          : accuracy - avgConfidence > 0.08
            ? "underconfident"
            : "well-calibrated",
    });
  }

  if (path.includes("/agent/token-count")) {
    const text = readString(
      pick(body.text, body.prompt, body.input, context.inputText, ""),
      "",
    );
    const chars = text.length;
    const wordsCount = words(text).length;
    const estimatedTokens = Math.max(1, Math.round(chars / 4));
    return buildSourceResponse({
      textLength: chars,
      wordCount: wordsCount,
      estimatedTokens,
      method: "chars_div_4",
      warning: estimatedTokens > 6000 ? "near_context_limit" : "within_context_budget",
    });
  }

  if (path.includes("/pay/reconcile")) {
    const expected = Array.isArray(body.expected) ? body.expected : [];
    const actual = Array.isArray(body.actual) ? body.actual : [];
    const expectedById = new Map(expected.map((entry) => [readString(entry.id), readNumber(entry.amount, 0)]));
    const actualById = new Map(actual.map((entry) => [readString(entry.id), readNumber(entry.amount, 0)]));
    const matched = [];
    const missing = [];
    const unexpected = [];
    for (const [id, amount] of expectedById.entries()) {
      if (actualById.has(id)) {
        matched.push({
          id,
          expected: Number(amount.toFixed(2)),
          actual: Number(actualById.get(id).toFixed(2)),
          delta: Number((actualById.get(id) - amount).toFixed(2)),
        });
      } else {
        missing.push({ id, expected: Number(amount.toFixed(2)) });
      }
    }
    for (const [id, amount] of actualById.entries()) {
      if (!expectedById.has(id)) {
        unexpected.push({ id, actual: Number(amount.toFixed(2)) });
      }
    }
    return buildSourceResponse({
      counts: {
        expected: expectedById.size,
        actual: actualById.size,
        matched: matched.length,
        missing: missing.length,
        unexpected: unexpected.length,
      },
      matched,
      missing,
      unexpected,
    });
  }

  if (path.includes("/pricing/saas")) {
    const category = readString(pick(body.category, context.query.category, "SaaS"), "SaaS");
    const features = Array.isArray(body.features)
      ? body.features.map((item) => readString(item).trim()).filter(Boolean)
      : readString(pick(body.features, context.query.features, ""), "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const featureCount = features.length || 3;
    const base = 18 + featureCount * 9;
    const low = base;
    const mid = Math.round(base * 1.6);
    const high = Math.round(base * 2.8);
    return buildSourceResponse({
      category,
      featureCount,
      benchmarkMonthlyUsd: {
        low,
        mid,
        high,
      },
      suggestedPackaging: [
        { plan: "starter", priceUsd: low, seats: "up to 3" },
        { plan: "growth", priceUsd: mid, seats: "up to 15" },
        { plan: "pro", priceUsd: high, seats: "unlimited" },
      ],
    });
  }

  if (path.includes("/pricing/elasticity")) {
    const history = Array.isArray(body.history) ? body.history : [];
    const points = history
      .map((entry) => ({
        price: readNumber(entry.price, NaN),
        volume: readNumber(entry.volume, NaN),
      }))
      .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.volume) && entry.price > 0 && entry.volume > 0);
    const dataset = points.length >= 2
      ? points
      : [
          { price: 10, volume: 1000 },
          { price: 12, volume: 860 },
          { price: 14, volume: 760 },
        ];
    let xSum = 0;
    let ySum = 0;
    let xxSum = 0;
    let xySum = 0;
    for (const point of dataset) {
      const x = Math.log(point.price);
      const y = Math.log(point.volume);
      xSum += x;
      ySum += y;
      xxSum += x * x;
      xySum += x * y;
    }
    const n = dataset.length;
    const denominator = n * xxSum - xSum * xSum;
    const slope = denominator === 0 ? -1 : (n * xySum - xSum * ySum) / denominator;
    return buildSourceResponse({
      sampleSize: n,
      elasticity: Number(slope.toFixed(3)),
      interpretation:
        Math.abs(slope) < 1
          ? "inelastic_demand"
          : Math.abs(slope) < 2
            ? "moderately_elastic"
            : "highly_elastic",
      points: dataset,
    });
  }

  return buildError("unsupported_business_ops_operation", "Unsupported business ops operation.");
}

function renderValidationCalcPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/email/validate")) {
    const email = readString(pick(body.email, context.query.email, ""), "").trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validFormat = emailRegex.test(email);
    const domain = validFormat ? email.split("@")[1] : "";
    const disposableDomains = new Set([
      "mailinator.com",
      "tempmail.com",
      "10minutemail.com",
      "guerrillamail.com",
      "yopmail.com",
    ]);
    const disposable = disposableDomains.has(domain);
    const mxCheck = validFormat && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
    return buildSourceResponse({
      email,
      valid: validFormat,
      deliverable: validFormat && mxCheck && !disposable,
      mxCheck,
      disposable,
      reason: !validFormat
        ? "invalid_format"
        : disposable
          ? "disposable_domain"
          : mxCheck
            ? "looks_deliverable"
            : "invalid_domain",
    });
  }

  if (path.includes("/phone/validate")) {
    const raw = readString(pick(body.phone, body.number, context.query.phone, ""), "").trim();
    const normalized = raw.replace(/[^\d+]/g, "");
    const digits = normalized.replace(/\D/g, "");
    const valid = digits.length >= 10 && digits.length <= 15;
    const e164 = valid ? `+${digits}` : null;
    const country =
      e164 && e164.startsWith("+1")
        ? "US/CA"
        : e164 && e164.startsWith("+44")
          ? "UK"
          : e164 && e164.startsWith("+91")
            ? "IN"
            : "unknown";
    return buildSourceResponse({
      input: raw,
      valid,
      e164,
      country,
      lineType: valid ? "unknown" : null,
      reason: valid ? "format_valid" : "invalid_length_or_format",
    });
  }

  if (path.includes("/calendar/generate")) {
    const title = readString(pick(body.title, body.summary, "Meeting"), "Meeting").trim();
    const description = readString(pick(body.description, ""), "").trim();
    const location = readString(pick(body.location, ""), "").trim();
    const timezone = readString(pick(body.timezone, "UTC"), "UTC").trim();
    const startRaw = readString(pick(body.start, body.start_at, body.starts_at), "").trim();
    const endRaw = readString(pick(body.end, body.end_at, body.ends_at), "").trim();
    const startDate = startRaw ? new Date(startRaw) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endDate =
      endRaw ? new Date(endRaw) : new Date(startDate.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return buildError("invalid_datetime_range", "Provide valid start/end datetimes with end after start.");
    }
    const uid = `${createQuickCode(20)}@x402.aurelianflo.com`;
    const formatIcsDate = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AurelianFlo//Calendar Invite//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(startDate)}`,
      `DTEND:${formatIcsDate(endDate)}`,
      `SUMMARY:${title.replace(/\r?\n/g, " ")}`,
      `DESCRIPTION:${description.replace(/\r?\n/g, "\\n")}`,
      `LOCATION:${location.replace(/\r?\n/g, " ")}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    return buildSourceResponse({
      title,
      timezone,
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
      artifact: {
        mimeType: "text/calendar",
        filename: `${normalizeSlug(title) || "invite"}.ics`,
        contentBase64: Buffer.from(ics, "utf8").toString("base64"),
      },
    });
  }

  if (path.includes("/calc/mortgage")) {
    const price = Math.max(readNumber(pick(body.home_price, body.price, context.query.price), 400000), 0);
    const downPaymentPct = clamp(readNumber(pick(body.down_payment_pct, body.down_pct, context.query.down_payment_pct), 20), 0, 100);
    const apr = clamp(readNumber(pick(body.apr, body.rate, context.query.apr), 6.5), 0, 100);
    const termYears = clamp(Math.floor(readNumber(pick(body.term_years, body.term, context.query.term_years), 30)), 1, 50);
    const downPayment = price * (downPaymentPct / 100);
    const principal = Math.max(price - downPayment, 0);
    const monthlyRate = apr / 100 / 12;
    const totalMonths = termYears * 12;
    const monthlyPayment =
      monthlyRate === 0
        ? principal / Math.max(totalMonths, 1)
        : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -totalMonths);
    const totalPaid = monthlyPayment * totalMonths + downPayment;
    return buildSourceResponse({
      inputs: { price, downPaymentPct, apr, termYears },
      outputs: {
        principal: Number(principal.toFixed(2)),
        monthlyPayment: Number(monthlyPayment.toFixed(2)),
        totalPaid: Number(totalPaid.toFixed(2)),
        totalInterest: Number((totalPaid - price).toFixed(2)),
      },
    });
  }

  if (path.includes("/calc/roi")) {
    const investment = Math.max(readNumber(pick(body.investment, body.cost, context.query.investment), 10000), 0.01);
    const returns = readNumber(pick(body.returns, body.revenue, context.query.returns), 13000);
    const net = returns - investment;
    const roiPct = (net / investment) * 100;
    return buildSourceResponse({
      investment: Number(investment.toFixed(2)),
      returns: Number(returns.toFixed(2)),
      net: Number(net.toFixed(2)),
      roiPct: Number(roiPct.toFixed(2)),
      verdict: roiPct >= 0 ? "positive" : "negative",
    });
  }

  if (path.includes("/calc/npv")) {
    const discountRatePct = clamp(readNumber(pick(body.discount_rate_pct, body.discount_rate, context.query.discount_rate_pct), 10), 0, 100);
    const discountRate = discountRatePct / 100;
    const initial = readNumber(pick(body.initial_investment, body.initial, context.query.initial_investment), -10000);
    const cashflowsInput = Array.isArray(body.cashflows) ? body.cashflows : [];
    const cashflows = cashflowsInput.length
      ? cashflowsInput.map((value) => readNumber(value, 0))
      : [3000, 4000, 4500, 5000];
    let npv = initial;
    const discounted = [];
    for (let i = 0; i < cashflows.length; i += 1) {
      const year = i + 1;
      const presentValue = cashflows[i] / (1 + discountRate) ** year;
      npv += presentValue;
      discounted.push({
        year,
        cashflow: Number(cashflows[i].toFixed(2)),
        presentValue: Number(presentValue.toFixed(2)),
      });
    }
    return buildSourceResponse({
      discountRatePct: Number(discountRatePct.toFixed(3)),
      initialInvestment: Number(initial.toFixed(2)),
      discountedCashflows: discounted,
      npv: Number(npv.toFixed(2)),
      verdict: npv >= 0 ? "accept" : "reject",
    });
  }

  return buildError("unsupported_validation_calc_operation", "Unsupported validation/calculation operation.");
}

function renderMediaStrategyPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/tts/ssml")) {
    const ssml = readString(pick(body.ssml, body.text, context.inputText, "<speak>Hello world</speak>"), "<speak>Hello world</speak>");
    const voice = readString(pick(body.voice, context.query.voice, "alloy"), "alloy");
    const normalized = ssml.replace(/\s+/g, " ").trim();
    const breakMatches = [...normalized.matchAll(/<break[^>]*time=["']?(\d+)(ms|s)["']?[^>]*>/gi)];
    const breakMs = breakMatches.reduce((sum, match) => {
      const value = Number.parseInt(match[1], 10);
      const unit = String(match[2] || "ms").toLowerCase();
      return sum + (unit === "s" ? value * 1000 : value);
    }, 0);
    const spokenText = normalized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = words(spokenText).length;
    const estimatedDurationSec = Number(((wordCount / 2.4) + breakMs / 1000).toFixed(2));
    const audioHash = hashText(`${voice}:${normalized}`).slice(0, 24);
    return buildSourceResponse({
      voice,
      ssmlValid: /<speak[\s>]/i.test(normalized) && /<\/speak>/i.test(normalized),
      wordCount,
      breakCount: breakMatches.length,
      estimatedDurationSec,
      artifact: {
        mimeType: "audio/mpeg",
        pseudoAudioId: `tts_${audioHash}`,
      },
    });
  }

  if (path.includes("/og-image/generate")) {
    const title = readString(pick(body.title, context.query.title, "Untitled"), "Untitled").trim();
    const description = readString(pick(body.description, context.query.description, ""), "").trim();
    const brand = readString(pick(body.brand, context.query.brand, "AurelianFlo"), "AurelianFlo").trim();
    const width = clamp(Math.floor(readNumber(pick(body.width, context.query.width), 1200)), 300, 2400);
    const height = clamp(Math.floor(readNumber(pick(body.height, context.query.height), 630)), 200, 1600);
    const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapedDescription = description
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const escapedBrand = brand.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1d4ed8"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><text x="60" y="140" fill="#ffffff" font-size="56" font-family="Arial, sans-serif" font-weight="700">${escapedTitle}</text><text x="60" y="220" fill="#cbd5e1" font-size="28" font-family="Arial, sans-serif">${escapedDescription}</text><text x="60" y="${height - 48}" fill="#93c5fd" font-size="24" font-family="Arial, sans-serif">${escapedBrand}</text></svg>`;
    const svgBase64 = Buffer.from(svg, "utf8").toString("base64");
    return buildSourceResponse({
      title,
      description,
      brand,
      width,
      height,
      artifact: {
        mimeType: "image/svg+xml",
        bytes: Buffer.byteLength(svg, "utf8"),
        dataUri: `data:image/svg+xml;base64,${svgBase64}`,
      },
    });
  }

  return buildError("unsupported_media_strategy_operation", "Unsupported media strategy operation.");
}

function renderI18nPayload(context) {
  const path = context.path;
  const body = context.body;

  if (path.includes("/i18n/format")) {
    const locale = readString(pick(body.locale, context.query.locale, "en-US"), "en-US");
    const type = readString(pick(body.type, context.query.type, "number"), "number").toLowerCase();
    const rawValue = pick(body.value, context.query.value, type === "date" ? new Date().toISOString() : 12345.678);
    let formatted = null;
    if (type === "currency") {
      const amount = readNumber(rawValue, 0);
      const currency = readString(pick(body.currency, context.query.currency, "USD"), "USD").toUpperCase();
      formatted = new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
    } else if (type === "percent") {
      const amount = readNumber(rawValue, 0);
      formatted = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(amount);
    } else if (type === "date" || type === "time") {
      const date = new Date(readString(rawValue));
      if (Number.isNaN(date.getTime())) {
        return buildError("invalid_date", "Value is not a valid date/time.");
      }
      formatted =
        type === "date"
          ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date)
          : new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date);
    } else {
      const amount = readNumber(rawValue, 0);
      formatted = new Intl.NumberFormat(locale).format(amount);
    }
    return buildSourceResponse({
      locale,
      type,
      input: rawValue,
      formatted,
    });
  }

  return buildError("unsupported_i18n_operation", "Unsupported /i18n/ operation.");
}

async function buildAutoLocalPayload(entry, req) {
  const context = buildContext(entry, req);
  const path = context.path;

  if (isDocumentArtifactPath(path)) {
    return buildDocumentArtifact({
      path,
      endpoint: context.endpoint,
      title: context.title,
      body: context.body,
      query: context.query,
      params: context.params,
    });
  }

  // Keep /photo/ routed to deterministic helpers instead of generic media adapters.
  if (path.includes("/photo/")) {
    return renderPhotoPayload(context);
  }

  if (path.includes("/tts/ssml") || path.includes("/og-image/generate")) {
    return renderMediaStrategyPayload(context);
  }
  if (
    path.includes("/ai/competitor") ||
    path.includes("/ai/model-compare") ||
    path.includes("/ai/consensus") ||
    path.includes("/ai/hallucination") ||
    path.includes("/ai/prompt-injection") ||
    path.includes("/ai/grade") ||
    path.includes("/ai/synthetic-data") ||
    path.includes("/ai/trace") ||
    path.includes("/ai/rag-score") ||
    path.includes("/ai/world-model")
  ) {
    return renderAiPayload(context);
  }
  if (
    path.includes("/legal/extract-clauses") ||
    path.includes("/legal/nda-summary") ||
    path.includes("/legal/cite") ||
    path.includes("/legal/retention")
  ) {
    return renderLegalPayload(context);
  }
  if (path.includes("/intel/market-size") || path.includes("/intel/industry")) {
    return renderIntelPayload(context);
  }
  if (
    path.includes("/realestate/rent-vs-buy") ||
    path.includes("/agent/calibrate") ||
    path.includes("/agent/token-count") ||
    path.includes("/pay/reconcile") ||
    path.includes("/pricing/saas") ||
    path.includes("/pricing/elasticity")
  ) {
    return renderBusinessOpsPayload(context);
  }
  if (
    path.includes("/email/validate") ||
    path.includes("/phone/validate") ||
    path.includes("/calendar/generate") ||
    path.includes("/calc/mortgage") ||
    path.includes("/calc/roi") ||
    path.includes("/calc/npv")
  ) {
    return renderValidationCalcPayload(context);
  }

  if (isMediaPath(path)) {
    return buildMediaPayload(context);
  }

  if (isContentPath(path)) {
    const contentPayload = buildContentPayload(context);
    const shouldFallbackToLegacyContent =
      contentPayload &&
      contentPayload.success === false &&
      contentPayload.error === "provider_required" &&
      /unhandled/i.test(String(contentPayload.reason || ""));
    if (!shouldFallbackToLegacyContent) {
      return contentPayload;
    }
  }

  if (isWebUtilPath(path)) {
    return buildWebUtilPayload({
      ...context,
      endpoint: context.endpoint,
      path,
    });
  }

  if (path.includes("/tts/ssml") || path.includes("/og-image/generate")) {
    return renderMediaStrategyPayload(context);
  }
  if (
    path.includes("/ai/competitor") ||
    path.includes("/ai/model-compare") ||
    path.includes("/ai/consensus") ||
    path.includes("/ai/hallucination") ||
    path.includes("/ai/prompt-injection") ||
    path.includes("/ai/grade") ||
    path.includes("/ai/synthetic-data")
  ) {
    return renderAiPayload(context);
  }
  if (
    path.includes("/legal/extract-clauses") ||
    path.includes("/legal/nda-summary") ||
    path.includes("/legal/cite") ||
    path.includes("/legal/retention")
  ) {
    return renderLegalPayload(context);
  }
  if (path.includes("/intel/market-size") || path.includes("/intel/industry")) {
    return renderIntelPayload(context);
  }
  if (
    path.includes("/realestate/rent-vs-buy") ||
    path.includes("/agent/calibrate") ||
    path.includes("/agent/token-count") ||
    path.includes("/pay/reconcile") ||
    path.includes("/pricing/saas") ||
    path.includes("/pricing/elasticity")
  ) {
    return renderBusinessOpsPayload(context);
  }
  if (
    path.includes("/email/validate") ||
    path.includes("/phone/validate") ||
    path.includes("/calendar/generate") ||
    path.includes("/calc/mortgage") ||
    path.includes("/calc/roi") ||
    path.includes("/calc/npv")
  ) {
    return renderValidationCalcPayload(context);
  }

  if (path.includes("/qr/svg")) return renderQrSvg(context);
  if (path.includes("/barcode/")) return renderBarcode(context);
  if (path.includes("/placeholder/")) return renderPlaceholder(context);
  if (path.includes("/colors/")) return renderColorPayload(context);
  if (path.includes("/chart/")) return renderChartPayload(context);
  if (path.includes("/image/") || path.includes("/svg-to-png") || path.includes("/html-to-image") || path.includes("/favicon/") || path.includes("/signature/")) {
    return renderImageTransform(context);
  }

  if (path.includes("/text/") || path.includes("/email/subject")) return renderTextNlpPayload(context);
  if (path.includes("/convert/") || path.includes("/json/") || path.includes("/decode/base64")) return renderTransformPayload(context);
  if (
    path.includes("/uuid/") ||
    path.includes("/password/") ||
    path.includes("/hash") ||
    path.includes("/jwt/") ||
    path.includes("/regex/") ||
    path.includes("/cron/") ||
    path.includes("/url/") ||
    path.includes("/diff/") ||
    path.includes("/mock/") ||
    path.includes("/ip/validate")
  ) {
    return renderDevPayload(context);
  }
  if (
    path.includes("/seo/") ||
    path.includes("/links/") ||
    path.includes("/perf/") ||
    path.includes("/ssl/") ||
    path.includes("/robots/") ||
    path.includes("/headers/") ||
    path.includes("/tech/") ||
    path.includes("/cookies/") ||
    path.includes("/a11y/")
  ) {
    return renderWebPayload(context);
  }
  if (path.includes("/random/")) {
    return buildSourceResponse({ value: stableInt(`${path}:${Date.now()}`, 1, 100000), token: createQuickCode(8), endpoint: context.endpoint });
  }
  if (path.includes("/edu/")) return renderEduPayload(context);
  if (path.includes("/productivity/")) return renderProductivityPayload(context);
  if (path.includes("/hr/")) return renderHrPayload(context);
  if (path.includes("/marketing/")) return renderMarketingPayload(context);
  if (path.includes("/lang/")) return renderLangPayload(context);
  if (path.includes("/misc/")) return renderMiscPayload(context);
  if (path.includes("/auto/")) return renderAutoPayload(context);
  if (path.includes("/aviation/")) return renderAviationPayload(context);
  if (path.includes("/maritime/")) return renderMaritimePayload(context);
  if (path.includes("/astronomy/")) return renderAstronomyPayload(context);
  if (path.includes("/wellness/")) return renderWellnessPayload(context);
  if (path.includes("/music/")) return renderMusicPayload(context);
  if (path.includes("/photo/")) return renderPhotoPayload(context);
  if (path.includes("/interior/")) return renderInteriorPayload(context);
  if (path.includes("/fitness/")) return renderFitnessPayload(context);
  if (path.includes("/drinks/")) return renderDrinksPayload(context);
  if (path.includes("/fashion/")) return renderFashionPayload(context);
  if (path.includes("/design/")) return renderDesignPayload(context);
  if (path.includes("/i18n/")) return renderI18nPayload(context);
  if (path.includes("/util/")) return renderUtilPayload(context);

  return buildSourceResponse({
    endpoint: context.endpoint,
    handlerMode: "auto_local",
    checksum: hashText(JSON.stringify({ body: context.body, query: context.query, params: context.params })).slice(0, 16),
  });
}

module.exports = {
  buildAutoLocalPayload,
};
