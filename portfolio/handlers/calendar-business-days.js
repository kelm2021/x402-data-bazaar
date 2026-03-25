const fetch = require("node-fetch");

const DEFAULT_TIME_ZONE_BY_COUNTRY = {
  AU: "Australia/Sydney",
  CA: "America/Toronto",
  GB: "Europe/London",
  JP: "Asia/Tokyo",
  US: "America/New_York",
};

function normalizeCountryCode(country) {
  return String(country ?? "").trim().toUpperCase();
}

function parseIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === text ? text : null;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDayOfWeekLabel(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function isWeekendDate(isoDate) {
  const dayOfWeek = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function resolveTimeZone(countryCode, requestedTimeZone) {
  const candidate = String(requestedTimeZone ?? "").trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch (error) {
      return null;
    }
  }

  return DEFAULT_TIME_ZONE_BY_COUNTRY[countryCode] ?? "UTC";
}

function getDateInTimeZone(timeZone, value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function summarizeHoliday(holiday) {
  if (!holiday) {
    return null;
  }

  return {
    name: holiday.name,
    localName: holiday.localName,
    types: holiday.types,
  };
}

function createHolidayIndex(holidays) {
  const holidayMap = new Map();
  const sorted = [...holidays].sort((left, right) => left.date.localeCompare(right.date));

  for (const holiday of sorted) {
    holidayMap.set(holiday.date, holiday);
  }

  return {
    holidayMap,
    holidays: sorted,
  };
}

function findNextHoliday(holidays, fromDate) {
  return holidays.find((holiday) => holiday.date > fromDate) ?? null;
}

function findNextBusinessDay(fromDate, holidayMap) {
  let daysAhead = 0;
  let candidate = fromDate;

  while (daysAhead < 370) {
    const holiday = holidayMap.get(candidate);
    if (!holiday && !isWeekendDate(candidate)) {
      return {
        date: candidate,
        dayOfWeek: getDayOfWeekLabel(candidate),
        daysAhead,
      };
    }

    candidate = addDays(candidate, 1);
    daysAhead += 1;
  }

  throw new Error("Unable to resolve next business day within one year");
}

function buildBusinessDaySnapshot(countryCode, isoDate, timeZone, holidayIndex) {
  const holiday = holidayIndex.holidayMap.get(isoDate) ?? null;
  const nextHoliday = findNextHoliday(holidayIndex.holidays, isoDate);
  const nextBusinessDay = findNextBusinessDay(isoDate, holidayIndex.holidayMap);

  return {
    country: countryCode,
    date: isoDate,
    timeZone,
    dayOfWeek: getDayOfWeekLabel(isoDate),
    isHoliday: Boolean(holiday),
    isWeekend: isWeekendDate(isoDate),
    isBusinessDay: !holiday && !isWeekendDate(isoDate),
    holiday: summarizeHoliday(holiday),
    nextHoliday: nextHoliday ? { date: nextHoliday.date, name: nextHoliday.name } : null,
    nextBusinessDay,
  };
}

async function fetchHolidayYear(countryCode, year) {
  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function loadHolidayIndex(countryCode, startDate) {
  const startYear = Number(startDate.slice(0, 4));
  const results = await Promise.all([
    fetchHolidayYear(countryCode, startYear),
    fetchHolidayYear(countryCode, startYear + 1),
  ]);
  const holidays = results.filter(Array.isArray).flat();

  if (!holidays.length) {
    return null;
  }

  return createHolidayIndex(holidays);
}

async function handleToday(req, res) {
  const countryCode = normalizeCountryCode(req.params.country);
  const timeZone = resolveTimeZone(countryCode, req.query.tz);

  if (!timeZone) {
    return res.status(400).json({ success: false, error: "Invalid IANA time zone" });
  }

  const today = getDateInTimeZone(timeZone);
  const holidayIndex = await loadHolidayIndex(countryCode, today);

  if (!holidayIndex) {
    return res.status(400).json({
      success: false,
      error: `No data for ${countryCode}. Use ISO 3166-1 alpha-2 codes.`,
    });
  }

  return res.json({
    success: true,
    data: buildBusinessDaySnapshot(countryCode, today, timeZone, holidayIndex),
    source: "Nager.Date API",
  });
}

async function handleNextBusinessDay(req, res) {
  const countryCode = normalizeCountryCode(req.params.country);
  const inputDate = parseIsoDate(req.params.date);

  if (!inputDate) {
    return res.status(400).json({
      success: false,
      error: "date must be in YYYY-MM-DD format",
    });
  }

  const timeZone = resolveTimeZone(countryCode, req.query.tz);
  if (!timeZone) {
    return res.status(400).json({ success: false, error: "Invalid IANA time zone" });
  }

  const holidayIndex = await loadHolidayIndex(countryCode, inputDate);
  if (!holidayIndex) {
    return res.status(400).json({
      success: false,
      error: `No data for ${countryCode}. Use ISO 3166-1 alpha-2 codes.`,
    });
  }

  const snapshot = buildBusinessDaySnapshot(countryCode, inputDate, timeZone, holidayIndex);

  return res.json({
    success: true,
    data: {
      country: countryCode,
      inputDate,
      timeZone,
      inputDayOfWeek: snapshot.dayOfWeek,
      isInputHoliday: snapshot.isHoliday,
      isInputWeekend: snapshot.isWeekend,
      isInputBusinessDay: snapshot.isBusinessDay,
      holiday: snapshot.holiday,
      nextHoliday: snapshot.nextHoliday,
      nextBusinessDay: snapshot.nextBusinessDay,
    },
    source: "Nager.Date API",
  });
}

async function handleHolidayYear(req, res) {
  const countryCode = normalizeCountryCode(req.params.country);
  const year = String(req.params.year ?? "").trim();
  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);

  if (!response.ok) {
    return res.status(400).json({
      success: false,
      error: `No data for ${countryCode}/${year}. Use ISO 3166-1 alpha-2 codes.`,
    });
  }

  const holidays = await response.json();
  return res.json({
    success: true,
    data: {
      country: countryCode,
      year: Number.parseInt(year, 10),
      count: holidays.length,
      holidays: holidays.map((holiday) => ({
        date: holiday.date,
        name: holiday.name,
        localName: holiday.localName,
        types: holiday.types,
        global: holiday.global,
      })),
    },
    source: "Nager.Date API",
  });
}

module.exports = async function primaryHandler(req, res) {
  try {
    if (req.route?.path === "/api/holidays/today/:country") {
      return await handleToday(req, res);
    }

    if (req.route?.path === "/api/business-days/next/:country/:date") {
      return await handleNextBusinessDay(req, res);
    }

    return await handleHolidayYear(req, res);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: "Upstream API error",
      details: error.message,
    });
  }
};
