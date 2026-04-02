const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { importMarkdownCorpus, importWordpressWxr, importEmdashExport, importBeehiivExport } = require("../lib/publisher-stack-import");

// existing tests omitted for brevity in this command rewrite.

test("importMarkdownCorpus converts markdown files into publisher corpus and wrapped launch metadata", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-import-"));
  fs.writeFileSync(
    path.join(tempDir, "agentic-commerce-primer.md"),
    `---
slug: agentic-commerce-primer
summary: A practical overview of agent-paid publishing.
author: Kent Egan
authorSlug: kent-egan
publishedAt: 2026-04-01
topics:
  - agent-commerce
  - x402
---
# Agentic Commerce Primer

Agents can buy content directly when the API surface is structured for them.

## Why it matters

Cloudflare and x402 make payment-native content possible.

See [Introducing EmDash](https://blog.cloudflare.com/emdash-wordpress/).
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(tempDir, "publisher-mcp-blueprint.md"),
    `# Publisher MCP Blueprint

A second article without front matter.

## Operations

Use MCP tools to search, retrieve, and export content.
`,
    "utf8",
  );

  const result = importMarkdownCorpus({
    inputDir: tempDir,
    corpusName: "Publisher Demo Corpus",
    corpusDescription: "Imported from markdown files.",
    defaultAuthorName: "AurelianFlo",
    defaultAuthorSlug: "aurelianflo",
    wrapped: {
      originUrl: "https://publisher.example.com",
      paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
      price: "0.03",
      pathPattern: "/content/*",
    },
  });

  assert.equal(result.corpus.name, "Publisher Demo Corpus");
  assert.equal(result.corpus.articles.length, 2);

  const primer = result.corpus.articles.find((article) => article.slug === "agentic-commerce-primer");
  assert.ok(primer);
  assert.equal(primer.title, "Agentic Commerce Primer");
  assert.equal(primer.author.name, "Kent Egan");
  assert.deepEqual(primer.topics, ["agent-commerce", "x402"]);
  assert.ok(Array.isArray(primer.sections));
  assert.ok(primer.sections.some((section) => section.heading === "Why it matters"));
  assert.ok(Array.isArray(primer.citations));
  assert.equal(primer.citations[0].url, "https://blog.cloudflare.com/emdash-wordpress/");

  const blueprint = result.corpus.articles.find((article) => article.slug === "publisher-mcp-blueprint");
  assert.ok(blueprint);
  assert.equal(blueprint.author.slug, "aurelianflo");
  assert.equal(blueprint.summary, "A second article without front matter.");

  assert.deepEqual(result.distribution.wrapped, {
    originUrl: "https://publisher.example.com",
    paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
    price: "0.03",
    pathPattern: "/content/*",
  });
});

test("importWordpressWxr converts published WordPress posts into corpus articles", async () => {
  const tempFile = path.join(os.tmpdir(), `publisher-wxr-${Date.now()}.xml`);
  fs.writeFileSync(
    tempFile,
    `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Publisher Site</title>
    <description>Premium research archive</description>
    <item>
      <title>Agent Markets Weekly</title>
      <link>https://publisher.example.com/agent-markets-weekly</link>
      <pubDate>Tue, 01 Apr 2026 12:00:00 +0000</pubDate>
      <dc:creator><![CDATA[Kent Egan]]></dc:creator>
      <category domain="category" nicename="agent-commerce"><![CDATA[Agent Commerce]]></category>
      <category domain="post_tag" nicename="x402"><![CDATA[x402]]></category>
      <content:encoded><![CDATA[<p>Agents are starting to pay for premium research.</p><h2>Evidence</h2><p>See <a href="https://blog.cloudflare.com/emdash-wordpress/">Cloudflare EmDash</a>.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[Weekly update on paid agent markets.]]></excerpt:encoded>
      <wp:post_name>agent-markets-weekly</wp:post_name>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
    </item>
    <item>
      <title>Ignored Draft</title>
      <wp:post_name>ignored-draft</wp:post_name>
      <wp:post_type>post</wp:post_type>
      <wp:status>draft</wp:status>
      <content:encoded><![CDATA[<p>Draft body</p>]]></content:encoded>
    </item>
  </channel>
</rss>`,
    "utf8",
  );

  const result = importWordpressWxr({
    inputFile: tempFile,
    defaultAuthorSlug: "kent-egan",
    wrapped: {
      originUrl: "https://publisher.example.com",
      paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
      price: "0.04",
      pathPattern: "/posts/*",
    },
  });

  assert.equal(result.corpus.name, "Publisher Site");
  assert.equal(result.corpus.description, "Premium research archive");
  assert.equal(result.corpus.articles.length, 1);

  const article = result.corpus.articles[0];
  assert.equal(article.slug, "agent-markets-weekly");
  assert.equal(article.title, "Agent Markets Weekly");
  assert.equal(article.summary, "Weekly update on paid agent markets.");
  assert.equal(article.author.name, "Kent Egan");
  assert.equal(article.author.slug, "kent-egan");
  assert.ok(article.topics.includes("agent-commerce"));
  assert.ok(article.topics.includes("x402"));
  assert.ok(article.sections.some((section) => section.heading === "Evidence"));
  assert.equal(article.citations[0].url, "https://blog.cloudflare.com/emdash-wordpress/");

  assert.deepEqual(result.distribution.wrapped, {
    originUrl: "https://publisher.example.com",
    paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
    price: "0.04",
    pathPattern: "/posts/*",
  });
});

test("importEmdashExport converts EmDash export JSON into corpus articles", async () => {
  const tempFile = path.join(os.tmpdir(), `publisher-emdash-${Date.now()}.json`);
  fs.writeFileSync(
    tempFile,
    JSON.stringify({
      site: {
        title: "EmDash Publisher",
        description: "Managed in EmDash",
      },
      posts: [
        {
          slug: "emdash-launch-note",
          title: "EmDash Launch Note",
          excerpt: "EmDash ships built-in x402 for paid content.",
          author: {
            name: "Kent Egan",
            slug: "kent-egan",
          },
          publishedAt: "2026-04-01",
          tags: ["emdash", "x402"],
          markdown: "# EmDash Launch Note\n\nAgents can pay for access.\n\n## Why it matters\n\nSee [Cloudflare](https://blog.cloudflare.com/emdash-wordpress/).",
        }
      ]
    }, null, 2),
    "utf8",
  );

  const result = importEmdashExport({
    inputFile: tempFile,
    wrapped: {
      originUrl: "https://publisher.example.com",
      paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
      price: "0.05",
      pathPattern: "/api/content/*",
    },
  });

  assert.equal(result.corpus.name, "EmDash Publisher");
  assert.equal(result.corpus.description, "Managed in EmDash");
  assert.equal(result.corpus.articles.length, 1);
  const article = result.corpus.articles[0];
  assert.equal(article.slug, "emdash-launch-note");
  assert.equal(article.author.slug, "kent-egan");
  assert.ok(article.topics.includes("emdash"));
  assert.ok(article.topics.includes("x402"));
  assert.ok(article.sections.some((section) => section.heading === "Why it matters"));
  assert.equal(article.citations[0].url, "https://blog.cloudflare.com/emdash-wordpress/");
});

test("importBeehiivExport converts Beehiiv export JSON into corpus articles", async () => {
  const tempFile = path.join(os.tmpdir(), `publisher-beehiiv-${Date.now()}.json`);
  fs.writeFileSync(
    tempFile,
    JSON.stringify({
      publication: {
        id: "pub_demo",
        name: "The Saliba Signal",
        description: "Institutional insight on tokenization and adoption.",
      },
      posts: [
        {
          id: "post_demo",
          title: "What I'm Watching This Week",
          subtitle: "Three separate trends that aren't actually separate.",
          slug: "what-i-m-watching-this-week",
          status: "published",
          url: "https://saliba-signal.beehiiv.com/p/what-i-m-watching-this-week",
          created_at: "2026-03-27T19:05:54Z",
          updated_at: "2026-03-27T20:02:03Z",
          content_text: "I've been trading long enough to recognize when separate trends start moving together.\n\nView image: (https://example.com/image.png)\nCaption:\n\n## Tokenization Infrastructure Going Live\n\nBlackRock's BUIDL fund crossed $2 billion in assets this month.\n\nSee [Cloudflare EmDash](https://blog.cloudflare.com/emdash-wordpress/).\n\n----------\nAll the best,\nTony\n\nYou are reading a plain text version of this post. For the best experience, copy and paste this link in your browser to view the post online:\nhttps://saliba-signal.beehiiv.com/p/what-i-m-watching-this-week",
        }
      ]
    }, null, 2),
    "utf8",
  );

  const result = importBeehiivExport({
    inputFile: tempFile,
    defaultAuthorName: "Tony Saliba",
    defaultAuthorSlug: "tony-saliba",
    wrapped: {
      originUrl: "https://saliba-signal.beehiiv.com",
      paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
      price: "0.05",
      pathPattern: "/p/*",
    },
  });

  assert.equal(result.corpus.name, "The Saliba Signal");
  assert.equal(result.corpus.description, "Institutional insight on tokenization and adoption.");
  assert.equal(result.corpus.articles.length, 1);
  const article = result.corpus.articles[0];
  assert.equal(article.slug, "what-i-m-watching-this-week");
  assert.equal(article.author.slug, "tony-saliba");
  assert.equal(article.summary, "Three separate trends that aren't actually separate.");
  assert.ok(article.topics.includes("tokenization-infrastructure-going-live"));
  assert.ok(article.sections.some((section) => section.heading === "Tokenization Infrastructure Going Live"));
  assert.equal(article.citations[0].url, "https://blog.cloudflare.com/emdash-wordpress/");
  assert.ok(!article.sections.some((section) => /View image/i.test(section.markdown)));
  assert.ok(!article.sections.some((section) => /plain text version/i.test(section.markdown)));
  assert.deepEqual(result.distribution.wrapped, {
    originUrl: "https://saliba-signal.beehiiv.com",
    paymentWallet: "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d",
    price: "0.05",
    pathPattern: "/p/*",
  });
});
