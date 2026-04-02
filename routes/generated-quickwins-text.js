const {
  getBodyAndQuery,
  pickFirstDefined,
  readString,
  clamp,
  extractWords,
  countSyllables,
  normalizeSlug,
  applyCase,
} = require("./generated-quickwins-common");

const POSITIVE_WORDS = new Set([
  "good",
  "great",
  "excellent",
  "amazing",
  "awesome",
  "positive",
  "love",
  "happy",
  "glad",
  "strong",
  "success",
  "win",
  "growth",
  "improve",
  "improved",
  "improving",
  "effective",
  "efficient",
  "clean",
  "fast",
  "quick",
  "stable",
  "secure",
  "reliable",
  "clear",
  "useful",
  "value",
  "valuable",
  "best",
  "better",
  "helpful",
  "smooth",
  "easy",
]);

const NEGATIVE_WORDS = new Set([
  "bad",
  "terrible",
  "awful",
  "horrible",
  "negative",
  "hate",
  "sad",
  "angry",
  "frustrated",
  "weak",
  "failure",
  "lose",
  "loss",
  "down",
  "decline",
  "risk",
  "bug",
  "bugs",
  "broken",
  "slow",
  "confusing",
  "hard",
  "difficult",
  "pain",
  "error",
  "issue",
  "problem",
  "messy",
  "unstable",
  "unsafe",
  "worse",
  "worst",
]);

const EMOTION_WORDS = {
  joy: ["happy", "glad", "love", "great", "awesome", "excited", "delighted"],
  anger: ["angry", "mad", "furious", "annoyed", "irritated"],
  sadness: ["sad", "upset", "depressed", "disappointed", "heartbroken"],
  fear: ["afraid", "scared", "anxious", "worried", "nervous", "fear"],
  surprise: ["surprised", "shocked", "unexpected", "wow"],
};

const TRANSLATION_DICTIONARIES = {
  es: {
    hello: "hola",
    world: "mundo",
    this: "este",
    is: "es",
    a: "un",
    test: "prueba",
    good: "bueno",
    bad: "malo",
    quick: "rapido",
    wins: "victorias",
    endpoint: "endpoint",
    text: "texto",
    translate: "traducir",
    from: "de",
    to: "a",
  },
  fr: {
    hello: "bonjour",
    world: "monde",
    this: "ceci",
    is: "est",
    a: "un",
    test: "test",
    good: "bon",
    bad: "mauvais",
    quick: "rapide",
    wins: "victoires",
    endpoint: "point-de-service",
    text: "texte",
    translate: "traduire",
    from: "de",
    to: "a",
  },
  de: {
    hello: "hallo",
    world: "welt",
    this: "dies",
    is: "ist",
    a: "ein",
    test: "test",
    good: "gut",
    bad: "schlecht",
    quick: "schnell",
    wins: "siege",
    endpoint: "endpunkt",
    text: "text",
    translate: "ubersetzen",
    from: "von",
    to: "zu",
  },
  pt: {
    hello: "ola",
    world: "mundo",
    this: "isto",
    is: "e",
    a: "um",
    test: "teste",
    good: "bom",
    bad: "ruim",
    quick: "rapido",
    wins: "vitorias",
    endpoint: "endpoint",
    text: "texto",
    translate: "traduzir",
    from: "de",
    to: "para",
  },
};

const COMMON_GRAMMAR_REPLACEMENTS = [
  { pattern: /\bteh\b/gi, replacement: "the", rule: "common-spelling" },
  { pattern: /\brecieve\b/gi, replacement: "receive", rule: "common-spelling" },
  { pattern: /\bseperate\b/gi, replacement: "separate", rule: "common-spelling" },
  { pattern: /\bdefinately\b/gi, replacement: "definitely", rule: "common-spelling" },
  { pattern: /\balot\b/gi, replacement: "a lot", rule: "common-spelling" },
  { pattern: /\bdont\b/gi, replacement: "don't", rule: "apostrophe" },
  { pattern: /\bcant\b/gi, replacement: "can't", rule: "apostrophe" },
  { pattern: /\bwont\b/gi, replacement: "won't", rule: "apostrophe" },
];

function handleTextSentiment(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(
    pickFirstDefined(body.text, body.input, query.text, "This endpoint is good, stable, and useful."),
  );
  const words = extractWords(text);
  const wordCount = words.length || 1;
  let positive = 0;
  let negative = 0;
  const emotionCounts = { joy: 0, anger: 0, sadness: 0, fear: 0, surprise: 0 };

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) {
      positive += 1;
    }
    if (NEGATIVE_WORDS.has(word)) {
      negative += 1;
    }
    for (const [emotion, lexicon] of Object.entries(EMOTION_WORDS)) {
      if (lexicon.includes(word)) {
        emotionCounts[emotion] += 1;
      }
    }
  }

  const score = Number((((positive - negative) / wordCount)).toFixed(4));
  const sentiment = score > 0.05 ? "positive" : score < -0.05 ? "negative" : "neutral";

  return {
    success: true,
    data: {
      sentiment,
      score,
      confidence: Number(Math.min(1, Math.abs(score) + 0.2).toFixed(3)),
      metrics: {
        words: words.length,
        positiveMatches: positive,
        negativeMatches: negative,
      },
      emotions: emotionCounts,
      text,
    },
    source: "local-lexicon-sentiment",
  };
}

function handleTextTranslate(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(pickFirstDefined(body.text, body.input, query.text, "hello world"));
  const targetLanguage = readString(
    pickFirstDefined(body.targetLanguage, body.target, body.to, query.targetLanguage, query.target, query.to, "es"),
  )
    .trim()
    .toLowerCase();
  const sourceLanguage = readString(
    pickFirstDefined(body.sourceLanguage, body.source, body.from, query.sourceLanguage, query.source, query.from, "auto"),
  )
    .trim()
    .toLowerCase();
  const dictionary = TRANSLATION_DICTIONARIES[targetLanguage] || null;
  const segments = text.split(/([A-Za-z']+)/);
  let translatedTokenCount = 0;
  const translated = segments
    .map((segment) => {
      if (!/^[A-Za-z']+$/.test(segment) || !dictionary) {
        return segment;
      }
      const translatedWord = dictionary[segment.toLowerCase()];
      if (!translatedWord) {
        return segment;
      }
      translatedTokenCount += 1;
      return applyCase(segment, translatedWord);
    })
    .join("");

  return {
    success: true,
    data: {
      sourceLanguage,
      targetLanguage,
      translatedText: translated,
      originalText: text,
      translatedTokenCount,
      coveragePct: Number(((translatedTokenCount / Math.max(1, extractWords(text).length)) * 100).toFixed(1)),
      supportedLanguages: Object.keys(TRANSLATION_DICTIONARIES),
      fallbackUsed: !dictionary,
    },
    source: "local-rule-based-translation",
  };
}

function applyGrammarPasses(text) {
  let corrected = readString(text);
  const corrections = [];

  for (const replacement of COMMON_GRAMMAR_REPLACEMENTS) {
    corrected = corrected.replace(replacement.pattern, (match) => {
      const value = applyCase(match, replacement.replacement);
      if (value !== match) {
        corrections.push({
          rule: replacement.rule,
          from: match,
          to: value,
        });
      }
      return value;
    });
  }

  const spacingBeforePunctuation = corrected.replace(/\s+([,.!?;:])/g, "$1");
  if (spacingBeforePunctuation !== corrected) {
    corrections.push({
      rule: "spacing-before-punctuation",
      from: corrected,
      to: spacingBeforePunctuation,
    });
    corrected = spacingBeforePunctuation;
  }

  const collapsedWhitespace = corrected.replace(/[ \t]{2,}/g, " ");
  if (collapsedWhitespace !== corrected) {
    corrections.push({
      rule: "collapse-whitespace",
      from: corrected,
      to: collapsedWhitespace,
    });
    corrected = collapsedWhitespace;
  }

  const sentenceCased = corrected.replace(/(^|[.!?]\s+)([a-z])/g, (_all, prefix, char) => `${prefix}${char.toUpperCase()}`);
  if (sentenceCased !== corrected) {
    corrections.push({
      rule: "sentence-case",
      from: corrected,
      to: sentenceCased,
    });
    corrected = sentenceCased;
  }

  return {
    corrected: corrected.trim(),
    corrections,
  };
}

function handleTextGrammar(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(
    pickFirstDefined(body.text, body.input, query.text, "teh quick brown fox dont jump over teh lazy dog ."),
  );
  const result = applyGrammarPasses(text);

  return {
    success: true,
    data: {
      originalText: text,
      correctedText: result.corrected,
      correctionCount: result.corrections.length,
      corrections: result.corrections.slice(0, 25),
      changed: result.corrected !== text,
    },
    source: "local-grammar-rules",
  };
}

function handleTextReadability(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(
    pickFirstDefined(body.text, body.input, query.text, "This is a short readability sample. It measures sentence and word complexity."),
  );
  const words = extractWords(text);
  const sentences = readString(text)
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const wordCount = Math.max(1, words.length);
  const sentenceCount = Math.max(1, sentences.length);
  const fleschReadingEase = Number((206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllables / wordCount)).toFixed(2));
  const fleschKincaidGrade = Number((0.39 * (wordCount / sentenceCount) + 11.8 * (syllables / wordCount) - 15.59).toFixed(2));

  let gradeBand = "college";
  if (fleschKincaidGrade <= 6) {
    gradeBand = "elementary";
  } else if (fleschKincaidGrade <= 9) {
    gradeBand = "middle-school";
  } else if (fleschKincaidGrade <= 12) {
    gradeBand = "high-school";
  }

  return {
    success: true,
    data: {
      text,
      words: words.length,
      sentences: sentences.length,
      syllables,
      fleschReadingEase,
      fleschKincaidGrade,
      gradeBand,
      averageWordsPerSentence: Number((wordCount / sentenceCount).toFixed(2)),
      averageSyllablesPerWord: Number((syllables / wordCount).toFixed(2)),
    },
    source: "local-readability-metrics",
  };
}

function handleTextSlug(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(pickFirstDefined(body.text, body.title, body.input, query.text, "Hello World"));
  const maxLength = clamp(Number.parseInt(readString(pickFirstDefined(body.maxLength, query.maxLength, 80)), 10) || 80, 8, 200);
  const normalized = normalizeSlug(text);
  const slug = normalized.slice(0, maxLength).replace(/-+$/g, "");

  return {
    success: true,
    data: {
      text,
      slug,
      changed: slug !== text,
      length: slug.length,
    },
    source: "local-slug-generator",
  };
}

function handleUtilWordcount(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(
    pickFirstDefined(body.text, body.input, query.text, "Word count endpoint sample."),
  );
  const words = extractWords(text);
  const sentences = readString(text)
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const paragraphs = readString(text)
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const letters = (readString(text).match(/[A-Za-z]/g) || []).length;

  return {
    success: true,
    data: {
      words: words.length,
      charactersWithSpaces: readString(text).length,
      charactersWithoutSpaces: readString(text).replace(/\s/g, "").length,
      letters,
      sentences: sentences.length,
      paragraphs: paragraphs.length || (text.trim() ? 1 : 0),
      averageWordLength: Number((letters / Math.max(1, words.length)).toFixed(2)),
      estimatedReadingMinutes: Number((words.length / 200).toFixed(2)),
      text,
    },
    source: "local-text-metrics",
  };
}

module.exports = {
  handleTextSentiment,
  handleTextTranslate,
  handleTextGrammar,
  handleTextReadability,
  handleTextSlug,
  handleUtilWordcount,
};
