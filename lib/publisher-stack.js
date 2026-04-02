const fs = require("node:fs");
const path = require("node:path");
const {
  importBeehiivExport,
  importEmdashExport,
  importMarkdownCorpus,
  importWordpressWxr,
} = require("./publisher-stack-import");

const defaultCorpusDocument = require("../data/publisher-stack/default-corpus.json");

const DEFAULT_SAMPLE_SLUG = "agentic-commerce-primer";
const DEFAULT_TOPIC_SLUG = "agent-commerce";
const DEFAULT_AUTHOR_SLUG = "kent-egan";
const SOURCE = "publisher-stack";

let cachedCorpus = null;
let cachedSignature = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function words(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function sentenceSplit(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function readingTimeMinutes(text) {
  const count = words(text).length;
  return Math.max(1, Math.ceil(count / 220));
}

function makeMarkdown(article) {
  const sections = Array.isArray(article.sections) ? article.sections : [];
  const sectionMarkdown = sections
    .map((section) => `## ${section.heading}\n\n${section.markdown}`)
    .join("\n\n");
  return `# ${article.title}\n\n${article.summary}\n\n${sectionMarkdown}`.trim();
}

function inferEntities(article) {
  const text = `${article.title} ${article.summary} ${article.markdown}`;
  const rawMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  const values = unique(
    rawMatches
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry.length > 2),
  );

  const entities = values.slice(0, 16).map((value) => ({
    type: value.includes("Cloudflare") ? "organization" : "named_entity",
    value,
  }));

  return {
    entities,
    grouped: {
      organizations: entities.filter((entity) => entity.type === "organization").map((entity) => entity.value),
      namedEntities: entities.map((entity) => entity.value),
      topics: article.topics || [],
    },
  };
}

function normalizeArticle(article) {
  const markdown = makeMarkdown(article);
  const text = markdown.replace(/[#*`>\-]/g, " ").replace(/\s+/g, " ").trim();
  const entityPayload = inferEntities({ ...article, markdown });
  return {
    slug: slugify(article.slug || article.title),
    title: article.title,
    summary: article.summary,
    author: {
      name: article.author?.name || "Unknown",
      slug: slugify(article.author?.slug || article.author?.name || "unknown"),
    },
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt || article.publishedAt,
    topics: Array.isArray(article.topics) ? article.topics.map((topic) => slugify(topic)) : [],
    citations: Array.isArray(article.citations) ? article.citations : [],
    sections: Array.isArray(article.sections) ? article.sections : [],
    markdown,
    text,
    wordCount: words(text).length,
    readingTimeMinutes: readingTimeMinutes(text),
    entities: entityPayload.entities,
    entityGroups: entityPayload.grouped,
  };
}

function loadCorpusDocument(env = process.env) {
  const pathOverride = String(env.PUBLISHER_STACK_CORPUS_PATH || "").trim();
  const jsonOverride = String(env.PUBLISHER_STACK_CORPUS_JSON || "").trim();
  const markdownDirOverride = String(env.PUBLISHER_STACK_MARKDOWN_DIR || "").trim();
  const wxrPathOverride = String(env.PUBLISHER_STACK_WXR_PATH || "").trim();
  const emdashPathOverride = String(env.PUBLISHER_STACK_EMDASH_EXPORT_PATH || "").trim();
  const beehiivPathOverride = String(env.PUBLISHER_STACK_BEEHIIV_EXPORT_PATH || "").trim();
  const defaultAuthorName = String(env.PUBLISHER_STACK_DEFAULT_AUTHOR_NAME || "").trim();
  const defaultAuthorSlug = String(env.PUBLISHER_STACK_DEFAULT_AUTHOR_SLUG || "").trim();
  const corpusNameOverride = String(env.PUBLISHER_STACK_CORPUS_NAME || "").trim();
  const corpusDescriptionOverride = String(env.PUBLISHER_STACK_CORPUS_DESCRIPTION || "").trim();
  const signature = [
    pathOverride,
    jsonOverride,
    markdownDirOverride,
    wxrPathOverride,
    emdashPathOverride,
    beehiivPathOverride,
    defaultAuthorName,
    defaultAuthorSlug,
    corpusNameOverride,
    corpusDescriptionOverride,
  ].join("::");
  if (cachedCorpus && cachedSignature === signature) {
    return cachedCorpus;
  }

  let document = defaultCorpusDocument;
  if (jsonOverride) {
    document = JSON.parse(jsonOverride);
  } else if (pathOverride) {
    const absolutePath = path.isAbsolute(pathOverride)
      ? pathOverride
      : path.join(process.cwd(), pathOverride);
    document = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } else if (emdashPathOverride) {
    document = importEmdashExport({
      inputFile: emdashPathOverride,
      corpusName: corpusNameOverride,
      corpusDescription: corpusDescriptionOverride,
      defaultAuthorName,
      defaultAuthorSlug,
    });
  } else if (beehiivPathOverride) {
    document = importBeehiivExport({
      inputFile: beehiivPathOverride,
      corpusName: corpusNameOverride,
      corpusDescription: corpusDescriptionOverride,
      defaultAuthorName,
      defaultAuthorSlug,
    });
  } else if (wxrPathOverride) {
    document = importWordpressWxr({
      inputFile: wxrPathOverride,
      corpusName: corpusNameOverride,
      corpusDescription: corpusDescriptionOverride,
      defaultAuthorName,
      defaultAuthorSlug,
    });
  } else if (markdownDirOverride) {
    document = importMarkdownCorpus({
      inputDir: markdownDirOverride,
      corpusName: corpusNameOverride,
      corpusDescription: corpusDescriptionOverride,
      defaultAuthorName,
      defaultAuthorSlug,
    });
  }

  const corpus = {
    name: document?.corpus?.name || "Publisher Stack Corpus",
    description: document?.corpus?.description || "",
    articles: Array.isArray(document?.corpus?.articles)
      ? document.corpus.articles.map(normalizeArticle)
      : [],
  };
  cachedCorpus = corpus;
  cachedSignature = signature;
  return corpus;
}

function getPublisherCorpus(env = process.env) {
  return clone(loadCorpusDocument(env));
}

function getArticleBySlug(slug, env = process.env) {
  const normalizedSlug = slugify(slug);
  return loadCorpusDocument(env).articles.find((article) => article.slug === normalizedSlug) || null;
}

function scoreText(haystack, queryTerms) {
  const haystackTerms = words(haystack);
  if (!queryTerms.length || !haystackTerms.length) {
    return 0;
  }
  let score = 0;
  for (const term of queryTerms) {
    const occurrences = haystackTerms.filter((value) => value === term).length;
    score += occurrences;
  }
  return score;
}

function buildArticleSummary(article) {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    author: article.author.slug,
    authorName: article.author.name,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    topics: article.topics,
    wordCount: article.wordCount,
    readingTimeMinutes: article.readingTimeMinutes,
    citationCount: article.citations.length,
  };
}

function searchArticles(query, options = {}, env = process.env) {
  const normalizedQuery = String(query || "").trim();
  const queryTerms = unique(words(normalizedQuery));
  const limit = Math.max(1, Math.min(Number.parseInt(String(options.limit || 10), 10) || 10, 50));
  const matches = loadCorpusDocument(env).articles
    .map((article) => {
      const score =
        scoreText(`${article.title} ${article.summary}`, queryTerms) * 3
        + scoreText(article.text, queryTerms)
        + scoreText((article.topics || []).join(" "), queryTerms) * 2
        + scoreText(`${article.author.slug} ${article.author.name}`, queryTerms);
      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
    .slice(0, limit)
    .map((entry) => ({
      ...buildArticleSummary(entry.article),
      score: entry.score,
    }));

  return {
    query: normalizedQuery,
    count: matches.length,
    results: matches,
  };
}

function buildChunks(article, options = {}) {
  const size = Math.max(120, Math.min(Number.parseInt(String(options.chunkSize || 240), 10) || 240, 1200));
  const maxChunks = Math.max(1, Math.min(Number.parseInt(String(options.maxChunks || 20), 10) || 20, 50));
  const sentences = sentenceSplit(article.markdown);
  const chunks = [];
  let current = "";
  let sectionIndex = 0;

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > size && current) {
      chunks.push({
        id: `${article.slug}-chunk-${chunks.length + 1}`,
        slug: article.slug,
        title: article.title,
        text: current.trim(),
        tags: unique([
          ...article.topics,
          ...words(current).filter((token) => token.length > 5).slice(0, 4),
        ]).slice(0, 8),
        section: article.sections[sectionIndex]?.heading || null,
      });
      current = sentence;
      sectionIndex = Math.min(sectionIndex + 1, article.sections.length - 1);
    } else {
      current = candidate;
    }

    if (chunks.length >= maxChunks) {
      break;
    }
  }

  if (current && chunks.length < maxChunks) {
    chunks.push({
      id: `${article.slug}-chunk-${chunks.length + 1}`,
      slug: article.slug,
      title: article.title,
      text: current.trim(),
      tags: unique([
        ...article.topics,
        ...words(current).filter((token) => token.length > 5).slice(0, 4),
      ]).slice(0, 8),
      section: article.sections[Math.min(sectionIndex, article.sections.length - 1)]?.heading || null,
    });
  }

  return chunks;
}

function searchCorpus(query, options = {}, env = process.env) {
  const normalizedQuery = String(query || "").trim();
  const queryTerms = unique(words(normalizedQuery));
  const limit = Math.max(1, Math.min(Number.parseInt(String(options.limit || 10), 10) || 10, 50));

  const chunks = loadCorpusDocument(env).articles.flatMap((article) => buildChunks(article, options));
  const matches = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreText(`${chunk.title} ${chunk.text} ${(chunk.tags || []).join(" ")}`, queryTerms),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);

  return {
    query: normalizedQuery,
    count: matches.length,
    chunks: matches,
  };
}

function listByTopic(topic, env = process.env) {
  const normalizedTopic = slugify(topic);
  const corpus = loadCorpusDocument(env);
  const articles = corpus.articles
    .filter((article) => article.topics.includes(normalizedTopic))
    .map(buildArticleSummary);
  return {
    topic: {
      slug: normalizedTopic,
      articleCount: articles.length,
    },
    articles,
  };
}

function listByAuthor(author, env = process.env) {
  const normalizedAuthor = slugify(author);
  const corpus = loadCorpusDocument(env);
  const articles = corpus.articles
    .filter((article) => article.author.slug === normalizedAuthor)
    .map(buildArticleSummary);
  const first = corpus.articles.find((article) => article.author.slug === normalizedAuthor);
  return {
    author: {
      slug: normalizedAuthor,
      name: first?.author?.name || normalizedAuthor,
      articleCount: articles.length,
    },
    articles,
  };
}

function resolveArticleSelection(input = {}, env = process.env) {
  const corpus = loadCorpusDocument(env);
  const requestedSlugs = Array.isArray(input.slugs)
    ? input.slugs.map((value) => slugify(value)).filter(Boolean)
    : [];
  if (requestedSlugs.length) {
    return corpus.articles.filter((article) => requestedSlugs.includes(article.slug));
  }

  if (input.slug) {
    const article = getArticleBySlug(input.slug, env);
    return article ? [article] : [];
  }

  if (input.q) {
    const search = searchArticles(input.q, { limit: input.limit || 10 }, env);
    return search.results
      .map((entry) => getArticleBySlug(entry.slug, env))
      .filter(Boolean);
  }

  return corpus.articles.slice(0, 10);
}

function buildDataset(input = {}, env = process.env) {
  const articles = resolveArticleSelection(input, env);
  const fields = Array.isArray(input.fields) && input.fields.length
    ? input.fields.map((field) => String(field).trim()).filter(Boolean)
    : ["slug", "title", "author", "publishedAt", "summary"];
  const format = String(input.format || "rows").trim().toLowerCase();
  const rows = articles.map((article) => {
    const row = {};
    for (const field of fields) {
      if (field === "author") {
        row.author = article.author.name;
      } else if (field === "topics") {
        row.topics = article.topics.join("|");
      } else if (field === "citationCount") {
        row.citationCount = article.citations.length;
      } else {
        row[field] = article[field] ?? null;
      }
    }
    return row;
  });

  const csvLines = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? "")).join(",")),
  ];
  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");

  return {
    format,
    rowCount: rows.length,
    fields,
    rows,
    ...(format === "csv" ? { csv: csvLines.join("\n") } : {}),
    ...(format === "jsonl" ? { jsonl } : {}),
    fileName: `publisher-dataset.${format === "jsonl" ? "jsonl" : format === "csv" ? "csv" : "json"}`,
  };
}

function extractFaq(input = {}, env = process.env) {
  const count = Math.max(1, Math.min(Number.parseInt(String(input.count || 5), 10) || 5, 10));
  const article = input.slug ? getArticleBySlug(input.slug, env) : null;
  const text = article ? article.markdown : String(input.text || "").trim();
  const title = article ? article.title : "Custom Content";
  const summary = article ? article.summary : sentenceSplit(text)[0] || "No summary provided.";
  const headings = article
    ? article.sections.map((section) => section.heading)
    : sentenceSplit(text).slice(0, count).map((sentence, index) => `Topic ${index + 1}: ${sentence.slice(0, 42)}`);
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const heading = headings[index] || `${title} detail ${index + 1}`;
    items.push({
      id: index + 1,
      question: `What should an agent know about ${heading.toLowerCase()}?`,
      answer:
        index === 0
          ? summary
          : sentenceSplit(text).slice(index, index + 2).join(" ") || summary,
    });
  }
  return {
    title,
    itemCount: items.length,
    items,
  };
}

function chunkAndTag(input = {}, env = process.env) {
  const article = input.slug ? getArticleBySlug(input.slug, env) : null;
  if (article) {
    return {
      slug: article.slug,
      title: article.title,
      chunkCount: buildChunks(article, input).length,
      chunks: buildChunks(article, input),
    };
  }

  const text = String(input.text || "").trim();
  const pseudoArticle = normalizeArticle({
    slug: slugify(input.title || "custom-content"),
    title: input.title || "Custom Content",
    summary: sentenceSplit(text)[0] || "Custom content chunking payload.",
    author: { name: "Custom Input", slug: "custom-input" },
    publishedAt: "2026-04-01",
    updatedAt: "2026-04-01",
    topics: Array.isArray(input.topics) ? input.topics : [],
    citations: [],
    sections: [{ heading: "Body", markdown: text }],
  });
  return {
    slug: pseudoArticle.slug,
    title: pseudoArticle.title,
    chunkCount: buildChunks(pseudoArticle, input).length,
    chunks: buildChunks(pseudoArticle, input),
  };
}

function buildPublisherStackExamples(env = process.env) {
  const article = getArticleBySlug(DEFAULT_SAMPLE_SLUG, env) || loadCorpusDocument(env).articles[0];
  return {
    article,
    articleSummary: buildArticleSummary(article),
    articleMarkdown: {
      article: {
        slug: article.slug,
        title: article.title,
      },
      markdown: article.markdown,
      wordCount: article.wordCount,
      readingTimeMinutes: article.readingTimeMinutes,
    },
    articleStructured: {
      article: buildArticleSummary(article),
      sections: article.sections,
      citations: article.citations,
    },
    articleCitations: {
      article: {
        slug: article.slug,
        title: article.title,
      },
      citations: article.citations,
      sourceDomains: unique(article.citations.map((citation) => {
        try {
          return new URL(citation.url).hostname;
        } catch (_error) {
          return citation.source;
        }
      })),
    },
    articleEntities: {
      article: {
        slug: article.slug,
        title: article.title,
      },
      entities: article.entities,
      grouped: article.entityGroups,
    },
    search: searchArticles("agentic commerce", { limit: 3 }, env),
    corpusSearch: searchCorpus("wallet routing", { limit: 3 }, env),
    topic: listByTopic(DEFAULT_TOPIC_SLUG, env),
    author: listByAuthor(DEFAULT_AUTHOR_SLUG, env),
    dataset: buildDataset({
      slugs: [DEFAULT_SAMPLE_SLUG, "publisher-mcp-blueprint"],
      format: "csv",
      fields: ["slug", "title", "author", "publishedAt", "summary"],
    }, env),
    faq: extractFaq({ slug: "publisher-mcp-blueprint", count: 4 }, env),
    chunks: chunkAndTag({ slug: DEFAULT_SAMPLE_SLUG, chunkSize: 220 }, env),
  };
}

module.exports = {
  DEFAULT_AUTHOR_SLUG,
  DEFAULT_SAMPLE_SLUG,
  DEFAULT_TOPIC_SLUG,
  SOURCE,
  buildChunks,
  buildDataset,
  buildPublisherStackExamples,
  chunkAndTag,
  extractFaq,
  getArticleBySlug,
  getPublisherCorpus,
  listByAuthor,
  listByTopic,
  searchArticles,
  searchCorpus,
};
