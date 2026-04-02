const crypto = require("node:crypto");

const SOURCE = "auto-local-engine/content";
const CONTENT_GROUPS = [
  { group: "text", marker: "/text/" },
  { group: "edu", marker: "/edu/" },
  { group: "hr", marker: "/hr/" },
  { group: "marketing", marker: "/marketing/" },
  { group: "lang", marker: "/lang/" },
  { group: "random", marker: "/random/" },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
]);

const PARAPHRASE_REPLACEMENTS = [
  [/\bimportant\b/gi, "meaningful"],
  [/\bfast\b/gi, "quick"],
  [/\bgood\b/gi, "strong"],
  [/\bbad\b/gi, "weak"],
  [/\bhelp\b/gi, "support"],
  [/\bmake\b/gi, "create"],
  [/\busing\b/gi, "with"],
  [/\bbecause\b/gi, "since"],
  [/\bshow\b/gi, "demonstrate"],
  [/\bneed\b/gi, "require"],
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObject(value) {
  return isObject(value) ? value : {};
}

function readString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function readNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashText(text) {
  return crypto.createHash("sha256").update(readString(text)).digest("hex");
}

function stableInt(seed, min, max) {
  const range = max - min + 1;
  if (range <= 0) return min;
  const value = Number.parseInt(hashText(seed).slice(0, 12), 16);
  if (!Number.isFinite(value)) return min;
  return min + (value % range);
}

function stablePick(seed, values) {
  if (!values.length) return undefined;
  return values[stableInt(seed, 0, values.length - 1)];
}

function words(text) {
  return readString(text).toLowerCase().match(/[a-z0-9']+/g) || [];
}

function unique(values) {
  return [...new Set(values)];
}

function splitSentences(text) {
  return readString(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function titleCase(text) {
  return readString(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function truncate(text, limit) {
  const value = readString(text).trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function normalizePath(value) {
  return readString(value).toLowerCase();
}

function parseIsoDate(value) {
  const text = readString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === text ? date : null;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => readString(entry).trim()).filter(Boolean);
  }
  const text = readString(value).trim();
  if (!text) return fallback.slice();
  return text
    .split(/\r?\n|,/) 
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ok(data) {
  return { success: true, data, source: SOURCE };
}

function fail(error, reason) {
  return { success: false, error, reason, source: SOURCE };
}

function providerRequired(reason) {
  return fail("provider_required", reason);
}

function normalizeContext(input) {
  const raw = toObject(input);
  const req = toObject(raw.req);
  const body = toObject(pick(raw.body, req.body));
  const query = toObject(pick(raw.query, req.query));
  const params = toObject(pick(raw.params, req.params));
  const path = normalizePath(pick(raw.path, raw.routePath, req.path, req.originalUrl, ""));
  const inputText = readString(
    pick(body.text, body.input, body.prompt, body.topic, body.title, body.subject, body.role, query.text, query.input, query.topic, ""),
  ).trim();
  return { body, query, params, path, inputText };
}

function isContentPath(path) {
  const normalized = normalizePath(path);
  return CONTENT_GROUPS.some(({ marker }) => normalized.includes(marker));
}

function getContentGroup(path) {
  const normalized = normalizePath(path);
  const entry = CONTENT_GROUPS.find(({ marker }) => normalized.includes(marker));
  return entry ? entry.group : null;
}

function getRouteKey(path, group) {
  const normalized = normalizePath(path);
  const match = new RegExp(`/api/tools/${group}/([^/?#]+)`).exec(normalized) || new RegExp(`/${group}/([^/?#]+)`).exec(normalized);
  return match ? match[1] : "";
}

function extractKeywords(text, limit = 10) {
  const counts = new Map();
  for (const token of words(text)) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

function headlineFromText(text) {
  const keywordList = extractKeywords(text, 4).map((entry) => entry.keyword);
  if (keywordList.length) {
    return titleCase(keywordList.join(" "));
  }
  const fallback = truncate(readString(text).replace(/\s+/g, " "), 48);
  return fallback ? titleCase(fallback) : "Clear, Practical Update";
}

function paraphraseText(text) {
  let value = readString(text).replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of PARAPHRASE_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  const sentences = splitSentences(value);
  if (sentences.length > 1) {
    const rotation = stableInt(value, 0, sentences.length - 1);
    value = [...sentences.slice(rotation), ...sentences.slice(0, rotation)].join(" ");
  }
  return value || text;
}

function similarityScore(left, right) {
  const leftTokens = new Set(words(left));
  const rightTokens = new Set(words(right));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return Number((intersection / union).toFixed(4));
}

function detectPiiFindings(text) {
  const value = readString(text);
  const emails = unique(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
  const phones = unique(value.match(/\+?[0-9][0-9\-().\s]{7,}[0-9]/g) || []);
  const ssns = unique(value.match(/\b\d{3}-\d{2}-\d{4}\b/g) || []);
  const creditCards = unique(value.match(/\b(?:\d[ -]*?){13,19}\b/g) || []);

  return {
    emails,
    phones,
    ssns,
    creditCards,
  };
}

function redactPiiText(text) {
  return readString(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?[0-9][0-9\-().\s]{7,}[0-9]/g, "[REDACTED_PHONE]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_CARD]");
}

function tokenizeMathExpression(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < expression.length && /[0-9.]/.test(expression[end])) {
        end += 1;
      }
      const value = Number.parseFloat(expression.slice(index, end));
      if (!Number.isFinite(value)) {
        return null;
      }
      tokens.push({ type: "number", value });
      index = end;
      continue;
    }
    if (/[+\-*/^()]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

function normalizeMathExpression(raw) {
  const source = readString(raw).trim();
  if (!source) {
    return "2+2";
  }
  const normalized = source
    .replace(/[×x]/g, "*")
    .replace(/÷/g, "/")
    .replace(/=/g, "")
    .replace(/,/g, "")
    .trim();
  const extracted = (normalized.match(/[-+*/^().\d\s]+/) || [""])[0].trim();
  if (!extracted) {
    return "2+2";
  }
  return extracted;
}

function toRpn(tokens) {
  const output = [];
  const stack = [];
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const rightAssociative = new Set(["^"]);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "number") {
      output.push(token);
      continue;
    }

    const op = token.value;
    if (op === "(") {
      stack.push(op);
      continue;
    }
    if (op === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") {
        output.push({ type: "operator", value: stack.pop() });
      }
      if (!stack.length || stack[stack.length - 1] !== "(") {
        return null;
      }
      stack.pop();
      continue;
    }

    const prev = i > 0 ? tokens[i - 1] : null;
    if (op === "-" && (!prev || (prev.type === "operator" && prev.value !== ")" && prev.value !== "("))) {
      output.push({ type: "number", value: 0 });
    }

    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!precedence[top]) break;
      const topPrecedence = precedence[top];
      const opPrecedence = precedence[op] || 0;
      const shouldPop = rightAssociative.has(op) ? topPrecedence > opPrecedence : topPrecedence >= opPrecedence;
      if (!shouldPop) break;
      output.push({ type: "operator", value: stack.pop() });
    }
    stack.push(op);
  }

  while (stack.length) {
    const top = stack.pop();
    if (top === "(" || top === ")") {
      return null;
    }
    output.push({ type: "operator", value: top });
  }
  return output;
}

function evaluateRpn(rpn) {
  const stack = [];
  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    const b = stack.pop();
    const a = stack.pop();
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }

    switch (token.value) {
      case "+":
        stack.push(a + b);
        break;
      case "-":
        stack.push(a - b);
        break;
      case "*":
        stack.push(a * b);
        break;
      case "/":
        if (b === 0) return null;
        stack.push(a / b);
        break;
      case "^":
        stack.push(a ** b);
        break;
      default:
        return null;
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    return null;
  }
  return stack[0];
}

function buildMathPayload(context) {
  const rawExpression = pick(
    context.body.expression,
    context.body.problem,
    context.body.text,
    context.query.expression,
    context.query.problem,
    context.inputText,
    "2+2",
  );
  const expression = normalizeMathExpression(rawExpression);
  const tokens = tokenizeMathExpression(expression);
  if (!tokens || !tokens.length) {
    return fail("invalid_input", "Could not parse a math expression.");
  }

  const rpn = toRpn(tokens);
  if (!rpn) {
    return fail("invalid_input", "Expression syntax is invalid.");
  }

  const result = evaluateRpn(rpn);
  if (!Number.isFinite(result)) {
    return fail("invalid_input", "Expression could not be evaluated.");
  }

  return ok({
    expression,
    result: Number(result.toFixed(10)),
    tokens: tokens.map((token) => (token.type === "number" ? token.value : token.value)),
    steps: ["normalized_expression", "tokenized_expression", "converted_to_rpn", "evaluated_rpn"],
  });
}
function buildTextPayload(context, routeKey) {
  const { body, query, inputText } = context;
  const text = readString(pick(body.text, body.input, query.text, inputText)).trim();

  if (routeKey === "keywords") {
    const keywords = extractKeywords(text, 12);
    return ok({ text, tokenCount: words(text).length, keywords, capabilities: ["keyword_extraction", "frequency_analysis"] });
  }

  if (routeKey === "summary-bullets" || routeKey === "summary" || routeKey === "summarize") {
    const bullets = splitSentences(text).slice(0, 5).map((line) => truncate(line, 140));
    return ok({ text, sentenceCount: splitSentences(text).length, bullets, summary: bullets.join(" "), capabilities: ["extractive_summarization"] });
  }

  if (routeKey === "headline") {
    const headline = headlineFromText(text);
    const alternate = titleCase(extractKeywords(text, 2).map((entry) => entry.keyword).join(" ")) || headline;
    return ok({ text, headline, alternates: unique([headline, alternate]).slice(0, 3), capabilities: ["headline_generation"] });
  }

  if (routeKey === "paraphrase") {
    const paraphrasedText = paraphraseText(text);
    return ok({ originalText: text, paraphrasedText, capabilities: ["paraphrase"] });
  }

  if (routeKey === "similarity") {
    const left = readString(pick(body.textA, body.left, query.textA, text)).trim();
    const right = readString(pick(body.textB, body.right, query.textB, left)).trim();
    return ok({ left, right, similarity: similarityScore(left, right), method: "jaccard", capabilities: ["text_similarity"] });
  }

  if (routeKey === "entities") {
    const properNouns = unique((text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []).slice(0, 20));
    const emails = unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
    const urls = unique(text.match(/https?:\/\/[^\s]+/gi) || []);
    const entities = [
      ...properNouns.map((value) => ({ type: "proper_noun", value })),
      ...emails.map((value) => ({ type: "email", value })),
      ...urls.map((value) => ({ type: "url", value })),
    ];
    return ok({ text, entities, grouped: { properNouns, emails, urls }, capabilities: ["entity_extraction"] });
  }

  if (routeKey === "classify") {
    const labels = toList(pick(body.labels, query.labels), ["general", "support", "sales"]);
    const tokenSet = new Set(words(text));
    const rankedLabels = labels
      .map((label) => {
        const overlap = words(label).filter((token) => tokenSet.has(token)).length;
        const tie = stableInt(`${label}:${text}`, 0, 1000) / 1000;
        return { label, score: Number((overlap + tie).toFixed(3)) };
      })
      .sort((a, b) => b.score - a.score);
    return ok({ text, label: rankedLabels[0]?.label || labels[0], rankedLabels, capabilities: ["label_classification"] });
  }

  if (routeKey === "detect-pii") {
    const findings = detectPiiFindings(text);
    const hasPii = Object.values(findings).some((values) => Array.isArray(values) && values.length > 0);
    return ok({ hasPii, findings, capabilities: ["pii_detection"] });
  }

  if (routeKey === "redact-pii") {
    const redactedText = redactPiiText(text);
    return ok({ originalText: text, redactedText, capabilities: ["pii_redaction"] });
  }

  if (routeKey === "pii") {
    const mode = readString(pick(body.action, body.mode, query.action, query.mode, "detect")).trim().toLowerCase();
    const findings = detectPiiFindings(text);
    const hasPii = Object.values(findings).some((values) => Array.isArray(values) && values.length > 0);
    if (mode === "redact") {
      return ok({
        mode: "redact",
        hasPii,
        findings,
        originalText: text,
        redactedText: redactPiiText(text),
        capabilities: ["pii_detection", "pii_redaction"],
      });
    }
    return ok({
      mode: "detect",
      hasPii,
      findings,
      capabilities: ["pii_detection", "pii_redaction"],
    });
  }

  if (routeKey === "toxicity") {
    const toxicTerms = ["hate", "idiot", "stupid", "worthless", "kill"];
    const tokenized = words(text);
    const flaggedTerms = toxicTerms.filter((term) => tokenized.includes(term));
    return ok({ toxicityScore: Number((flaggedTerms.length / Math.max(1, tokenized.length)).toFixed(3)), flaggedTerms, capabilities: ["toxicity_screening"] });
  }

  if (routeKey === "detect-language") {
    const language = /[\u4e00-\u9fff]/.test(text) ? "zh" : /[\u0400-\u04ff]/.test(text) ? "ru" : /[áéíóúñ¿¡]/i.test(text) ? "es" : /[a-z]/i.test(text) ? "en" : "unknown";
    return ok({ language, confidence: language === "unknown" ? 0 : 0.8, textSample: text.slice(0, 150), capabilities: ["language_detection"] });
  }

  if (routeKey === "to-json") {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const json = {};
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      if (!rawKey || rest.length === 0) continue;
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!key) continue;
      json[key] = rest.join(":").trim();
    }
    return ok({ json, parsedPairs: Object.keys(json).length, capabilities: ["text_structuring"] });
  }

  if (routeKey === "normalize") {
    const normalizedText = text.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
    return ok({ originalText: text, normalizedText, capabilities: ["text_normalization"] });
  }

  return providerRequired("Unhandled text route requires a model provider.");
}

function buildEduPayload(context, routeKey) {
  const { body, query, inputText } = context;
  const topic = readString(pick(body.topic, body.subject, body.text, query.topic, inputText, "general topic")).trim();

  if (routeKey === "quiz") {
    const count = clamp(Math.floor(readNumber(pick(body.count, query.count), 5)), 1, 12);
    const keywords = extractKeywords(topic, 6).map((entry) => entry.keyword);
    const questions = Array.from({ length: count }).map((_, index) => {
      const focus = keywords[index % Math.max(1, keywords.length)] || `concept ${index + 1}`;
      const answerIndex = stableInt(`${topic}:${index}:answer`, 0, 3);
      return {
        id: index + 1,
        question: `Which option best matches ${focus} in ${topic}?`,
        choices: [
          `A. Core idea about ${focus}`,
          `B. Tangential detail about ${focus}`,
          `C. Example that is not central to ${focus}`,
          `D. Contrast case for ${focus}`,
        ],
        answerIndex,
      };
    });
    return ok({ topic, questionCount: count, questions, capabilities: ["quiz_generation"] });
  }

  if (routeKey === "math") {
    return buildMathPayload(context);
  }

  if (routeKey === "flashcards") {
    const terms = toList(pick(body.terms, body.words, query.terms, topic), extractKeywords(topic, 8).map((entry) => entry.keyword));
    const flashcards = terms.slice(0, 20).map((term, index) => ({
      id: index + 1,
      front: term,
      back: `${term}: a practical concept tied to ${topic}.`,
    }));
    return ok({ topic, flashcards, capabilities: ["flashcard_generation"] });
  }

  if (routeKey === "study-plan") {
    const days = clamp(Math.floor(readNumber(pick(body.days, query.days), 7)), 1, 60);
    const start = parseIsoDate(pick(body.startDate, query.startDate, "2026-01-01")) || new Date("2026-01-01T00:00:00Z");
    const focusItems = toList(pick(body.modules, body.focus, query.modules, topic), extractKeywords(topic, 5).map((entry) => entry.keyword));
    const plan = Array.from({ length: days }).map((_, index) => ({
      day: index + 1,
      date: toIsoDate(new Date(start.getTime() + index * 86400000)),
      focus: focusItems[index % Math.max(1, focusItems.length)] || topic,
      task: `Review ${focusItems[index % Math.max(1, focusItems.length)] || topic} and complete one practice activity.`,
    }));
    return ok({ topic, days, plan, capabilities: ["study_planning"] });
  }

  if (routeKey === "explain") {
    const keywords = extractKeywords(topic, 4).map((entry) => entry.keyword);
    return ok({
      topic,
      explanation: `The main idea is to connect ${keywords[0] || topic} with the broader context of ${keywords[1] || topic}.`,
      keyPoints: unique([
        `${keywords[0] || topic} is the starting point.`,
        `${keywords[1] || topic} changes how the topic is applied.`,
        `Practice turns ${topic} into something usable.`,
      ]).slice(0, 3),
      capabilities: ["explanatory_summary"],
    });
  }

  if (routeKey === "essay-outline") {
    return ok({
      topic,
      thesis: `${topic} can be analyzed through causes, effects, and tradeoffs.`,
      sections: ["Introduction", "Background", "Main Argument 1", "Main Argument 2", "Counterargument", "Conclusion"],
      capabilities: ["essay_outline"],
    });
  }

  if (routeKey === "cite") {
    const style = readString(pick(body.style, query.style, "APA")).toUpperCase();
    const author = readString(pick(body.author, "Doe, J."));
    const year = clamp(Math.floor(readNumber(pick(body.year, query.year), 2024)), 1900, 2100);
    const title = readString(pick(body.title, topic, "Untitled Source"));
    const citation = style === "MLA" ? `${author}. "${title}." Publisher, ${year}.` : `${author} (${year}). ${title}. Publisher.`;
    return ok({ style, citation, bibliography: [citation], capabilities: ["citation_formatting"] });
  }

  if (routeKey === "history") {
    const count = clamp(Math.floor(readNumber(pick(body.count, query.count), 5)), 3, 12);
    const startYear = clamp(Math.floor(readNumber(pick(body.startYear, query.startYear), stableInt(topic, 1800, 2010))), 1200, 2050);
    const stepYears = clamp(Math.floor(readNumber(pick(body.stepYears, query.stepYears), stableInt(`${topic}:step`, 5, 25))), 1, 50);
    const timeline = Array.from({ length: count }).map((_, index) => ({ year: startYear + index * stepYears, event: `${topic} milestone ${index + 1}` }));
    return ok({ topic, timeline, capabilities: ["timeline_generation"] });
  }

  if (routeKey === "analogy") {
    const target = readString(pick(body.target, "a city transit system"));
    return ok({
      topic,
      analogy: `${topic} is like ${target}: many parts coordinating toward one outcome.`,
      mapping: [
        { concept: "core mechanism", analogy: "main route" },
        { concept: "dependencies", analogy: "intersections" },
        { concept: "optimization", analogy: "traffic timing" },
      ],
      capabilities: ["analogy_generation"],
    });
  }

  if (routeKey === "vocab") {
    const base = toList(pick(body.words, topic), [topic]).slice(0, 10);
    const vocab = base.map((word, index) => ({
      word,
      definition: `${word} - plain language definition ${index + 1}`,
      example: `Example usage of ${word} in context.`,
    }));
    return ok({ topic, vocab, capabilities: ["vocabulary_builder"] });
  }

  return providerRequired("Unhandled education route requires a model provider.");
}

function buildHrPayload(context, routeKey) {
  const { body, query, inputText } = context;
  const role = readString(pick(body.role, body.title, body.position, query.role, inputText, "general role")).trim();

  if (routeKey === "interview-questions") {
    const skills = toList(pick(body.skills, body.competencies, query.skills), extractKeywords(role, 4).map((entry) => entry.keyword));
    const baseSkills = skills.length ? skills : extractKeywords(role, 3).map((entry) => entry.keyword || role);
    return ok({
      role,
      behavioral: baseSkills.map((skill) => `Describe a time you used ${skill} to move a team goal forward.`),
      situational: baseSkills.map((skill) => `How would you apply ${skill} when expectations change quickly?`),
      technical: baseSkills.map((skill) => `How would you validate ${skill} in a ${role} workflow?`),
      followUp: baseSkills.map((skill) => `What tradeoffs did you consider when using ${skill}?`),
      capabilities: ["interview_question_generation"],
    });
  }

  if (routeKey === "feedback") {
    const strengths = toList(pick(body.strengths, query.strengths), ["reliability", "communication"]);
    const opportunities = toList(pick(body.gaps, body.opportunities, query.gaps), ["ownership", "clarity"]);
    return ok({
      subject: role,
      strengths: strengths.map((item) => `Keep reinforcing ${item}.`),
      improvements: opportunities.map((item) => `Build a repeatable habit around ${item}.`),
      nextSteps: ["Align expectations", "Set one measurable goal", "Review progress in two weeks"],
      capabilities: ["feedback_structuring"],
    });
  }

  if (routeKey === "onboarding") {
    const phases = [
      { phase: "week_1", checklist: ["Access setup", "Team introductions", "Read key docs"] },
      { phase: "days_30", checklist: [`Deliver first ${role} task`, "Review feedback", "Clarify success metrics"] },
      { phase: "days_60", checklist: ["Own a small workflow", "Share a process improvement"] },
    ];
    return ok({
      role,
      plan: phases,
      phases,
      capabilities: ["onboarding_planning"],
    });
  }

  return providerRequired("Unhandled HR route requires a model provider.");
}

function buildMarketingPayload(context, routeKey) {
  const { body, query, inputText } = context;
  const topic = readString(pick(body.topic, body.product, body.text, query.topic, inputText, "new product")).trim();

  if (routeKey === "ab-test") {
    const focus = extractKeywords(topic, 4).map((entry) => entry.keyword).join(" ") || topic;
    return ok({
      topic,
      hypothesis: `Clearer messaging around ${focus} should improve conversion.`,
      variants: [
        { id: "A", headline: `${titleCase(focus)} with less friction` },
        { id: "B", headline: `Move faster with ${titleCase(focus)}` },
      ],
      primaryMetric: readString(pick(body.metric, query.metric, "conversion_rate")),
      capabilities: ["ab_test_design"],
    });
  }

  if (routeKey === "email-campaign") {
    const keywords = extractKeywords(topic, 3).map((entry) => entry.keyword);
    const subjectBase = titleCase(keywords.join(" ") || topic);
    const subjectLines = [
      `${subjectBase}: the simplest way to start`,
      `A practical update on ${subjectBase}`,
      `What changes when ${subjectBase} gets easier`,
    ];
    return ok({
      topic,
      subject: subjectLines[0],
      subjectLines,
      previewText: `Built around ${keywords[0] || topic} and designed for quick action.`,
      emails: [
        { day: 1, goal: "introduce", angle: `Explain the value of ${topic}.` },
        { day: 3, goal: "convert", angle: `Show the strongest use case for ${topic}.` },
        { day: 5, goal: "close", angle: `Ask for a direct response on ${topic}.` },
      ],
      capabilities: ["email_campaign_structuring"],
    });
  }

  if (routeKey === "social-caption") {
    const keywords = extractKeywords(topic, 3).map((entry) => entry.keyword);
    const base = titleCase(keywords.join(" ") || topic);
    return ok({
      topic,
      captions: [
        `${base} made practical, not complicated.`,
        `A cleaner way to think about ${topic}.`,
        `Less noise. More ${keywords[0] || topic}.`,
      ],
      hashtags: unique([`#${(keywords[0] || "growth").replace(/[^a-z0-9]/gi, "")}`, "#automation", "#productivity"]).slice(0, 3),
      capabilities: ["social_caption_generation"],
    });
  }

  return providerRequired("Unhandled marketing route requires a model provider.");
}

function buildLangPayload(context, routeKey) {
  const { body, query, inputText } = context;
  const text = readString(pick(body.text, body.input, query.text, inputText, "sample phrase")).trim();

  if (routeKey === "acronym") {
    const tokens = words(text).filter((token) => !STOP_WORDS.has(token));
    const acronym = tokens.map((token) => token[0].toUpperCase()).join("") || "N/A";
    return ok({ text, acronym, words: tokens, capabilities: ["acronym_generation"] });
  }

  if (routeKey === "formality") {
    const tone = readString(pick(body.tone, query.tone, "formal")).toLowerCase();
    const formalized = readString(text)
      .replace(/\bdon't\b/gi, "do not")
      .replace(/\bcan't\b/gi, "cannot")
      .replace(/\bwon't\b/gi, "will not")
      .replace(/\bI'm\b/gi, "I am")
      .replace(/\bwe're\b/gi, "we are");
    const casualized = readString(text)
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bcannot\b/gi, "can't")
      .replace(/\bwill not\b/gi, "won't")
      .replace(/\bI am\b/gi, "I'm")
      .replace(/\bwe are\b/gi, "we're");
    return ok({ tone, originalText: text, rewrittenText: tone === "formal" ? formalized : casualized, capabilities: ["tone_adjustment"] });
  }

  return providerRequired("Unhandled language route requires a model provider.");
}

function buildRandomPayload(context, routeKey) {
  const { body, query, inputText, path, params } = context;
  const seed = readString(pick(body.seed, query.seed, inputText, JSON.stringify({ path, params, body, query }))).trim();
  const subject = extractKeywords(seed, 3).map((entry) => entry.keyword)[0] || "workflow";

  if (routeKey === "joke") {
    const setupTemplates = [
      `Why did the ${subject} stay calm`,
      `What do you call a ${subject} with a backup plan`,
      `Why does the ${subject} never panic`,
    ];
    const punchlines = [
      `Because it had already sorted out ${topicFragment(seed)}.`,
      `Because it knew how to handle ${topicFragment(seed)} before the meeting started.`,
      `Because it had a checklist for ${topicFragment(seed)}.`,
    ];
    const setup = stablePick(`${seed}:setup`, setupTemplates);
    const punchline = stablePick(`${seed}:punchline`, punchlines);
    return ok({ seed, joke: `${setup}? ${punchline}`, setup, punchline, capabilities: ["seeded_joke_generation"] });
  }

  if (routeKey === "quote") {
    const themes = [
      `Small improvements compound when ${subject} stays consistent.`,
      `${titleCase(subject)} gets easier when the next step is obvious.`,
      `Clarity beats cleverness when ${subject} matters.`,
    ];
    const quote = stablePick(`${seed}:quote`, themes);
    return ok({ seed, quote, attribution: "auto-local", capabilities: ["seeded_quote_generation"] });
  }

  return providerRequired("Unhandled random route requires a model provider.");
}

function topicFragment(seed) {
  const focus = extractKeywords(seed, 2).map((entry) => entry.keyword);
  if (!focus.length) return "the details";
  return focus.join(" and ");
}

function buildContentPayload(input) {
  const context = normalizeContext(input);
  const group = getContentGroup(context.path);

  if (!group) {
    return fail("unsupported_path", "Path is not a content endpoint.");
  }

  const routeKey = getRouteKey(context.path, group);

  if (group === "text") return buildTextPayload(context, routeKey);
  if (group === "edu") return buildEduPayload(context, routeKey);
  if (group === "hr") return buildHrPayload(context, routeKey);
  if (group === "marketing") return buildMarketingPayload(context, routeKey);
  if (group === "lang") return buildLangPayload(context, routeKey);
  if (group === "random") return buildRandomPayload(context, routeKey);

  return fail("unsupported_path", "No content handler found for path.");
}

module.exports = {
  isContentPath,
  buildContentPayload,
};


