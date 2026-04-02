const crypto = require("node:crypto");
const {
  getBodyAndQuery,
  pickFirstDefined,
  readString,
  clamp,
  parseIsoDate,
  toIsoDate,
  createQuickCode,
  markdownToHtml,
  parseCsv,
  diffInCalendarMonths,
} = require("./generated-quickwins-common");

function handleConvertCsvToJson(req) {
  const { body, query } = getBodyAndQuery(req);
  const csv = readString(
    pickFirstDefined(body.csv, body.text, body.input, query.csv, "name,age,city\nAlice,30,Austin\nBob,25,Chicago"),
  );
  const delimiter = readString(pickFirstDefined(body.delimiter, query.delimiter, ",")).slice(0, 1) || ",";
  const rows = parseCsv(csv, delimiter);
  const hasHeaders = pickFirstDefined(body.hasHeaders, query.hasHeaders, true);
  const useHeaders = !(String(hasHeaders).toLowerCase() === "false" || String(hasHeaders) === "0");
  const headers = useHeaders && rows.length ? rows[0].map((value, index) => readString(value).trim() || `column_${index + 1}`) : null;
  const bodyRows = useHeaders ? rows.slice(1) : rows;
  const data = headers
    ? bodyRows.map((row) => {
        const item = {};
        for (let index = 0; index < headers.length; index += 1) {
          item[headers[index]] = readString(row[index] ?? "");
        }
        return item;
      })
    : bodyRows;

  return {
    success: true,
    data: {
      delimiter,
      hasHeaders: Boolean(headers),
      headers: headers || [],
      rowCount: data.length,
      rows: data,
    },
    source: "local-csv-parser",
  };
}

function handleConvertMdToHtml(req) {
  const { body, query } = getBodyAndQuery(req);
  const markdown = readString(
    pickFirstDefined(body.markdown, body.md, body.text, body.input, query.markdown, "# Sample\n\n- quick\n- win"),
  );
  const html = markdownToHtml(markdown);
  return {
    success: true,
    data: {
      markdown,
      html,
      lineCount: markdown.split(/\r?\n/).length,
    },
    source: "local-markdown-renderer",
  };
}

function handleEncodeBase64(req) {
  const { body, query } = getBodyAndQuery(req);
  const value = pickFirstDefined(body.text, body.value, body.input, query.text, query.value, "");
  const input = typeof value === "string" ? value : JSON.stringify(value);
  const encoded = Buffer.from(input, "utf8").toString("base64");
  return {
    success: true,
    data: {
      input,
      base64: encoded,
      byteLength: Buffer.byteLength(input, "utf8"),
    },
    source: "node-buffer",
  };
}

function handleUuidGenerate() {
  return {
    success: true,
    data: {
      uuid: crypto.randomUUID(),
      version: "v4",
    },
    source: "node-crypto",
  };
}

function buildPassword(options = {}) {
  const rawLength = Number.parseInt(readString(options.length || 16), 10);
  const length = clamp(Number.isFinite(rawLength) ? rawLength : 16, 8, 128);
  const includeUpper = options.uppercase !== false;
  const includeLower = options.lowercase !== false;
  const includeNumbers = options.numbers !== false;
  const includeSymbols = Boolean(options.symbols);
  const symbols = "!@#$%^&*()-_=+[]{};:,.?";

  const pools = [];
  if (includeUpper) pools.push("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  if (includeLower) pools.push("abcdefghijklmnopqrstuvwxyz");
  if (includeNumbers) pools.push("0123456789");
  if (includeSymbols) pools.push(symbols);
  if (!pools.length) pools.push("abcdefghijklmnopqrstuvwxyz");

  const allCharacters = pools.join("");
  const chars = [];
  for (const pool of pools) {
    chars.push(pool[crypto.randomInt(pool.length)]);
  }
  while (chars.length < length) {
    chars.push(allCharacters[crypto.randomInt(allCharacters.length)]);
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }

  return {
    password: chars.join(""),
    charsetSize: allCharacters.length,
    length,
  };
}

function handlePasswordGenerate(req) {
  const { body, query } = getBodyAndQuery(req);
  const complexity = readString(pickFirstDefined(body.complexity, query.complexity, "medium")).toLowerCase();
  const defaultSymbols = complexity === "high";
  const config = {
    length: pickFirstDefined(body.length, query.length, complexity === "high" ? 20 : 16),
    uppercase: pickFirstDefined(body.uppercase, query.uppercase, true) !== false,
    lowercase: pickFirstDefined(body.lowercase, query.lowercase, true) !== false,
    numbers: pickFirstDefined(body.numbers, query.numbers, true) !== false,
    symbols: pickFirstDefined(body.symbols, query.symbols, defaultSymbols),
  };
  const generated = buildPassword(config);
  return {
    success: true,
    data: {
      password: generated.password,
      length: generated.length,
      complexity,
      charsetSize: generated.charsetSize,
      entropyBits: Number((generated.length * Math.log2(generated.charsetSize)).toFixed(1)),
    },
    source: "crypto-random-password",
  };
}

function handleUrlShorten(req) {
  const { body, query } = getBodyAndQuery(req);
  const originalUrl = readString(
    pickFirstDefined(body.url, body.longUrl, body.target, query.url, query.longUrl, "https://x402.aurelianflo.com"),
  ).trim();
  let normalized;
  try {
    normalized = new URL(originalUrl).toString();
  } catch (_error) {
    return {
      success: false,
      error: "invalid_url",
      message: "Provide a valid absolute URL.",
    };
  }

  const hash = crypto.createHash("sha256").update(normalized).digest("base64url").replace(/[-_]/g, "");
  const shortCode = (hash.slice(0, 8) || createQuickCode(8)).toLowerCase();
  const base = readString(pickFirstDefined(body.baseUrl, query.baseUrl, process.env.SHORT_URL_BASE, "https://x402.aurelianflo.com/u")).replace(/\/+$/, "");
  const shortUrl = `${base}/${shortCode}`;

  return {
    success: true,
    data: {
      originalUrl: normalized,
      shortCode,
      shortUrl,
    },
    source: "deterministic-sha256-shortener",
  };
}

function handleUtilDateDiff(req) {
  const { body, query } = getBodyAndQuery(req);
  const todayIso = toIsoDate(new Date());
  const startDateInput = pickFirstDefined(body.startDate, body.from, query.startDate, query.from, todayIso);
  const endDateInput = pickFirstDefined(body.endDate, body.to, query.endDate, query.to, todayIso);
  const startDate = parseIsoDate(startDateInput);
  const endDate = parseIsoDate(endDateInput);
  if (!startDate || !endDate) {
    return {
      success: false,
      error: "invalid_date",
      message: "Use YYYY-MM-DD for startDate and endDate.",
    };
  }

  const msDiff = endDate.getTime() - startDate.getTime();
  const signedDays = Math.round(msDiff / (24 * 60 * 60 * 1000));
  const absoluteDays = Math.abs(signedDays);
  const direction = signedDays === 0 ? "same-day" : signedDays > 0 ? "forward" : "backward";
  const monthDiff = diffInCalendarMonths(startDate, endDate);

  return {
    success: true,
    data: {
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
      direction,
      signedDays,
      absolute: {
        days: absoluteDays,
        weeks: Number((absoluteDays / 7).toFixed(2)),
        months: Math.abs(monthDiff),
        years: Number((Math.abs(monthDiff) / 12).toFixed(2)),
      },
    },
    source: "local-date-math",
  };
}

function calculateAgeParts(birthDate, currentDate) {
  let years = currentDate.getUTCFullYear() - birthDate.getUTCFullYear();
  let months = currentDate.getUTCMonth() - birthDate.getUTCMonth();
  let days = currentDate.getUTCDate() - birthDate.getUTCDate();

  if (days < 0) {
    const previousMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 0));
    days += previousMonth.getUTCDate();
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return {
    years: Math.max(0, years),
    months: Math.max(0, months),
    days: Math.max(0, days),
  };
}

function handleUtilAge(req) {
  const { body, query } = getBodyAndQuery(req);
  const birthdateInput = pickFirstDefined(
    body.birthdate,
    body.birthDate,
    body.dob,
    query.birthdate,
    query.birthDate,
    query.dob,
    "1990-01-01",
  );
  const birthDate = parseIsoDate(birthdateInput);
  if (!birthDate) {
    return {
      success: false,
      error: "invalid_birthdate",
      message: "Use YYYY-MM-DD for birthdate.",
    };
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (birthDate.getTime() > today.getTime()) {
    return {
      success: false,
      error: "invalid_birthdate",
      message: "birthdate cannot be in the future.",
    };
  }

  const age = calculateAgeParts(birthDate, today);
  let nextBirthday = new Date(Date.UTC(
    today.getUTCFullYear(),
    birthDate.getUTCMonth(),
    birthDate.getUTCDate(),
  ));
  if (nextBirthday.getTime() < today.getTime()) {
    nextBirthday = new Date(Date.UTC(
      today.getUTCFullYear() + 1,
      birthDate.getUTCMonth(),
      birthDate.getUTCDate(),
    ));
  }
  const daysUntilNextBirthday = Math.round((nextBirthday.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  return {
    success: true,
    data: {
      birthdate: toIsoDate(birthDate),
      age,
      nextBirthday: toIsoDate(nextBirthday),
      daysUntilNextBirthday,
    },
    source: "local-age-calculator",
  };
}

module.exports = {
  handleConvertCsvToJson,
  handleConvertMdToHtml,
  handleEncodeBase64,
  handleUuidGenerate,
  handlePasswordGenerate,
  handleUrlShorten,
  handleUtilDateDiff,
  handleUtilAge,
};
