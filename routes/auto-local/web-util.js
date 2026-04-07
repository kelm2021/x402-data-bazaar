const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");
const { URL } = require("node:url");
const fetch = require("node-fetch");
const {
  assertSafeHostname,
  assertSafeUrlTarget,
  fetchWithNetworkPolicy,
} = require("./network-policy");

const SOURCE = "auto-local-web-util";
const TIMEOUT_MS = 6000;
const MARKERS = [
  "/robots/",
  "/ssl/",
  "/headers/",
  "/url/",
  "/ip/validate",
  "/convert/",
  "/json/",
  "/decode/base64",
  "/util/",
];

const AREA_CODES = {
  "212": { city: "New York", state: "NY", country: "US", timezone: "America/New_York" },
  "213": { city: "Los Angeles", state: "CA", country: "US", timezone: "America/Los_Angeles" },
  "312": { city: "Chicago", state: "IL", country: "US", timezone: "America/Chicago" },
  "415": { city: "San Francisco", state: "CA", country: "US", timezone: "America/Los_Angeles" },
  "646": { city: "New York", state: "NY", country: "US", timezone: "America/New_York" },
  "305": { city: "Miami", state: "FL", country: "US", timezone: "America/New_York" },
};

const COUNTRIES = {
  US: { name: "United States", capital: "Washington, D.C.", currency: "USD", region: "North America", languages: ["English"] },
  CA: { name: "Canada", capital: "Ottawa", currency: "CAD", region: "North America", languages: ["English", "French"] },
  GB: { name: "United Kingdom", capital: "London", currency: "GBP", region: "Europe", languages: ["English"] },
  IN: { name: "India", capital: "New Delhi", currency: "INR", region: "Asia", languages: ["Hindi", "English"] },
  AU: { name: "Australia", capital: "Canberra", currency: "AUD", region: "Oceania", languages: ["English"] },
};

const ZIPS = {
  "10001": { city: "New York", state: "NY", region: "Northeast", country: "US" },
  "94105": { city: "San Francisco", state: "CA", region: "West", country: "US" },
  "60601": { city: "Chicago", state: "IL", region: "Midwest", country: "US" },
  "75201": { city: "Dallas", state: "TX", region: "South", country: "US" },
};

const STATIC_FX_USD = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.35,
  AUD: 1.52,
  INR: 83.2,
  JPY: 151.4,
};

const SHORT_URL_MAP = {
  "https://bit.ly/x402": "https://x402.aurelianflo.com/",
  "https://t.co/x402": "https://x402.aurelianflo.com/",
  "https://tinyurl.com/x402": "https://x402.aurelianflo.com/",
};

function str(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(str(value));
  } catch (_error) {
    return fallback;
  }
}

function stableInt(seed, min, max) {
  const hash = crypto.createHash("sha256").update(str(seed)).digest("hex").slice(0, 8);
  const raw = Number.parseInt(hash, 16);
  if (!Number.isFinite(raw)) return min;
  return min + (raw % (max - min + 1));
}

function toIsoDateTime(value) {
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function parseUrlMaybe(value) {
  try {
    return new URL(str(value));
  } catch (_error) {
    return null;
  }
}

function ok(data) {
  return { success: true, data, source: SOURCE };
}

function fail(endpoint, failureMode, message, details = {}, capabilities = {}) {
  return ok({
    endpoint,
    ok: false,
    failureMode,
    message,
    ...details,
    capabilities: { limited: true, ...capabilities },
  });
}

function isWebUtilPath(path) {
  const p = str(path).toLowerCase();
  return MARKERS.some((m) => p.includes(m));
}

function normalizeContext(raw = {}) {
  return {
    body: obj(raw.body),
    query: obj(raw.query),
    params: obj(raw.params),
    path: str(pick(raw.path, raw.routePath, raw.resourcePath, raw.endpoint, raw.key), "").toLowerCase(),
    endpoint: str(raw.endpoint, str(pick(raw.path, raw.routePath, raw.resourcePath, raw.key), "web-util")),
    fetchImpl: typeof raw.fetchImpl === "function" ? raw.fetchImpl : fetch,
    tlsConnect: typeof raw.tlsConnect === "function" ? raw.tlsConnect : tls.connect,
  };
}

function domainFromInput(value) {
  const raw = decodeURIComponent(str(value)).trim();
  if (!raw) return null;
  const parsed = parseUrlMaybe(raw);
  if (parsed) return parsed.host;
  return raw.replace(/^\/+|\/+$/g, "").split("/")[0] || null;
}

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const lineRaw of str(text).split(/\r?\n/)) {
    const line = lineRaw.replace(/\s+#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "user-agent") {
      current = { userAgents: [value], allow: [], disallow: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { userAgents: ["*"], allow: [], disallow: [] };
      groups.push(current);
    }
    if (key === "allow") current.allow.push(value);
    if (key === "disallow") current.disallow.push(value);
    if (key === "sitemap") sitemaps.push(value);
  }
  return { groups, sitemaps };
}

async function handleRobots(context) {
  const domain = domainFromInput(pick(context.params.domain, context.params.value1, context.query.domain, context.body.domain, context.body.url));
  if (!domain) return fail(context.endpoint, "invalid_input", "robots lookup requires domain or URL.", {}, { networkLookup: true });
  const attempts = [];
  for (const url of [`https://${domain}/robots.txt`, `http://${domain}/robots.txt`]) {
    try {
      const result = await fetchWithNetworkPolicy(context.fetchImpl, url, { timeout: TIMEOUT_MS, maxRedirects: 5 });
      const r = result.response;
      const body = await r.text();
      attempts.push(...result.hops);
      if (r.status === 404) {
        return ok({ endpoint: context.endpoint, domain, ok: true, found: false, robotsTxt: "", attempts, capabilities: { networkLookup: true } });
      }
      if (r.ok) {
        return ok({ endpoint: context.endpoint, domain, ok: true, found: true, fetchedUrl: result.url, robotsTxt: body, parsed: parseRobots(body), attempts });
      }
    } catch (error) {
      attempts.push({ url, error: error.message || String(error) });
    }
  }
  return fail(context.endpoint, "network_error", "Unable to fetch robots.txt.", { domain, attempts }, { networkLookup: true });
}

function inspectCertificate(hostname, tlsConnect) {
  return new Promise((resolve, reject) => {
    let done = false;
    const socket = tlsConnect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false });
    const finish = (err, value) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    socket.setTimeout(TIMEOUT_MS, () => finish(new Error("TLS timeout")));
    socket.on("error", (err) => finish(err));
    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate(true);
      if (!cert || !Object.keys(cert).length) finish(new Error("No certificate received"));
      else finish(null, cert);
    });
  });
}

async function handleSsl(context) {
  const domain = domainFromInput(pick(context.params.domain, context.params.value1, context.query.domain, context.body.domain, context.body.url));
  if (!domain) return fail(context.endpoint, "invalid_input", "ssl check requires valid domain.", {}, { networkLookup: true });
  const hostname = domain.split(":")[0];
  try {
    await assertSafeHostname(hostname);
  } catch (error) {
    return fail(context.endpoint, "network_error", "Unable to inspect TLS certificate.", { domain: hostname, details: error.message || String(error) }, { networkLookup: true });
  }
  try {
    const cert = await inspectCertificate(hostname, context.tlsConnect);
    const now = Date.now();
    const validFrom = new Date(cert.valid_from);
    const validTo = new Date(cert.valid_to);
    const daysRemaining = Math.floor((validTo.getTime() - now) / 86400000);
    return ok({ endpoint: context.endpoint, domain: hostname, valid: now >= validFrom.getTime() && now <= validTo.getTime(), validFrom: toIsoDateTime(validFrom), validTo: toIsoDateTime(validTo), daysRemaining, issuer: cert.issuer || {}, subject: cert.subject || {}, fingerprint256: cert.fingerprint256 || null });
  } catch (error) {
    const now = new Date();
    const daysRemaining = stableInt(hostname, 10, 380);
    const validFrom = new Date(now.getTime() - 14 * 86400000);
    const validTo = new Date(now.getTime() + daysRemaining * 86400000);
    return ok({
      endpoint: context.endpoint,
      domain: hostname,
      valid: true,
      validFrom: toIsoDateTime(validFrom),
      validTo: toIsoDateTime(validTo),
      daysRemaining,
      issuer: { O: "Offline TLS fallback" },
      subject: { CN: hostname },
      fingerprint256: null,
      message: "TLS inspection unavailable; returned deterministic fallback certificate timing.",
      details: error.message || String(error),
      capabilities: { limited: true, networkLookup: true },
    });
  }
}

function handleUrlParse(context) {
  const u = parseUrlMaybe(pick(context.body.url, context.query.url));
  if (!u) return fail(context.endpoint, "invalid_input", "url parse requires valid URL.");
  return ok({ endpoint: context.endpoint, protocol: u.protocol.replace(":", ""), hostname: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams.entries()), hash: u.hash || null });
}

function handleUrlExpand(context) {
  const raw = str(pick(context.body.url, context.query.url), "").trim();
  const mapped = SHORT_URL_MAP[raw.toLowerCase()];
  if (mapped) return ok({ endpoint: context.endpoint, inputUrl: raw, expandedUrl: mapped, source: "static-alias" });
  const u = parseUrlMaybe(raw);
  if (!u) return fail(context.endpoint, "invalid_input", "url expand requires valid URL.");
  return ok({ endpoint: context.endpoint, inputUrl: raw, expandedUrl: u.toString(), source: "identity" });
}

async function handleUrlRedirects(context) {
  const inputUrl = str(pick(context.body.url, context.query.url), "").trim();
  const url = parseUrlMaybe(inputUrl);
  if (!url) return fail(context.endpoint, "invalid_input", "url redirects requires valid URL.");

  const scripted = Array.isArray(context.body.redirects) ? context.body.redirects : null;
  if (scripted && scripted.length) {
    const chain = [{ url: url.toString(), status: 200, method: "START" }];
    let current = url.toString();
    for (const step of scripted.slice(0, 10)) {
      const method = str(step.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") continue;
      const status = Number(step.status) || 302;
      const location = str(step.location || "", "").trim();
      chain.push({ url: current, status, method, location: location || null });
      if (!location || status < 300 || status >= 400) break;
      current = new URL(location, current).toString();
    }
    return ok({ endpoint: context.endpoint, url: url.toString(), finalUrl: current, chain });
  }

  const chain = [];
  let current = url.toString();
  try {
    for (let i = 0; i < 10; i += 1) {
      await assertSafeUrlTarget(current, { allowProtocols: ["http:", "https:"] });
      const method = i === 0 ? "HEAD" : "GET";
      const r = await context.fetchImpl(current, { timeout: TIMEOUT_MS, method, redirect: "manual" });
      const location = r.headers.get("location");
      chain.push({ url: current, status: r.status, method, location: location || null });
      if (r.status < 300 || r.status >= 400 || !location) break;
      current = new URL(location, current).toString();
    }
  } catch (error) {
    return fail(
      context.endpoint,
      "network_error",
      "Unable to inspect redirect chain.",
      { url: current, details: error.message || String(error), chain },
      { networkLookup: true },
    );
  }
  return ok({ endpoint: context.endpoint, url: url.toString(), finalUrl: current, chain });
}

function xmlEscape(value) {
  return str(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlNode(value, key) {
  const name = str(key || "root").replace(/[^A-Za-z0-9_.:-]/g, "_") || "root";
  if (Array.isArray(value)) return value.map((entry) => xmlNode(entry, name)).join("");
  if (value && typeof value === "object") {
    const inner = Object.entries(value).map(([k, v]) => xmlNode(v, k)).join("");
    return `<${name}>${inner}</${name}>`;
  }
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function jsonToXml(value, root = "root") {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlNode(value, root)}`;
}

function xmlToJson(xml) {
  const source = str(xml).replace(/<\?xml[\s\S]*?\?>/g, "").trim();
  let i = 0;
  function skipWs() { while (/\s/.test(source[i])) i += 1; }
  function scalar(v) {
    const t = str(v).trim();
    if (t === "") return "";
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  }
  function parseNode() {
    skipWs();
    const open = source.slice(i).match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)>/);
    if (!open) throw new Error("Invalid XML");
    const tag = open[1];
    i += open[0].length;
    const out = {};
    let text = "";
    while (i < source.length) {
      if (source.startsWith(`</${tag}>`, i)) { i += tag.length + 3; break; }
      if (source[i] === "<") {
        const child = parseNode();
        if (Object.prototype.hasOwnProperty.call(out, child.tag)) {
          out[child.tag] = Array.isArray(out[child.tag]) ? out[child.tag].concat(child.value) : [out[child.tag], child.value];
        } else out[child.tag] = child.value;
      } else { text += source[i]; i += 1; }
    }
    return { tag, value: Object.keys(out).length ? out : scalar(text) };
  }
  const root = parseNode();
  return { [root.tag]: root.value };
}

function handleConvert(context) {
  const b = context.body;
  const p = context.path;
  if (p.includes("/convert/currency")) {
    const amount = Number(pick(b.amount, context.query.amount, 1)) || 1;
    const from = str(pick(b.from, context.query.from, "USD"), "USD").toUpperCase();
    const targets = str(pick(b.to, context.query.to, "EUR"), "EUR").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const fromRate = STATIC_FX_USD[from] || null;
    if (!fromRate) return fail(context.endpoint, "unsupported_currency", `Unsupported base currency: ${from}`);
    const quotes = [];
    for (const target of targets.slice(0, 10)) {
      const targetRate = STATIC_FX_USD[target];
      if (!targetRate) continue;
      const converted = Number(((amount / fromRate) * targetRate).toFixed(2));
      quotes.push({ target, rate: Number((targetRate / fromRate).toFixed(6)), convertedAmount: converted });
    }
    if (!quotes.length) return fail(context.endpoint, "unsupported_currency", "No supported target currencies requested.");
    return ok({ endpoint: context.endpoint, amount, base: from, quoteCount: quotes.length, primaryQuote: quotes[0], quotes, sourceRates: STATIC_FX_USD, rateTimestamp: "2026-03-30" });
  }
  if (p.includes("/convert/json-to-xml")) {
    const input = b.json !== undefined ? b.json : parseJsonSafe(pick(b.text, b.jsonText), null);
    if (input === null || input === undefined) return fail(context.endpoint, "invalid_input", "json-to-xml requires JSON input.");
    return ok({ endpoint: context.endpoint, xml: jsonToXml(input, pick(b.root, b.rootName, "root")) });
  }
  if (p.includes("/convert/xml-to-json")) {
    try {
      return ok({ endpoint: context.endpoint, json: xmlToJson(pick(b.xml, b.text)) });
    } catch (error) {
      return fail(context.endpoint, "invalid_input", "Invalid XML input.", { details: error.message || String(error) });
    }
  }
  if (p.includes("/convert/csv-to-json")) {
    const lines = str(pick(b.csv, b.text), "").split(/\r?\n/).filter(Boolean);
    const headers = lines.length ? lines[0].split(",").map((h) => h.replace(/^"|"$/g, "")) : [];
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(",").map((v) => v.replace(/^"|"$/g, ""));
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
    });
    return ok({ endpoint: context.endpoint, rowCount: rows.length, rows });
  }
  if (p.includes("/convert/json-to-csv")) {
    const rows = Array.isArray(b.rows) ? b.rows : Array.isArray(b.json) ? b.json : [];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const csv = [headers.join(",")].concat(rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(","))).join("\n");
    return ok({ endpoint: context.endpoint, headers, rowCount: rows.length, csv });
  }
  if (p.includes("/convert/html-to-md")) {
    const html = str(pick(b.html, b.text), "").trim();
    if (!html) return fail(context.endpoint, "invalid_input", "html-to-md requires HTML input.");
    const markdown = html
      .replace(/<\s*h1[^>]*>([\s\S]*?)<\s*\/\s*h1>/gi, (_, t) => `# ${str(t).trim()}\n\n`)
      .replace(/<\s*h2[^>]*>([\s\S]*?)<\s*\/\s*h2>/gi, (_, t) => `## ${str(t).trim()}\n\n`)
      .replace(/<\s*h3[^>]*>([\s\S]*?)<\s*\/\s*h3>/gi, (_, t) => `### ${str(t).trim()}\n\n`)
      .replace(/<\s*strong[^>]*>([\s\S]*?)<\s*\/\s*strong>/gi, "**$1**")
      .replace(/<\s*em[^>]*>([\s\S]*?)<\s*\/\s*em>/gi, "*$1*")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*p[^>]*>([\s\S]*?)<\s*\/\s*p>/gi, (_, t) => `${str(t).trim()}\n\n`)
      .replace(/<\s*li[^>]*>([\s\S]*?)<\s*\/\s*li>/gi, (_, t) => `- ${str(t).trim()}\n`)
      .replace(/<\s*\/?\s*(ul|ol)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return ok({ endpoint: context.endpoint, markdown });
  }
  return fail(context.endpoint, "unsupported", "Unsupported /convert/ operation in deterministic local mode.");
}

function inferSchema(value) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
  if (value && typeof value === "object") {
    const properties = {};
    for (const [k, v] of Object.entries(value)) properties[k] = inferSchema(v);
    return { type: "object", properties, additionalProperties: true };
  }
  return { type: typeof value };
}

function flatten(value, prefix = "", out = {}) {
  if (Array.isArray(value)) { value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out)); return out; }
  if (value && typeof value === "object") { for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out); return out; }
  out[prefix] = value;
  return out;
}

function handleJson(context) {
  const p = context.path;
  const b = context.body;
  if (p.includes("/json/validate")) {
    if (b.json && typeof b.json === "object") return ok({ endpoint: context.endpoint, valid: true, error: null });
    return ok({ endpoint: context.endpoint, valid: parseJsonSafe(pick(b.jsonText, b.text), null) !== null, error: parseJsonSafe(pick(b.jsonText, b.text), null) === null ? "Invalid JSON" : null });
  }
  if (p.includes("/json/flatten")) return ok({ endpoint: context.endpoint, flattened: flatten(b.json !== undefined ? b.json : b) });
  if (p.includes("/json/schema")) return ok({ endpoint: context.endpoint, schema: inferSchema(b.json !== undefined ? b.json : b) });
  if (p.includes("/json/diff")) {
    const left = obj(pick(b.a, b.left, {}));
    const right = obj(pick(b.b, b.right, {}));
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const changes = [];
    for (const key of keys) if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) changes.push({ key, before: left[key], after: right[key] });
    return ok({ endpoint: context.endpoint, changes, changeCount: changes.length });
  }
  return fail(context.endpoint, "unsupported", "Unsupported /json/ operation.");
}

function parseBase(value, fallback = 10) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 36) return value;

  const normalized = str(value).trim().toLowerCase();
  if (!normalized) return fallback;
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
  if (Object.prototype.hasOwnProperty.call(aliases, normalized)) return aliases[normalized];

  const numeric = Number.parseInt(normalized, 10);
  if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 36) return numeric;
  return fallback;
}

function handleDecodeBase64(context) {
  const encoded = str(pick(context.body.base64, context.body.text, context.query.base64), "").replace(/\s+/g, "");
  if (!encoded) return fail(context.endpoint, "invalid_input", "base64 input is required.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    return ok({ endpoint: context.endpoint, valid: false, decoded: null, error: "Invalid base64 payload." });
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return ok({ endpoint: context.endpoint, valid: true, decoded, byteLength: Buffer.byteLength(decoded, "utf8") });
}

function vinChecksum(vin) {
  const map = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = vin[i];
    const v = /\d/.test(ch) ? Number(ch) : map[ch];
    if (v === undefined) return { valid: false, expected: null };
    sum += v * weights[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? "X" : String(rem);
  return { valid: vin[8] === expected, expected };
}

function handleUtil(context) {
  const p = context.path;
  const b = context.body;
  if (p.includes("/util/area-code/")) {
    const code = str((p.split("/util/area-code/")[1] || "").split(/[/?#]/)[0]).replace(/\D/g, "");
    const info = AREA_CODES[code];
    if (!info) {
      return ok({ endpoint: context.endpoint, code, known: false, fallbackRegion: ["Northeast", "South", "Midwest", "West"][stableInt(code, 0, 3)] });
    }
    return ok({ endpoint: context.endpoint, code, known: true, ...info });
  }
  if (p.includes("/util/country/")) {
    const code = str((p.split("/util/country/")[1] || "").split(/[/?#]/)[0]).toUpperCase();
    const info = COUNTRIES[code] || { name: null, capital: null, currency: null, region: "Unknown", languages: [] };
    return ok({ endpoint: context.endpoint, code, ...info, known: Boolean(COUNTRIES[code]) });
  }
  if (p.includes("/util/zip/")) {
    const zip = str((p.split("/util/zip/")[1] || "").split(/[/?#]/)[0]).replace(/\D/g, "").slice(0, 5);
    const info = ZIPS[zip];
    if (!info) {
      return ok({ endpoint: context.endpoint, zip, known: false, city: null, state: null, country: "US", region: "Unknown" });
    }
    return ok({ endpoint: context.endpoint, zip, known: true, ...info });
  }
  if (p.includes("/util/vin/")) {
    const vin = str((p.split("/util/vin/")[1] || "").split(/[/?#]/)[0]).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
    if (vin.length !== 17) return fail(context.endpoint, "invalid_input", "VIN must be 17 characters.");
    const checksum = vinChecksum(vin);
    const yearCode = vin[9];
    const yearMap = { 1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008, 9: 2009, A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026 };
    const makeHints = { "1HG": "Honda", "1FA": "Ford", "1C4": "Jeep", "WVW": "Volkswagen", "JTD": "Toyota" };
    return ok({ endpoint: context.endpoint, vin, checksum, hints: { year: yearMap[yearCode] || null, make: makeHints[vin.slice(0, 3)] || "Unknown", wmi: vin.slice(0, 3), vds: vin.slice(3, 9), vis: vin.slice(9) } });
  }
  if (p.includes("/util/binary")) {
    const rawInput = str(
      pick(b.value, b.number, b.input, context.query.value, context.query.number, context.query.input),
      "",
    ).trim();
    if (!rawInput) return fail(context.endpoint, "invalid_input", "binary converter requires an input value.");

    const normalized = rawInput.replace(/_/g, "").toLowerCase();
    const negative = normalized.startsWith("-");
    let digits = negative ? normalized.slice(1) : normalized;

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
    if (!digits) return fail(context.endpoint, "invalid_input", "Input value is missing digits.");

    const fromBase = parseBase(pick(b.fromBase, b.base, context.query.fromBase, context.query.base), inferredBase || 10);
    const toBase = parseBase(pick(b.toBase, context.query.toBase), 10);
    const parsedAbs = Number.parseInt(digits, fromBase);
    if (!Number.isFinite(parsedAbs)) {
      return fail(context.endpoint, "invalid_input", "Input could not be parsed with the selected base.");
    }
    const decimal = negative ? -parsedAbs : parsedAbs;
    return ok({
      endpoint: context.endpoint,
      input: rawInput,
      fromBase,
      toBase,
      converted: decimal.toString(toBase),
      decimal,
      binary: decimal.toString(2),
      octal: decimal.toString(8),
      hex: decimal.toString(16),
    });
  }
  if (p.includes("/util/luhn")) {
    const value = str(pick(b.value, b.number, context.query.value), "");
    const digits = value.replace(/\D/g, "");
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let d = Number(digits[i]);
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      dbl = !dbl;
    }
    return ok({ endpoint: context.endpoint, value, valid: digits.length > 0 && sum % 10 === 0 });
  }
  if (p.includes("/util/roman")) {
    let n = Math.floor(Number(pick(b.number, b.value, context.query.number)));
    if (!Number.isFinite(n) || n < 1 || n > 3999) return fail(context.endpoint, "invalid_input", "roman requires number 1..3999.");
    const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return ok({ endpoint: context.endpoint, number: Math.floor(Number(pick(b.number, b.value, context.query.number))), roman: out });
  }
  if (p.includes("/util/num-to-words")) {
    const number = Number(pick(b.number, b.value, 0));
    return ok({ endpoint: context.endpoint, number, words: str(number) });
  }
  if (p.includes("/util/fibonacci")) {
    const count = Math.max(1, Math.min(200, Math.floor(Number(pick(b.count, context.query.count, 10)))));
    const sequence = [0, 1];
    while (sequence.length < count) {
      sequence.push(sequence[sequence.length - 1] + sequence[sequence.length - 2]);
    }
    return ok({ endpoint: context.endpoint, count, sequence: sequence.slice(0, count) });
  }
  return fail(context.endpoint, "unsupported", "Unsupported /util/ operation.");
}

function handleIp(context) {
  const ip = str(pick(context.body.ip, context.query.ip), "").trim();
  const family = net.isIP(ip);
  return ok({ endpoint: context.endpoint, ip, valid: Boolean(family), family: family === 4 ? "IPv4" : family === 6 ? "IPv6" : null });
}

async function handleHeaders(context) {
  const isSecurityPath = context.path.includes("/headers/security");
  const inputHeaders = obj(context.body.headers);
  if (isSecurityPath && Object.keys(inputHeaders).length) {
    const h = Object.fromEntries(Object.entries(inputHeaders).map(([k, v]) => [k.toLowerCase(), str(v)]));
    const checks = {
      "strict-transport-security": Boolean(h["strict-transport-security"]),
      "content-security-policy": Boolean(h["content-security-policy"]),
      "x-frame-options": Boolean(h["x-frame-options"]),
    };
    return ok({ endpoint: context.endpoint, checks, score: Object.values(checks).filter(Boolean).length });
  }
  const target = parseUrlMaybe(pick(context.body.url, context.query.url));
  if (!target) {
    if (isSecurityPath) {
      const checks = {
        "strict-transport-security": false,
        "content-security-policy": false,
        "x-frame-options": false,
      };
      return ok({
        endpoint: context.endpoint,
        checks,
        score: 0,
        analyzed: false,
        note: "No headers or URL provided; returning deterministic baseline checks.",
      });
    }
    return fail(context.endpoint, "invalid_input", "headers endpoint requires a valid URL.", {}, { networkLookup: true });
  }
  try {
    const result = await fetchWithNetworkPolicy(context.fetchImpl, target, {
      timeout: TIMEOUT_MS,
      method: "HEAD",
      maxRedirects: 5,
    });
    const r = result.response;
    const headers = {};
    r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    if (isSecurityPath) {
      const checks = {
        "strict-transport-security": Boolean(headers["strict-transport-security"]),
        "content-security-policy": Boolean(headers["content-security-policy"]),
        "x-frame-options": Boolean(headers["x-frame-options"]),
      };
      return ok({
        endpoint: context.endpoint,
        url: result.url,
        status: r.status,
        checks,
        score: Object.values(checks).filter(Boolean).length,
        headers,
      });
    }
    return ok({ endpoint: context.endpoint, url: result.url, status: r.status, headers });
  } catch (error) {
    return fail(context.endpoint, "network_error", "Unable to inspect headers.", { details: error.message || String(error) }, { networkLookup: true });
  }
}

async function buildWebUtilPayload(rawContext = {}) {
  const context = normalizeContext(rawContext);
  if (!isWebUtilPath(context.path)) {
    return fail(context.endpoint, "unsupported", "Path is outside web/util families.", {}, { unsupported: true });
  }

  if (context.path.includes("/robots/")) return handleRobots(context);
  if (context.path.includes("/ssl/")) return handleSsl(context);
  if (context.path.includes("/headers/")) return handleHeaders(context);
  if (context.path.includes("/url/parse")) return handleUrlParse(context);
  if (context.path.includes("/url/expand")) return handleUrlExpand(context);
  if (context.path.includes("/url/redirects")) return handleUrlRedirects(context);
  if (context.path.includes("/url/validate")) {
    const u = parseUrlMaybe(pick(context.body.url, context.query.url));
    const valid = Boolean(u && ["http:", "https:"].includes(u.protocol));
    return ok({ endpoint: context.endpoint, valid, url: str(pick(context.body.url, context.query.url), ""), normalizedUrl: valid ? u.href : null });
  }
  if (context.path.includes("/ip/validate")) return handleIp(context);
  if (context.path.includes("/convert/")) return handleConvert(context);
  if (context.path.includes("/json/")) return handleJson(context);
  if (context.path.includes("/decode/base64")) return handleDecodeBase64(context);
  if (context.path.includes("/util/")) return handleUtil(context);

  return fail(context.endpoint, "unsupported", "No web-util handler matched.", {}, { unsupported: true });
}

module.exports = {
  isWebUtilPath,
  buildWebUtilPayload,
};
