const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { writePublisherPack } = require("../lib/publisher-stack-pack");

test("writePublisherPack emits corpus file, wrapped registration manifest, and runtime env file", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-pack-"));
  const result = writePublisherPack({
    outputDir,
    document: {
      corpus: {
        name: "Pack Test",
        description: "Pack description",
        articles: [
          {
            slug: "pack-test",
            title: "Pack Test",
            summary: "Summary",
            author: { name: "Kent Egan", slug: "kent-egan" },
            topics: ["publisher-stack"],
            citations: [],
            sections: [{ heading: "Body", markdown: "Body" }],
          }
        ],
      },
      distribution: {
        wrapped: {
          originUrl: "https://publisher.example.com",
          paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
          price: "0.07",
          pathPattern: "/content/*",
        }
      }
    }
  });

  assert.ok(fs.existsSync(result.files.corpus));
  assert.ok(fs.existsSync(result.files.runtimeEnv));
  assert.ok(fs.existsSync(result.files.manifest));
  assert.ok(fs.existsSync(result.files.wrappedRegistration));

  const runtimeEnv = fs.readFileSync(result.files.runtimeEnv, "utf8");
  assert.match(runtimeEnv, /PUBLISHER_STACK_CORPUS_PATH=\.\/publisher-corpus\.json/);

  const wrapped = JSON.parse(fs.readFileSync(result.files.wrappedRegistration, "utf8"));
  assert.equal(wrapped.originUrl, "https://publisher.example.com");
  assert.equal(wrapped.pathPattern, "/content/*");
});
