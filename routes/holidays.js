const fetch = require("node-fetch");
const { Router } = require("express");
const router = Router();

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

function createHolidayIndex(holidays, metadata = {}) {
  const holidayMap = new Map();
  const sorted = [...holidays].sort((left, right) => left.date.localeCompare(right.date));

  for (const holiday of sorted) {
    holidayMap.set(holiday.date, holiday);
  }

  return {
    holidayMap,
    holidays: sorted,
    ...metadata,
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

function buildBusinessDayDecision(snapshot) {
  if (snapshot.isBusinessDay) {
    return {
      status: "business-day",
      summary: `${snapshot.date} is a business day in ${snapshot.country}.`,
      recommendedAction:
        "Proceed with normal operations and same-day cutoffs if your internal deadlines are still open.",
    };
  }

  if (snapshot.isHoliday) {
    return {
      status: "holiday",
      summary: `${snapshot.date} is ${snapshot.holiday?.name ?? "a holiday"} in ${snapshot.country}.`,
      recommendedAction:
        "Delay non-urgent settlements and outbound operational deadlines until the next business day.",
      nextBusinessDay: snapshot.nextBusinessDay,
    };
  }

  if (snapshot.isWeekend) {
    return {
      status: "weekend",
      summary: `${snapshot.date} falls on a weekend in ${snapshot.country}.`,
      recommendedAction:
        "Shift time-sensitive processing to the next business day unless your workflow explicitly supports weekend handling.",
      nextBusinessDay: snapshot.nextBusinessDay,
    };
  }

  return {
    status: "non-business-day",
    summary: `${snapshot.date} is not a business day in ${snapshot.country}.`,
    recommendedAction: "Use the returned nextBusinessDay as the operational execution date.",
    nextBusinessDay: snapshot.nextBusinessDay,
  };
}

async function fetchHolidayYear(countryCode, year, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
    );

    if (!response.ok) {
      return null;
    }

    const holidays = await response.json();
    return Array.isArray(holidays) ? holidays : null;
  } catch (_error) {
    return null;
  }
}

function toIsoDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0)).toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
  const date = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCDate(date.getUTCDate() + ((occurrence - 1) * 7));
  return date.toISOString().slice(0, 10);
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function createHoliday(date, name, localName = name, types = ["Public"]) {
  return { date, name, localName, types, global: true };
}

function createObservedFixedHoliday(year, monthIndex, day, name, localName = name, types = ["Public"]) {
  const actualDate = toIsoDate(year, monthIndex, day);
  const holidays = [createHoliday(actualDate, name, localName, types)];
  const observedDate = observeWeekendHoliday(actualDate);

  if (observedDate !== actualDate) {
    holidays.push(
      createHoliday(
        observedDate,
        `${name} (observed)`,
        `${localName} (observed)`,
        types,
      ),
    );
  }

  return holidays.filter((holiday) => holiday.date.startsWith(`${year}-`));
}

function observeWeekendHoliday(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 6) {
    return addDays(isoDate, -1);
  }
  if (dayOfWeek === 0) {
    return addDays(isoDate, 1);
  }
  return isoDate;
}

function dedupeAndSortHolidays(holidays) {
  const byDate = new Map();
  for (const holiday of holidays) {
    if (!holiday?.date || byDate.has(holiday.date)) {
      continue;
    }
    byDate.set(holiday.date, holiday);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function buildFallbackHolidayYear(countryCode, year) {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const holidays = [];

  switch (normalizedCountry) {
    case "US":
      holidays.push(...createObservedFixedHoliday(year, 0, 1, "New Year's Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 0, 1, 3), "Martin Luther King, Jr. Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 1, 1, 3), "Washington's Birthday"));
      holidays.push(createHoliday(lastWeekdayOfMonth(year, 4, 1), "Memorial Day"));
      holidays.push(...createObservedFixedHoliday(year, 5, 19, "Juneteenth National Independence Day"));
      holidays.push(...createObservedFixedHoliday(year, 6, 4, "Independence Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 8, 1, 1), "Labor Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 9, 1, 2), "Columbus Day"));
      holidays.push(...createObservedFixedHoliday(year, 10, 11, "Veterans Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 10, 4, 4), "Thanksgiving Day"));
      holidays.push(...createObservedFixedHoliday(year, 11, 25, "Christmas Day"));
      break;
    case "CA":
      holidays.push(...createObservedFixedHoliday(year, 0, 1, "New Year's Day"));
      holidays.push(...createObservedFixedHoliday(year, 6, 1, "Canada Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 8, 1, 1), "Labour Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 9, 1, 2), "Thanksgiving"));
      holidays.push(...createObservedFixedHoliday(year, 11, 25, "Christmas Day"));
      holidays.push(...createObservedFixedHoliday(year, 11, 26, "Boxing Day"));
      break;
    case "GB":
      holidays.push(...createObservedFixedHoliday(year, 0, 1, "New Year's Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 4, 1, 1), "Early May Bank Holiday"));
      holidays.push(createHoliday(lastWeekdayOfMonth(year, 7, 1), "Summer Bank Holiday"));
      holidays.push(...createObservedFixedHoliday(year, 11, 25, "Christmas Day"));
      holidays.push(...createObservedFixedHoliday(year, 11, 26, "Boxing Day"));
      break;
    case "AU":
      holidays.push(...createObservedFixedHoliday(year, 0, 1, "New Year's Day"));
      holidays.push(...createObservedFixedHoliday(year, 0, 26, "Australia Day"));
      holidays.push(...createObservedFixedHoliday(year, 3, 25, "Anzac Day"));
      holidays.push(createHoliday(nthWeekdayOfMonth(year, 9, 1, 1), "Labour Day"));
      holidays.push(...createObservedFixedHoliday(year, 11, 25, "Christmas Day"));
      holidays.push(...createObservedFixedHoliday(year, 11, 26, "Boxing Day"));
      break;
    case "JP":
      holidays.push(...createObservedFixedHoliday(year, 0, 1, "New Year's Day"));
      holidays.push(...createObservedFixedHoliday(year, 1, 11, "National Foundation Day"));
      holidays.push(...createObservedFixedHoliday(year, 1, 23, "Emperor's Birthday"));
      holidays.push(...createObservedFixedHoliday(year, 3, 29, "Showa Day"));
      holidays.push(...createObservedFixedHoliday(year, 4, 3, "Constitution Memorial Day"));
      holidays.push(...createObservedFixedHoliday(year, 4, 4, "Greenery Day"));
      holidays.push(...createObservedFixedHoliday(year, 4, 5, "Children's Day"));
      holidays.push(...createObservedFixedHoliday(year, 7, 11, "Mountain Day"));
      holidays.push(...createObservedFixedHoliday(year, 10, 3, "Culture Day"));
      holidays.push(...createObservedFixedHoliday(year, 10, 23, "Labor Thanksgiving Day"));
      break;
    default:
      return null;
  }

  return dedupeAndSortHolidays(holidays);
}

async function loadHolidayYear(countryCode, year, fetchImpl = fetch) {
  const remoteHolidays = await fetchHolidayYear(countryCode, year, fetchImpl);
  if (Array.isArray(remoteHolidays) && remoteHolidays.length) {
    return { holidays: remoteHolidays, source: "Nager.Date API" };
  }

  const fallbackHolidays = buildFallbackHolidayYear(countryCode, year);
  if (Array.isArray(fallbackHolidays) && fallbackHolidays.length) {
    return { holidays: fallbackHolidays, source: "Deterministic fallback calendar" };
  }

  return null;
}

async function loadHolidayIndex(countryCode, startDate, fetchImpl = fetch) {
  const startYear = Number(startDate.slice(0, 4));
  const results = await Promise.all([
    loadHolidayYear(countryCode, startYear, fetchImpl),
    loadHolidayYear(countryCode, startYear + 1, fetchImpl),
  ]);
  const holidays = results
    .filter(Boolean)
    .flatMap((result) => result.holidays);

  if (!holidays.length) {
    return null;
  }

  const fallbackUsed = results.some((result) => result?.source === "Deterministic fallback calendar");
  return createHolidayIndex(holidays, {
    source: fallbackUsed ? "Deterministic fallback calendar" : "Nager.Date API",
  });
}

// This must come BEFORE /:country/:year to avoid "today" matching as a country
router.get("/api/holidays/today/:country", async (req, res) => {
  try {
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

    const snapshot = buildBusinessDaySnapshot(countryCode, today, timeZone, holidayIndex);

    res.json({
      success: true,
      data: {
        ...snapshot,
        decision: buildBusinessDayDecision(snapshot),
      },
      source: holidayIndex.source || "Nager.Date API",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.get("/api/business-days/next/:country/:date", async (req, res) => {
  try {
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

    res.json({
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
        decision: buildBusinessDayDecision(snapshot),
      },
      source: holidayIndex.source || "Nager.Date API",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.get("/api/holidays/:country/:year", async (req, res) => {
  try {
    const { country, year } = req.params;
    const holidayYear = await loadHolidayYear(country.toUpperCase(), Number(year));
    if (!holidayYear) {
      return res.status(400).json({ success: false, error: `No data for ${country}/${year}. Use ISO 3166-1 alpha-2 codes.` });
    }
    const holidays = holidayYear.holidays;

    res.json({
      success: true,
      data: {
        country: country.toUpperCase(),
        year: parseInt(year),
        count: holidays.length,
        holidays: holidays.map((h) => ({
          date: h.date,
          name: h.name,
          localName: h.localName,
          types: h.types,
          global: h.global,
        })),
      },
      source: holidayYear.source || "Nager.Date API",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.buildBusinessDaySnapshot = buildBusinessDaySnapshot;
router.findNextBusinessDay = findNextBusinessDay;
router.resolveTimeZone = resolveTimeZone;
router.getDateInTimeZone = getDateInTimeZone;
router.parseIsoDate = parseIsoDate;
router.createHolidayIndex = createHolidayIndex;
router.buildFallbackHolidayYear = buildFallbackHolidayYear;
router.loadHolidayYear = loadHolidayYear;
router.loadHolidayIndex = loadHolidayIndex;

module.exports = router;
