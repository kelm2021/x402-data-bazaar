#!/usr/bin/env node

const BASE_URL = process.env.SPORTS_WORKFLOW_CANARY_BASE_URL || "https://api.aurelianflo.com";
const MAX_AMOUNT_USD_MICROS = Number(process.env.SPORTS_WORKFLOW_CANARY_MAX_USD_MICROS || 200000);
const SEED = Number(process.env.SPORTS_WORKFLOW_CANARY_SEED || 20260403);
const SELF_TAG_HEADER_NAME = "x-metrics-source";
const SELF_TAG_HEADER_VALUE = "sports-workflow-paid-canary";
const LEAGUES = String(process.env.SPORTS_WORKFLOW_PAID_CANARY_LEAGUES || "nba,nfl,mlb,nhl")
  .split(",")
  .map((league) => league.trim().toLowerCase())
  .filter(Boolean);

const LEAGUE_TEAMS = {
  nba: [
    { name: "Detroit Pistons", abbr: "DET", conference: "East", seed: 1, wins: 56, losses: 21, win_pct: 0.727, point_diff: 7.9, last_10: "8-2" },
    { name: "Boston Celtics", abbr: "BOS", conference: "East", seed: 2, wins: 51, losses: 25, win_pct: 0.671, point_diff: 7.2, last_10: "8-2" },
    { name: "New York Knicks", abbr: "NY", conference: "East", seed: 3, wins: 49, losses: 28, win_pct: 0.636, point_diff: 6.1, last_10: "7-3" },
    { name: "Cleveland Cavaliers", abbr: "CLE", conference: "East", seed: 4, wins: 48, losses: 29, win_pct: 0.623, point_diff: 4.1, last_10: "7-3" },
    { name: "Atlanta Hawks", abbr: "ATL", conference: "East", seed: 5, wins: 44, losses: 33, win_pct: 0.571, point_diff: 2.3, last_10: "8-2" },
    { name: "Philadelphia 76ers", abbr: "PHI", conference: "East", seed: 6, wins: 42, losses: 34, win_pct: 0.553, point_diff: -0.1, last_10: "7-3" },
    { name: "Oklahoma City Thunder", abbr: "OKC", conference: "West", seed: 1, wins: 61, losses: 16, win_pct: 0.792, point_diff: 11.4, last_10: "9-1" },
    { name: "San Antonio Spurs", abbr: "SA", conference: "West", seed: 2, wins: 59, losses: 18, win_pct: 0.766, point_diff: 8.5, last_10: "10-0" },
    { name: "Los Angeles Lakers", abbr: "LAL", conference: "West", seed: 3, wins: 50, losses: 27, win_pct: 0.649, point_diff: 1.5, last_10: "8-2" },
    { name: "Denver Nuggets", abbr: "DEN", conference: "West", seed: 4, wins: 49, losses: 28, win_pct: 0.636, point_diff: 4.8, last_10: "8-2" },
    { name: "Houston Rockets", abbr: "HOU", conference: "West", seed: 5, wins: 47, losses: 29, win_pct: 0.618, point_diff: 4.5, last_10: "6-4" },
    { name: "Minnesota Timberwolves", abbr: "MIN", conference: "West", seed: 6, wins: 46, losses: 30, win_pct: 0.605, point_diff: 3.7, last_10: "6-4" },
  ],
  nfl: [
    { name: "Kansas City Chiefs", abbr: "KC", conference: "AFC", seed: 1, wins: 14, losses: 3, win_pct: 0.824, point_diff: 11.2, last_10: "8-2" },
    { name: "Buffalo Bills", abbr: "BUF", conference: "AFC", seed: 2, wins: 13, losses: 4, win_pct: 0.765, point_diff: 10.4, last_10: "8-2" },
    { name: "Baltimore Ravens", abbr: "BAL", conference: "AFC", seed: 3, wins: 12, losses: 5, win_pct: 0.706, point_diff: 8.3, last_10: "7-3" },
    { name: "Houston Texans", abbr: "HOU", conference: "AFC", seed: 4, wins: 11, losses: 6, win_pct: 0.647, point_diff: 4.8, last_10: "6-4" },
    { name: "Cincinnati Bengals", abbr: "CIN", conference: "AFC", seed: 5, wins: 11, losses: 6, win_pct: 0.647, point_diff: 5.1, last_10: "7-3" },
    { name: "New York Jets", abbr: "NYJ", conference: "AFC", seed: 6, wins: 10, losses: 7, win_pct: 0.588, point_diff: 1.9, last_10: "6-4" },
    { name: "San Francisco 49ers", abbr: "SF", conference: "NFC", seed: 1, wins: 14, losses: 3, win_pct: 0.824, point_diff: 12.6, last_10: "9-1" },
    { name: "Detroit Lions", abbr: "DET", conference: "NFC", seed: 2, wins: 13, losses: 4, win_pct: 0.765, point_diff: 9.1, last_10: "8-2" },
    { name: "Philadelphia Eagles", abbr: "PHI", conference: "NFC", seed: 3, wins: 12, losses: 5, win_pct: 0.706, point_diff: 7.4, last_10: "7-3" },
    { name: "Dallas Cowboys", abbr: "DAL", conference: "NFC", seed: 4, wins: 11, losses: 6, win_pct: 0.647, point_diff: 6.3, last_10: "6-4" },
    { name: "Green Bay Packers", abbr: "GB", conference: "NFC", seed: 5, wins: 11, losses: 6, win_pct: 0.647, point_diff: 3.6, last_10: "7-3" },
    { name: "Los Angeles Rams", abbr: "LAR", conference: "NFC", seed: 6, wins: 10, losses: 7, win_pct: 0.588, point_diff: 2.8, last_10: "6-4" },
  ],
  mlb: [
    { name: "New York Yankees", abbr: "NYY", conference: "AL", seed: 1, wins: 5, losses: 1, win_pct: 0.833, point_diff: 2.33, last_10: "5-1" },
    { name: "Detroit Tigers", abbr: "DET", conference: "AL", seed: 2, wins: 5, losses: 1, win_pct: 0.833, point_diff: 2.17, last_10: "5-1" },
    { name: "Baltimore Orioles", abbr: "BAL", conference: "AL", seed: 3, wins: 4, losses: 2, win_pct: 0.667, point_diff: 1.5, last_10: "4-2" },
    { name: "Toronto Blue Jays", abbr: "TOR", conference: "AL", seed: 4, wins: 4, losses: 2, win_pct: 0.667, point_diff: 1.17, last_10: "4-2" },
    { name: "Houston Astros", abbr: "HOU", conference: "AL", seed: 5, wins: 4, losses: 2, win_pct: 0.667, point_diff: 0.83, last_10: "4-2" },
    { name: "Seattle Mariners", abbr: "SEA", conference: "AL", seed: 6, wins: 4, losses: 2, win_pct: 0.667, point_diff: 0.67, last_10: "4-2" },
    { name: "Los Angeles Dodgers", abbr: "LAD", conference: "NL", seed: 1, wins: 6, losses: 0, win_pct: 1, point_diff: 2.83, last_10: "6-0" },
    { name: "San Diego Padres", abbr: "SD", conference: "NL", seed: 2, wins: 5, losses: 1, win_pct: 0.833, point_diff: 2.5, last_10: "5-1" },
    { name: "Chicago Cubs", abbr: "CHC", conference: "NL", seed: 3, wins: 5, losses: 1, win_pct: 0.833, point_diff: 1.83, last_10: "5-1" },
    { name: "Philadelphia Phillies", abbr: "PHI", conference: "NL", seed: 4, wins: 4, losses: 2, win_pct: 0.667, point_diff: 1.33, last_10: "4-2" },
    { name: "San Francisco Giants", abbr: "SF", conference: "NL", seed: 5, wins: 4, losses: 2, win_pct: 0.667, point_diff: 1, last_10: "4-2" },
    { name: "Atlanta Braves", abbr: "ATL", conference: "NL", seed: 6, wins: 4, losses: 2, win_pct: 0.667, point_diff: 0.83, last_10: "4-2" },
  ],
  nhl: [
    { name: "New York Rangers", abbr: "NYR", conference: "East", seed: 1, wins: 54, losses: 22, win_pct: 0.711, point_diff: 1.15, last_10: "7-3" },
    { name: "Carolina Hurricanes", abbr: "CAR", conference: "East", seed: 2, wins: 52, losses: 24, win_pct: 0.684, point_diff: 0.91, last_10: "8-2" },
    { name: "Boston Bruins", abbr: "BOS", conference: "East", seed: 3, wins: 49, losses: 27, win_pct: 0.645, point_diff: 0.73, last_10: "6-4" },
    { name: "Toronto Maple Leafs", abbr: "TOR", conference: "East", seed: 4, wins: 47, losses: 29, win_pct: 0.618, point_diff: 0.54, last_10: "6-4" },
    { name: "Florida Panthers", abbr: "FLA", conference: "East", seed: 5, wins: 46, losses: 30, win_pct: 0.605, point_diff: 0.48, last_10: "7-3" },
    { name: "Tampa Bay Lightning", abbr: "TBL", conference: "East", seed: 6, wins: 44, losses: 32, win_pct: 0.579, point_diff: 0.33, last_10: "5-5" },
    { name: "Dallas Stars", abbr: "DAL", conference: "West", seed: 1, wins: 55, losses: 21, win_pct: 0.724, point_diff: 1.19, last_10: "8-2" },
    { name: "Colorado Avalanche", abbr: "COL", conference: "West", seed: 2, wins: 53, losses: 23, win_pct: 0.697, point_diff: 1.02, last_10: "7-3" },
    { name: "Vancouver Canucks", abbr: "VAN", conference: "West", seed: 3, wins: 50, losses: 26, win_pct: 0.658, point_diff: 0.82, last_10: "7-3" },
    { name: "Edmonton Oilers", abbr: "EDM", conference: "West", seed: 4, wins: 49, losses: 27, win_pct: 0.645, point_diff: 0.77, last_10: "6-4" },
    { name: "Winnipeg Jets", abbr: "WPG", conference: "West", seed: 5, wins: 47, losses: 29, win_pct: 0.618, point_diff: 0.61, last_10: "6-4" },
    { name: "Nashville Predators", abbr: "NSH", conference: "West", seed: 6, wins: 43, losses: 33, win_pct: 0.566, point_diff: 0.21, last_10: "5-5" },
  ],
};

function buildPayload(league, seed = SEED, options = {}) {
  const teams = LEAGUE_TEAMS[league];
  if (!teams) {
    throw new Error(`Unsupported league in paid canary payload builder: ${league}`);
  }

  return {
    as_of_date: "2026-04-03",
    league,
    mode: "custom_field",
    field: "top_6_only",
    inputs: {
      teams,
    },
    model_options: {
      seed,
      simulations: 10000,
      include_report: Boolean(options.includeReport),
      include_artifacts: options.includeArtifacts || []
    }
  };
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function decodeBase64Json(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function loadAwalIpc() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const candidate = path.join(process.env.APPDATA || "", "npm", "node_modules", "awal", "dist");

  if (!fs.existsSync(path.join(candidate, "ipcClient.js"))) {
    throw new Error("Unable to locate awal dist ipcClient.js");
  }

  const ipcModuleUrl = pathToFileURL(path.join(candidate, "ipcClient.js")).href;
  const authModuleUrl = pathToFileURL(path.join(candidate, "utils", "authCheck.js")).href;
  const { sendIpcRequest } = await import(ipcModuleUrl);
  const { requireAuth } = await import(authModuleUrl);
  return { requireAuth, sendIpcRequest };
}

function buildRequest(url, body) {
  const parsed = new URL(url);
  return {
    baseURL: `${parsed.protocol}//${parsed.host}`,
    path: `${parsed.pathname}${parsed.search}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
    },
    body,
    maxAmountPerRequest: MAX_AMOUNT_USD_MICROS,
  };
}

function assert(condition, message, failures) {
  if (!condition) {
    failures.push(message);
    console.log(`FAIL ${message}`);
    return;
  }
  console.log(`PASS ${message}`);
}

async function run() {
  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const canaries = [];
  for (const league of LEAGUES) {
    canaries.push(
      {
        name: `${league}-workflow-repeat-a`,
        league,
        url: `${BASE_URL}/api/workflows/sports/${league}/championship-forecast?seed=${SEED}`,
        body: buildPayload(league, SEED),
      },
      {
        name: `${league}-workflow-repeat-b`,
        league,
        url: `${BASE_URL}/api/workflows/sports/${league}/championship-forecast?seed=${SEED}`,
        body: buildPayload(league, SEED),
      },
      {
        name: `${league}-workflow-different-seed`,
        league,
        url: `${BASE_URL}/api/workflows/sports/${league}/championship-forecast?seed=${SEED + 1}`,
        body: buildPayload(league, SEED + 1),
      },
      {
        name: `${league}-workflow-report-xlsx`,
        league,
        url: `${BASE_URL}/api/workflows/sports/${league}/championship-forecast?seed=${SEED}`,
        body: buildPayload(league, SEED, { includeReport: true, includeArtifacts: ["xlsx"] }),
      },
    );
  }

  const failures = [];
  const results = [];

  for (const canary of canaries) {
    console.log(`[${canary.name}]`);
    const response = await sendIpcRequest("make-x402-request", buildRequest(canary.url, canary.body));
    const payload = typeof response?.data === "string" ? parseJsonSafe(response.data) || response.data : response?.data;
    const payment = decodeBase64Json(response?.headers?.["PAYMENT-RESPONSE"]);

    assert(response?.status >= 200 && response?.status < 300, `${canary.name} returned 2xx`, failures);
    assert(Boolean(payment?.success), `${canary.name} payment settled`, failures);

    results.push({ name: canary.name, payload, payment });

    if (canary.name.endsWith("workflow-report-xlsx")) {
      const expectedPath = `outputs/${canary.league}-championship-forecast-2026-04-03.xlsx`;
      assert(typeof payload?.prediction?.predicted_winner === "string", "workflow-report-xlsx returns prediction", failures);
      assert(Array.isArray(payload?.ranking) && payload.ranking.length > 0, "workflow-report-xlsx returns ranking", failures);
      assert(
        payload?.artifacts?.xlsx?.documentType === "xlsx",
        "workflow-report-xlsx returns xlsx artifact",
        failures,
      );
      assert(
        payload?.artifacts?.xlsx?.recommended_local_path === expectedPath,
        "workflow-report-xlsx returns expected recommended path",
        failures,
      );
    }

    console.log("");
  }

  for (const league of LEAGUES) {
    const repeatA = results.find((entry) => entry.name === `${league}-workflow-repeat-a`);
    const repeatB = results.find((entry) => entry.name === `${league}-workflow-repeat-b`);
    const different = results.find((entry) => entry.name === `${league}-workflow-different-seed`);

    assert(
      JSON.stringify(repeatA?.payload) === JSON.stringify(repeatB?.payload),
      `${league} same-seed workflow calls are identical`,
      failures,
    );
    assert(
      JSON.stringify(repeatA?.payload) !== JSON.stringify(different?.payload),
      `${league} different-seed workflow calls differ`,
      failures,
    );
  }

  if (failures.length > 0) {
    console.log(`Paid canary failed with ${failures.length} assertion(s).`);
    process.exit(1);
  }

  console.log("Paid canary passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
