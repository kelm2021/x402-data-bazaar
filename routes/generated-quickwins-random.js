const {
  getBodyAndQuery,
  pickFirstDefined,
  readString,
  clamp,
  extractWords,
  normalizeSlug,
  randomPick,
  createQuickCode,
} = require("./generated-quickwins-common");

const JOKE_BANK = [
  "Why do developers prefer dark mode? Because light attracts bugs.",
  "I changed my password to incorrect. Now my computer tells me whenever I forget.",
  "There are 10 kinds of people in this world: those who understand binary and those who don't.",
  "A SQL query walks into a bar, walks up to two tables, and asks: can I join you?",
  "My code doesn't have bugs. It develops random features.",
  "Debugging is like being the detective in a crime movie where you are also the murderer.",
  "I told my computer I needed a break, and it said no problem, I'll go to sleep.",
  "Why did the developer go broke? Because they used up all their cache.",
  "I would tell you a UDP joke, but you might not get it.",
  "The best thing about a Boolean is that even if you are wrong, you are only off by a bit.",
];

const QUOTE_BANK = [
  { quote: "Simplicity is the soul of efficiency.", author: "Austin Freeman", tags: ["productivity", "engineering"] },
  { quote: "Well begun is half done.", author: "Aristotle", tags: ["execution", "focus"] },
  { quote: "What gets measured gets improved.", author: "Peter Drucker", tags: ["metrics", "operations"] },
  { quote: "Action is the foundational key to all success.", author: "Pablo Picasso", tags: ["execution", "strategy"] },
  { quote: "Quality means doing it right when no one is looking.", author: "Henry Ford", tags: ["quality", "craft"] },
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain", tags: ["momentum", "planning"] },
  { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupery", tags: ["planning", "strategy"] },
];

function handleQrGenerate(req) {
  const { body, query } = getBodyAndQuery(req);
  const text = readString(
    pickFirstDefined(body.text, body.url, body.value, query.text, query.url, "https://x402.aurelianflo.com"),
  ).trim();
  const size = clamp(Number.parseInt(readString(pickFirstDefined(body.size, query.size, 256)), 10) || 256, 64, 2048);
  const margin = clamp(Number.parseInt(readString(pickFirstDefined(body.margin, query.margin, 2)), 10) || 2, 0, 20);
  const dark = readString(pickFirstDefined(body.darkColor, query.darkColor, "000000")).replace(/^#/, "");
  const light = readString(pickFirstDefined(body.lightColor, query.lightColor, "ffffff")).replace(/^#/, "");
  const qrImageUrl =
    "https://quickchart.io/qr?" +
    `text=${encodeURIComponent(text)}` +
    `&size=${size}` +
    `&margin=${margin}` +
    `&dark=${encodeURIComponent(dark)}` +
    `&light=${encodeURIComponent(light)}`;

  return {
    success: true,
    data: {
      text,
      size,
      margin,
      qrImageUrl,
      token: createQuickCode(10),
    },
    source: "quickchart-url-generator",
  };
}

function handleRandomJoke() {
  const joke = randomPick(JOKE_BANK) || "No jokes are available.";
  return {
    success: true,
    data: {
      id: createQuickCode(6),
      joke,
      type: "clean-tech",
    },
    source: "local-joke-bank",
  };
}

function handleRandomQuote(req) {
  const { query } = getBodyAndQuery(req);
  const topic = readString(query.topic).trim().toLowerCase();
  const authorQuery = readString(query.author).trim().toLowerCase();
  const filtered = QUOTE_BANK.filter((entry) => {
    const topicMatch = !topic || (entry.tags || []).some((tag) => tag.toLowerCase().includes(topic));
    const authorMatch = !authorQuery || entry.author.toLowerCase().includes(authorQuery);
    return topicMatch && authorMatch;
  });
  const selected = randomPick(filtered.length ? filtered : QUOTE_BANK) || QUOTE_BANK[0];

  return {
    success: true,
    data: {
      quote: selected.quote,
      author: selected.author,
      tags: selected.tags,
      topic: topic || null,
    },
    source: "local-quote-bank",
  };
}

function buildHashtags(topic, platform, count) {
  const words = extractWords(topic);
  const baseTokens = words.length ? words : ["content"];
  const platformSuffixes = {
    instagram: ["instagood", "photooftheday", "reels", "explorepage"],
    tiktok: ["fyp", "viral", "trend", "learnontiktok"],
    youtube: ["youtubeshorts", "creator", "subscribe", "video"],
    linkedin: ["leadership", "business", "career", "strategy"],
    x: ["trending", "news", "thread", "insight"],
    twitter: ["trending", "news", "thread", "insight"],
  };
  const suffixes = platformSuffixes[platform] || ["tips", "insights", "strategy", "growth"];
  const candidates = new Map();

  for (const token of baseTokens) {
    const root = normalizeSlug(token).replace(/-/g, "");
    if (!root) {
      continue;
    }
    const direct = `#${root}`;
    candidates.set(direct, { tag: direct, score: 70 });

    for (const suffix of suffixes) {
      const combo = `#${root}${normalizeSlug(suffix).replace(/-/g, "")}`;
      candidates.set(combo, { tag: combo, score: 60 });
    }
  }

  for (const suffix of suffixes) {
    const tag = `#${normalizeSlug(suffix).replace(/-/g, "")}`;
    candidates.set(tag, { tag, score: 50 });
  }

  return Array.from(candidates.values())
    .map((entry) => ({
      ...entry,
      score: clamp(entry.score + Math.max(0, 18 - entry.tag.length), 1, 99),
      tier: entry.score >= 75 ? "high" : entry.score >= 60 ? "medium" : "niche",
    }))
    .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
    .slice(0, count);
}

function handleMarketingHashtags(req) {
  const { body, query } = getBodyAndQuery(req);
  const topic = readString(
    pickFirstDefined(body.topic, body.text, body.keyword, query.topic, query.keyword, "x402 api marketplace"),
  );
  const platform = readString(
    pickFirstDefined(body.platform, query.platform, "instagram"),
  )
    .trim()
    .toLowerCase();
  const count = clamp(Number.parseInt(readString(pickFirstDefined(body.count, query.count, 12)), 10) || 12, 3, 30);
  const suggestions = buildHashtags(topic, platform, count);

  return {
    success: true,
    data: {
      topic,
      platform,
      count: suggestions.length,
      suggestions,
    },
    source: "local-hashtag-generator",
  };
}

module.exports = {
  handleQrGenerate,
  handleRandomJoke,
  handleRandomQuote,
  handleMarketingHashtags,
};
