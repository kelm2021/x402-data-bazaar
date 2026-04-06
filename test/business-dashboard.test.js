const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
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

async function createFixtureFiles() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "business-dashboard-"));
  const snapshotPath = path.join(tempRoot, "business-dashboard.json");
  const proofPath = path.join(tempRoot, "proof-checkpoint-latest.md");

  await fs.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        generatedAt: "2026-03-18T22:00:00.000Z",
        publishedAt: "2026-03-18T22:05:00.000Z",
        mission: {
          targetNetUsd: 1000,
          deadline: "2026-03-31",
          leadWedge: "restricted-party-screen",
          bundle: "vendor-entity-brief",
          status: "tighten the lead wedge and prove demand",
        },
        process: {
          fidelity: "pass",
          failureTrigger: "not hit",
          dispatchedLaneCount: 9,
          requiredLaneCount: 4,
          reason: "real external actions were recorded",
        },
        evidence: {
          outreachSends: 5,
          blockedTargets: 1,
          replies: 0,
          paidAttempts: 0,
          paidConversions: 0,
          bundleInterest: 0,
          externalProbes: 0,
          moltbookPublished: true,
          latestMoltbookPostId: "7e99dc14-e4c5-4203-b746-a8b3496dca7e",
        },
        pipeline: {
          activeProspects: 2,
          prospects: [
            {
              rank: 1,
              target: "Paul Valente",
              title: "Chief Customer Officer & Co-Founder",
              firm: "VISO TRUST",
              status: "sent 2026-03-18",
              bestAngle: "compliance and due diligence advisors",
            },
            {
              rank: 2,
              target: "Ajay Trehan",
              title: "Founder & Chief Executive Officer",
              firm: "AuthBridge",
              status: "sent 2026-03-18",
              bestAngle: "procurement and vendor onboarding",
            },
          ],
        },
        confirmedActions: [
          "VISO TRUST public email sent to info@visotrust.com",
          "OneCredential public contact form submitted successfully",
        ],
        blockedRoutes: [
          "Valua Partners public email and public form both failed",
        ],
        nextProof: ["first real reply from outreach", "first paid attempt"],
        channelWatchlist: [
          {
            channel: "x402",
            role: "near-term payment rail",
            status: "active",
            promoteWhen: "it is the simplest believable paid path",
          },
        ],
        refreshPackage: {
          path: "ops-dashboard/runner-refresh.zip",
          sha256: "abc123",
        },
        remoteRunner: {
          status: "workspace-verified",
          detail: "fresh unattended loop start was verified",
        },
        rawFiles: {
          proofMarkdownPath: "ops-dashboard/proof-checkpoint-latest.md",
          operatorScoreboardPath: "ops-dashboard/operator-scoreboard.md",
          pipelinePath: "ops-dashboard/pipeline.md",
          outreachExecutionLogPath: "ops-dashboard/outreach-execution-log.md",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    proofPath,
    "# Proof Checkpoint\n\n- Process fidelity: pass\n- Confirmed outreach sends/submissions today: 5\n",
    "utf8",
  );

  return {
    tempRoot,
    snapshotPath,
    proofPath,
  };
}

function authHeader(password) {
  return `Basic ${Buffer.from(`metrics:${password}`).toString("base64")}`;
}

test("business dashboard endpoints require auth when configured", async () => {
  const fixture = await createFixtureFiles();
  const app = createApp({
    enableDebugRoutes: false,
    enableOpsDashboards: true,
    businessDashboardPassword: "secret",
    businessDashboardSnapshotPath: fixture.snapshotPath,
    businessDashboardProofPath: fixture.proofPath,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const htmlResponse = await fetch(`${baseUrl}/ops/business`);
    const dataResponse = await fetch(`${baseUrl}/ops/business/data`);

    assert.equal(htmlResponse.status, 401);
    assert.equal(dataResponse.status, 401);
    assert.match(htmlResponse.headers.get("www-authenticate") || "", /Business Dashboard/);
  });

  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
});

test("business dashboard routes are disabled by default", async () => {
  const fixture = await createFixtureFiles();
  const app = createApp({
    enableDebugRoutes: false,
    businessDashboardPassword: "secret",
    businessDashboardSnapshotPath: fixture.snapshotPath,
    businessDashboardProofPath: fixture.proofPath,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const htmlResponse = await fetch(`${baseUrl}/ops/business`);
    const dataResponse = await fetch(`${baseUrl}/ops/business/data`);
    const proofResponse = await fetch(`${baseUrl}/ops/business/proof`);

    assert.equal(htmlResponse.status, 404);
    assert.equal(dataResponse.status, 404);
    assert.equal(proofResponse.status, 404);
  });

  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
});

test("business dashboard renders published proof snapshot", async () => {
  const fixture = await createFixtureFiles();
  const app = createApp({
    enableDebugRoutes: false,
    enableOpsDashboards: true,
    businessDashboardPassword: "secret",
    businessDashboardSnapshotPath: fixture.snapshotPath,
    businessDashboardProofPath: fixture.proofPath,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ops/business`, {
      headers: {
        authorization: authHeader("secret"),
      },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Business Proof Dashboard/);
    assert.match(html, /restricted-party-screen/);
    assert.match(html, /VISO TRUST public email sent to info@visotrust\.com/);
    assert.match(html, /first real reply from outreach/);
    assert.match(html, /workspace-verified/);
  });

  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
});

test("business dashboard data and proof routes return published artifacts", async () => {
  const fixture = await createFixtureFiles();
  const app = createApp({
    enableDebugRoutes: false,
    enableOpsDashboards: true,
    businessDashboardPassword: "secret",
    businessDashboardSnapshotPath: fixture.snapshotPath,
    businessDashboardProofPath: fixture.proofPath,
    paymentGate: (req, res, next) => next(),
  });

  await withServer(app, async (baseUrl) => {
    const dataResponse = await fetch(`${baseUrl}/ops/business/data`, {
      headers: {
        authorization: authHeader("secret"),
      },
    });
    const summary = await dataResponse.json();

    assert.equal(dataResponse.status, 200);
    assert.equal(summary.evidence.outreachSends, 5);
    assert.equal(summary.pipeline.activeProspects, 2);
    assert.equal(summary.refreshPackage.sha256, "abc123");

    const proofResponse = await fetch(`${baseUrl}/ops/business/proof`, {
      headers: {
        authorization: authHeader("secret"),
      },
    });
    const proofText = await proofResponse.text();

    assert.equal(proofResponse.status, 200);
    assert.match(proofText, /Process fidelity: pass/);
  });

  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
});
