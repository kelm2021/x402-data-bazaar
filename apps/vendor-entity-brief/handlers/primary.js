const {
  buildScreeningData,
  clampInteger,
  createHttpError,
  DEFAULT_LIMIT: DEFAULT_SCREENING_LIMIT,
  DEFAULT_MIN_SCORE,
  fetchSearchResults,
  fetchSourceFreshness,
  MAX_LIMIT: MAX_SCREENING_LIMIT,
  normalizeString,
} = require("../lib/ofac");
const {
  buildVendorEntityBriefResponse,
  fetchEntityCandidates,
  MAX_LIMIT: MAX_ENTITY_LIMIT,
} = require("../lib/vendor-entity-brief");

function parseVendorEntityBriefQuery(req) {
  const name = normalizeString(req.query?.name);
  if (!name) {
    throw createHttpError("A name query parameter is required.", 400);
  }

  const country = normalizeString(req.query?.country).toUpperCase();
  const limit = clampInteger(
    req.query?.limit,
    DEFAULT_SCREENING_LIMIT,
    1,
    Math.min(MAX_ENTITY_LIMIT, MAX_SCREENING_LIMIT),
  );

  return {
    name,
    country,
    minScore: clampInteger(req.query?.minScore, DEFAULT_MIN_SCORE, 50, 100),
    limit,
  };
}

function createPrimaryHandler(deps = {}) {
  const entitySearchLoader = deps.fetchEntityCandidates ?? fetchEntityCandidates;
  const sanctionsLoader = deps.fetchSearchResults ?? fetchSearchResults;
  const freshnessLoader = deps.fetchSourceFreshness ?? fetchSourceFreshness;

  return async function primaryHandler(req, res) {
    try {
      const query = parseVendorEntityBriefQuery(req);
      const [entitySearch, rawMatches, freshness] = await Promise.all([
        entitySearchLoader(query),
        sanctionsLoader(query),
        freshnessLoader(),
      ]);
      const screening = buildScreeningData(query, rawMatches);

      res.json(buildVendorEntityBriefResponse(query, entitySearch, screening, freshness));
    } catch (error) {
      const statusCode = error.statusCode ?? 502;
      res.status(statusCode).json({
        success: false,
        error: error.message || "Vendor entity brief lookup failed.",
      });
    }
  };
}

module.exports = createPrimaryHandler();
module.exports.createPrimaryHandler = createPrimaryHandler;
module.exports.parseVendorEntityBriefQuery = parseVendorEntityBriefQuery;
