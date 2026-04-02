const assert = require("node:assert/strict");
const test = require("node:test");

const { buildContentPayload, isContentPath } = require("../routes/auto-local/content-engines");

test("isContentPath matches only the allowed content families", () => {
  assert.equal(isContentPath("/api/tools/text/keywords"), true);
  assert.equal(isContentPath("/api/tools/edu/quiz"), true);
  assert.equal(isContentPath("/api/tools/hr/onboarding"), true);
  assert.equal(isContentPath("/api/tools/random/quote"), true);
  assert.equal(isContentPath("/api/tools/productivity/standup"), false);
  assert.equal(isContentPath("/api/tools/url/parse"), false);
});

test("text keywords are deterministic and input-driven", () => {
  const payload = buildContentPayload({
    path: "/api/tools/text/keywords",
    body: { text: "Alpha alpha alpha beta beta gamma" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.source, "auto-local-engine/content");
  assert.equal(payload.data.keywords[0].keyword, "alpha");
  assert.equal(payload.data.keywords[0].count, 3);
  assert.deepEqual(buildContentPayload({ path: "/api/tools/text/keywords", body: { text: "Alpha alpha alpha beta beta gamma" } }), payload);
});

test("text similarity is deterministic and uses both inputs", () => {
  const payload = buildContentPayload({
    path: "/api/tools/text/similarity",
    body: { textA: "shared planning and execution", textB: "shared planning and review" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.method, "jaccard");
  assert.equal(payload.data.similarity, 0.6);
  assert.deepEqual(buildContentPayload({ path: "/api/tools/text/similarity", body: { textA: "shared planning and execution", textB: "shared planning and review" } }), payload);
});

test("text headline and paraphrase are local and deterministic", () => {
  const headline = buildContentPayload({
    path: "/api/tools/text/headline",
    body: { text: "launch the fastest workflow automation platform" },
  });
  const paraphrase = buildContentPayload({
    path: "/api/tools/text/paraphrase",
    body: { text: "We help teams move fast because the process is simple." },
  });

  assert.equal(headline.success, true);
  assert.equal(typeof headline.data.headline, "string");
  assert.equal(paraphrase.success, true);
  assert.equal(typeof paraphrase.data.paraphrasedText, "string");
  assert.deepEqual(buildContentPayload({ path: "/api/tools/text/headline", body: { text: "launch the fastest workflow automation platform" } }), headline);
});

test("text pii merge endpoint supports detect and redact modes", () => {
  const detect = buildContentPayload({
    path: "/api/tools/text/pii",
    body: { text: "Contact me at user@example.com and +1 312 555 0199" },
  });
  const redact = buildContentPayload({
    path: "/api/tools/text/pii",
    body: { text: "Contact me at user@example.com and +1 312 555 0199", action: "redact" },
  });

  assert.equal(detect.success, true);
  assert.equal(detect.data.mode, "detect");
  assert.equal(detect.data.hasPii, true);
  assert.equal(Array.isArray(detect.data.findings.emails), true);
  assert.equal(Array.isArray(detect.data.findings.phones), true);

  assert.equal(redact.success, true);
  assert.equal(redact.data.mode, "redact");
  assert.equal(typeof redact.data.redactedText, "string");
  assert.match(redact.data.redactedText, /\[REDACTED_EMAIL\]/);
  assert.match(redact.data.redactedText, /\[REDACTED_PHONE\]/);
});

test("edu quiz and flashcards are structured and repeatable", () => {
  const quiz = buildContentPayload({
    path: "/api/tools/edu/quiz",
    body: { topic: "fractions basics", count: 3 },
  });
  const flashcards = buildContentPayload({
    path: "/api/tools/edu/flashcards",
    body: { topic: "fractions basics", terms: ["numerator", "denominator"] },
  });

  assert.equal(quiz.success, true);
  assert.equal(quiz.data.questionCount, 3);
  assert.equal(quiz.data.questions.length, 3);
  assert.equal(flashcards.success, true);
  assert.equal(flashcards.data.flashcards.length, 2);
  assert.deepEqual(buildContentPayload({ path: "/api/tools/edu/quiz", body: { topic: "fractions basics", count: 3 } }), quiz);
});

test("edu math is computed locally", () => {
  const payload = buildContentPayload({
    path: "/api/tools/edu/math",
    body: { expression: "2 + 2 * 5" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.expression, "2 + 2 * 5");
  assert.equal(payload.data.result, 12);
  assert.ok(Array.isArray(payload.data.steps));
});

test("hr feedback and onboarding return deterministic plans", () => {
  const feedback = buildContentPayload({
    path: "/api/tools/hr/feedback",
    body: { role: "product manager", strengths: ["clarity"], gaps: ["delegation"] },
  });
  const onboarding = buildContentPayload({
    path: "/api/tools/hr/onboarding",
    body: { role: "product manager" },
  });

  assert.equal(feedback.success, true);
  assert.equal(feedback.data.subject, "product manager");
  assert.equal(onboarding.success, true);
  assert.equal(onboarding.data.plan[0].phase, "week_1");
  assert.deepEqual(buildContentPayload({ path: "/api/tools/hr/onboarding", body: { role: "product manager" } }), onboarding);
});

test("marketing email campaigns and social captions are deterministic", () => {
  const emailCampaign = buildContentPayload({
    path: "/api/tools/marketing/email-campaign",
    body: { topic: "agent automation platform" },
  });
  const socialCaption = buildContentPayload({
    path: "/api/tools/marketing/social-caption",
    body: { topic: "agent automation platform" },
  });

  assert.equal(emailCampaign.success, true);
  assert.ok(emailCampaign.data.subjectLines.length >= 3);
  assert.equal(socialCaption.success, true);
  assert.ok(socialCaption.data.captions.length >= 2);
  assert.deepEqual(buildContentPayload({ path: "/api/tools/marketing/social-caption", body: { topic: "agent automation platform" } }), socialCaption);
});

test("lang acronym and formality stay input-driven", () => {
  const acronym = buildContentPayload({
    path: "/api/tools/lang/acronym",
    body: { text: "secure hypertext transfer protocol" },
  });
  const formality = buildContentPayload({
    path: "/api/tools/lang/formality",
    body: { text: "I can't join because we're busy.", tone: "formal" },
  });

  assert.equal(acronym.success, true);
  assert.equal(acronym.data.acronym, "SHTP");
  assert.equal(formality.success, true);
  assert.equal(formality.data.rewrittenText, "I cannot join because we are busy.");
});

test("random joke and quote are deterministic and do not use preview token stubs", () => {
  const joke = buildContentPayload({
    path: "/api/tools/random/joke",
    body: { seed: "release-42" },
  });
  const quote = buildContentPayload({
    path: "/api/tools/random/quote",
    body: { seed: "release-42" },
  });

  assert.equal(joke.success, true);
  assert.equal(quote.success, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(joke.data, "token"));
  assert.ok(!Object.prototype.hasOwnProperty.call(quote.data, "token"));
  assert.deepEqual(buildContentPayload({ path: "/api/tools/random/joke", body: { seed: "release-42" } }), joke);
});

test("unknown routes inside the allowed families require a provider", () => {
  const marketing = buildContentPayload({
    path: "/api/tools/marketing/press-release",
    body: { topic: "new launch" },
  });
  const text = buildContentPayload({
    path: "/api/tools/text/brainstorm",
    body: { text: "some content" },
  });

  assert.equal(marketing.success, false);
  assert.equal(marketing.error, "provider_required");
  assert.equal(text.success, false);
  assert.equal(text.error, "provider_required");
});

