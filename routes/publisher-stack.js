const { Router } = require("express");
const {
  SOURCE,
  buildDataset,
  chunkAndTag,
  extractFaq,
  getArticleBySlug,
  listByAuthor,
  listByTopic,
  searchArticles,
  searchCorpus,
} = require("../lib/publisher-stack");

function createPublisherStackRouter(options = {}) {
  const env = options.env || process.env;
  const router = Router();

  function ok(res, data) {
    return res.json({ success: true, data, source: SOURCE });
  }

  function badRequest(res, error, details) {
    return res.status(400).json({ success: false, error, details, source: SOURCE });
  }

  function notFound(res, error, details) {
    return res.status(404).json({ success: false, error, details, source: SOURCE });
  }

  router.get("/api/data/content/article/:slug", (req, res) => {
    const article = getArticleBySlug(req.params.slug, env);
    if (!article) {
      return notFound(res, "article_not_found", "Unknown content slug.");
    }

    return ok(res, {
      article: {
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        author: article.author,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
        topics: article.topics,
        wordCount: article.wordCount,
        readingTimeMinutes: article.readingTimeMinutes,
        citationCount: article.citations.length,
      },
    });
  });

  router.get("/api/data/content/article/:slug/markdown", (req, res) => {
    const article = getArticleBySlug(req.params.slug, env);
    if (!article) {
      return notFound(res, "article_not_found", "Unknown content slug.");
    }

    return ok(res, {
      article: {
        slug: article.slug,
        title: article.title,
      },
      markdown: article.markdown,
      wordCount: article.wordCount,
      readingTimeMinutes: article.readingTimeMinutes,
    });
  });

  router.get("/api/data/content/article/:slug/structured", (req, res) => {
    const article = getArticleBySlug(req.params.slug, env);
    if (!article) {
      return notFound(res, "article_not_found", "Unknown content slug.");
    }

    return ok(res, {
      article: {
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        author: article.author,
        topics: article.topics,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
      },
      sections: article.sections,
      citations: article.citations,
    });
  });

  router.get("/api/data/content/article/:slug/citations", (req, res) => {
    const article = getArticleBySlug(req.params.slug, env);
    if (!article) {
      return notFound(res, "article_not_found", "Unknown content slug.");
    }

    return ok(res, {
      article: {
        slug: article.slug,
        title: article.title,
      },
      citations: article.citations,
      sourceDomains: [...new Set(article.citations.map((citation) => {
        try {
          return new URL(citation.url).hostname;
        } catch (_error) {
          return citation.source;
        }
      }))],
    });
  });

  router.get("/api/data/content/article/:slug/entities", (req, res) => {
    const article = getArticleBySlug(req.params.slug, env);
    if (!article) {
      return notFound(res, "article_not_found", "Unknown content slug.");
    }

    return ok(res, {
      article: {
        slug: article.slug,
        title: article.title,
      },
      entities: article.entities,
      grouped: article.entityGroups,
    });
  });

  router.get("/api/data/content/search", (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return badRequest(res, "missing_query", "q is required.");
    }

    return ok(res, searchArticles(query, { limit: req.query.limit }, env));
  });

  router.get("/api/data/content/corpus/search", (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return badRequest(res, "missing_query", "q is required.");
    }

    return ok(res, searchCorpus(query, {
      limit: req.query.limit,
      chunkSize: req.query.chunkSize,
    }, env));
  });

  router.get("/api/data/content/topic/:topic", (req, res) => {
    const payload = listByTopic(req.params.topic, env);
    if (!payload.articles.length) {
      return notFound(res, "topic_not_found", "Unknown topic slug.");
    }
    return ok(res, payload);
  });

  router.get("/api/data/content/author/:author", (req, res) => {
    const payload = listByAuthor(req.params.author, env);
    if (!payload.articles.length) {
      return notFound(res, "author_not_found", "Unknown author slug.");
    }
    return ok(res, payload);
  });

  router.post("/api/tools/content/to-dataset", (req, res) => {
    return ok(res, buildDataset(req.body || {}, env));
  });

  router.post("/api/tools/content/extract-faq", (req, res) => {
    const slug = String(req.body?.slug || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!slug && !text) {
      return badRequest(res, "missing_input", "Provide slug or text.");
    }
    return ok(res, extractFaq(req.body || {}, env));
  });

  router.post("/api/tools/content/chunk-and-tag", (req, res) => {
    const slug = String(req.body?.slug || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!slug && !text) {
      return badRequest(res, "missing_input", "Provide slug or text.");
    }
    return ok(res, chunkAndTag(req.body || {}, env));
  });

  return router;
}

module.exports = createPublisherStackRouter;
