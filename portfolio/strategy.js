const SELLER_STRATEGY = {
  "restricted-party-screen": {
    track: "core",
    operatingMode: "build-and-measure",
    focusArea: "trade-compliance",
    rationale:
      "Primary phase-1 wedge. Build around this until the market says otherwise.",
  },
  "calendar-business-days": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
    rationale:
      "Transaction-adjacent calendar logic is still useful, but it is not the center of the business right now.",
  },
  "fx-conversion-quotes": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
    rationale:
      "FX has meaningful demand and can stay live as side income, but it is no longer the strategic wedge.",
  },
  "vehicle-vin": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
    rationale:
      "Specific enough to keep if it remains low-maintenance, but outside the current trade-compliance wedge.",
  },
  "weather-decision": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
    rationale:
      "Keep live because it already attracts traffic, but do not let weather set the roadmap.",
  },
  "nutrition-search": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Catalog breadth only. Do not invest further unless it surprises us with real paid demand.",
  },
  "food-barcode": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Low-fit consumer utility relative to the focused rebuild.",
  },
  "public-health-recalls": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Interesting data, but too far from the current business thesis.",
  },
  "drug-safety-events": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Niche inventory, not part of the focused provider identity.",
  },
  "census-demographics": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Generic data inventory with weak connection to transaction checks.",
  },
  "economic-inflation": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Useful macro data, but too far from the wedge to keep investing in.",
  },
  "economic-unemployment": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Long-tail inventory, not a focused revenue bet.",
  },
  "air-quality-zip": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Commodity environmental utility with no strong tie to the rebuild thesis.",
  },
  "ip-geolocation": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Crowded market and weak strategic fit.",
  },
  "congress-bills": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
    rationale: "Research inventory, not a coherent part of the focused provider identity.",
  },
};

const LIVE_SELLER_STRATEGY = {
  "warehouse-app": {
    track: "legacy-keep",
    operatingMode: "operate-as-warehouse-only",
    focusArea: "ops-infra",
  },
  "solar-times": {
    track: "legacy-kill",
    operatingMode: "retire-if-costly",
    focusArea: "legacy-catalog",
  },
  "restricted-party-screen": {
    track: "core",
    operatingMode: "build-and-measure",
    focusArea: "trade-compliance",
  },
  "weather-decision": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
  },
  "calendar-business-days": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
  },
  "fx-conversion-quotes": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
  },
  "vehicle-vin": {
    track: "legacy-keep",
    operatingMode: "freeze-and-monitor",
    focusArea: "utility-portfolio",
  },
};

function getSellerStrategy(id) {
  return (
    SELLER_STRATEGY[id] ?? {
      track: "legacy-kill",
      operatingMode: "retire-if-costly",
      focusArea: "legacy-catalog",
      rationale: "Unclassified seller defaults to legacy catalog until proven otherwise.",
    }
  );
}

function getLiveSellerStrategy(id) {
  return (
    LIVE_SELLER_STRATEGY[id] ?? {
      track: "legacy-kill",
      operatingMode: "retire-if-costly",
      focusArea: "legacy-catalog",
    }
  );
}

module.exports = {
  LIVE_SELLER_STRATEGY,
  SELLER_STRATEGY,
  getLiveSellerStrategy,
  getSellerStrategy,
};
