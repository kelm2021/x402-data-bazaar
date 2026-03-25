const {
  buildBatchScreeningResponse,
  clampInteger,
  createHttpError,
  DEFAULT_LIMIT,
  DEFAULT_MIN_SCORE,
  DEFAULT_WORKFLOW,
  fetchBatchSearchResults,
  fetchSourceFreshness,
  MAX_BATCH_COUNTERPARTIES,
  MAX_LIMIT,
  normalizeString,
  splitCounterpartyNames,
  splitQueryValues,
} = require("../lib/ofac");

function parseBatchScreeningQuery(req) {
  const names = splitCounterpartyNames(req.query?.names);
  if (!names.length) {
    throw createHttpError(
      "A names query parameter is required. Separate counterparties with the pipe character (|).",
      400,
    );
  }

  if (names.length > MAX_BATCH_COUNTERPARTIES) {
    throw createHttpError(
      `Batch screening supports up to ${MAX_BATCH_COUNTERPARTIES} counterparties per request.`,
      400,
    );
  }

  return {
    names,
    workflow: normalizeString(req.query?.workflow) || DEFAULT_WORKFLOW,
    minScore: clampInteger(req.query?.minScore, DEFAULT_MIN_SCORE, 50, 100),
    limit: clampInteger(req.query?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    type: normalizeString(req.query?.type),
    country: normalizeString(req.query?.country),
    programs: splitQueryValues(req.query?.program),
    list: normalizeString(req.query?.list),
  };
}

function createBatchHandler(deps = {}) {
  const batchSearchLoader = deps.fetchBatchSearchResults ?? fetchBatchSearchResults;
  const freshnessLoader = deps.fetchSourceFreshness ?? fetchSourceFreshness;

  return async function batchHandler(req, res) {
    try {
      const batchQuery = parseBatchScreeningQuery(req);
      const perCounterpartyQueries = batchQuery.names.map((name) => ({
        name,
        minScore: batchQuery.minScore,
        limit: batchQuery.limit,
        type: batchQuery.type,
        country: batchQuery.country,
        programs: batchQuery.programs,
        list: batchQuery.list,
      }));

      const [rawMatches, freshness] = await Promise.all([
        batchSearchLoader(perCounterpartyQueries),
        freshnessLoader(),
      ]);

      res.json(
        buildBatchScreeningResponse(
          batchQuery,
          perCounterpartyQueries.map((query, index) => ({
            name: query.name,
            rawMatches: rawMatches[index] ?? [],
          })),
          freshness,
        ),
      );
    } catch (error) {
      const statusCode = error.statusCode ?? 502;
      res.status(statusCode).json({
        success: false,
        error: error.message || "Restricted-party batch screening failed.",
      });
    }
  };
}

module.exports = createBatchHandler();
module.exports.createBatchHandler = createBatchHandler;
module.exports.parseBatchScreeningQuery = parseBatchScreeningQuery;
