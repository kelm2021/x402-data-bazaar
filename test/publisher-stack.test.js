const assert = require("node:assert/strict");
const test = require("node:test");
const fetch = require("node-fetch");

const { createApp } = require("../app");

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
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

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();
  return { response, payload };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  return { response, payload };
}

function createFreeApp() {
  return createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });
}

test("publisher stack article and search endpoints return structured corpus results", async () => {
  const app = createFreeApp();

  await withServer(app, async (baseUrl) => {
    const article = await getJson(baseUrl, "/api/data/content/article/agentic-commerce-primer");
    const markdown = await getJson(baseUrl, "/api/data/content/article/agentic-commerce-primer/markdown");
    const structured = await getJson(baseUrl, "/api/data/content/article/agentic-commerce-primer/structured");
    const citations = await getJson(baseUrl, "/api/data/content/article/agentic-commerce-primer/citations");
    const entities = await getJson(baseUrl, "/api/data/content/article/agentic-commerce-primer/entities");
    const search = await getJson(baseUrl, "/api/data/content/search?q=agentic%20commerce");
    const corpusSearch = await getJson(baseUrl, "/api/data/content/corpus/search?q=wallet%20routing");

    assert.equal(article.response.status, 200);
    assert.equal(article.payload.success, true);
    assert.equal(article.payload.data.article.slug, "agentic-commerce-primer");
    assert.equal(article.payload.data.article.author.slug, "kent-egan");
    assert.ok(Array.isArray(article.payload.data.article.topics));
    assert.ok(article.payload.data.article.topics.includes("agent-commerce"));

    assert.equal(markdown.response.status, 200);
    assert.equal(markdown.payload.success, true);
    assert.match(String(markdown.payload.data.markdown || ""), /# Agentic Commerce Primer/);
    assert.ok(markdown.payload.data.readingTimeMinutes >= 1);

    assert.equal(structured.response.status, 200);
    assert.equal(structured.payload.success, true);
    assert.ok(Array.isArray(structured.payload.data.sections));
    assert.ok(structured.payload.data.sections.length >= 3);
    assert.equal(structured.payload.data.article.slug, "agentic-commerce-primer");

    assert.equal(citations.response.status, 200);
    assert.equal(citations.payload.success, true);
    assert.ok(Array.isArray(citations.payload.data.citations));
    assert.ok(citations.payload.data.citations.length >= 2);

    assert.equal(entities.response.status, 200);
    assert.equal(entities.payload.success, true);
    assert.ok(Array.isArray(entities.payload.data.entities));
    assert.ok(entities.payload.data.entities.some((entity) => entity.value === "Cloudflare"));

    assert.equal(search.response.status, 200);
    assert.equal(search.payload.success, true);
    assert.ok(Array.isArray(search.payload.data.results));
    assert.equal(search.payload.data.results[0].slug, "agentic-commerce-primer");

    assert.equal(corpusSearch.response.status, 200);
    assert.equal(corpusSearch.payload.success, true);
    assert.ok(Array.isArray(corpusSearch.payload.data.chunks));
    assert.ok(corpusSearch.payload.data.chunks.length >= 1);
    assert.match(String(corpusSearch.payload.data.chunks[0].text || ""), /wallet/i);
  });
});

test("publisher stack topic and author collections group articles into agent-buyable bundles", async () => {
  const app = createFreeApp();

  await withServer(app, async (baseUrl) => {
    const topic = await getJson(baseUrl, "/api/data/content/topic/agent-commerce");
    const author = await getJson(baseUrl, "/api/data/content/author/kent-egan");

    assert.equal(topic.response.status, 200);
    assert.equal(topic.payload.success, true);
    assert.equal(topic.payload.data.topic.slug, "agent-commerce");
    assert.ok(Array.isArray(topic.payload.data.articles));
    assert.ok(topic.payload.data.articles.length >= 2);

    assert.equal(author.response.status, 200);
    assert.equal(author.payload.success, true);
    assert.equal(author.payload.data.author.slug, "kent-egan");
    assert.ok(Array.isArray(author.payload.data.articles));
    assert.ok(author.payload.data.articles.length >= 2);
  });
});

test("publisher stack tools convert a content selection into dataset, faq, and chunk outputs", async () => {
  const app = createFreeApp();

  await withServer(app, async (baseUrl) => {
    const dataset = await postJson(baseUrl, "/api/tools/content/to-dataset", {
      slugs: ["agentic-commerce-primer", "publisher-mcp-blueprint"],
      format: "csv",
      fields: ["slug", "title", "author", "publishedAt", "summary"],
    });
    const faq = await postJson(baseUrl, "/api/tools/content/extract-faq", {
      slug: "publisher-mcp-blueprint",
      count: 4,
    });
    const chunks = await postJson(baseUrl, "/api/tools/content/chunk-and-tag", {
      slug: "agentic-commerce-primer",
      chunkSize: 220,
    });

    assert.equal(dataset.response.status, 200);
    assert.equal(dataset.payload.success, true);
    assert.equal(dataset.payload.data.format, "csv");
    assert.equal(dataset.payload.data.rowCount, 2);
    assert.match(String(dataset.payload.data.csv || ""), /slug,title,author,publishedAt,summary/);

    assert.equal(faq.response.status, 200);
    assert.equal(faq.payload.success, true);
    assert.ok(Array.isArray(faq.payload.data.items));
    assert.equal(faq.payload.data.items.length, 4);
    assert.ok(faq.payload.data.items.every((item) => item.question && item.answer));

    assert.equal(chunks.response.status, 200);
    assert.equal(chunks.payload.success, true);
    assert.ok(Array.isArray(chunks.payload.data.chunks));
    assert.ok(chunks.payload.data.chunks.length >= 2);
    assert.ok(chunks.payload.data.chunks.every((chunk) => Array.isArray(chunk.tags)));
  });
});

test("publisher stack routes are exposed through discovery with canonical content surfaces", async () => {
  const app = createFreeApp();

  await withServer(app, async (baseUrl) => {
    const discovery = await getJson(baseUrl, "/api/system/discovery/full?limit=500");
    const openapi = await getJson(baseUrl, "/openapi-full.json");

    const articleEntry = discovery.payload.catalog.find((entry) => entry.routeKey === "GET /api/data/content/article/*");
    const datasetEntry = discovery.payload.catalog.find((entry) => entry.routeKey === "POST /api/tools/content/to-dataset");

    assert.equal(discovery.response.status, 200);
    assert.ok(articleEntry);
    assert.equal(articleEntry.surface, "data");
    assert.equal(articleEntry.exampleUrl, "https://x402.aurelianflo.com/api/data/content/article/agentic-commerce-primer");
    assert.ok(datasetEntry);
    assert.equal(datasetEntry.surface, "tools");
    assert.equal(datasetEntry.exampleUrl, "https://x402.aurelianflo.com/api/tools/content/to-dataset");

    assert.equal(openapi.response.status, 200);
    assert.ok(openapi.payload.paths["/api/data/content/article/{param1}"]?.get);
    assert.ok(openapi.payload.paths["/api/tools/content/to-dataset"]?.post);
  });
});
