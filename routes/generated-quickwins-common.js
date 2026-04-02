const crypto = require("node:crypto");

const LOWER_ALPHA_NUMERIC = "abcdefghijklmnopqrstuvwxyz0123456789";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPlainObject(value) {
  return isPlainObject(value) ? value : {};
}

function getBodyAndQuery(req) {
  return {
    body: toPlainObject(req.body),
    query: toPlainObject(req.query),
  };
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      continue;
    }
    return value;
  }
  return undefined;
}

function readString(value, fallback = "") {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseIsoDate(value) {
  const text = readString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (parsed.toISOString().slice(0, 10) !== text) {
    return null;
  }
  return parsed;
}

function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

function extractWords(text) {
  return readString(text)
    .toLowerCase()
    .match(/[a-z']+/g) || [];
}

function countSyllables(word) {
  const cleaned = readString(word).toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) {
    return 0;
  }
  if (cleaned.length <= 3) {
    return 1;
  }

  const withoutSilentE = cleaned.replace(/e$/, "");
  const groups = withoutSilentE.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function normalizeSlug(value) {
  return readString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createQuickCode(length = 7) {
  const size = Math.max(4, Number.parseInt(length, 10) || 7);
  const bytes = crypto.randomBytes(size);
  let output = "";
  for (let index = 0; index < size; index += 1) {
    output += LOWER_ALPHA_NUMERIC[bytes[index] % LOWER_ALPHA_NUMERIC.length];
  }
  return output;
}

function randomPick(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  return values[crypto.randomInt(values.length)];
}

function escapeHtml(value) {
  return readString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text) {
  let rendered = escapeHtml(text);
  rendered = rendered.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_all, label, url) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
  );
  rendered = rendered.replace(/`([^`]+)`/g, (_all, value) => `<code>${escapeHtml(value)}</code>`);
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return rendered;
}

function markdownToHtml(markdownInput) {
  const lines = readString(markdownInput).split(/\r?\n/);
  const html = [];
  let inCodeBlock = false;
  let listMode = null;

  function closeList() {
    if (!listMode) {
      return;
    }
    html.push(listMode === "ol" ? "</ol>" : "</ul>");
    listMode = null;
  }

  for (const rawLine of lines) {
    const line = readString(rawLine);
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      closeList();
      if (inCodeBlock) {
        html.push("</code></pre>");
      } else {
        const language = escapeHtml(trimmed.slice(3).trim());
        const classAttr = language ? ` class="language-${language}"` : "";
        html.push(`<pre><code${classAttr}>`);
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      html.push(escapeHtml(line));
      continue;
    }

    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const blockquote = trimmed.match(/^>\s?(.*)$/);
    if (blockquote) {
      closeList();
      html.push(`<blockquote><p>${renderInlineMarkdown(blockquote[1])}</p></blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      if (listMode !== "ul") {
        closeList();
        html.push("<ul>");
        listMode = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listMode !== "ol") {
        closeList();
        html.push("<ol>");
        listMode = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  if (inCodeBlock) {
    html.push("</code></pre>");
  }
  closeList();
  return html.join("\n");
}

function parseCsv(csvInput, delimiter = ",") {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const normalized = readString(csvInput).replace(/\r\n/g, "\n");
  const separator = readString(delimiter || ",").charAt(0) || ",";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
        continue;
      }
      if (character === '"') {
        inQuotes = false;
        continue;
      }
      field += character;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === separator) {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n") {
      row.push(field);
      const hasContent = row.some((value) => readString(value).trim().length > 0);
      if (hasContent) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += character;
  }

  row.push(field);
  if (row.some((value) => readString(value).trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function applyCase(templateWord, replacementWord) {
  const template = readString(templateWord);
  if (!template) {
    return replacementWord;
  }
  if (template === template.toUpperCase()) {
    return replacementWord.toUpperCase();
  }
  if (template[0] === template[0].toUpperCase()) {
    return replacementWord[0].toUpperCase() + replacementWord.slice(1);
  }
  return replacementWord;
}

function diffInCalendarMonths(startDate, endDate) {
  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();
  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth();
  const endDay = endDate.getUTCDate();
  let months = (endYear - startYear) * 12 + (endMonth - startMonth);
  if (endDay < startDay) {
    months -= 1;
  }
  return months;
}

module.exports = {
  getBodyAndQuery,
  pickFirstDefined,
  readString,
  clamp,
  parseIsoDate,
  toIsoDate,
  extractWords,
  countSyllables,
  normalizeSlug,
  createQuickCode,
  randomPick,
  markdownToHtml,
  parseCsv,
  applyCase,
  diffInCalendarMonths,
};
