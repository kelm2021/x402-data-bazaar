const fetch = require("node-fetch");
const { Router } = require("express");
const airQualityRoutes = require("./air-quality");

const router = Router();

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function roundWeatherValue(value) {
  return Number(value.toFixed(1));
}

function getCoordinates(req) {
  return {
    lat: req.params.lat ?? req.query.lat,
    lon: req.params.lon ?? req.query.lon,
  };
}

function parseCoordinateNumbers(req) {
  const { lat, lon } = getCoordinates(req);
  const latNum = Number.parseFloat(String(lat));
  const lonNum = Number.parseFloat(String(lon));
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return null;
  }
  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return null;
  }

  return { lat: latNum, lon: lonNum };
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === text ? text : null;
}

function getDayDifference(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizeUsState(value) {
  const state = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : null;
}

function buildHourlyDecisionWindow(raw, hours = 12) {
  const hourly = raw.hourly ?? {};
  const time = Array.isArray(hourly.time) ? hourly.time : [];
  const startIndex = Math.max(time.findIndex((entry) => entry >= raw.current.time), 0);
  const endIndex = Math.min(startIndex + hours, time.length);

  return time.slice(startIndex, endIndex).map((entry, offset) => {
    const index = startIndex + offset;
    const weatherCode = hourly.weather_code?.[index];

    return {
      time: entry,
      apparent_temperature_f: hourly.apparent_temperature?.[index] ?? null,
      precipitation_probability_pct: hourly.precipitation_probability?.[index] ?? 0,
      precipitation_in: hourly.precipitation?.[index] ?? 0,
      wind_speed_mph: hourly.wind_speed_10m?.[index] ?? 0,
      weather_code: weatherCode,
      condition: WEATHER_CODES[weatherCode] || "Unknown",
    };
  });
}

function buildDecisionBrief(current, hourlyWindow) {
  const maxPrecipitationProbability = hourlyWindow.reduce(
    (maxValue, entry) => Math.max(maxValue, entry.precipitation_probability_pct ?? 0),
    0,
  );
  const maxWindSpeed = hourlyWindow.reduce(
    (maxValue, entry) => Math.max(maxValue, entry.wind_speed_mph ?? 0),
    0,
  );
  const minFeelsLike = hourlyWindow.reduce(
    (minValue, entry) => Math.min(minValue, entry.apparent_temperature_f ?? minValue),
    current.feels_like_f,
  );
  const firstWetHour = hourlyWindow.find(
    (entry) =>
      (entry.precipitation_probability_pct ?? 0) >= 45 || (entry.precipitation_in ?? 0) >= 0.01,
  );
  const severeWindow = hourlyWindow.some((entry) => (entry.weather_code ?? 0) >= 95);
  const coatRecommended =
    (current.feels_like_f ?? 999) < 55 || minFeelsLike < 50 || maxWindSpeed >= 18;
  const umbrellaRecommended =
    (current.precipitation_in ?? 0) >= 0.01 ||
    Boolean(firstWetHour) ||
    maxPrecipitationProbability >= 45;

  let outdoorScore = 100;
  if ((current.feels_like_f ?? 72) < 32 || (current.feels_like_f ?? 72) > 95) {
    outdoorScore -= 30;
  } else if ((current.feels_like_f ?? 72) < 45 || (current.feels_like_f ?? 72) > 85) {
    outdoorScore -= 15;
  }
  outdoorScore -= Math.min(maxPrecipitationProbability * 0.35, 35);
  outdoorScore -= Math.min(Math.max(maxWindSpeed - 12, 0) * 1.5, 25);
  if (severeWindow) {
    outdoorScore -= 20;
  }

  const commuteRisk =
    severeWindow || maxPrecipitationProbability >= 75 || maxWindSpeed >= 28
      ? "high"
      : maxPrecipitationProbability >= 45 || maxWindSpeed >= 20
        ? "medium"
        : "low";

  const summaryParts = [];
  summaryParts.push(coatRecommended ? "Bring a coat" : "No heavy coat needed");
  summaryParts.push(
    umbrellaRecommended
      ? firstWetHour
        ? `rain risk starts around ${firstWetHour.time}`
        : "keep an umbrella handy"
      : "looks dry for the next several hours",
  );
  summaryParts.push(
    commuteRisk === "high"
      ? "commute conditions are rough"
      : commuteRisk === "medium"
        ? "expect some commute friction"
        : "commute conditions look manageable",
  );

  return {
    summary: summaryParts.join("; "),
    outdoorScore: Math.max(0, Math.min(100, Math.round(outdoorScore))),
    commuteRisk,
    coatRecommended,
    umbrellaRecommended,
    maxPrecipitationProbabilityPct: Math.round(maxPrecipitationProbability),
    maxWindMph: roundWeatherValue(maxWindSpeed),
    firstWetHour: firstWetHour
      ? {
          time: firstWetHour.time,
          precipitationProbabilityPct: firstWetHour.precipitation_probability_pct,
          condition: firstWetHour.condition,
        }
      : null,
    dryWindowHours: firstWetHour ? hourlyWindow.indexOf(firstWetHour) : hourlyWindow.length,
  };
}

async function handleCurrentWeather(req, res) {
  try {
    const { lat, lon } = getCoordinates(req);
    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        error: "lat and lon are required in the path or query string",
      });
    }

    const resp = await fetch(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${lat}&longitude=${lon}` +
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
        "&hourly=apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=2&timezone=auto",
    );
    const raw = await resp.json();
    const c = raw.current;
    const hourlyWindow = buildHourlyDecisionWindow(raw);
    const current = {
      latitude: raw.latitude,
      longitude: raw.longitude,
      timezone: raw.timezone,
      temperature_f: c.temperature_2m,
      feels_like_f: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m,
      precipitation_in: c.precipitation,
      wind_speed_mph: c.wind_speed_10m,
      wind_direction_deg: c.wind_direction_10m,
      condition: WEATHER_CODES[c.weather_code] || "Unknown",
      weather_code: c.weather_code,
      time: c.time,
    };

    return res.json({
      success: true,
      data: {
        ...current,
        decision: buildDecisionBrief(current, hourlyWindow),
        next12Hours: hourlyWindow,
      },
      source: "Open-Meteo API",
    });
  } catch (err) {
    return res
      .status(502)
      .json({ success: false, error: "Upstream API error", details: err.message });
  }
}

router.get("/api/weather/current/:lat/:lon", handleCurrentWeather);
router.get("/api/weather/current", handleCurrentWeather);

router.get("/api/weather/forecast", async (req, res) => {
  try {
    const lat = req.query.lat ?? "40.7128";
    const lon = req.query.lon ?? "-74.0060";
    const { days } = req.query;

    const forecastDays = Math.min(parseInt(days, 10) || 7, 16);
    const resp = await fetch(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${lat}&longitude=${lon}` +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto" +
        `&forecast_days=${forecastDays}`,
    );
    const raw = await resp.json();
    const daily = raw.daily;

    const forecast = daily.time.map((date, index) => ({
      date,
      high_f: daily.temperature_2m_max[index],
      low_f: daily.temperature_2m_min[index],
      precipitation_in: daily.precipitation_sum[index],
      precip_chance_pct: daily.precipitation_probability_max[index],
      wind_max_mph: daily.wind_speed_10m_max[index],
      condition: WEATHER_CODES[daily.weather_code[index]] || "Unknown",
    }));

    return res.json({
      success: true,
      data: { latitude: raw.latitude, longitude: raw.longitude, timezone: raw.timezone, forecast },
      source: "Open-Meteo API",
    });
  } catch (err) {
    return res
      .status(502)
      .json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.get("/api/weather/historical", async (req, res) => {
  try {
    const { lat, lon } = getCoordinates(req);
    const start = parseIsoDate(req.query.start);
    const end = parseIsoDate(req.query.end);
    if (!lat || !lon) {
      return res.status(400).json({ success: false, error: "lat and lon are required" });
    }
    if (!start || !end) {
      return res
        .status(400)
        .json({ success: false, error: "start and end must be ISO dates (YYYY-MM-DD)" });
    }
    if (getDayDifference(start, end) < 0) {
      return res.status(400).json({ success: false, error: "end date must be on or after start date" });
    }
    if (getDayDifference(start, end) > 31) {
      return res.status(400).json({ success: false, error: "date range cannot exceed 31 days" });
    }

    const response = await fetch(
      "https://archive-api.open-meteo.com/v1/archive" +
        `?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}` +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto",
    );
    const raw = await response.json();
    const daily = raw.daily || {};
    const times = Array.isArray(daily.time) ? daily.time : [];
    const history = times.map((time, index) => ({
      date: time,
      temp_max_f: daily.temperature_2m_max?.[index] ?? null,
      temp_min_f: daily.temperature_2m_min?.[index] ?? null,
      precipitation_in: daily.precipitation_sum?.[index] ?? null,
      wind_max_mph: daily.wind_speed_10m_max?.[index] ?? null,
    }));

    return res.json({
      success: true,
      data: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        timezone: raw.timezone,
        startDate: start,
        endDate: end,
        daily: history,
      },
      source: "Open-Meteo Historical API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.get("/api/weather/alerts/:state", async (req, res) => {
  try {
    const state = normalizeUsState(req.params.state);
    if (!state) {
      return res.status(400).json({ success: false, error: "state must be a 2-letter US code" });
    }

    const userAgentContact = String(process.env.UPSTREAM_CONTACT_EMAIL || "").trim();
    const userAgent = userAgentContact
      ? `x402-data-bazaar/1.0 (${userAgentContact})`
      : "x402-data-bazaar/1.0";
    const response = await fetch(`https://api.weather.gov/alerts/active/area/${state}`, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": userAgent,
      },
    });
    const raw = await response.json();
    const alerts = (raw.features || []).map((feature) => {
      const props = feature.properties || {};
      return {
        id: feature.id || null,
        event: props.event || null,
        severity: props.severity || null,
        certainty: props.certainty || null,
        urgency: props.urgency || null,
        headline: props.headline || null,
        onset: props.onset || null,
        expires: props.expires || null,
        areaDesc: props.areaDesc || null,
        instruction: props.instruction || null,
      };
    });

    return res.json({
      success: true,
      data: { state, count: alerts.length, alerts },
      source: "NWS Alerts API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.get("/api/weather/marine", async (req, res) => {
  try {
    const { lat, lon } = getCoordinates(req);
    if (!lat || !lon) {
      return res.status(400).json({ success: false, error: "lat and lon are required" });
    }
    const hours = Math.max(1, Math.min(72, Number.parseInt(String(req.query.hours || "24"), 10) || 24));

    const response = await fetch(
      "https://marine-api.open-meteo.com/v1/marine" +
        `?latitude=${lat}&longitude=${lon}` +
        "&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height" +
        "&timezone=auto&forecast_days=3",
    );
    const raw = await response.json();
    const hourly = raw.hourly || {};
    const times = Array.isArray(hourly.time) ? hourly.time.slice(0, hours) : [];
    const forecast = times.map((time, index) => ({
      time,
      waveHeight_m: hourly.wave_height?.[index] ?? null,
      waveDirection_deg: hourly.wave_direction?.[index] ?? null,
      wavePeriod_s: hourly.wave_period?.[index] ?? null,
      windWaveHeight_m: hourly.wind_wave_height?.[index] ?? null,
      swellWaveHeight_m: hourly.swell_wave_height?.[index] ?? null,
    }));

    return res.json({
      success: true,
      data: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        timezone: raw.timezone,
        count: forecast.length,
        forecast,
      },
      source: "Open-Meteo Marine API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.get("/api/weather/air-quality", async (req, res) => {
  try {
    const zip = String(req.query.zip || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      return res
        .status(400)
        .json({ success: false, error: "zip query parameter is required and must be a 5-digit ZIP code" });
    }

    const data = await airQualityRoutes.fetchAirQualityByZip(zip);
    return res.json({
      success: true,
      data,
      source: "EPA AirNow API",
    });
  } catch (error) {
    return res
      .status(error.statusCode || 502)
      .json({ success: false, error: error.statusCode ? error.message : "Upstream API error", details: error.message });
  }
});

router.get("/api/uv-index/:lat/:lon", async (req, res) => {
  try {
    const { lat, lon } = getCoordinates(req);
    const latNum = Number.parseFloat(String(lat));
    const lonNum = Number.parseFloat(String(lon));
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return res.status(400).json({ success: false, error: "lat and lon must be numeric" });
    }

    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${latNum}&longitude=${lonNum}&current=uv_index&hourly=uv_index&timezone=auto&forecast_days=2`,
    );
    const raw = await response.json();
    const currentUv = raw.current?.uv_index ?? null;
    const times = Array.isArray(raw.hourly?.time) ? raw.hourly.time : [];
    const values = Array.isArray(raw.hourly?.uv_index) ? raw.hourly.uv_index : [];
    const next12Hours = times.slice(0, 12).map((time, index) => ({
      time,
      uvIndex: values[index] ?? null,
    }));

    let maxEntry = { uvIndex: null, time: null };
    for (let index = 0; index < Math.min(24, values.length); index += 1) {
      const value = values[index];
      if (maxEntry.uvIndex == null || (Number.isFinite(value) && value > maxEntry.uvIndex)) {
        maxEntry = { uvIndex: value, time: times[index] || null };
      }
    }

    return res.json({
      success: true,
      data: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        timezone: raw.timezone,
        current: {
          time: raw.current?.time ?? null,
          uvIndex: currentUv,
        },
        todayMax: maxEntry,
        next12Hours,
      },
      source: "Open-Meteo API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.get("/api/weather/extremes", async (req, res) => {
  try {
    const coordinates = parseCoordinateNumbers(req);
    if (!coordinates) {
      return res.status(400).json({
        success: false,
        error: "lat and lon are required query params and must be valid coordinates",
      });
    }
    const days = Math.max(1, Math.min(16, Number.parseInt(String(req.query.days || "7"), 10) || 7));

    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${coordinates.lat}&longitude=${coordinates.lon}` +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto" +
        `&forecast_days=${days}`,
    );
    const raw = await response.json();
    const daily = raw.daily || {};
    const dates = Array.isArray(daily.time) ? daily.time : [];
    const byDay = dates.map((date, index) => {
      const weatherCode = daily.weather_code?.[index];
      const maxTemp = daily.temperature_2m_max?.[index] ?? null;
      const minTemp = daily.temperature_2m_min?.[index] ?? null;
      const precipitation = daily.precipitation_sum?.[index] ?? null;
      const maxWind = daily.wind_speed_10m_max?.[index] ?? null;

      return {
        date,
        tempMaxF: maxTemp,
        tempMinF: minTemp,
        precipitationIn: precipitation,
        windMaxMph: maxWind,
        condition: WEATHER_CODES[weatherCode] || "Unknown",
        flags: {
          heatRisk: Number.isFinite(maxTemp) && maxTemp >= 95,
          freezeRisk: Number.isFinite(minTemp) && minTemp <= 32,
          heavyRain: Number.isFinite(precipitation) && precipitation >= 1,
          highWind: Number.isFinite(maxWind) && maxWind >= 25,
          severeStorm: Number.isFinite(weatherCode) && weatherCode >= 95,
        },
      };
    });

    const summary = byDay.reduce(
      (acc, day) => {
        acc.heatRiskDays += day.flags.heatRisk ? 1 : 0;
        acc.freezeRiskDays += day.flags.freezeRisk ? 1 : 0;
        acc.heavyRainDays += day.flags.heavyRain ? 1 : 0;
        acc.highWindDays += day.flags.highWind ? 1 : 0;
        acc.severeStormDays += day.flags.severeStorm ? 1 : 0;
        return acc;
      },
      {
        heatRiskDays: 0,
        freezeRiskDays: 0,
        heavyRainDays: 0,
        highWindDays: 0,
        severeStormDays: 0,
      },
    );

    return res.json({
      success: true,
      data: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        timezone: raw.timezone,
        days: byDay.length,
        summary,
        forecast: byDay,
      },
      source: "Open-Meteo API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.get("/api/weather/freeze-risk", async (req, res) => {
  try {
    const coordinates = parseCoordinateNumbers(req);
    if (!coordinates) {
      return res.status(400).json({
        success: false,
        error: "lat and lon are required query params and must be valid coordinates",
      });
    }
    const days = Math.max(1, Math.min(16, Number.parseInt(String(req.query.days || "10"), 10) || 10));
    const thresholdF = Math.max(
      -40,
      Math.min(50, Number.parseFloat(String(req.query.threshold_f || "32")) || 32),
    );

    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${coordinates.lat}&longitude=${coordinates.lon}` +
        "&daily=temperature_2m_min,weather_code" +
        "&temperature_unit=fahrenheit&timezone=auto" +
        `&forecast_days=${days}`,
    );
    const raw = await response.json();
    const daily = raw.daily || {};
    const dates = Array.isArray(daily.time) ? daily.time : [];
    const riskDays = dates
      .map((date, index) => ({
        date,
        tempMinF: daily.temperature_2m_min?.[index] ?? null,
        condition: WEATHER_CODES[daily.weather_code?.[index]] || "Unknown",
      }))
      .filter((entry) => Number.isFinite(entry.tempMinF) && entry.tempMinF <= thresholdF);

    const riskLevel =
      riskDays.length >= 4 ? "high" : riskDays.length >= 2 ? "medium" : riskDays.length >= 1 ? "low" : "none";

    return res.json({
      success: true,
      data: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        timezone: raw.timezone,
        thresholdF,
        daysScanned: dates.length,
        riskLevel,
        freezeDays: riskDays,
        firstFreezeDate: riskDays[0]?.date || null,
      },
      source: "Open-Meteo API",
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Upstream API error", details: error.message });
  }
});

router.buildDecisionBrief = buildDecisionBrief;
router.buildHourlyDecisionWindow = buildHourlyDecisionWindow;
router.parseIsoDate = parseIsoDate;
router.normalizeUsState = normalizeUsState;
router.getDayDifference = getDayDifference;
router.parseCoordinateNumbers = parseCoordinateNumbers;

module.exports = router;
