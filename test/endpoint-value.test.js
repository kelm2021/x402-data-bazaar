const assert = require("node:assert/strict");
const test = require("node:test");

const exchangeRoutes = require("../routes/exchange-rates");
const holidayRoutes = require("../routes/holidays");
const weatherRoutes = require("../routes/weather");

test("exchange quote helpers build default conversion quotes for actionable amounts", () => {
  const targets = exchangeRoutes.parseQuoteTargets("USD");
  const quotes = exchangeRoutes.buildConversionQuotes(
    "USD",
    { EUR: 0.9, GBP: 0.8, JPY: 150 },
    targets,
    100,
  );

  assert.deepEqual(targets, ["EUR", "GBP", "JPY"]);
  assert.equal(quotes[0].target, "EUR");
  assert.equal(quotes[0].convertedAmount, 90);
  assert.equal(quotes[0].inverseRate, 1.1111);
});

test("holiday helpers skip weekends and holidays when finding the next business day", () => {
  const holidayIndex = holidayRoutes.createHolidayIndex([
    {
      date: "2026-03-16",
      name: "Observed Holiday",
      localName: "Observed Holiday",
      types: ["Public"],
    },
  ]);
  const snapshot = holidayRoutes.buildBusinessDaySnapshot(
    "US",
    "2026-03-15",
    "America/New_York",
    holidayIndex,
  );

  assert.equal(snapshot.isWeekend, true);
  assert.equal(snapshot.isBusinessDay, false);
  assert.deepEqual(snapshot.nextBusinessDay, {
    date: "2026-03-17",
    dayOfWeek: "Tuesday",
    daysAhead: 2,
  });
});

test("weather decision helper flags coat and umbrella needs from near-term conditions", () => {
  const brief = weatherRoutes.buildDecisionBrief(
    {
      feels_like_f: 42,
      precipitation_in: 0,
    },
    [
      {
        time: "2026-03-15T10:00",
        apparent_temperature_f: 40,
        precipitation_probability_pct: 20,
        precipitation_in: 0,
        wind_speed_mph: 12,
        weather_code: 3,
        condition: "Overcast",
      },
      {
        time: "2026-03-15T12:00",
        apparent_temperature_f: 38,
        precipitation_probability_pct: 60,
        precipitation_in: 0.05,
        wind_speed_mph: 24,
        weather_code: 61,
        condition: "Slight rain",
      },
    ],
  );

  assert.equal(brief.coatRecommended, true);
  assert.equal(brief.umbrellaRecommended, true);
  assert.equal(brief.commuteRisk, "medium");
  assert.equal(brief.firstWetHour.time, "2026-03-15T12:00");
  assert.ok(brief.outdoorScore < 80);
});
