const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const fetch = require("node-fetch");

const { createApp } = require("../app");

function withServer(app, run) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(result);
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

function withHttpServer(handler, run) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const result = await run(`http://127.0.0.1:${port}`);
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(result);
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  return { response, payload };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();
  return { response, payload };
}

function schemaIncludesRequiredProperty(schema, propertyName) {
  if (!schema || typeof schema !== "object") {
    return false;
  }

  if (Array.isArray(schema.required) && schema.required.includes(propertyName)) {
    return true;
  }

  if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, propertyName)) {
    return true;
  }

  const variants = []
    .concat(Array.isArray(schema.oneOf) ? schema.oneOf : [])
    .concat(Array.isArray(schema.anyOf) ? schema.anyOf : []);

  return variants.some((variant) => schemaIncludesRequiredProperty(variant, propertyName));
}

function schemaHasArtifactEnvelope(schema) {
  if (!schema || typeof schema !== "object" || !schema.properties) {
    return false;
  }

  const data = schema.properties.data;
  if (!data || typeof data !== "object" || !data.properties) {
    return false;
  }

  const artifact = data.properties.artifact;
  return Boolean(
    schema.properties.success
    && data.properties.documentType
    && data.properties.fileName
    && artifact?.properties?.contentBase64,
  );
}

test("generated auto-local routes return computed non-stub payloads", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/pdf/generate", {
        title: "Q2 Planning Memo",
        owner: "Ops",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.documentType, "pdf");
      assert.equal(typeof payload.data.artifact.contentBase64, "string");
      assert.notEqual(payload.data.status, "stub");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/keywords", {
        text: "x402 agents automate endpoint generation and endpoint testing",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.keywords));
      assert.ok(payload.data.keywords.length > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/text/pii", {
        text: "Email user@example.com or call +1 312 555 0199",
        action: "redact",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.mode, "redact");
      assert.equal(payload.data.hasPii, true);
      assert.match(String(payload.data.redactedText || ""), /\[REDACTED_EMAIL\]/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/edu/math", {
        expression: "2 + 2 * 5",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.expression, "2 + 2 * 5");
      assert.equal(payload.data.result, 12);
      assert.ok(Array.isArray(payload.data.steps));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/edu/quiz", {
        topic: "algebra basics",
        count: 4,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.questions));
      assert.equal(payload.data.questions.length, 4);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/hr/interview-questions", {
        role: "backend engineer",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.behavioral));
      assert.ok(Array.isArray(payload.data.technical));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/productivity/standup", {
        notes: "Finished parser. Starting validator. Waiting on one dependency.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.yesterday));
      assert.ok(Array.isArray(payload.data.today));
      assert.ok(Array.isArray(payload.data.blockers));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/marketing/ab-test", {
        topic: "pricing page headline",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.variants));
      assert.equal(payload.data.variants.length, 2);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/lang/acronym", {
        text: "secure hypertext transfer protocol",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.acronym, "string");
      assert.ok(payload.data.acronym.length >= 2);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/misc/iching");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.hexagram, "number");
      assert.equal(typeof payload.data.interpretation, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/convert/json-to-csv", {
        rows: [
          { name: "Alice", score: 91 },
          { name: "Bob", score: 88 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(String(payload.data.csv || ""), /name,score/);
      assert.equal(payload.data.rowCount, 2);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/url/parse", {
        url: "https://x402.aurelianflo.com/api/tools/convert/json-to-csv?sample=1",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.hostname, "x402.aurelianflo.com");
      assert.equal(payload.data.query.sample, "1");
    }
    {
      const sign = await postJson(baseUrl, "/api/tools/jwt/sign", {
        payload: { sub: "user-123", role: "admin" },
        secret: "integration-secret",
        algorithm: "HS256",
      });
      assert.equal(sign.response.status, 200);
      assert.equal(sign.payload.success, true);
      assert.equal(sign.payload.data.algorithm, "HS256");
      assert.equal(sign.payload.data.signed, true);
      assert.equal(String(sign.payload.data.token).split(".").length, 3);

      const verify = await postJson(baseUrl, "/api/tools/jwt/verify", {
        token: sign.payload.data.token,
        secret: "integration-secret",
      });
      assert.equal(verify.response.status, 200);
      assert.equal(verify.payload.success, true);
      assert.equal(verify.payload.data.valid, true);
      assert.equal(verify.payload.data.signatureValid, true);
      assert.equal(verify.payload.data.payload.sub, "user-123");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/util/binary", {
        value: "0b101010",
        toBase: 16,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.fromBase, 2);
      assert.equal(payload.data.toBase, 16);
      assert.equal(payload.data.decimal, 42);
      assert.equal(String(payload.data.converted).toLowerCase(), "2a");
      assert.equal(payload.data.binary, "101010");
      assert.equal(payload.data.hex, "2a");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/ssl/check/example.com");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.domain, "example.com");
      assert.equal(typeof payload.data.daysRemaining, "number");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/placeholder/320x200?text=demo");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.width, 320);
      assert.equal(payload.data.height, 200);
      assert.match(String(payload.data.svgDataUri || ""), /^data:image\/svg\+xml;base64,/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/gif/generate", {
        prompt: "Launch countdown",
        frames: 8,
        width: 320,
        height: 180,
        fps: 8,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.operation, "gif-generate");
      assert.equal(payload.data.frameCount, 8);
      assert.equal(payload.data.artifact.mimeType, "image/gif");
      assert.ok(payload.data.artifact.sizeBytes > 100);
      assert.match(String(payload.data.gifDataUri || ""), /^data:image\/gif;base64,/);
    }
    {
      const redPng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVR4AYXBAQEAAAiAIPP/53qQMAvLQ4IECRIkSJBwElsCDgH7XhwAAAAASUVORK5CYII=";
      const bluePng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVR4AYXBAQEAAAiAIPP/53qQMLDLQ4IECRIkSJBwEF0CDvOrHbEAAAAASUVORK5CYII=";
      const { response, payload } = await postJson(baseUrl, "/api/tools/gif/compose", {
        image_data_uris: [redPng, bluePng, redPng],
        width: 180,
        height: 120,
        fps: 6,
        fit: "cover",
        show_index: true,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.operation, "gif-compose");
      assert.equal(payload.data.loadedSources, 3);
      assert.ok(payload.data.frameCount >= 3);
      assert.equal(payload.data.artifact.mimeType, "image/gif");
      assert.ok(payload.data.artifact.sizeBytes > 100);
      assert.match(String(payload.data.gifDataUri || ""), /^data:image\/gif;base64,/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/fuel-cost", {
        mpg: 30,
        miles: 1200,
        fuel_price: 3.5,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.monthlyCost, 140);
      assert.equal(payload.data.annualCost, 1680);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/ev-range", {
        battery_kwh: 75,
        consumption: 25,
        temp: 40,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.temperatureFactor, 0.82);
      assert.ok(payload.data.estimatedRangeMiles > 200);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/payment", {
        price: 40000,
        down: 5000,
        rate: 6,
        term: 60,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.monthlyPayment > 600);
      assert.equal(payload.data.termMonths, 60);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/aviation/great-circle", {
        from: "JFK",
        to: "LAX",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.distanceNm > 2000);
      assert.ok(payload.data.estimatedFlightHours > 4);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/mood", {
        mood: 8,
        notes: "Good day",
        tags: ["focus", "sleep"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.moodLabel, "positive");
      assert.equal(payload.data.tags.length, 2);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/breathing", {
        technique: "4-7-8",
        duration: 6,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.technique, "4-7-8");
      assert.equal(payload.data.cycleSeconds, 19);
      assert.ok(payload.data.recommendedCycles > 10);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/habit", {
        habit: "reading",
        logs: [
          { date: "2026-03-25", completed: true },
          { date: "2026-03-26", completed: false },
          { date: "2026-03-27", completed: true },
          { date: "2026-03-28", completed: true },
          { date: "2026-03-29", completed: true },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.currentStreak, 3);
      assert.equal(payload.data.longestStreak, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/vo2max", {
        age: 34,
        resting_hr: 55,
        max_hr: 185,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.vo2maxEstimate > 40);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/hr-zones", {
        age: 34,
        resting_hr: 55,
        max_hr: 185,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.zones.length, 5);
      assert.ok(payload.data.zones[0].bpmMin < payload.data.zones[4].bpmMax);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/one-rep-max", {
        weight: 225,
        reps: 5,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.recommendedOneRepMax > 240);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/tires", {
        tire_size: "225/45R17",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.tireSize, "225/45R17");
      assert.ok(payload.data.overallDiameterIn > 24);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/emissions", {
        make: "Honda",
        model: "Civic",
        year: 2021,
        mpg: 35,
        annual_miles: 12000,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.mpg, 35);
      assert.ok(payload.data.co2GramsPerMile > 200);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/stress", {
        sleep_hours: 5.5,
        workload: 8,
        caffeine: 3,
        exercise_minutes: 10,
        events: ["deadline", "meeting"],
        notes: "Overwhelmed by deadline pressure",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.stressScore > 60);
      assert.equal(typeof payload.data.level, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/sleep", {
        hours: 7.2,
        quality: 8,
        factors: ["exercise", "late-screen"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.sleepScore > 50);
      assert.equal(typeof payload.data.rating, "string");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/wellness/gratitude?topic=team");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.topic, "team");
      assert.equal(typeof payload.data.prompt, "string");
      assert.ok(Array.isArray(payload.data.followUps));
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/wellness/mindfulness?technique=grounding&duration=4");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.technique, "grounding");
      assert.ok(Array.isArray(payload.data.steps));
      assert.ok(payload.data.steps.length >= 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/calories-burned", {
        activity: "running",
        duration: 45,
        weight: 180,
        weight_unit: "lb",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.activity, "running");
      assert.ok(payload.data.estimatedCalories > 500);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/pace", {
        distance_miles: 3.1,
        time: "24:48",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.pacePerMileMinutes > 7);
      assert.ok(payload.data.projectionsMinutes.marathon > 180);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/hydration", {
        weight: 180,
        weight_unit: "lb",
        activity_minutes: 60,
        temp: 85,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.recommendedLitersPerDay > 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/bodyfat", {
        sex: "male",
        unit: "in",
        height: 70,
        neck: 16,
        waist: 34,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.bodyFatPercent > 5);
      assert.equal(payload.data.method, "us-navy");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/drinks/abv", {
        og: 1.056,
        fg: 1.012,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.abvPercent > 5);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/drinks/sobriety", {
        drinks: 3,
        weight: 180,
        weight_unit: "lb",
        sex: "male",
        hours: 2,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimatedBac >= 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fashion/size", {
        measurement: 40,
        unit: "in",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.recommended.us, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fashion/care", {
        symbols: ["wash30", "no_bleach", "tumble_low"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.decoded.length, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fashion/dress-code", {
        code: "business casual",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.recommendation.attire, "smart-casual");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/type-scale", {
        base_size: 16,
        ratio: 1.25,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.scale.length, 7);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/readability", {
        foreground: "#111111",
        background: "#ffffff",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.contrastRatio > 7);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/golden-ratio", {
        width: 1200,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.recommendedHeight > 700);
      assert.ok(payload.data.recommendedHeight < 800);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/grid", {
        width: 1440,
        columns: 12,
        gutter: 24,
        margin: 80,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.columnWidth > 80);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/i18n/format", {
        value: 12345.67,
        type: "currency",
        currency: "USD",
        locale: "en-US",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.formatted, /\$/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/cbt", {
        text: "I always fail at presentations and everyone thinks I'm incompetent.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.flags));
      assert.ok(payload.data.flags.length >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/journal", {
        mood: "stressed",
        topic: "workload",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.topic, "workload");
      assert.equal(typeof payload.data.prompt, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/chords", {
        key: "C",
        mood: "uplifting",
        style: "pop",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.chords));
      assert.equal(payload.data.chords.length, 4);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/lyrics", {
        genre: "pop",
        theme: "momentum",
        mood: "hopeful",
        verses: 2,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.verses, 2);
      assert.equal(typeof payload.data.lyrics, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/scale", {
        root: "D",
        type: "major",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.root, "D");
      assert.ok(payload.data.notes.includes("F#"));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/metronome", {
        bpm: 120,
        time_sig: "4/4",
        measures: 2,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.ticks.length, 8);
      assert.equal(payload.data.timeSignature, "4/4");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/structure", {
        genre: "pop",
        length: 210,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.timeline));
      assert.ok(payload.data.timeline.length >= 6);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/theory-quiz", {
        level: "beginner",
        topic: "intervals",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.question, "string");
      assert.ok(Array.isArray(payload.data.choices));
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/music/tuning/A4");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.note, "A4");
      assert.equal(payload.data.standardHz, 440);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/royalty-split", {
        streams: 100000,
        rate_per_stream: 0.003,
        shares: [
          { party: "artist", pct: 50 },
          { party: "writer", pct: 30 },
          { party: "producer", pct: 20 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.grossRevenue, 300);
      assert.equal(payload.data.payouts.length, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/exif", {
        image_url: "https://example.com/photo.jpg",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.cameraModel, "string");
      assert.equal(typeof payload.data.capturedAt, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/hash", {
        image_url: "https://example.com/photo.jpg",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.sha256.length, 64);
      assert.equal(payload.data.perceptualHash.length, 16);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/watermark-text", {
        name: "AurelianFlo",
        year: 2026,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.watermark, /AurelianFlo/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/print", {
        pixels: "6000x4000",
        dpi: 300,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.maxPrintSize.widthIn > 10);
      assert.ok(Array.isArray(payload.data.fitsStandardPrints));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/focal", {
        focal: 35,
        sensor_size: "aps-c",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.equivalent35mm > 50);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/exposure", {
        aperture: 2.8,
        shutter: "1/125",
        ev: 10,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.iso >= 50);
      assert.equal(typeof payload.data.shutterDisplay, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/golden-hour", {
        date: "2026-06-21",
        lat: 41.88,
        lon: -87.63,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.sunrise, /^\d{2}:\d{2}$/);
      assert.match(payload.data.sunset, /^\d{2}:\d{2}$/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/dimensions", {
        room: "living-room",
        style: "modern",
        length: 14,
        width: 12,
        unit: "ft",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.area > 100);
      assert.equal(payload.data.unit, "ft");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/lighting", {
        length: 14,
        width: 12,
        unit: "ft",
        use: "living",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.fixtureCount >= 1);
      assert.ok(payload.data.lumensNeeded > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/flooring", {
        room_dims: "14x12",
        unit: "ft",
        pattern: "herringbone",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.totalWithWaste > payload.data.area);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/value", {
        make: "Toyota",
        model: "Camry",
        year: 2021,
        mileage: 62000,
        condition: "good",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimateUsd.low > 0);
      assert.ok(payload.data.estimateUsd.high >= payload.data.estimateUsd.low);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/plate-to-vin", {
        plate: "ABC1234",
        state: "IL",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.vin.length, 17);
      assert.equal(payload.data.state, "IL");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/auto/vin-recall/1HGCM82633A004352");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.vin.length, 17);
      assert.ok(Array.isArray(payload.data.recalls));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/insurance", {
        vehicle: { make: "Toyota", model: "Camry", year: 2021 },
        age: 34,
        zip: "60601",
        history: "clean",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimateUsd.monthlyLow > 0);
      assert.ok(payload.data.estimateUsd.monthlyHigh >= payload.data.estimateUsd.monthlyLow);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/auto/insurance", {
        vehicle: { make: "Honda", model: "Civic", year: 2022 },
        age: 32,
        zip: "60601",
        history: { accidents: 1, tickets: 2 },
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.notEqual(payload.data.driver.history, "[object object]");
      assert.ok(payload.data.driver.history.includes("accident"));
      assert.ok(payload.data.driver.history.includes("ticket"));
      assert.ok(payload.data.factors.historyFactor > 1);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/auto/recall/honda/accord/2019");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.vehicle.make.toLowerCase(), "honda");
      assert.equal(payload.data.vehicle.model.toLowerCase(), "accord");
      assert.equal(payload.data.vehicle.year, 2019);
      assert.ok(Array.isArray(payload.data.recalls));
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/aviation/taf/KJFK");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.airport, "KJFK");
      assert.ok(Array.isArray(payload.data.periods));
      assert.ok(payload.data.periods.length >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/aviation/metar", {
        metar: "KJFK 121651Z 18012KT 10SM FEW020 SCT250 27/19 A2992 RMK AO2",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.decoded.station, "KJFK");
      assert.equal(payload.data.decoded.wind.speedKt, 12);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/aviation/fuel", {
        aircraft_type: "A320",
        distance: 800,
        load: 82,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimateKg.totalFuel > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/aviation/airspace", {
        lat: 41.9,
        lon: -87.6,
        altitude: 4500,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.airspaceClass, "string");
      assert.equal(typeof payload.data.restricted, "boolean");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/aviation/flight/AA100");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.flightNumber, "AA100");
      assert.equal(typeof payload.data.gate, "string");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/aviation/aircraft/N123AB");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.tailNumber, "N123AB");
      assert.equal(typeof payload.data.make, "string");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/aviation/airport/JFK");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.airport, "JFK");
      assert.ok(Array.isArray(payload.data.services));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/aviation/runway", {
        airport: "KJFK",
        aircraft_weight: 130000,
        temp: 28,
        altitude: 15,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.requiredRunwayLengthFt > 0);
      assert.ok(payload.data.recommendedRunwayLengthFt >= payload.data.requiredRunwayLengthFt);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/aviation/notam/KJFK");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.airport, "KJFK");
      assert.ok(Array.isArray(payload.data.notams));
      assert.ok(payload.data.notams.length >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/planets", {
        date: "2026-07-04",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.planets));
      assert.equal(payload.data.planets.length, 7);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/star", {
        star: "Sirius",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.name, "Sirius");
      assert.equal(typeof payload.data.magnitude, "number");
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/astronomy/meteors?year=2026");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.meteorShowers));
      assert.ok(payload.data.meteorShowers.length >= 4);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/iss", {
        lat: 41.8781,
        lon: -87.6298,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.passes));
      assert.ok(payload.data.passes.length >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/satellite", {
        norad_id: 25544,
        lat: 34.0522,
        lon: -118.2437,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.noradId, 25544);
      assert.ok(Array.isArray(payload.data.passes));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/eclipses", {
        location: "chicago",
        years: 3,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.events));
      assert.ok(payload.data.events.length >= 1);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/astronomy/launches");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.launches));
      assert.ok(payload.data.launches.length >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/neo", {
        start_date: "2026-04-01",
        end_date: "2026-04-10",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.objects));
      assert.ok(payload.data.count >= 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/light-pollution", {
        lat: 35.0,
        lon: -100.0,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.bortleScale >= 1);
      assert.ok(payload.data.bortleScale <= 9);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/astronomy/constellation", {
        ra: 5.9,
        dec: 7.4,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.constellation, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/color-harmony", {
        hex: "#3366cc",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.base, /^#/);
      assert.ok(Array.isArray(payload.data.triadic));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/wallpaper", {
        room_dims: "14x12",
        height: 8,
        roll_width: 1.75,
        roll_length: 33,
        unit: "ft",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.rollsNeeded >= 1);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/maritime/tides/SFO");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.port, "SFO");
      assert.ok(Array.isArray(payload.data.tides));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/maritime/weather", {
        lat: 37.7749,
        lon: -122.4194,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.forecast.windKt >= 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/maritime/route", {
        origin: "SFO",
        destination: "LAX",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.distanceNm > 0);
      assert.ok(Array.isArray(payload.data.waypoints));
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/maritime/imo/IMO1234567");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.imo, /^IMO\d{7}$/);
      assert.equal(typeof payload.data.vesselType, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/tile", {
        area: 200,
        tile_size: "12x12",
        pattern: "diagonal",
        unit: "ft",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.totalTiles >= payload.data.baseTiles);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/carpet", {
        area: 180,
        price_per_sqft: 4.5,
        install_rate: 1.25,
        unit: "ft",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.totalCost > payload.data.materialCost);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/wellness/burnout", {
        workload: 8,
        hours: 58,
        satisfaction: 4,
        sleep_hours: 6,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.burnoutRiskScore, "number");
      assert.ok(["low", "moderate", "high"].includes(payload.data.burnoutRiskLevel));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/plan", {
        goal: "strength",
        days: 4,
        equipment: ["dumbbells", "bench"],
        level: "intermediate",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.daysPerWeek, 4);
      assert.equal(payload.data.weeklySchedule.length, 4);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/load", {
        sessions: [
          { duration: 45, rpe: 7 },
          { duration: 60, rpe: 8 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.sessionCount, 2);
      assert.ok(payload.data.weeklyLoad > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fitness/injury-risk", {
        training_data: {
          weekly_delta_pct: 24,
          soreness: 8,
          sleep: 5.5,
        },
        history: {
          priorInjury: true,
        },
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.injuryRiskScore, "number");
      assert.ok(["low", "moderate", "high"].includes(payload.data.injuryRiskLevel));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/bpm", {
        audio_url: "https://example.com/track.mp3",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimatedBpm >= 40);
      assert.ok(payload.data.estimatedBpm <= 220);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/music/key", {
        audio_url: "https://example.com/track.mp3",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.key, "string");
      assert.ok(Array.isArray(payload.data.alternateKeys));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/grade", {
        mood: "cinematic",
        style: "teal-orange",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.mood, "cinematic");
      assert.equal(typeof payload.data.preset.contrast, "number");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/composition", {
        image_url: "https://example.com/photo.jpg",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.compositionScore, "number");
      assert.ok(Array.isArray(payload.data.suggestions));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/photo/style", {
        image_url: "https://example.com/photo.jpg",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.detectedStyle, "string");
      assert.ok(payload.data.confidence > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/interior/paint-match", {
        hex: "#5d9cec",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.inputHex, "#5d9cec");
      assert.equal(payload.data.matches.length, 2);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/tts/ssml", {
        ssml: "<speak>Hello <break time='300ms'/> world</speak>",
        voice: "alloy",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.voice, "alloy");
      assert.equal(payload.data.ssmlValid, true);
      assert.equal(typeof payload.data.estimatedDurationSec, "number");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/og-image/generate", {
        title: "Q2 Report",
        description: "Revenue up 22%",
        brand: "AurelianFlo",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.title, "Q2 Report");
      assert.match(String(payload.data.artifact.dataUri || ""), /^data:image\/svg\+xml;base64,/);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/legal/extract-clauses", {
        text: "Confidential information shall remain confidential for 3 years. Governing law is Delaware.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.clauseCount >= 1);
      assert.ok(Array.isArray(payload.data.clauses));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/legal/nda-summary", {
        text: "Mutual NDA. Term 2 years. Governing law is Delaware.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.summary, "string");
      assert.equal(typeof payload.data.keyTerms, "object");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/ai/competitor", {
        company: "Acme",
        competitors: ["BetaCo", "Gamma"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.scorecard));
      assert.ok(Array.isArray(payload.data.ranking));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/intel/market-size", {
        market: "US workflow automation SaaS",
        region: "US",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.estimates.tamUsdMillions > 0);
      assert.ok(payload.data.estimates.samUsdMillions > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/intel/industry", {
        industry: "cybersecurity saas",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.trends));
      assert.ok(Array.isArray(payload.data.keyPlayers));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/ai/synthetic-data", {
        schema: { name: "string", mrr: "number" },
        rows: 5,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.generatedRows, 5);
      assert.ok(Array.isArray(payload.data.rows));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/legal/cite", {
        case_name: "Roe v. Wade",
        reporter: "410 U.S. 113",
        year: 1973,
        style: "Bluebook",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.style, "Bluebook");
      assert.equal(typeof payload.data.citation, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/legal/retention", {
        data_type: "customer pii",
        industry: "fintech",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.recommendedRetentionMonths >= 24);
      assert.equal(typeof payload.data.recommendedRetentionYears, "number");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/realestate/rent-vs-buy", {
        home_price: 450000,
        monthly_rent: 2600,
        down_payment_pct: 20,
        mortgage_rate: 6.5,
        years: 7,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.estimates.mortgagePaymentMonthly, "number");
      assert.equal(typeof payload.data.recommendation, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/agent/calibrate", {
        predictions: [0.9, 0.7, 0.2, 0.4],
        outcomes: [1, 1, 0, 0],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.metrics.brierScore, "number");
      assert.equal(typeof payload.data.calibrationHint, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/agent/token-count", {
        text: "This is a token counting test payload for deterministic estimation.",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.estimatedTokens, "number");
      assert.equal(payload.data.method, "chars_div_4");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/pay/reconcile", {
        expected: [
          { id: "a", amount: 100 },
          { id: "b", amount: 75 },
        ],
        actual: [
          { id: "a", amount: 100 },
          { id: "c", amount: 75 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.counts.matched, 1);
      assert.equal(payload.data.counts.missing, 1);
      assert.equal(payload.data.counts.unexpected, 1);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/pricing/saas", {
        category: "B2B SaaS",
        features: ["api", "sso", "analytics"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(payload.data.benchmarkMonthlyUsd.high > payload.data.benchmarkMonthlyUsd.low);
      assert.ok(Array.isArray(payload.data.suggestedPackaging));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/pricing/elasticity", {
        history: [
          { price: 10, volume: 1000 },
          { price: 12, volume: 860 },
          { price: 14, volume: 760 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.elasticity, "number");
      assert.equal(payload.data.sampleSize, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/ai/world-model", {});
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.date, "string");
      assert.equal(typeof payload.data.snapshot, "object");
      assert.equal(typeof payload.data.indicators.momentum, "number");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/email/validate", {
        email: "demo@example.com",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.valid, true);
      assert.equal(typeof payload.data.deliverable, "boolean");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/phone/validate", {
        phone: "+1 (312) 555-0199",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.valid, true);
      assert.equal(typeof payload.data.e164, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/calendar/generate", {
        title: "Roadmap Review",
        start: "2026-04-05T14:00:00Z",
        end: "2026-04-05T15:00:00Z",
        timezone: "UTC",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.artifact.mimeType, "text/calendar");
      assert.equal(typeof payload.data.artifact.contentBase64, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/calc/mortgage", {
        home_price: 450000,
        down_payment_pct: 20,
        apr: 6.5,
        term_years: 30,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.outputs.monthlyPayment, "number");
      assert.ok(payload.data.outputs.monthlyPayment > 0);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/calc/roi", {
        investment: 10000,
        returns: 14000,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.net, 4000);
      assert.equal(payload.data.verdict, "positive");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/calc/npv", {
        initial_investment: -10000,
        discount_rate_pct: 10,
        cashflows: [3000, 4000, 4500, 5000],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(typeof payload.data.npv, "number");
      assert.ok(Array.isArray(payload.data.discountedCashflows));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/drinks/cocktail", {
        ingredients: ["gin", "lime", "simple syrup"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.recipes));
      assert.ok(payload.data.recipes.length >= 1);
      assert.equal(typeof payload.data.topPick.name, "string");
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/drinks/beer-style", {
        style: "ipa",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.family, "India Pale Ale");
      assert.ok(Array.isArray(payload.data.notes));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fashion/outfit", {
        colors: ["black", "white", "emerald"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.harmony, "safe");
      assert.ok(Array.isArray(payload.data.accentColors));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/fashion/capsule", {
        style: "minimal",
        climate: "temperate",
        budget: 1500,
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.essentials));
      assert.ok(payload.data.estimatedSpendRange.high > payload.data.estimatedSpendRange.low);
    }
    {
      const { response, payload } = await getJson(baseUrl, "/api/tools/fashion/textile/linen");
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.fabric, "linen");
      assert.ok(Array.isArray(payload.data.properties));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/font-pair", {
        base_font: "inter",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.baseFont, "inter");
      assert.equal(payload.data.pairings.length, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/colorblind", {
        palette: ["#3366cc", "#ff7f0e", "#2ca02c"],
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(Array.isArray(payload.data.simulations.protanopia));
      assert.equal(payload.data.simulations.protanopia.length, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/brand-color", {
        hex: "#3366cc",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.ok(["blue", "purple"].includes(payload.data.family));
      assert.ok(Array.isArray(payload.data.associations));
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/icon", {
        concept: "payment checkout",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.concept, "payment checkout");
      assert.ok(Array.isArray(payload.data.suggestions));
      assert.equal(payload.data.suggestions.length, 3);
    }
    {
      const { response, payload } = await postJson(baseUrl, "/api/tools/design/logo-colors", {
        image_url: "https://example.com/logo.png",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.match(payload.data.palette.primary, /^#[0-9a-f]{6}$/);
      assert.ok(Array.isArray(payload.data.allExtracted));
      assert.ok(payload.data.allExtracted.length >= 3);
    }
  });
});

test("generated media routes do not fetch loopback image URLs", async () => {
  await withHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end("not-used");
  }, async (targetBaseUrl) => {
    const app = createApp({
      env: {},
      enableDebugRoutes: false,
      paymentGate: (_req, _res, next) => next(),
      mercTrustMiddleware: null,
    });

    await withServer(app, async (baseUrl) => {
      const blockedUrl = `${targetBaseUrl}/test.png`;
      const { response, payload } = await postJson(baseUrl, "/api/tools/colors/extract", {
        imageUrl: blockedUrl,
        text: "fallback-seed",
      });

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.mode, "text-fallback");
      assert.equal(payload.data.imageUrl, blockedUrl);
      assert.equal(payload.data.fallbackReason, "blocked_private_host");
      assert.ok(Array.isArray(payload.data.palette));
      assert.ok(payload.data.palette.length > 0);
    });
  });
});

test("generated document routes are published in discovery and OpenAPI", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api?format=json`);
    const discovery = await discoveryResponse.json();

    assert.equal(discoveryResponse.status, 200);
    assert.ok(Array.isArray(discovery.catalog));
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/report/generate"),
      "expected report generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/docx/generate"),
      "expected DOCX generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/xlsx/generate"),
      "expected XLSX generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/report/pdf/generate"),
      "expected report PDF generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/report/docx/generate"),
      "expected report DOCX generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/report/xlsx/generate"),
      "expected report XLSX generator in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/pdf/render-html"),
      "expected max-fidelity PDF renderer in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/docx/render-template"),
      "expected template DOCX renderer in /api discovery",
    );
    assert.ok(
      discovery.catalog.some((entry) => entry.path === "/api/tools/xlsx/render-template"),
      "expected template XLSX renderer in /api discovery",
    );

    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApi = await openApiResponse.json();

    assert.equal(openApiResponse.status, 200);
    const reportRequestSchema = openApi.paths["/api/tools/report/generate"].post.requestBody.content["application/json"].schema;
    const docxRequestSchema = openApi.paths["/api/tools/docx/generate"].post.requestBody.content["application/json"].schema;
    const xlsxRequestSchema = openApi.paths["/api/tools/xlsx/generate"].post.requestBody.content["application/json"].schema;
    const reportPdfRequestSchema = openApi.paths["/api/tools/report/pdf/generate"].post.requestBody.content["application/json"].schema;
    const reportDocxRequestSchema = openApi.paths["/api/tools/report/docx/generate"].post.requestBody.content["application/json"].schema;
    const reportXlsxRequestSchema = openApi.paths["/api/tools/report/xlsx/generate"].post.requestBody.content["application/json"].schema;
    const renderHtmlRequestSchema = openApi.paths["/api/tools/pdf/render-html"].post.requestBody.content["application/json"].schema;
    const renderTemplateDocxSchema = openApi.paths["/api/tools/docx/render-template"].post.requestBody.content["application/json"].schema;
    const renderTemplateXlsxSchema = openApi.paths["/api/tools/xlsx/render-template"].post.requestBody.content["application/json"].schema;
    const reportResponseSchema = openApi.paths["/api/tools/report/generate"].post.responses["200"].content["application/json"].schema;

    assert.ok(schemaIncludesRequiredProperty(reportRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(reportRequestSchema, "tables"));
    assert.ok(schemaIncludesRequiredProperty(docxRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(docxRequestSchema, "sections"));
    assert.ok(schemaIncludesRequiredProperty(xlsxRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(xlsxRequestSchema, "sheets"));
    assert.ok(schemaIncludesRequiredProperty(reportPdfRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(reportDocxRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(reportXlsxRequestSchema, "report_meta"));
    assert.ok(schemaIncludesRequiredProperty(renderHtmlRequestSchema, "html"));
    assert.ok(schemaIncludesRequiredProperty(renderTemplateDocxSchema, "template"));
    assert.ok(schemaIncludesRequiredProperty(renderTemplateXlsxSchema, "template"));
    assert.ok(schemaHasArtifactEnvelope(reportResponseSchema));
  });
});

test("explicit document alias routes resolve to live handlers", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const reportPdf = await postJson(baseUrl, "/api/tools/report/pdf/generate", {
      report_meta: { report_type: "ops-brief", title: "Ops Brief", author: "AurelianFlo" },
      executive_summary: ["Routes healthy."],
      tables: {
        health: {
          columns: ["route", "status"],
          rows: [{ route: "/api/tools/report/pdf/generate", status: "healthy" }],
        },
      },
    });
    assert.equal(reportPdf.response.status, 200);
    assert.equal(reportPdf.payload.success, true);
    assert.equal(reportPdf.payload.data.documentType, "pdf");

    const reportDocx = await postJson(baseUrl, "/api/tools/report/docx/generate", {
      report_meta: { report_type: "board-update", title: "Board Update", author: "AurelianFlo" },
      executive_summary: ["Highlights ready."],
      tables: {
        pipeline: {
          columns: ["stage", "status"],
          rows: [{ stage: "Draft", status: "complete" }],
        },
      },
    });
    assert.equal(reportDocx.response.status, 200);
    assert.equal(reportDocx.payload.success, true);
    assert.equal(reportDocx.payload.data.documentType, "docx");

    const reportXlsx = await postJson(baseUrl, "/api/tools/report/xlsx/generate", {
      report_meta: { report_type: "ops-workbook", title: "Ops Workbook", author: "AurelianFlo" },
      executive_summary: ["Workbook ready."],
      tables: {
        metrics: {
          columns: ["metric", "value"],
          rows: [{ metric: "availability", value: "99.9%" }],
        },
      },
    });
    assert.equal(reportXlsx.response.status, 200);
    assert.equal(reportXlsx.payload.success, true);
    assert.equal(reportXlsx.payload.data.documentType, "xlsx");

    const renderHtml = await postJson(baseUrl, "/api/tools/pdf/render-html", {
      title: "Branded HTML Brief",
      html: "<html><body><h1>Quarterly Brief</h1><p>ARR is healthy.</p></body></html>",
    });
    assert.equal(renderHtml.response.status, 200);
    assert.equal(renderHtml.payload.success, true);
    assert.equal(renderHtml.payload.data.documentType, "pdf");
    assert.equal(renderHtml.payload.data.capabilities.selected.lane, "max-fidelity");

    const renderTemplateDocx = await postJson(baseUrl, "/api/tools/docx/render-template", {
      title: "Mutual NDA",
      template: "nda",
    });
    assert.equal(renderTemplateDocx.response.status, 200);
    assert.equal(renderTemplateDocx.payload.success, true);
    assert.equal(renderTemplateDocx.payload.data.documentType, "docx");

    const renderTemplateXlsx = await postJson(baseUrl, "/api/tools/xlsx/render-template", {
      title: "Revenue Tracker",
      template: "tracker",
      items: [{ name: "Launch docs", owner: "Ops", due_date: "2026-04-10", status: "In Progress" }],
    });
    assert.equal(renderTemplateXlsx.response.status, 200);
    assert.equal(renderTemplateXlsx.payload.success, true);
    assert.equal(renderTemplateXlsx.payload.data.documentType, "xlsx");
  });
});

test("legacy system discovery and OpenAPI aliases resolve to curated live route catalogs", async () => {
  const app = createApp({
    env: { NODE_ENV: "production" },
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api/system/discovery/core?limit=500&format=json`);
    const discovery = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 200);
    assert.ok(Array.isArray(discovery.catalog));
    assert.ok(discovery.catalog.some((entry) => entry.path === "/api/tools/report/generate"));
    assert.ok(discovery.catalog.some((entry) => entry.path === "/api/tools/report/pdf/generate"));

    const fullDiscoveryResponse = await fetch(`${baseUrl}/api/system/discovery/full?limit=500&format=json`);
    const fullDiscovery = await fullDiscoveryResponse.json();
    assert.equal(fullDiscoveryResponse.status, 200);
    assert.ok(Array.isArray(fullDiscovery.catalog));
    assert.ok(fullDiscovery.catalog.some((entry) => entry.path === "/api/tools/xlsx/generate"));
    assert.ok(!fullDiscovery.catalog.some((entry) => entry.path === "/api/weather/current"));
    assert.ok(!fullDiscovery.catalog.some((entry) => entry.path === "/api/tools/contract/generate"));

    const openApiResponse = await fetch(`${baseUrl}/api/system/openapi.json`);
    const openApi = await openApiResponse.json();
    assert.equal(openApiResponse.status, 200);
    assert.ok(openApi.paths["/api/tools/docx/generate"]?.post);
    assert.ok(openApi.paths["/api/tools/pdf/render-html"]?.post);

    const fullOpenApiResponse = await fetch(`${baseUrl}/openapi-full.json`);
    const fullOpenApi = await fullOpenApiResponse.json();
    assert.equal(fullOpenApiResponse.status, 200);
    assert.ok(fullOpenApi.paths["/api/tools/report/generate"]?.post);
    assert.ok(fullOpenApi.paths["/api/tools/xlsx/render-template"]?.post);
    assert.ok(!fullOpenApi.paths["/api/weather/current"]);
    assert.ok(!fullOpenApi.paths["/api/tools/contract/generate"]?.post);
  });
});

test("public discovery surfaces stay curated while system discovery exposes the full allowed AurelianFlo inventory", async () => {
  const app = createApp({
    env: { NODE_ENV: "production" },
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const publicDiscoveryResponse = await fetch(`${baseUrl}/api?format=json`);
    const publicDiscovery = await publicDiscoveryResponse.json();
    const fullDiscoveryResponse = await fetch(`${baseUrl}/api/system/discovery/full?limit=500&format=json`);
    const fullDiscovery = await fullDiscoveryResponse.json();

    assert.equal(publicDiscoveryResponse.status, 200);
    assert.equal(fullDiscoveryResponse.status, 200);
    assert.ok(Array.isArray(publicDiscovery.catalog));
    assert.ok(Array.isArray(fullDiscovery.catalog));

    const publicRouteKeys = new Set(publicDiscovery.catalog.map((entry) => String(entry.routeKey || "")));
    const fullRouteKeys = new Set(fullDiscovery.catalog.map((entry) => String(entry.routeKey || "")));
    const expectedPublicRouteKeys = new Set([
      "GET /api/ofac-wallet-screen/:address",
      "POST /api/workflows/compliance/edd-report",
      "POST /api/workflows/compliance/batch-wallet-screen",
      "POST /api/workflows/compliance/wallet-sanctions-report",
      "GET /api/vendor-entity-brief",
      "POST /api/workflows/finance/cash-runway-forecast",
      "POST /api/workflows/finance/startup-runway-forecast",
      "POST /api/workflows/finance/pricing-plan-compare",
      "POST /api/workflows/finance/pricing-sensitivity-report",
      "POST /api/workflows/vendor/risk-assessment",
      "POST /api/workflows/vendor/due-diligence-report",
      "POST /api/sim/probability",
      "POST /api/sim/batch-probability",
      "POST /api/sim/compare",
      "POST /api/sim/sensitivity",
      "POST /api/sim/forecast",
      "POST /api/sim/composed",
      "POST /api/sim/optimize",
      "POST /api/sim/report",
      "POST /api/tools/report/generate",
      "POST /api/tools/report/pdf/generate",
      "POST /api/tools/report/docx/generate",
      "POST /api/tools/report/xlsx/generate",
      "POST /api/tools/docx/generate",
      "POST /api/tools/xlsx/generate",
      "POST /api/tools/pdf/generate",
      "POST /api/tools/pdf/render-html",
      "POST /api/tools/docx/render-template",
      "POST /api/tools/xlsx/render-template",
    ]);

    assert.deepEqual(new Set([...publicRouteKeys].sort()), new Set([...expectedPublicRouteKeys].sort()));
    assert.ok(!publicRouteKeys.has("POST /api/tools/design/icon"));
    assert.ok(!publicRouteKeys.has("GET /api/tools/misc/iching"));
    assert.ok(!publicRouteKeys.has("POST /api/tools/contract/generate"));
    assert.ok(!publicRouteKeys.has("GET /api/weather/current/*"));
    assert.ok(fullRouteKeys.has("POST /api/workflows/vendor/risk-forecast"));
    assert.ok(fullRouteKeys.has("POST /api/workflows/finance/pricing-scenario-forecast"));
    assert.ok(!fullRouteKeys.has("POST /api/tools/design/icon"));
    assert.ok(!fullRouteKeys.has("GET /api/tools/misc/iching"));
    assert.ok(!fullRouteKeys.has("GET /api/weather/current/*"));
    assert.ok(fullDiscovery.catalog.length > publicDiscovery.catalog.length);

    const publicOpenApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const publicOpenApi = await publicOpenApiResponse.json();
    const fullOpenApiResponse = await fetch(`${baseUrl}/openapi-full.json`);
    const fullOpenApi = await fullOpenApiResponse.json();

    assert.equal(publicOpenApiResponse.status, 200);
    assert.equal(fullOpenApiResponse.status, 200);
    assert.equal(
      publicOpenApi.info.title,
      "AurelianFlo",
    );
    assert.match(publicOpenApi.info.description, /vendor diligence/i);
    assert.match(publicOpenApi.info.description, /finance scenario workflows/i);
    assert.match(publicOpenApi.info.description, /PDF, DOCX, XLSX/i);
    assert.ok(publicOpenApi.paths["/api/tools/report/generate"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/report/pdf/generate"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/report/docx/generate"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/report/xlsx/generate"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/pdf/render-html"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/docx/render-template"]?.post);
    assert.ok(publicOpenApi.paths["/api/tools/xlsx/render-template"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/compliance/wallet-sanctions-report"]?.post);
    assert.ok(publicOpenApi.paths["/api/vendor-entity-brief"]?.get);
    assert.ok(publicOpenApi.paths["/api/workflows/finance/cash-runway-forecast"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/finance/startup-runway-forecast"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/finance/pricing-plan-compare"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/finance/pricing-sensitivity-report"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/vendor/risk-assessment"]?.post);
    assert.ok(publicOpenApi.paths["/api/workflows/vendor/due-diligence-report"]?.post);
    assert.ok(publicOpenApi.paths["/api/sim/probability"]?.post);
    assert.ok(!publicOpenApi.paths["/api/tools/design/icon"]?.post);
    assert.ok(!publicOpenApi.paths["/api/weather/current/{param1}"]?.get);
    assert.ok(!publicOpenApi.paths["/api/tools/contract/generate"]?.post);
    assert.ok(fullOpenApi.paths["/api/workflows/vendor/risk-forecast"]?.post);
    assert.ok(fullOpenApi.paths["/api/workflows/finance/pricing-scenario-forecast"]?.post);
    assert.ok(!fullOpenApi.paths["/api/tools/design/icon"]?.post);
    assert.match(
      publicOpenApi.paths["/api/workflows/compliance/wallet-sanctions-report"]?.post?.summary || "",
      /crypto payment review/i,
    );
    assert.match(
      publicOpenApi.paths["/api/workflows/vendor/due-diligence-report"]?.post?.summary || "",
      /supplier onboarding/i,
    );
    assert.match(
      publicOpenApi.paths["/api/workflows/finance/startup-runway-forecast"]?.post?.summary || "",
      /founder- and investor-ready/i,
    );
    assert.match(
      publicOpenApi.paths["/api/tools/pdf/generate"]?.post?.summary || "",
      /client deliverables/i,
    );
  });
});

test("public OpenAPI exposes structured workflow output schemas for curated workflow routes", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const publicOpenApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const publicOpenApi = await publicOpenApiResponse.json();

    assert.equal(publicOpenApiResponse.status, 200);

    const eddWorkflowSchema =
      publicOpenApi.paths["/api/workflows/compliance/edd-report"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    const batchWorkflowSchema =
      publicOpenApi.paths["/api/workflows/compliance/batch-wallet-screen"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    const pricingWorkflowSchema =
      publicOpenApi.paths["/api/workflows/finance/pricing-plan-compare"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    const vendorWorkflowSchema =
      publicOpenApi.paths["/api/workflows/vendor/risk-assessment"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;

    assert.ok(schemaIncludesRequiredProperty(eddWorkflowSchema, "type"));
    assert.ok(Object.prototype.hasOwnProperty.call(eddWorkflowSchema?.properties || {}, "example"));

    assert.ok(schemaIncludesRequiredProperty(batchWorkflowSchema, "type"));
    assert.ok(Object.prototype.hasOwnProperty.call(batchWorkflowSchema?.properties || {}, "example"));

    assert.ok(schemaIncludesRequiredProperty(pricingWorkflowSchema, "workflow_meta"));
    assert.ok(schemaIncludesRequiredProperty(pricingWorkflowSchema, "summary"));
    assert.ok(schemaIncludesRequiredProperty(pricingWorkflowSchema, "scenarios"));

    assert.ok(schemaIncludesRequiredProperty(vendorWorkflowSchema, "workflow_meta"));
    assert.ok(schemaIncludesRequiredProperty(vendorWorkflowSchema, "summary"));
    assert.ok(schemaIncludesRequiredProperty(vendorWorkflowSchema, "vendors"));
  });
});

test("root app publishes and serves the cash runway workflow route", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api?format=json`);
    const discovery = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 200);
    assert.ok(
      discovery.catalog.some(
        (entry) => entry.routeKey === "POST /api/workflows/finance/cash-runway-forecast",
      ),
      "expected cash runway workflow route in curated discovery",
    );
    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApi = await openApiResponse.json();
    assert.equal(openApiResponse.status, 200);
    assert.ok(openApi.paths["/api/workflows/finance/cash-runway-forecast"]?.post);

    const response = await fetch(`${baseUrl}/api/workflows/finance/cash-runway-forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        as_of_date: "2026-04-03",
        workflow: "finance.cash_runway_forecast",
        mode: "single_case",
        inputs: {
          company_name: "AurelianFlo",
          current_cash_usd: 2400000,
          monthly_burn_usd: 185000,
          monthly_revenue_usd: 95000,
          burn_growth_rate_monthly: 0.012,
          revenue_growth_rate_monthly: 0.035,
          burn_volatility_pct: 0.1,
          revenue_volatility_pct: 0.14,
          runway_threshold_usd: 250000,
        },
        model_options: {
          seed: 12345,
          simulations: 10000,
          horizon_months: 24,
          include_report: true,
          include_artifacts: ["xlsx"],
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.workflow_meta.workflow, "finance.cash_runway_forecast");
    assert.equal(payload.workflow_meta.mode, "single_case");
    assert.equal(typeof payload.summary, "object");
    assert.ok(Array.isArray(payload.timeline));
    assert.equal(typeof payload.report, "object");
    assert.equal(payload.artifacts.xlsx.documentType, "xlsx");
  });
});

test("root app publishes and serves the pricing scenario workflow route", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api?format=json`);
    const discovery = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 200);
    assert.ok(
      discovery.catalog.some(
        (entry) => entry.routeKey === "POST /api/workflows/finance/pricing-plan-compare",
      ),
      "expected pricing scenario workflow route in curated discovery",
    );
    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApi = await openApiResponse.json();
    assert.equal(openApiResponse.status, 200);
    assert.ok(openApi.paths["/api/workflows/finance/pricing-plan-compare"]?.post);

    const response = await fetch(`${baseUrl}/api/workflows/finance/pricing-plan-compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        as_of_date: "2026-04-03",
        workflow: "finance.pricing_plan_compare",
        mode: "plan_compare",
        inputs: {
          baseline: {
            label: "current",
            monthly_visitors: 120000,
            conversion_rate: 0.031,
            price_usd: 49,
            variable_cost_usd: 8,
            retention_months: 7.5,
            fixed_cost_usd: 95000,
          },
          candidates: [
            {
              label: "growth",
              monthly_visitors: 120000,
              conversion_rate: 0.028,
              price_usd: 59,
              variable_cost_usd: 8,
              retention_months: 8.1,
              fixed_cost_usd: 98000,
            },
            {
              label: "volume",
              monthly_visitors: 120000,
              conversion_rate: 0.036,
              price_usd: 39,
              variable_cost_usd: 7,
              retention_months: 6.4,
              fixed_cost_usd: 92000,
            }
          ],
        },
        model_options: {
          seed: 12345,
          simulations: 10000,
          horizon_months: 12,
          include_report: true,
          include_artifacts: ["xlsx"],
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.workflow_meta.workflow, "finance.pricing_plan_compare");
    assert.equal(payload.workflow_meta.mode, "plan_compare");
    assert.equal(typeof payload.summary, "object");
    assert.ok(Array.isArray(payload.scenarios));
    assert.equal(typeof payload.report, "object");
    assert.equal(payload.artifacts.xlsx.documentType, "xlsx");
  });
});

test("root app publishes and serves the vendor risk workflow route", async () => {
  const app = createApp({
    env: {},
    enableDebugRoutes: false,
    paymentGate: (_req, _res, next) => next(),
    mercTrustMiddleware: null,
  });

  await withServer(app, async (baseUrl) => {
    const discoveryResponse = await fetch(`${baseUrl}/api?format=json`);
    const discovery = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 200);
    assert.ok(
      discovery.catalog.some(
        (entry) => entry.routeKey === "POST /api/workflows/vendor/risk-assessment",
      ),
      "expected vendor workflow route in curated discovery",
    );
    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApi = await openApiResponse.json();
    assert.equal(openApiResponse.status, 200);
    assert.ok(openApi.paths["/api/workflows/vendor/risk-assessment"]?.post);

    const response = await fetch(`${baseUrl}/api/workflows/vendor/risk-assessment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        as_of_date: "2026-04-03",
        workflow: "vendor.risk_assessment",
        mode: "vendor_batch",
        inputs: {
          vendors: [
            {
              name: "SBERBANK",
              country: "CZ",
              criticality: "high",
              annual_spend_usd: 2500000,
              cross_border: true,
              service_category: "banking",
            },
            {
              name: "ACME LOGISTICS LLC",
              country: "US",
              criticality: "medium",
              annual_spend_usd: 900000,
              cross_border: false,
              service_category: "logistics",
            },
          ],
        },
        model_options: {
          seed: 12345,
          screening_threshold: 90,
          screening_limit: 3,
          include_report: true,
          include_artifacts: ["xlsx"],
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.workflow_meta.workflow, "vendor.risk_assessment");
    assert.equal(payload.workflow_meta.mode, "vendor_batch");
    assert.equal(typeof payload.report, "object");
    assert.equal(typeof payload.artifacts, "object");
    assert.equal(payload.artifacts.xlsx.documentType, "xlsx");
    assert.equal(typeof payload.artifacts.xlsx.artifact.contentBase64, "string");
  });
});

