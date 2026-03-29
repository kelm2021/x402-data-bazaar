const assert = require("node:assert/strict");
const test = require("node:test");

const stocksRouter = require("../routes/stocks");
const { UpstreamRequestError } = require("../lib/upstream-client");

test("isFredSeriesMissingError detects missing-series upstream payloads", () => {
  const missingSeriesError = new UpstreamRequestError("Upstream fred failed with status 400", {
    provider: "fred",
    code: "upstream_http",
    upstreamStatus: 400,
    details: {
      error_message: "Bad Request.  The series does not exist.",
    },
  });

  assert.equal(stocksRouter.isFredSeriesMissingError(missingSeriesError), true);
});

test("isFredSeriesMissingError ignores non-matching FRED errors", () => {
  const otherFredError = new UpstreamRequestError("Upstream fred failed with status 400", {
    provider: "fred",
    code: "upstream_http",
    upstreamStatus: 400,
    details: {
      error_message: "Bad Request.  Invalid API key.",
    },
  });

  assert.equal(stocksRouter.isFredSeriesMissingError(otherFredError), false);
});

test("normalizeYahooChartSeries normalizes close values into dated observations", () => {
  const raw = {
    chart: {
      result: [
        {
          timestamp: [1711843200, 1711929600],
          indicators: {
            quote: [
              {
                close: [2210.5, 2225.2],
              },
            ],
          },
        },
      ],
    },
  };

  const observations = stocksRouter.normalizeYahooChartSeries(raw, 2, "Yahoo gold");

  assert.equal(observations.length, 2);
  assert.equal(observations[0].date, "2024-04-01");
  assert.equal(observations[0].value, 2225.2);
  assert.equal(observations[1].date, "2024-03-31");
  assert.equal(observations[1].value, 2210.5);
});
