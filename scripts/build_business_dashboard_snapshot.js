#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = "true";
    }
  }

  return args;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function splitLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\r/g, ""));
}

function extractSection(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^## ${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "m");
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
}

function extractBulletValue(sectionText, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(sectionText || "").match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : null;
}

function extractNumber(sectionText, label) {
  const value = extractBulletValue(sectionText, label);
  if (!value) {
    return 0;
  }

  const match = value.match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function extractNumberedListAfterLabel(sectionText, label) {
  const lines = splitLines(sectionText);
  const startIndex = lines.findIndex((line) => line.trim() === `${label}:`);
  if (startIndex === -1) {
    return [];
  }

  const items = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      if (items.length) {
        break;
      }
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      items.push(numbered[1].trim());
      continue;
    }

    if (items.length) {
      break;
    }
  }

  return items;
}

function extractBullets(sectionText) {
  return splitLines(sectionText)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function parseMarkdownTable(sectionText) {
  const lines = splitLines(sectionText).map((line) => line.trim());
  const tableLines = lines.filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 2) {
    return [];
  }

  const headerCells = tableLines[0]
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

  const rows = [];
  for (let index = 2; index < tableLines.length; index += 1) {
    const cells = tableLines[index]
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => !cell)) {
      continue;
    }

    const row = {};
    headerCells.forEach((header, headerIndex) => {
      row[header] = cells[headerIndex] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function buildSnapshot({ proofText, scoreboardText, pipelineText, outputDir }) {
  const proofVerdictSection = extractSection(proofText, "End-Of-Day Verdict");
  const processAuditSection = extractSection(proofText, "Process Fidelity Audit");
  const verifiedActionsSection = extractSection(proofText, "Verified External Actions Only");
  const revenueBoundarySection = extractSection(proofText, "Revenue Proof Boundary");
  const pipelineEvidenceSection = extractSection(proofText, "Pipeline Evidence");
  const packageStateSection = extractSection(proofText, "Remote Runner Package State");
  const remoteStateSection = extractSection(proofText, "Verified Remote Runner State");
  const nextProofSection = extractSection(proofText, "Next Proof To Collect");
  const scoreboardSnapshotSection = extractSection(scoreboardText, "Snapshot");
  const watchlistSection = extractSection(scoreboardText, "Channel Watchlist");
  const activeProspectsSection = extractSection(pipelineText, "Active Prospects");

  return {
    generatedAt: proofText.match(/^Generated:\s*(.+)$/m)?.[1] || null,
    publishedAt: new Date().toISOString(),
    mission: {
      targetNetUsd: 1000,
      deadline: "2026-03-31",
      leadWedge: extractBulletValue(pipelineEvidenceSection, "Lead wedge"),
      bundle: extractBulletValue(pipelineEvidenceSection, "Bundle / upsell"),
      status: extractBulletValue(scoreboardSnapshotSection, "Current strategic posture"),
    },
    process: {
      fidelity: extractBulletValue(proofVerdictSection, "Process fidelity"),
      failureTrigger: extractBulletValue(proofVerdictSection, "Process failure trigger"),
      dispatchedLaneCount: extractNumber(processAuditSection, "Non-Chief lanes dispatched today"),
      requiredLaneCount: extractNumber(processAuditSection, "Required minimum"),
      reason: extractBulletValue(proofVerdictSection, "Reason"),
    },
    evidence: {
      outreachSends: extractNumber(
        verifiedActionsSection,
        "Confirmed outreach sends/submissions today",
      ),
      blockedTargets: extractNumber(
        verifiedActionsSection,
        "Confirmed blocked outreach target today",
      ),
      replies: extractNumber(revenueBoundarySection, "Confirmed replies"),
      paidAttempts: extractNumber(revenueBoundarySection, "Confirmed paid attempts"),
      paidConversions: extractNumber(revenueBoundarySection, "Confirmed paid conversions"),
      bundleInterest: extractNumber(revenueBoundarySection, "Confirmed bundle interest"),
      externalProbes: extractNumber(
        revenueBoundarySection,
        "Confirmed non-self product probes",
      ),
      moltbookPublished: Boolean(
        extractBulletValue(verifiedActionsSection, "Confirmed Moltbook publish today"),
      ),
      latestMoltbookPostId:
        extractBulletValue(verifiedActionsSection, "Confirmed Moltbook publish today")?.match(
          /[0-9a-f]{8}-[0-9a-f-]{27}/i,
        )?.[0] || null,
    },
    pipeline: {
      activeProspects: extractNumber(
        pipelineEvidenceSection,
        "Active named prospects in pipeline",
      ),
      prospects: parseMarkdownTable(activeProspectsSection).map((row) => ({
        rank: Number(row.Rank || 0),
        target: row.Target || "",
        title: row.Title || "",
        firm: row.Firm || "",
        status: row.Status || "",
        bestAngle: row["Best Angle"] || "",
      })),
    },
    confirmedActions: extractNumberedListAfterLabel(
      verifiedActionsSection,
      "Confirmed outreach sends/submissions",
    ),
    blockedRoutes: extractNumberedListAfterLabel(verifiedActionsSection, "Blocked route"),
    nextProof: extractBullets(nextProofSection),
    channelWatchlist: parseMarkdownTable(watchlistSection).map((row) => ({
      channel: row.Channel || "",
      role: row.Role || "",
      status: row.Status || "",
      promoteWhen: row["Promote When"] || "",
    })),
    refreshPackage: {
      path: extractBulletValue(packageStateSection, "Refresh bundle path"),
      sha256: extractBulletValue(packageStateSection, "Refresh bundle SHA256"),
    },
    remoteRunner: {
      status: extractBulletValue(remoteStateSection, "Direct remote host inspection in this run")
        ? "checked"
        : "workspace-verified",
      detail:
        extractBulletValue(remoteStateSection, "Workspace-recorded remote state") ||
        "No remote runner detail published.",
    },
    rawFiles: {
      proofMarkdownPath: "ops-dashboard/proof-checkpoint-latest.md",
      operatorScoreboardPath: "ops-dashboard/operator-scoreboard.md",
      pipelinePath: "ops-dashboard/pipeline.md",
      outreachExecutionLogPath: "ops-dashboard/outreach-execution-log.md",
    },
    source: {
      outputDir,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args["repo-root"] || process.cwd());
  const sourceDir = path.resolve(
    args["source-dir"] || path.join(repoRoot, "..", "eom-revenue-business-os"),
  );
  const outputDir = path.resolve(args["output-dir"] || path.join(repoRoot, "ops-dashboard"));

  const sourceFiles = {
    proof: path.join(sourceDir, "ops", "proof-checkpoint-latest.md"),
    scoreboard: path.join(sourceDir, "ops", "operator-scoreboard.md"),
    pipeline: path.join(sourceDir, "revenue", "pipeline.md"),
    outreach: path.join(sourceDir, "revenue", "outreach", "outreach-execution-log.md"),
  };

  const proofText = await readFileIfExists(sourceFiles.proof);
  const scoreboardText = await readFileIfExists(sourceFiles.scoreboard);
  const pipelineText = await readFileIfExists(sourceFiles.pipeline);
  const outreachText = await readFileIfExists(sourceFiles.outreach);

  if (!proofText || !scoreboardText || !pipelineText) {
    throw new Error(
      "Missing required business OS files. Expected proof-checkpoint-latest.md, operator-scoreboard.md, and pipeline.md.",
    );
  }

  await ensureDir(outputDir);

  await Promise.all([
    fs.copyFile(sourceFiles.proof, path.join(outputDir, "proof-checkpoint-latest.md")),
    fs.copyFile(sourceFiles.scoreboard, path.join(outputDir, "operator-scoreboard.md")),
    fs.copyFile(sourceFiles.pipeline, path.join(outputDir, "pipeline.md")),
    outreachText
      ? fs.copyFile(sourceFiles.outreach, path.join(outputDir, "outreach-execution-log.md"))
      : Promise.resolve(),
  ]);

  const snapshot = buildSnapshot({
    proofText,
    scoreboardText,
    pipelineText,
    outputDir,
  });

  await fs.writeFile(
    path.join(outputDir, "business-dashboard.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `Built business dashboard snapshot at ${path.join(outputDir, "business-dashboard.json")}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
