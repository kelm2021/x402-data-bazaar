const {
  buildScreeningResponse,
  clampInteger,
  createHttpError,
  DEFAULT_LIMIT,
  DEFAULT_MIN_SCORE,
  fetchSearchResults,
  fetchSourceFreshness,
  MAX_LIMIT,
  normalizeString,
  splitQueryValues,
} = require("../lib/ofac");

function parseScreeningQuery(req) {
  const name = normalizeString(req.params?.name);
  if (!name) {
    throw createHttpError("A name path parameter is required.", 400);
  }

  if (name.length < 2) {
    throw createHttpError("The name path parameter must be at least 2 characters.", 400);
  }

  return {
    name,
    minScore: clampInteger(req.query?.minScore, DEFAULT_MIN_SCORE, 50, 100),
    limit: clampInteger(req.query?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    type: normalizeString(req.query?.type),
    country: normalizeString(req.query?.country),
    city: normalizeString(req.query?.city),
    address: normalizeString(req.query?.address),
    idNumber: normalizeString(req.query?.idNumber),
    stateProvince: normalizeString(req.query?.stateProvince),
    programs: splitQueryValues(req.query?.program),
    list: normalizeString(req.query?.list),
  };
}

function createPrimaryHandler(deps = {}) {
  const searchResultsLoader = deps.fetchSearchResults ?? fetchSearchResults;
  const freshnessLoader = deps.fetchSourceFreshness ?? fetchSourceFreshness;

  return async function primaryHandler(req, res) {
    try {
      const query = parseScreeningQuery(req);
      const [rawMatches, freshness] = await Promise.all([
        searchResultsLoader(query),
        freshnessLoader(),
      ]);

      res.json(buildScreeningResponse(query, rawMatches, freshness));
    } catch (error) {
      const statusCode = error.statusCode ?? 502;
      res.status(statusCode).json({
        success: false,
        error: error.message || "Restricted-party screening failed.",
      });
    }
  };
}

module.exports = createPrimaryHandler();
module.exports.createPrimaryHandler = createPrimaryHandler;
module.exports.parseScreeningQuery = parseScreeningQuery;
