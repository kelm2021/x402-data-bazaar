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

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  return { response, payload };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();
  return { response, payload };
}

test("generated quick-win routes return computed values", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/qr/generate", { text: "https://example.com" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.qrImageUrl || ""), /^https:\/\/quickchart\.io\/qr\?/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/sentiment", { text: "great stable useful" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.score, "number");
      assert.notEqual(payload.data.status, "stub");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/translate", {
        text: "hello world",
        targetLanguage: "es",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.translatedText.toLowerCase(), "hola mundo");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/grammar", { text: "teh team dont ship late ." });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.correctedText || ""), /The team/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/readability", {
        text: "Simple writing is easier to read.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.fleschKincaidGrade, "number");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/convert/csv-to-json", {
        csv: "name,age\nAlice,30\nBob,25",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.rowCount, 2);
      assert.equal(payload.data.rows[0].name, "Alice");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/convert/md-to-html", {
        markdown: "# Title\n\n- One\n- Two",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.html || ""), /<h1>Title<\/h1>/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/encode/base64", { text: "hello" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.base64, "aGVsbG8=");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/uuid");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.uuid || ""), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/password/generate", { length: 18, complexity: "high" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.password.length, 18);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/url/shorten", {
        url: "https://x402.aurelianflo.com/pricing",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.shortUrl || ""), /^https:\/\/x402\.aurelianflo\.com\/u\//);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/slug", { text: "Hello World from x402" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.slug, "hello-world-from-x402");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/random/joke");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.joke, "string");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/random/quote?topic=strategy");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.quote, "string");
      assert.equal(typeof payload.data.author, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/marketing/hashtags", {
        topic: "x402 api marketplace",
        platform: "linkedin",
        count: 10,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.suggestions.length, 10);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/util/wordcount", {
        text: "One short sentence.\n\nSecond paragraph here.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.paragraphs, 2);
      assert.equal(payload.data.sentences, 2);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/util/date-diff", {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.signedDays, 30);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/util/age", { birthdate: "1990-01-15" });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.age.years, "number");
      assert.ok(payload.data.age.years >= 30);
    }
  });
});

