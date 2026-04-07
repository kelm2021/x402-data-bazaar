const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AURELIANFLO_ALLOWED_ROUTE_KEYS,
  PUBLIC_CORE_DISCOVERY_ROUTE_KEYS,
  buildAllowedRouteKeySet,
  WELL_KNOWN_DESCRIPTION,
  WELL_KNOWN_INSTRUCTIONS,
  isAllowedAurelianFloRouteKey,
  isPublicCoreDiscoveryRouteKey,
} = require("../lib/aurelianflo-surface");

const manifest = require("../well-known-x402-aurelian.json");

test("aurelianflo surface exports the current production allowlist", () => {
  assert.equal(AURELIANFLO_ALLOWED_ROUTE_KEYS.length, 31);
  assert.ok(AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("POST /api/workflows/vendor/risk-forecast"));
  assert.ok(AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("POST /api/workflows/finance/pricing-scenario-forecast"));
  assert.ok(AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("POST /api/tools/report/xlsx/generate"));
  assert.ok(!AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("GET /api/weather/current/*"));
  assert.ok(!AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("GET /api/stocks/quote/*"));
  assert.ok(!AURELIANFLO_ALLOWED_ROUTE_KEYS.includes("POST /api/tools/password/generate"));
});

test("aurelianflo surface keeps the curated public core smaller than full discovery", () => {
  const allowed = buildAllowedRouteKeySet();
  assert.ok(allowed instanceof Set);
  assert.ok(allowed.has("POST /api/workflows/vendor/risk-forecast"));
  assert.ok(isAllowedAurelianFloRouteKey("POST /api/workflows/finance/pricing-scenario-forecast"));
  assert.ok(!isAllowedAurelianFloRouteKey("GET /api/weather/current/*"));
  assert.ok(PUBLIC_CORE_DISCOVERY_ROUTE_KEYS.length < AURELIANFLO_ALLOWED_ROUTE_KEYS.length);
  assert.ok(isPublicCoreDiscoveryRouteKey("POST /api/workflows/compliance/edd-report"));
  assert.ok(!isPublicCoreDiscoveryRouteKey("POST /api/workflows/vendor/risk-forecast"));
});

test("aurelianflo well-known manifest matches the retained production surface language", () => {
  assert.equal(manifest.description, WELL_KNOWN_DESCRIPTION);
  assert.equal(manifest.instructions, WELL_KNOWN_INSTRUCTIONS);
  assert.ok(Array.isArray(manifest.resources));
  assert.ok(manifest.resources.length > 0);
  assert.doesNotMatch(manifest.description, /premium/i);
  assert.doesNotMatch(manifest.instructions, /workflow-safe/i);
  assert.doesNotMatch(manifest.instructions, /generic mixed bazaar/i);
});
