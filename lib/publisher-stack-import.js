const fs = require("node:fs");
const path = require("node:path");

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseScalar(value) {
  const text = stripQuotes(value);
  if (!text) {
    return "";
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  return text;
}

function parseFrontMatter(source) {
  const text = String(source || "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { data: {}, body: text };
  }

  const lines = text.split(/\r?\n/);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { data: {}, body: text };
  }

  const data = {};
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index];
    if (!line || !line.trim()) {
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }
    const [, key, rawValue] = keyMatch;
    if (rawValue.trim()) {
      data[key] = parseScalar(rawValue);
      continue;
    }

    const items = [];
    let cursor = index + 1;
    while (cursor < closingIndex) {
      const itemLine = lines[cursor];
      const itemMatch = itemLine.match(/^\s*-\s*(.*)$/);
      if (!itemMatch) {
        break;
      }
      items.push(parseScalar(itemMatch[1]));
      cursor += 1;
    }
    data[key] = items;
    index = cursor - 1;
  }

  const body = lines.slice(closingIndex + 1).join("\n").trim();
  return { data, body };
}

function extractTitle(body) {
  const lines = String(body || "").split(/\r?\n/);
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()));
  return titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Untitled";
}

function removeLeadingTitle(body) {
  const lines = String(body || "").split(/\r?\n/);
  if (lines.length && /^#\s+/.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim();
  }
  return String(body || "").trim();
}

function extractSummary(body) {
  const cleaned = removeLeadingTitle(body)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .find((part) => !/^##\s+/.test(part));
  return cleaned ? cleaned.replace(/\s+/g, " ").trim() : "";
}

function buildSections(body) {
  const cleaned = removeLeadingTitle(body);
  const lines = cleaned.split(/\r?\n/);
  const sections = [];
  let currentHeading = "Body";
  let currentLines = [];

  function pushSection() {
    const markdown = currentLines.join("\n").trim();
    if (!markdown) {
      return;
    }
    sections.push({ heading: currentHeading, markdown });
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      pushSection();
      currentHeading = headingMatch[1].trim();
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  pushSection();

  if (!sections.length) {
    const markdown = cleaned.trim();
    if (markdown) {
      sections.push({ heading: "Body", markdown });
    }
  }

  return sections;
}

function extractCitations(body) {
  const matches = [...String(body || "").matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)];
  const citations = matches.map((match) => {
    let source = "Unknown";
    try {
      source = new URL(match[2]).hostname.replace(/^www\./i, "");
    } catch (_error) {
      source = "Unknown";
    }
    return {
      title: match[1].trim(),
      url: match[2].trim(),
      source,
    };
  });

  return unique(citations.map((citation) => citation.url)).map((url) => citations.find((citation) => citation.url === url));
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function htmlToMarkdown(value) {
  const html = decodeXmlEntities(value);
  return html
    .replace(/\r/g, "")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) => `[${decodeXmlEntities(text).trim()}](${href.trim()})`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|em|b|i)>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function cleanBeehiivText(value) {
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const cleaned = [];
  let skipPlainTextFooter = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (skipPlainTextFooter) {
      continue;
    }
    if (/^You are reading a plain text version of this post\./i.test(trimmed)) {
      skipPlainTextFooter = true;
      continue;
    }
    if (/^View image:/i.test(trimmed) || /^Caption:/i.test(trimmed)) {
      continue;
    }
    if (/^[-—]{6,}$/.test(trimmed)) {
      cleaned.push("----------");
      continue;
    }
    cleaned.push(line);
  }

  let text = cleaned.join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\n----------\nAll the best,[\s\S]*$/i, "");
  text = text.replace(/\nAll the best,[\s\S]*$/i, "");
  return text.trim();
}

function normalizeTopics(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => slugify(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => slugify(entry))
      .filter(Boolean);
  }
  return [];
}

function buildArticleFromContent(entry = {}, options = {}) {
  const title = String(entry.title || "Untitled").trim();
  const markdown = String(
    entry.markdown
      || entry.contentMarkdown
      || entry.bodyMarkdown
      || (entry.html || entry.contentHtml || entry.bodyHtml ? htmlToMarkdown(entry.html || entry.contentHtml || entry.bodyHtml) : ""),
  ).trim();
  const summary = String(entry.summary || entry.excerpt || extractSummary(markdown)).trim();
  const authorName =
    String(entry.author?.name || entry.authorName || options.defaultAuthorName || "Unknown").trim();
  const authorSlug = slugify(entry.author?.slug || entry.authorSlug || options.defaultAuthorSlug || authorName || "unknown");
  const sections = Array.isArray(entry.sections) && entry.sections.length
    ? entry.sections.map((section) => ({
      heading: String(section.heading || "Body").trim() || "Body",
      markdown: String(section.markdown || section.body || "").trim(),
    })).filter((section) => section.markdown)
    : buildSections(markdown);
  const citations = Array.isArray(entry.citations) && entry.citations.length
    ? entry.citations
    : extractCitations(markdown);

  return {
    slug: slugify(entry.slug || title),
    title,
    summary,
    author: {
      name: authorName,
      slug: authorSlug,
    },
    publishedAt: String(entry.publishedAt || entry.createdAt || "").trim() || undefined,
    updatedAt: String(entry.updatedAt || entry.publishedAt || entry.createdAt || "").trim() || undefined,
    topics: normalizeTopics(entry.topics || entry.tags || entry.categories),
    citations,
    sections,
  };
}

function inferTopicsFromSections(sections = []) {
  return unique(
    sections
      .map((section) => slugify(section.heading))
      .filter((value) => value && value !== "body")
      .slice(0, 6),
  );
}

function extractTag(block, tagName) {
  const match = String(block || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : "";
}

function extractWpCategories(block) {
  return [...String(block || "").matchAll(/<category[^>]*domain=["'](?:category|post_tag)["'][^>]*nicename=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => slugify(match[1]))
    .filter(Boolean);
}

function buildWordpressArticle(itemBlock, options = {}) {
  const title = extractTag(itemBlock, "title") || "Untitled";
  const slug = slugify(extractTag(itemBlock, "wp:post_name") || title);
  const authorName = extractTag(itemBlock, "dc:creator") || String(options.defaultAuthorName || "Unknown").trim();
  const authorSlug = slugify(options.defaultAuthorSlug || authorName || "unknown");
  const markdown = htmlToMarkdown(extractTag(itemBlock, "content:encoded"));
  const summary = extractTag(itemBlock, "excerpt:encoded") || extractSummary(markdown);
  return {
    slug,
    title,
    summary,
    author: {
      name: authorName,
      slug: authorSlug,
    },
    publishedAt: extractTag(itemBlock, "wp:post_date") || undefined,
    updatedAt: extractTag(itemBlock, "wp:post_date") || undefined,
    topics: unique(extractWpCategories(itemBlock)),
    citations: extractCitations(markdown),
    sections: buildSections(markdown),
  };
}

function buildArticle(filePath, options = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontMatter(source);
  const title = String(data.title || extractTitle(body)).trim();
  const summary = String(data.summary || extractSummary(body)).trim();
  const topics = normalizeTopics(data.topics);
  const sections = buildSections(body);
  const citations = extractCitations(body);
  const authorName = String(data.author || options.defaultAuthorName || "Unknown").trim();
  const authorSlug = slugify(data.authorSlug || options.defaultAuthorSlug || authorName || "unknown");

  return {
    slug: slugify(data.slug || path.basename(filePath, path.extname(filePath)) || title),
    title,
    summary,
    author: {
      name: authorName,
      slug: authorSlug,
    },
    publishedAt: String(data.publishedAt || "").trim() || undefined,
    updatedAt: String(data.updatedAt || data.publishedAt || "").trim() || undefined,
    topics,
    citations,
    sections,
  };
}

function listMarkdownFiles(inputDir) {
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(inputDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(absolutePath));
      continue;
    }
    if (/\.(md|mdx)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function normalizeWrappedDistribution(wrapped) {
  if (!wrapped || typeof wrapped !== "object") {
    return undefined;
  }
  const originUrl = String(wrapped.originUrl || "").trim();
  const paymentWallet = String(wrapped.paymentWallet || "").trim();
  const price = String(wrapped.price || "").trim();
  const pathPattern = String(wrapped.pathPattern || "/*").trim() || "/*";
  if (!originUrl && !paymentWallet && !price) {
    return undefined;
  }
  return {
    ...(originUrl ? { originUrl } : {}),
    ...(paymentWallet ? { paymentWallet } : {}),
    ...(price ? { price } : {}),
    pathPattern,
  };
}

function importMarkdownCorpus(options = {}) {
  const inputDir = path.resolve(String(options.inputDir || "").trim());
  if (!inputDir) {
    throw new Error("inputDir is required.");
  }
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const articles = listMarkdownFiles(inputDir).map((filePath) => buildArticle(filePath, options));
  const wrapped = normalizeWrappedDistribution(options.wrapped);
  const output = {
    corpus: {
      name: String(options.corpusName || path.basename(inputDir)).trim() || "Publisher Stack Corpus",
      description: String(options.corpusDescription || "").trim(),
      articles,
    },
  };
  if (wrapped) {
    output.distribution = { wrapped };
  }
  return output;
}

function importWordpressWxr(options = {}) {
  const inputFile = path.resolve(String(options.inputFile || "").trim());
  if (!inputFile) {
    throw new Error("inputFile is required.");
  }
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const xml = fs.readFileSync(inputFile, "utf8");
  const title = extractTag(xml, "title") || path.basename(inputFile, path.extname(inputFile));
  const description = extractTag(xml, "description");
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const articles = itemBlocks
    .filter((itemBlock) => extractTag(itemBlock, "wp:post_type") === "post")
    .filter((itemBlock) => {
      const status = extractTag(itemBlock, "wp:status");
      return !status || status === "publish";
    })
    .map((itemBlock) => buildWordpressArticle(itemBlock, options));

  const output = {
    corpus: {
      name: String(options.corpusName || title).trim() || "Publisher Stack Corpus",
      description: String(options.corpusDescription || description).trim(),
      articles,
    },
  };

  const wrapped = normalizeWrappedDistribution(options.wrapped);
  if (wrapped) {
    output.distribution = { wrapped };
  }

  return output;
}

function importEmdashExport(options = {}) {
  const inputFile = path.resolve(String(options.inputFile || "").trim());
  if (!inputFile) {
    throw new Error("inputFile is required.");
  }
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const entries = Array.isArray(payload)
    ? payload
    : payload.posts || payload.articles || payload.entries || payload.content || [];
  const siteTitle =
    payload.site?.title || payload.site?.name || payload.title || options.corpusName || path.basename(inputFile, path.extname(inputFile));
  const siteDescription =
    payload.site?.description || payload.description || options.corpusDescription || "";

  const output = {
    corpus: {
      name: String(siteTitle || "Publisher Stack Corpus").trim(),
      description: String(siteDescription || "").trim(),
      articles: entries.map((entry) => buildArticleFromContent(entry, options)),
    },
  };

  const wrapped = normalizeWrappedDistribution(options.wrapped);
  if (wrapped) {
    output.distribution = { wrapped };
  }

  return output;
}

function importBeehiivExport(options = {}) {
  const inputFile = path.resolve(String(options.inputFile || "").trim());
  if (!inputFile) {
    throw new Error("inputFile is required.");
  }
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const publication = payload.publication || payload.site || {};
  const entries = Array.isArray(payload.posts) ? payload.posts : [];

  const articles = entries
    .filter((entry) => !entry.status || String(entry.status).toLowerCase() === "published")
    .map((entry) => {
      const markdown = cleanBeehiivText(String(
        entry.content_markdown
          || entry.contentMarkdown
          || entry.content_text
          || entry.contentText
          || entry.text
          || (entry.content_html || entry.contentHtml || entry.html ? htmlToMarkdown(entry.content_html || entry.contentHtml || entry.html) : ""),
      )).trim();
      const sections = buildSections(markdown);
      const topics = normalizeTopics(entry.tags || entry.topics || entry.categories);
      return {
        slug: slugify(entry.slug || entry.title),
        title: String(entry.title || "Untitled").trim(),
        summary: String(entry.subtitle || entry.excerpt || extractSummary(markdown)).trim(),
        author: {
          name: String(entry.author?.name || entry.authorName || options.defaultAuthorName || "Unknown").trim(),
          slug: slugify(entry.author?.slug || entry.authorSlug || options.defaultAuthorSlug || entry.author?.name || entry.authorName || "unknown"),
        },
        publishedAt: String(entry.created_at || entry.publishedAt || "").trim() || undefined,
        updatedAt: String(entry.updated_at || entry.updatedAt || entry.created_at || entry.publishedAt || "").trim() || undefined,
        topics: topics.length ? topics : inferTopicsFromSections(sections),
        citations: extractCitations(markdown),
        sections,
      };
    });

  const output = {
    corpus: {
      name: String(options.corpusName || publication.name || publication.title || "Publisher Stack Corpus").trim(),
      description: String(options.corpusDescription || publication.description || "").trim(),
      articles,
    },
  };

  const wrapped = normalizeWrappedDistribution(options.wrapped);
  if (wrapped) {
    output.distribution = { wrapped };
  }

  return output;
}

module.exports = {
  importBeehiivExport,
  importMarkdownCorpus,
  importEmdashExport,
  importWordpressWxr,
  parseFrontMatter,
};
