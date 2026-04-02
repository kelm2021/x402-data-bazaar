const {
  handleQrGenerate,
  handleRandomJoke,
  handleRandomQuote,
  handleMarketingHashtags,
} = require("./generated-quickwins-random");
const {
  handleTextSentiment,
  handleTextTranslate,
  handleTextGrammar,
  handleTextReadability,
  handleTextSlug,
  handleUtilWordcount,
} = require("./generated-quickwins-text");
const {
  handleConvertCsvToJson,
  handleConvertMdToHtml,
  handleEncodeBase64,
  handleUuidGenerate,
  handlePasswordGenerate,
  handleUrlShorten,
  handleUtilDateDiff,
  handleUtilAge,
} = require("./generated-quickwins-utils");

const QUICK_WIN_HANDLER_IDS = Object.freeze({
  qr_generate: "POST /api/tools/qr/generate",
  text_sentiment: "POST /api/tools/text/sentiment",
  text_translate: "POST /api/tools/text/translate",
  text_grammar: "POST /api/tools/text/grammar",
  text_readability: "POST /api/tools/text/readability",
  convert_csv_to_json: "POST /api/tools/convert/csv-to-json",
  convert_md_to_html: "POST /api/tools/convert/md-to-html",
  encode_base64: "POST /api/tools/encode/base64",
  uuid_generate: "GET /api/tools/uuid",
  password_generate: "POST /api/tools/password/generate",
  url_shorten: "POST /api/tools/url/shorten",
  text_slug: "POST /api/tools/text/slug",
  random_joke: "GET /api/tools/random/joke",
  random_quote: "GET /api/tools/random/quote",
  marketing_hashtags: "POST /api/tools/marketing/hashtags",
  util_wordcount: "POST /api/tools/util/wordcount",
  util_date_diff: "POST /api/tools/util/date-diff",
  util_age: "POST /api/tools/util/age",
});

const QUICK_WIN_HANDLERS = {
  "POST /api/tools/qr/generate": handleQrGenerate,
  "POST /api/tools/text/sentiment": handleTextSentiment,
  "POST /api/tools/text/translate": handleTextTranslate,
  "POST /api/tools/text/grammar": handleTextGrammar,
  "POST /api/tools/text/readability": handleTextReadability,
  "POST /api/tools/convert/csv-to-json": handleConvertCsvToJson,
  "POST /api/tools/convert/md-to-html": handleConvertMdToHtml,
  "POST /api/tools/encode/base64": handleEncodeBase64,
  "GET /api/tools/uuid": handleUuidGenerate,
  "POST /api/tools/password/generate": handlePasswordGenerate,
  "POST /api/tools/url/shorten": handleUrlShorten,
  "POST /api/tools/text/slug": handleTextSlug,
  "GET /api/tools/random/joke": handleRandomJoke,
  "GET /api/tools/random/quote": handleRandomQuote,
  "POST /api/tools/marketing/hashtags": handleMarketingHashtags,
  "POST /api/tools/util/wordcount": handleUtilWordcount,
  "POST /api/tools/util/date-diff": handleUtilDateDiff,
  "POST /api/tools/util/age": handleUtilAge,
};

module.exports = {
  QUICK_WIN_HANDLER_IDS,
  QUICK_WIN_HANDLERS,
};

