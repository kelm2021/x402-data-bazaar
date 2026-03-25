const fetch = require("node-fetch");

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
  const { lat, lon } = getCoordinates(req);
  if (!lat || !lon) {
    return res.status(400).json({
      success: false,
      error: "lat and lon are required in the path or query string",
    });
  }

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&hourly=apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=2&timezone=auto`,
  );
  const raw = await response.json();
  const currentRaw = raw.current;

  if (!currentRaw) {
    return res.status(502).json({
      success: false,
      error: "Upstream weather data missing current conditions",
    });
  }

  const hourlyWindow = buildHourlyDecisionWindow(raw);
  const current = {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    temperature_f: currentRaw.temperature_2m,
    feels_like_f: currentRaw.apparent_temperature,
    humidity_pct: currentRaw.relative_humidity_2m,
    precipitation_in: currentRaw.precipitation,
    wind_speed_mph: currentRaw.wind_speed_10m,
    wind_direction_deg: currentRaw.wind_direction_10m,
    condition: WEATHER_CODES[currentRaw.weather_code] || "Unknown",
    weather_code: currentRaw.weather_code,
    time: currentRaw.time,
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
}

async function handleForecast(req, res) {
  const { lat, lon, days } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({
      success: false,
      error: "lat and lon query params required",
    });
  }

  const forecastDays = Math.min(parseInt(days, 10) || 7, 16);
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=${forecastDays}`,
  );
  const raw = await response.json();
  const daily = raw.daily;

  if (!daily || !Array.isArray(daily.time)) {
    return res.status(502).json({
      success: false,
      error: "Upstream weather data missing daily forecast",
    });
  }

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
    data: {
      latitude: raw.latitude,
      longitude: raw.longitude,
      timezone: raw.timezone,
      forecast,
    },
    source: "Open-Meteo API",
  });
}

module.exports = async function primaryHandler(req, res) {
  try {
    if (req.route?.path === "/api/weather/forecast") {
      return await handleForecast(req, res);
    }

    return await handleCurrentWeather(req, res);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: "Upstream API error",
      details: error.message,
    });
  }
};
