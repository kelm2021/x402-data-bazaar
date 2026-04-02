const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { isWebUtilPath, buildWebUtilPayload } = require("../routes/auto-local/web-util");

function withHttpServer(handler, run) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        const result = await run(address.port);
        server.close((err) => (err ? reject(err) : resolve(result)));
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

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
  await withHttpServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /private\n");
      return;
    }
    res.writeHead(404);
    res.end("");
  }, async (port) => {
    const payload = await buildWebUtilPayload({
      path: "/api/tools/robots/*",
      endpoint: "GET /api/tools/robots/*",
      params: { domain: `127.0.0.1:${port}` },
    });

    assert.equal(payload.success, true);
    assert.equal(payload.data.ok, true);
    assert.equal(payload.data.found, true);
    assert.match(String(payload.data.robotsTxt || ""), /User-agent:\s*\*/);
    assert.ok(Array.isArray(payload.data.attempts));
    assert.ok(payload.data.attempts.length >= 1);
  });
});

test("robots lookup returns explicit network failure mode when unreachable", async () => {
  const payload = await buildWebUtilPayload({
    path: "/api/tools/robots/*",
    endpoint: "GET /api/tools/robots/*",
    params: { domain: "127.0.0.1:1" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.ok, false);
  assert.equal(payload.data.failureMode, "network_error");
  assert.equal(payload.data.capabilities.limited, true);
  assert.equal(payload.data.capabilities.networkLookup, true);
});

