const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isMediaPath,
  buildMediaPayload,
} = require("../routes/auto-local/media-ops");

function decodeBase64Utf8(base64Text) {
  return Buffer.from(String(base64Text || ""), "base64").toString("utf8");
}

function assertSvgMarkup(text) {
  assert.match(text, /<svg[\s\S]*<\/svg>/i);
  assert.match(text, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i);
}

test("isMediaPath recognizes all auto-local media endpoint groups", () => {
  const endpoints = [
    "/api/tools/qr/svg",
    "/api/tools/barcode/code128",
    "/api/tools/image/resize",
    "/api/tools/svg-to-png",
    "/api/tools/html-to-image",
    "/api/tools/favicon/generate",
    "/api/tools/signature/create",
    "/api/tools/placeholder/320x200",
    "/api/tools/colors/extract",
    "/api/tools/chart/render",
  ];

  for (const endpoint of endpoints) {
    assert.equal(isMediaPath(endpoint), true, `Expected media path: ${endpoint}`);
  }

  assert.equal(isMediaPath("/api/tools/text/keywords"), false);
});

test("QR media payload returns valid SVG artifact content", async () => {
  const payload = await buildMediaPayload({
    path: "/api/tools/qr/svg",
    body: { text: "https://x402.aurelianflo.com", size: 320 },
    query: {},
    params: {},
  });

  assert.equal(payload.success, true);
  assert.equal(payload.source, "auto-local-engine");
  assert.equal(payload.data.artifact.mimeType, "image/svg+xml");
  assert.match(payload.data.svgDataUri, /^data:image\/svg\+xml;base64,/);

  const svgText = decodeBase64Utf8(payload.data.artifact.contentBase64);
  assertSvgMarkup(svgText);
  assert.match(svgText, /aria-label="QR code"/);
});

test("Placeholder media payload returns valid SVG artifact content", async () => {
  const payload = await buildMediaPayload({
    path: "/api/tools/placeholder/320x200",
    body: {},
    query: { text: "demo" },
    params: { size: "320x200" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.width, 320);
  assert.equal(payload.data.height, 200);
  assert.equal(payload.data.artifact.mimeType, "image/svg+xml");

  const svgText = decodeBase64Utf8(payload.data.artifact.contentBase64);
  assertSvgMarkup(svgText);
  assert.match(svgText, />demo</);
});

test("Barcode media payload returns valid SVG artifact content", async () => {
  const payload = await buildMediaPayload({
    path: "/api/tools/barcode/code128",
    body: { value: "123456789012", type: "code128" },
    query: {},
    params: {},
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.value, "123456789012");
  assert.equal(payload.data.format, "code128");
  assert.equal(payload.data.artifact.mimeType, "image/svg+xml");

  const svgText = decodeBase64Utf8(payload.data.artifact.contentBase64);
  assertSvgMarkup(svgText);
  assert.match(svgText, /aria-label="Barcode"/);
});

