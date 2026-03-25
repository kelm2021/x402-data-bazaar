const fs = require("node:fs/promises");
const path = require("node:path");

const DASHBOARD_USERNAME = "metrics";

function normalizeSecret(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatInteger(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(number);
}

function getBasicAuthCredentials(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch (error) {
    return null;
  }
}

function hasDashboardAccess(req, password) {
  const expectedPassword = normalizeSecret(password);
  if (!expectedPassword) {
    return true;
  }

  const credentials = getBasicAuthCredentials(req);
  return (
    credentials?.username === DASHBOARD_USERNAME &&
    normalizeSecret(credentials?.password) === expectedPassword
  );
}

function sendDashboardAuthChallenge(res) {
  res.set("WWW-Authenticate", 'Basic realm="Business Dashboard"');
  res.status(401).send("Authentication required");
}

function defaultSnapshotPath() {
  return path.join(__dirname, "ops-dashboard", "business-dashboard.json");
}

function defaultProofPath() {
  return path.join(__dirname, "ops-dashboard", "proof-checkpoint-latest.md");
}

function createEmptySnapshot() {
  return {
    generatedAt: null,
    publishedAt: null,
    mission: {
      targetNetUsd: 1000,
      deadline: "2026-03-31",
      leadWedge: null,
      bundle: null,
      status: "No published business snapshot yet.",
    },
    process: {
      fidelity: "pending",
      failureTrigger: "unknown",
      dispatchedLaneCount: 0,
      requiredLaneCount: 4,
      reason: "The proof publisher has not pushed a snapshot into the repo yet.",
    },
    evidence: {
      outreachSends: 0,
      blockedTargets: 0,
      replies: 0,
      paidAttempts: 0,
      paidConversions: 0,
      bundleInterest: 0,
      externalProbes: 0,
      moltbookPublished: false,
      latestMoltbookPostId: null,
    },
    pipeline: {
      activeProspects: 0,
      prospects: [],
    },
    confirmedActions: [],
    blockedRoutes: [],
    nextProof: [],
    channelWatchlist: [],
    refreshPackage: null,
    remoteRunner: null,
    rawFiles: {
      proofMarkdownPath: "ops-dashboard/proof-checkpoint-latest.md",
      operatorScoreboardPath: "ops-dashboard/operator-scoreboard.md",
      pipelinePath: "ops-dashboard/pipeline.md",
      outreachExecutionLogPath: "ops-dashboard/outreach-execution-log.md",
    },
  };
}

async function loadBusinessDashboardSnapshot(options = {}) {
  const snapshotPath = options.snapshotPath ?? defaultSnapshotPath();

  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...createEmptySnapshot(),
      ...parsed,
      mission: {
        ...createEmptySnapshot().mission,
        ...(parsed.mission ?? {}),
      },
      process: {
        ...createEmptySnapshot().process,
        ...(parsed.process ?? {}),
      },
      evidence: {
        ...createEmptySnapshot().evidence,
        ...(parsed.evidence ?? {}),
      },
      pipeline: {
        ...createEmptySnapshot().pipeline,
        ...(parsed.pipeline ?? {}),
      },
      rawFiles: {
        ...createEmptySnapshot().rawFiles,
        ...(parsed.rawFiles ?? {}),
      },
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptySnapshot();
    }

    return {
      ...createEmptySnapshot(),
      mission: {
        ...createEmptySnapshot().mission,
        status: "Published snapshot is unreadable.",
      },
      process: {
        ...createEmptySnapshot().process,
        fidelity: "error",
        reason: error.message,
      },
    };
  }
}

async function loadOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function renderSummaryCard(title, value, detail, className = "") {
  return `
    <article class="metric-card ${className}">
      <h3>${escapeHtml(title)}</h3>
      <div class="metric-value">${escapeHtml(value)}</div>
      <p class="metric-detail">${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderSimpleList(items = []) {
  if (!items.length) {
    return '<p class="empty-state">No items recorded in the current snapshot.</p>';
  }

  return `
    <ul class="plain-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderProspectsTable(prospects = []) {
  if (!prospects.length) {
    return '<p class="empty-state">No active prospects are present in the published snapshot.</p>';
  }

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Target</th>
            <th scope="col">Firm</th>
            <th scope="col">Stage</th>
            <th scope="col">Next angle</th>
          </tr>
        </thead>
        <tbody>
          ${prospects
            .map(
              (prospect) => `
                <tr>
                  <td>${escapeHtml(formatInteger(prospect.rank ?? ""))}</td>
                  <td>
                    <div class="route-key">${escapeHtml(prospect.target || "Unknown")}</div>
                    <div class="route-detail">${escapeHtml(prospect.title || "No title recorded")}</div>
                  </td>
                  <td>${escapeHtml(prospect.firm || "Unknown")}</td>
                  <td>${escapeHtml(prospect.status || "Unknown")}</td>
                  <td>${escapeHtml(prospect.bestAngle || "Unknown")}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderWatchlistTable(items = []) {
  if (!items.length) {
    return '<p class="empty-state">No channel watchlist was published with this snapshot.</p>';
  }

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Channel</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Promote when</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.channel || "Unknown")}</td>
                  <td>${escapeHtml(item.role || "Unknown")}</td>
                  <td>${escapeHtml(item.status || "Unknown")}</td>
                  <td>${escapeHtml(item.promoteWhen || "Unknown")}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBusinessDashboardPage(snapshot, options = {}) {
  const cards = [
    renderSummaryCard(
      "Process fidelity",
      String(snapshot.process.fidelity || "pending").toUpperCase(),
      snapshot.process.reason || "No reason recorded.",
      snapshot.process.fidelity === "pass" ? "metric-card-positive" : "metric-card-warm",
    ),
    renderSummaryCard(
      "Outreach sends today",
      formatInteger(snapshot.evidence.outreachSends),
      `${formatInteger(snapshot.evidence.blockedTargets)} blocked routes recorded`,
    ),
    renderSummaryCard(
      "Replies",
      formatInteger(snapshot.evidence.replies),
      `${formatInteger(snapshot.evidence.externalProbes)} non-self probes recorded`,
    ),
    renderSummaryCard(
      "Paid attempts",
      formatInteger(snapshot.evidence.paidAttempts),
      `${formatInteger(snapshot.evidence.paidConversions)} paid conversions recorded`,
    ),
    renderSummaryCard(
      "Active prospects",
      formatInteger(snapshot.pipeline.activeProspects),
      `${snapshot.mission.leadWedge || "No lead wedge"} is the current lead wedge`,
    ),
    renderSummaryCard(
      "Published snapshot",
      formatTimestamp(snapshot.publishedAt || snapshot.generatedAt),
      options.passwordProtected
        ? "Protected with HTTP Basic auth."
        : "Public access is enabled.",
    ),
  ].join("");

  const proofLinks = [
    { label: "Proof markdown", href: "/ops/business/proof" },
    { label: "JSON data", href: "/ops/business/data" },
  ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Business Proof Dashboard</title>
    <style>
      :root {
        --bg: #f5f0e8;
        --bg-accent: #fffaf2;
        --card: rgba(255, 251, 245, 0.9);
        --ink: #1b1e1f;
        --muted: #566164;
        --line: rgba(27, 30, 31, 0.12);
        --brand: #0f766e;
        --shadow: 0 20px 45px rgba(36, 38, 38, 0.1);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Trebuchet MS", "Gill Sans", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 34%),
          radial-gradient(circle at top right, rgba(154, 52, 18, 0.12), transparent 28%),
          linear-gradient(180deg, var(--bg-accent), var(--bg));
      }
      a { color: inherit; }
      .page-shell { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 3rem; }
      header, section { padding: 1.4rem; border: 1px solid var(--line); border-radius: 28px; background: var(--card); box-shadow: var(--shadow); }
      header { margin-bottom: 1rem; }
      .eyebrow { margin: 0 0 0.75rem; font-size: 0.9rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brand); }
      h1, h2, h3, p { margin-top: 0; }
      h1 { margin-bottom: 0.5rem; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.05; }
      .lede { max-width: 66ch; color: var(--muted); margin-bottom: 1rem; }
      main { display: grid; gap: 1rem; }
      .hero-chips, .link-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
      .hero-chip, .dashboard-link { margin: 0; padding: 0.65rem 0.9rem; border-radius: 999px; border: 1px solid rgba(15, 118, 110, 0.2); background: rgba(255, 255, 255, 0.72); }
      .dashboard-link { text-decoration: none; font-weight: 700; }
      .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.9rem; }
      .metric-card { padding: 1rem; border-radius: 18px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.55); }
      .metric-card-positive { background: linear-gradient(180deg, rgba(32, 132, 75, 0.14), rgba(255, 255, 255, 0.72)); }
      .metric-card-warm { background: linear-gradient(180deg, rgba(154, 52, 18, 0.14), rgba(255, 255, 255, 0.72)); }
      .metric-card h3 { font-size: 0.95rem; color: var(--muted); margin-bottom: 0.8rem; }
      .metric-value { font-size: 2rem; font-weight: 700; margin-bottom: 0.3rem; }
      .metric-detail { color: var(--muted); margin-bottom: 0; }
      .section-header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
      .section-header p { margin-bottom: 0; color: var(--muted); }
      .section-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 1rem; }
      .notice { padding: 1rem; border-radius: 18px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.55); }
      .table-scroll { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 0.8rem 0.65rem; border-bottom: 1px solid var(--line); vertical-align: top; }
      th { font-size: 0.95rem; }
      .route-key { font-weight: 700; }
      .route-detail { margin-top: 0.35rem; color: var(--muted); font-weight: 400; max-width: 44ch; }
      .plain-list { padding-left: 1.2rem; margin-bottom: 0; }
      .plain-list li + li { margin-top: 0.45rem; }
      .empty-state { margin-bottom: 0; color: var(--muted); }
      .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.9rem; }
      .info-label { color: var(--muted); font-size: 0.95rem; }
      .info-value { margin-top: 0.3rem; font-weight: 700; }
      @media (max-width: 900px) { .section-grid { grid-template-columns: 1fr; } }
      @media (max-width: 720px) {
        .page-shell { width: min(100% - 1rem, 1180px); padding-top: 1rem; }
        header, section { border-radius: 20px; padding: 1rem; }
        th, td { padding-inline: 0.45rem; }
      }
    </style>
  </head>
  <body>
    <div class="page-shell">
      <header>
        <p class="eyebrow">Revenue Business OS</p>
        <h1>Business Proof Dashboard</h1>
        <p class="lede">This page is driven by the remote Proof lane. It shows only the evidence that was pushed from the remote runner into the Vercel-linked repo, so you can inspect demand proof, pipeline motion, and runner state without logging into the box.</p>
        <div class="hero-chips">
          <p class="hero-chip"><strong>Target:</strong> $${escapeHtml(formatInteger(snapshot.mission.targetNetUsd))} net by ${escapeHtml(snapshot.mission.deadline || "Unknown")}</p>
          <p class="hero-chip"><strong>Lead wedge:</strong> ${escapeHtml(snapshot.mission.leadWedge || "Unknown")}</p>
          <p class="hero-chip"><strong>Bundle:</strong> ${escapeHtml(snapshot.mission.bundle || "Unknown")}</p>
        </div>
      </header>
      <main>
        <section>
          <div class="section-header">
            <div>
              <h2>Snapshot</h2>
              <p>Published ${escapeHtml(formatTimestamp(snapshot.publishedAt || snapshot.generatedAt))}. Generated from the remote business OS proof artifacts.</p>
            </div>
            <div class="link-row">
              ${proofLinks.map((link) => `<a class="dashboard-link" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}
            </div>
          </div>
          <div class="metric-grid">${cards}</div>
        </section>
        <div class="section-grid">
          <section>
            <div class="section-header"><div><h2>Confirmed Actions</h2><p>Only externally visible actions and logged blockers belong here.</p></div></div>
            ${renderSimpleList(snapshot.confirmedActions)}
          </section>
          <section>
            <div class="section-header"><div><h2>Next Proof</h2><p>The next evidence that would move the business forward.</p></div></div>
            ${renderSimpleList(snapshot.nextProof)}
          </section>
        </div>
        <section>
          <div class="section-header">
            <div>
              <h2>Pipeline</h2>
              <p>${escapeHtml(formatInteger(snapshot.pipeline.activeProspects))} active prospects are in the published pipeline.</p>
            </div>
          </div>
          ${renderProspectsTable(snapshot.pipeline.prospects || [])}
        </section>
        <div class="section-grid">
          <section>
            <div class="section-header"><div><h2>Channel Watchlist</h2><p>Current primary and watchlisted rails from the business OS.</p></div></div>
            ${renderWatchlistTable(snapshot.channelWatchlist || [])}
          </section>
          <section>
            <div class="section-header"><div><h2>Runner State</h2><p>What the remote proof lane last published about the unattended runner.</p></div></div>
            <div class="info-grid">
              <article class="notice"><div class="info-label">Refresh bundle</div><div class="info-value">${escapeHtml(snapshot.refreshPackage?.sha256 || "Unknown")}</div><p class="metric-detail">${escapeHtml(snapshot.refreshPackage?.path || "No refresh bundle path published.")}</p></article>
              <article class="notice"><div class="info-label">Runner status</div><div class="info-value">${escapeHtml(snapshot.remoteRunner?.status || "Unknown")}</div><p class="metric-detail">${escapeHtml(snapshot.remoteRunner?.detail || "No remote runner detail published.")}</p></article>
              <article class="notice"><div class="info-label">Moltbook publish</div><div class="info-value">${snapshot.evidence.moltbookPublished ? "Published" : "Not published"}</div><p class="metric-detail">${escapeHtml(snapshot.evidence.latestMoltbookPostId || "No Moltbook post id recorded.")}</p></article>
              <article class="notice"><div class="info-label">Proof paths</div><div class="info-value">${escapeHtml(snapshot.rawFiles.proofMarkdownPath)}</div><p class="metric-detail">${escapeHtml(snapshot.rawFiles.operatorScoreboardPath)}</p></article>
            </div>
            ${snapshot.blockedRoutes?.length ? `<div class="notice" style="margin-top:1rem"><h3>Blocked routes</h3>${renderSimpleList(snapshot.blockedRoutes)}</div>` : ""}
          </section>
        </div>
      </main>
    </div>
  </body>
</html>`;
}

function createBusinessDataHandler(options = {}) {
  return async function businessDataHandler(req, res) {
    if (!hasDashboardAccess(req, options.password)) {
      sendDashboardAuthChallenge(res);
      return;
    }

    const snapshot = await loadBusinessDashboardSnapshot(options);
    res.set("Cache-Control", "no-store");
    res.json(snapshot);
  };
}

function createBusinessProofHandler(options = {}) {
  return async function businessProofHandler(req, res) {
    if (!hasDashboardAccess(req, options.password)) {
      sendDashboardAuthChallenge(res);
      return;
    }

    const proofPath = options.proofPath ?? defaultProofPath();
    const proofText = await loadOptionalText(proofPath);
    res.set("Cache-Control", "no-store");
    res.type("text/markdown").send(proofText ?? "# Proof Checkpoint\n\nNo published proof file yet.\n");
  };
}

function createBusinessDashboardHandler(options = {}) {
  return async function businessDashboardHandler(req, res) {
    if (!hasDashboardAccess(req, options.password)) {
      sendDashboardAuthChallenge(res);
      return;
    }

    const snapshot = await loadBusinessDashboardSnapshot(options);
    res.set("Cache-Control", "no-store");
    res.type("html").send(
      renderBusinessDashboardPage(snapshot, {
        passwordProtected: Boolean(options.password),
      }),
    );
  };
}

module.exports = {
  createBusinessDashboardHandler,
  createBusinessDataHandler,
  createBusinessProofHandler,
  loadBusinessDashboardSnapshot,
};
