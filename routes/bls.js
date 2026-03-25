const fetch = require("node-fetch");
const { Router } = require("express");
const router = Router();

async function fetchBLS(seriesId, years) {
  const endYear = new Date().getFullYear();
  const startYear = endYear - (parseInt(years) || 5);
  const resp = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid: [seriesId],
      startyear: String(startYear),
      endyear: String(endYear),
    }),
  });
  return resp.json();
}

router.get("/api/bls/cpi", async (req, res) => {
  try {
    const { years } = req.query;
    // CUUR0000SA0 = CPI-U All items, US city average
    const raw = await fetchBLS("CUUR0000SA0", years);

    if (raw.status !== "REQUEST_SUCCEEDED") {
      return res.status(502).json({ success: false, error: raw.message || "BLS request failed" });
    }

    const series = raw.Results.series[0];
    const data = series.data.map((d) => ({
      year: d.year,
      period: d.periodName,
      value: parseFloat(d.value),
    }));

    res.json({
      success: true,
      data: {
        seriesId: "CUUR0000SA0",
        title: "Consumer Price Index - All Urban Consumers (CPI-U), All Items, US City Average",
        latest: data[0],
        history: data,
      },
      source: "Bureau of Labor Statistics",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.get("/api/bls/unemployment", async (req, res) => {
  try {
    const { years } = req.query;
    // LNS14000000 = Unemployment rate, seasonally adjusted
    const raw = await fetchBLS("LNS14000000", years);

    if (raw.status !== "REQUEST_SUCCEEDED") {
      return res.status(502).json({ success: false, error: raw.message || "BLS request failed" });
    }

    const series = raw.Results.series[0];
    const data = series.data.map((d) => ({
      year: d.year,
      period: d.periodName,
      rate_pct: parseFloat(d.value),
    }));

    res.json({
      success: true,
      data: {
        seriesId: "LNS14000000",
        title: "Unemployment Rate, Seasonally Adjusted",
        latest: data[0],
        history: data,
      },
      source: "Bureau of Labor Statistics",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

module.exports = router;
