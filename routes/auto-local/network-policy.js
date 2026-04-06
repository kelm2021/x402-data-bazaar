const dns = require("node:dns").promises;
const net = require("node:net");
const { URL } = require("node:url");

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

function normalizeHostname(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!raw) {
    return "";
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isPrivateIpv4(address) {
  const parts = String(address).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }
  if (first >= 224) {
    return true;
  }
  return false;
}

function isPrivateIpv6(address) {
  const normalized = normalizeHostname(address);
  if (!normalized) {
    return false;
  }
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  if (normalized.startsWith("ff")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isPrivateIpAddress(address) {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4) {
    return isPrivateIpv4(normalized);
  }
  if (family === 6) {
    return isPrivateIpv6(normalized);
  }
  return false;
}

async function assertSafeHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("blocked_private_host");
  }
  if (BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost")) {
    throw new Error("blocked_private_host");
  }
  if (isPrivateIpAddress(normalized)) {
    throw new Error("blocked_private_host");
  }

  try {
    const addresses = await dns.lookup(normalized, { all: true, verbatim: true });
    if (Array.isArray(addresses) && addresses.some((entry) => entry && isPrivateIpAddress(entry.address))) {
      throw new Error("blocked_private_host");
    }
  } catch (error) {
    if (error && error.message === "blocked_private_host") {
      throw error;
    }
  }

  return normalized;
}

async function assertSafeUrlTarget(value, options = {}) {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ""));
  const allowProtocols = Array.isArray(options.allowProtocols) && options.allowProtocols.length
    ? options.allowProtocols
    : ["http:", "https:"];
  if (!allowProtocols.includes(url.protocol)) {
    throw new Error("unsupported_protocol");
  }
  await assertSafeHostname(url.hostname);
  return url;
}

async function fetchWithNetworkPolicy(fetchImpl, value, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;
  const allowProtocols = Array.isArray(options.allowProtocols) && options.allowProtocols.length
    ? options.allowProtocols
    : ["http:", "https:"];
  const requestOptions = { ...options };
  delete requestOptions.maxRedirects;
  delete requestOptions.allowProtocols;

  let current = await assertSafeUrlTarget(value, { allowProtocols });
  const hops = [];

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current.toString(), {
      ...requestOptions,
      redirect: "manual",
    });
    const location = response.headers && typeof response.headers.get === "function"
      ? response.headers.get("location")
      : null;
    hops.push({
      url: current.toString(),
      status: Number(response.status) || 0,
      location: location || null,
    });
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirectCount === maxRedirects) {
        throw new Error("too_many_redirects");
      }
      current = await assertSafeUrlTarget(new URL(location, current), { allowProtocols });
      continue;
    }
    return {
      response,
      url: current.toString(),
      hops,
    };
  }

  throw new Error("too_many_redirects");
}

module.exports = {
  assertSafeHostname,
  assertSafeUrlTarget,
  fetchWithNetworkPolicy,
};
