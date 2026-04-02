const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fetch = require("node-fetch");

const { createApp } = require("../app");

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => closeErr ? reject(closeErr) : resolve(result));
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

test("publisher stack runtime can load directly from EmDash export path via app env", async () => {
  const tempFile = path.join(os.tmpdir(), `publisher-runtime-emdash-${Date.now()}.json`);
  fs.writeFileSync(
    tempFile,
    JSON.stringify({
      site: { title: "Runtime EmDash", description: "Runtime source" },
      posts: [{
        slug: "runtime-note",
        title: "Runtime Note",
        excerpt: "Loaded from EmDash export path.",
        author: { name: "Kent Egan", slug: "kent-egan" },
        markdown: "# Runtime Note\n\nLoaded from source file.",
      }]
    }, null, 2),
    "utf8",
  );

  const app = createApp({
    env: { PUBLISHER_STACK_EMDASH_EXPORT_PATH: tempFile },
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/data/content/article/runtime-note`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.article.slug, "runtime-note");
  });
});
