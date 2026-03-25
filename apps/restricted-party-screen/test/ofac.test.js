const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildBatchScreeningResponse,
  buildScreeningResponse,
  groupMatches,
  normalizeQueryName,
  splitCounterpartyNames,
  splitQueryValues,
} = require("../lib/ofac");

test("groupMatches collapses aliases under a shared OFAC id", () => {
  const grouped = groupMatches(
    [
      {
        id: 18715,
        name: "AKTSIONERNE TOVARYSTVO SBERBANK",
        address: "46 Volodymyrska street",
        type: "Entity",
        programs: "RUSSIA-EO14024; UKRAINE-EO13662",
        lists: "SDN; Non-SDN",
        nameScore: 100,
      },
      {
        id: 18715,
        name: "JSC SBERBANK",
        address: "46 Volodymyrska street",
        type: "Entity",
        programs: "RUSSIA-EO14024; UKRAINE-EO13662",
        lists: "SDN; Non-SDN",
        nameScore: 100,
      },
      {
        id: 18715,
        name: "JOINT STOCK COMPANY SBERBANK",
        address: "46 Volodymyrska street",
        type: "Entity",
        programs: "RUSSIA-EO14024",
        lists: "SDN",
        nameScore: 100,
      },
    ],
    "SBERBANK",
  );

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 18715);
  assert.equal(grouped[0].primaryName, "AKTSIONERNE TOVARYSTVO SBERBANK");
  assert.deepEqual(grouped[0].aliases, [
    "JOINT STOCK COMPANY SBERBANK",
    "JSC SBERBANK",
  ]);
  assert.deepEqual(grouped[0].programs, [
    "RUSSIA-EO14024",
    "UKRAINE-EO13662",
  ]);
  assert.deepEqual(grouped[0].lists, ["Non-SDN", "SDN"]);
  assert.equal(grouped[0].exactNameMatch, false);
});

test("buildScreeningResponse marks manual review when grouped matches exist", () => {
  const response = buildScreeningResponse(
    {
      name: "SBERBANK",
      minScore: 90,
      limit: 5,
      programs: [],
      list: "",
      type: "",
      country: "",
    },
    [
      {
        id: 18715,
        name: "JSC SBERBANK",
        address: "46 Volodymyrska street",
        type: "Entity",
        programs: "RUSSIA-EO14024; UKRAINE-EO13662",
        lists: "SDN; Non-SDN",
        nameScore: 100,
      },
    ],
    {
      sdnLastUpdated: "2026-03-13T00:00:00",
      consolidatedLastUpdated: "2026-01-08T00:00:00",
    },
  );

  assert.equal(response.success, true);
  assert.equal(response.data.summary.status, "potential-match");
  assert.equal(response.data.summary.manualReviewRecommended, true);
  assert.equal(response.data.matches[0].detailUrl.endsWith("18715"), true);
  assert.equal(response.data.screeningOnly, true);
});

test("buildBatchScreeningResponse recommends pause when any counterparty is flagged", () => {
  const response = buildBatchScreeningResponse(
    {
      names: ["SBERBANK", "Acme Trading LLC"],
      workflow: "vendor-onboarding",
      minScore: 90,
      limit: 3,
      programs: [],
      list: "",
      type: "",
      country: "",
    },
    [
      {
        name: "SBERBANK",
        rawMatches: [
          {
            id: 18715,
            name: "JSC SBERBANK",
            address: "46 Volodymyrska street",
            type: "Entity",
            programs: "RUSSIA-EO14024; UKRAINE-EO13662",
            lists: "SDN; Non-SDN",
            nameScore: 100,
          },
        ],
      },
      {
        name: "Acme Trading LLC",
        rawMatches: [],
      },
    ],
    {
      sdnLastUpdated: "2026-03-13T00:00:00",
      consolidatedLastUpdated: "2026-01-08T00:00:00",
    },
  );

  assert.equal(response.success, true);
  assert.equal(response.data.summary.screenedCount, 2);
  assert.equal(response.data.summary.flaggedCount, 1);
  assert.equal(response.data.summary.clearCount, 1);
  assert.equal(response.data.summary.recommendedAction, "pause-and-review");
  assert.equal(response.data.counterparties[0].summary.status, "potential-match");
  assert.equal(response.data.counterparties[1].summary.status, "no-potential-match");
});

test("splitQueryValues accepts comma-separated and repeated query values", () => {
  assert.deepEqual(splitQueryValues("SDN, Non-SDN"), ["SDN", "Non-SDN"]);
  assert.deepEqual(splitQueryValues(["IRAN", "RUSSIA-EO14024, UKRAINE-EO13662"]), [
    "IRAN",
    "RUSSIA-EO14024",
    "UKRAINE-EO13662",
  ]);
});

test("splitCounterpartyNames accepts pipe, newline, and semicolon separators", () => {
  assert.deepEqual(
    splitCounterpartyNames("SBERBANK|VTB BANK PJSC\nGAZPROMBANK;SBERBANK"),
    ["SBERBANK", "VTB BANK PJSC", "GAZPROMBANK"],
  );
});

test("normalizeQueryName strips punctuation and normalizes case", () => {
  assert.equal(normalizeQueryName("Bank Melli, Iran"), "BANK MELLI IRAN");
});
