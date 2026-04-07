const assert = require("node:assert/strict");
const test = require("node:test");

const { isWebUtilPath, buildWebUtilPayload } = require("../routes/auto-local/web-util");

test("isWebUtilPath identifies supported families", () => {
  assert.equal(isWebUtilPath("/api/tools/convert/json-to-xml"), true);
  assert.equal(isWebUtilPath("/api/tools/robots/example.com"), true);
  assert.equal(isWebUtilPath("/api/holidays/today/US"), false);
});

test("convert json-to-xml and xml-to-json roundtrip", async () => {
  const toXml = await buildWebUtilPayload({
    path: "/api/tools/convert/json-to-xml",
    endpoint: "POST /api/tools/convert/json-to-xml",
    body: {
      root: "person",
      json: {
        name: "Alice",
        age: 30,
        active: true,
      },
    },
  });

  assert.equal(toXml.success, true);
  assert.match(String(toXml.data.xml || ""), /<person>/);
  assert.match(String(toXml.data.xml || ""), /<name>Alice<\/name>/);

  const toJson = await buildWebUtilPayload({
    path: "/api/tools/convert/xml-to-json",
    endpoint: "POST /api/tools/convert/xml-to-json",
    body: {
      xml: toXml.data.xml,
    },
  });

  assert.equal(toJson.success, true);
  assert.equal(toJson.data.json.person.name, "Alice");
  assert.equal(toJson.data.json.person.age, 30);
  assert.equal(toJson.data.json.person.active, true);
});

test("url validate returns true for valid URLs and false for invalid", async () => {
  const valid = await buildWebUtilPayload({
    path: "/api/tools/url/validate",
    endpoint: "POST /api/tools/url/validate",
    body: { url: "https://example.com/path?x=1" },
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.valid, true);

  const invalid = await buildWebUtilPayload({
    path: "/api/tools/url/validate",
    endpoint: "POST /api/tools/url/validate",
    body: { url: "not a url" },
  });
  assert.equal(invalid.success, true);
  assert.equal(invalid.data.valid, false);
});

test("util luhn validates known valid and invalid values", async () => {
  const knownValid = await buildWebUtilPayload({
    path: "/api/tools/util/luhn",
    endpoint: "POST /api/tools/util/luhn",
    body: { value: "4539578763621486" },
  });
  assert.equal(knownValid.success, true);
  assert.equal(knownValid.data.valid, true);

  const knownInvalid = await buildWebUtilPayload({
    path: "/api/tools/util/luhn",
    endpoint: "POST /api/tools/util/luhn",
    body: { value: "4539578763621487" },
  });
  assert.equal(knownInvalid.success, true);
  assert.equal(knownInvalid.data.valid, false);
});

test("robots lookup falls back from https to http and succeeds", async () => {
  const payload = await buildWebUtilPayload({
    path: "/api/tools/robots/*",
    endpoint: "GET /api/tools/robots/*",
    params: { domain: "example.com" },
    fetchImpl: async (url) => {
      if (String(url).startsWith("https://")) {
        throw new Error("tls_failed");
      }
      return {
        ok: true,
        status: 200,
        url: String(url),
        text: async () => "User-agent: *\nDisallow: /private\n",
      };
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.ok, true);
  assert.equal(payload.data.found, true);
  assert.match(String(payload.data.robotsTxt || ""), /User-agent:\s*\*/);
  assert.ok(Array.isArray(payload.data.attempts));
  assert.ok(payload.data.attempts.length >= 1);
});

test("robots lookup returns explicit network failure mode when unreachable", async () => {
  const payload = await buildWebUtilPayload({
    path: "/api/tools/robots/*",
    endpoint: "GET /api/tools/robots/*",
    params: { domain: "example.com" },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.ok, false);
  assert.equal(payload.data.failureMode, "network_error");
  assert.equal(payload.data.capabilities.limited, true);
  assert.equal(payload.data.capabilities.networkLookup, true);
});

test("robots lookup blocks loopback targets before issuing a fetch", async () => {
  let called = false;
  const payload = await buildWebUtilPayload({
    path: "/api/tools/robots/*",
    endpoint: "GET /api/tools/robots/*",
    params: { domain: "127.0.0.1:8080" },
    fetchImpl: async () => {
      called = true;
      throw new Error("should_not_fetch");
    },
  });

  assert.equal(called, false);
  assert.equal(payload.success, true);
  assert.equal(payload.data.ok, false);
  assert.equal(payload.data.failureMode, "network_error");
  assert.match(String(payload.data.message || ""), /Unable to fetch robots\.txt/i);
  assert.ok(Array.isArray(payload.data.attempts));
  assert.ok(payload.data.attempts.every((attempt) => String(attempt.error || "").includes("blocked_private_host")));
});

test("ssl lookup returns deterministic certificate timing when network inspection fails", async () => {
  const payload = await buildWebUtilPayload({
    path: "/api/tools/ssl/check/example.com",
    endpoint: "GET /api/tools/ssl/check/*",
    params: { domain: "example.com" },
    tlsConnect: () => {
      throw new Error("offline");
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.domain, "example.com");
  assert.equal(typeof payload.data.daysRemaining, "number");
  assert.equal(typeof payload.data.validTo, "string");
  assert.equal(payload.data.capabilities?.limited, true);
  assert.equal(payload.data.capabilities?.networkLookup, true);
});

