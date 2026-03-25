#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_HOST = "x402-data-bazaar.vercel.app";
const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_CYCLE1_MINUTES = 60;
const DEFAULT_CYCLE2_MINUTES = 120;
const DEFAULT_PACKET_PARENT = path.join("docs", "support-escalation");
const DEFAULT_PACKET_NAME_SUFFIX = "discovery-followup";
const AUTOMATION_HTTP_SCRIPT = path.join("scripts", "automation_http.cjs");
const REPORT_FILE = "automation-run-report.json";
const DEFAULT_SUBMIT_MODE = "email";
const INDEX402_DEFAULT_TO = "hello@402index.io";

function log(message) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${message}\n`);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const args = {
    host: DEFAULT_HOST,
    searchLimit: DEFAULT_SEARCH_LIMIT,
    cycle1Minutes: DEFAULT_CYCLE1_MINUTES,
    cycle2Minutes: DEFAULT_CYCLE2_MINUTES,
    supportDir: null,
    liveSubmit: false,
    submitMode: DEFAULT_SUBMIT_MODE,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--host" && next) {
      args.host = next;
      i += 1;
      continue;
    }

    if (token === "--search-limit" && next) {
      args.searchLimit = parseInteger(next, DEFAULT_SEARCH_LIMIT);
      i += 1;
      continue;
    }

    if (token === "--cycle1-minutes" && next) {
      args.cycle1Minutes = parseInteger(next, DEFAULT_CYCLE1_MINUTES);
      i += 1;
      continue;
    }

    if (token === "--cycle2-minutes" && next) {
      args.cycle2Minutes = parseInteger(next, DEFAULT_CYCLE2_MINUTES);
      i += 1;
      continue;
    }

    if (token === "--support-dir" && next) {
      args.supportDir = next;
      i += 1;
      continue;
    }

    if (token === "--live-submit") {
      args.liveSubmit = true;
      continue;
    }

    if (token === "--submit-mode" && next) {
      args.submitMode = String(next).trim().toLowerCase();
      i += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      printUsageAndExit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.cycle1Minutes < 0 || args.cycle2Minutes < 0) {
    throw new Error("Cycle minutes must be >= 0.");
  }

  if (args.cycle2Minutes < args.cycle1Minutes) {
    throw new Error("cycle2 must be >= cycle1.");
  }

  if (!["email", "webhook", "auto"].includes(args.submitMode)) {
    throw new Error("submit-mode must be one of: email, webhook, auto");
  }

  return args;
}

function printUsageAndExit(exitCode) {
  process.stdout.write(
    [
      "Usage: node scripts/discovery_escalation_automation.cjs [options]",
      "",
      "Options:",
      "  --host <domain>              Host needle for discovery and 402index search",
      "  --search-limit <n>           402index host search limit (default: 100)",
      "  --cycle1-minutes <n>         Delay before cycle 1 (default: 60)",
      "  --cycle2-minutes <n>         Delay before cycle 2 (default: 120)",
      "  --support-dir <path>         Packet folder; defaults to latest support-escalation packet",
      "  --live-submit                Submit drafts to webhook endpoints when unchanged",
      "  --submit-mode <mode>         email|webhook|auto (default: email)",
      "  --help                       Show this usage",
      "",
      "Submission env vars for email mode (required for --live-submit + email):",
      "  RESEND_API_KEY",
      "  SUPPORT_EMAIL_FROM",
      "  CDP_SUPPORT_EMAIL_TO",
      "  INDEX402_SUPPORT_EMAIL_TO (optional; default hello@402index.io)",
      "",
      "Submission env vars for webhook mode (required for --live-submit + webhook):",
      "  CDP_TICKET_WEBHOOK_URL",
      "  CDP_TICKET_WEBHOOK_BEARER_TOKEN (optional)",
      "  INDEX402_TICKET_WEBHOOK_URL",
      "  INDEX402_TICKET_WEBHOOK_BEARER_TOKEN (optional)",
      "",
      "Examples:",
      "  node scripts/discovery_escalation_automation.cjs",
      "  node scripts/discovery_escalation_automation.cjs --cycle1-minutes 1 --cycle2-minutes 2",
      "  node scripts/discovery_escalation_automation.cjs --live-submit --submit-mode email",
      "",
    ].join("\n"),
  );
  process.exit(exitCode);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolvePacketDir(repoRoot, explicitPath) {
  if (explicitPath) {
    return path.resolve(repoRoot, explicitPath);
  }

  const parent = path.join(repoRoot, DEFAULT_PACKET_PARENT);
  if (!fs.existsSync(parent)) {
    throw new Error(`Support escalation directory not found: ${parent}`);
  }

  const subdirs = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(DEFAULT_PACKET_NAME_SUFFIX))
    .map((entry) => path.join(parent, entry.name))
    .sort((a, b) => b.localeCompare(a));

  if (!subdirs.length) {
    throw new Error(`No support packet directories found under: ${parent}`);
  }

  return subdirs[0];
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(String(value));
    const origin = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${origin}${pathname}${url.search}`;
  } catch (error) {
    return null;
  }
}

function uniqueSorted(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

async function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(targetTs, label) {
  const now = Date.now();
  if (targetTs <= now) {
    log(`${label}: scheduled time already passed, running now.`);
    return;
  }

  const remainingMs = targetTs - now;
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  log(`${label}: waiting ${remainingMinutes} minute(s) until ${new Date(targetTs).toISOString()}.`);
  await sleep(remainingMs);
}

function parseJsonFromStdout(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    throw new Error("Command produced empty stdout.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Unable to parse JSON from command stdout.");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

async function runNodeScript(repoRoot, scriptRelPath, scriptArgs) {
  const scriptPath = path.join(repoRoot, scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            `Command failed (${scriptRelPath} ${scriptArgs.join(" ")}), exit ${exitCode}. stderr: ${stderr.trim()}`,
          ),
        );
        return;
      }

      try {
        const parsed = parseJsonFromStdout(stdout);
        resolve({
          exitCode,
          stdout,
          stderr,
          parsed,
        });
      } catch (parseError) {
        reject(
          new Error(
            `Failed to parse JSON from ${scriptRelPath} ${scriptArgs.join(" ")}: ${parseError.message}`,
          ),
        );
      }
    });
  });
}

async function getFetch() {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  const mod = await import("node-fetch");
  return mod.default;
}

async function fetch402IndexServicesRaw(host, limit) {
  const fetchFn = await getFetch();
  const url = `https://402index.io/api/v1/services?q=${encodeURIComponent(host)}&limit=${encodeURIComponent(String(limit))}`;
  const response = await fetchFn(url);
  const rawText = await response.text();
  let body = null;
  try {
    body = JSON.parse(rawText);
  } catch (error) {
    body = { parseError: true, rawText };
  }

  if (!response.ok) {
    throw new Error(`402index host search failed (${response.status}): ${rawText.slice(0, 600)}`);
  }

  return {
    url,
    status: response.status,
    body,
  };
}

function loadBaseline(packetDir) {
  const snapshotPath = path.join(packetDir, "cdp-and-402index-snapshots.json");
  const snapshot = readJson(snapshotPath);

  const staleFromHistorical = Array.isArray(snapshot.cdpHistoricalStaleEntries)
    ? snapshot.cdpHistoricalStaleEntries.map((entry) => normalizeUrl(entry.resource))
    : [];
  const staleFromHostSearch = Array.isArray(snapshot.hostSearchResults?.services)
    ? snapshot.hostSearchResults.services.map((entry) => normalizeUrl(entry.url))
    : [];

  const expectedStaleUrls = uniqueSorted([...staleFromHistorical, ...staleFromHostSearch]);
  const discoveryBaselineCount = Number.isFinite(snapshot.cdpCurrentHostMatchCount)
    ? snapshot.cdpCurrentHostMatchCount
    : null;

  return {
    snapshotPath,
    discoveryBaselineCount,
    expectedStaleUrls,
  };
}

function evaluateCycle({ discovery, indexRaw }, baseline) {
  const discoveryCount = Number.isFinite(discovery?.count) ? discovery.count : null;
  const services = Array.isArray(indexRaw?.body?.services) ? indexRaw.body.services : [];
  const currentUrls = uniqueSorted(services.map((entry) => normalizeUrl(entry.url)));
  const expectedUrls = baseline.expectedStaleUrls;

  const sameRoutes = setsEqual(currentUrls, expectedUrls);
  const metadataMissingForExpected = expectedUrls.every((url) => {
    const service = services.find((entry) => normalizeUrl(entry.url) === url);
    if (!service) {
      return false;
    }
    const category = String(service.category ?? "").trim().toLowerCase();
    return service.price_usd == null && category === "uncategorized";
  });

  return {
    discoveryCount,
    discoveryNotImproved:
      baseline.discoveryBaselineCount == null
        ? null
        : Number.isFinite(discoveryCount) && discoveryCount <= baseline.discoveryBaselineCount,
    expectedStaleCount: expectedUrls.length,
    currentHostResultCount: currentUrls.length,
    sameStaleRouteSet: sameRoutes,
    expectedStaleUrls: expectedUrls,
    currentHostUrls: currentUrls,
    expectedRoutesStillMissingMetadata: metadataMissingForExpected,
  };
}

function extractSubject(markdownText) {
  const lines = String(markdownText || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase() === "## subject") {
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j].trim();
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.replace(/^#\s+/, "").trim();
    }
  }

  return "Support Ticket";
}

async function submitDraft({
  submitMode,
  webhookUrl,
  bearerToken,
  resendApiKey,
  fromEmail,
  toEmail,
  draftPath,
  packetDir,
  triggerDecision,
  name,
}) {
  const markdown = fs.readFileSync(draftPath, "utf8");
  const subject = extractSubject(markdown);
  const fetchFn = await getFetch();
  const mode = submitMode || "email";

  if (mode === "webhook") {
    if (!webhookUrl) {
      return {
        name,
        ok: false,
        skipped: true,
        reason: "Missing webhook URL",
      };
    }

    const payload = {
      source: "x402-data-bazaar/discovery-escalation-automation",
      submittedAt: new Date().toISOString(),
      subject,
      bodyMarkdown: markdown,
      packetDir: path.relative(process.cwd(), packetDir),
      triggerDecision,
    };

    const headers = {
      "content-type": "application/json",
    };
    if (bearerToken) {
      headers.authorization = `Bearer ${bearerToken}`;
    }

    const response = await fetchFn(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();

    return {
      name,
      channel: "webhook",
      ok: response.ok,
      status: response.status,
      webhookUrl,
      responseSnippet: String(responseText || "").slice(0, 1000),
    };
  }

  if (!resendApiKey) {
    return {
      name,
      channel: "email",
      ok: false,
      skipped: true,
      reason: "Missing RESEND_API_KEY",
    };
  }
  if (!fromEmail) {
    return {
      name,
      channel: "email",
      ok: false,
      skipped: true,
      reason: "Missing SUPPORT_EMAIL_FROM",
    };
  }
  if (!toEmail) {
    return {
      name,
      channel: "email",
      ok: false,
      skipped: true,
      reason: "Missing destination support email",
    };
  }

  const decisionSummary = JSON.stringify(triggerDecision, null, 2);
  const bodyText = [
    "Automated escalation from x402-data-bazaar/discovery-escalation-automation.",
    "",
    `Packet directory: ${path.relative(process.cwd(), packetDir)}`,
    `Submitted at: ${new Date().toISOString()}`,
    "",
    "Trigger decision:",
    decisionSummary,
    "",
    "---",
    "",
    markdown,
  ].join("\n");

  const emailPayload = {
    from: fromEmail,
    to: [toEmail],
    subject: `[AUTO] ${subject}`,
    text: bodyText,
  };

  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify(emailPayload),
  });
  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = JSON.parse(responseText);
  } catch (error) {
    responseJson = null;
  }

  return {
    name,
    channel: "email",
    ok: response.ok,
    status: response.status,
    toEmail,
    resendId: responseJson?.id ?? null,
    responseSnippet: String(responseText || "").slice(0, 1000),
  };
}

async function runCycle({
  cycleNumber,
  scheduledAtMs,
  label,
  repoRoot,
  packetDir,
  host,
  searchLimit,
  baseline,
}) {
  await waitUntil(scheduledAtMs, label);
  const ranAt = new Date().toISOString();
  log(`${label}: running checks.`);

  const discoveryResult = await runNodeScript(repoRoot, AUTOMATION_HTTP_SCRIPT, [
    "discovery",
    host,
  ]);
  const indexRawResult = await fetch402IndexServicesRaw(host, searchLimit);

  const discoveryPath = path.join(packetDir, `recheck-cycle${cycleNumber}-discovery.json`);
  const indexPath = path.join(packetDir, `recheck-cycle${cycleNumber}-402index-raw.json`);
  writeJson(discoveryPath, discoveryResult.parsed);
  writeJson(indexPath, indexRawResult);

  const evaluation = evaluateCycle(
    {
      discovery: discoveryResult.parsed,
      indexRaw: indexRawResult,
    },
    baseline,
  );

  return {
    cycle: cycleNumber,
    label,
    scheduledAt: new Date(scheduledAtMs).toISOString(),
    ranAt,
    discoveryPath: path.relative(repoRoot, discoveryPath),
    indexPath: path.relative(repoRoot, indexPath),
    discovery: discoveryResult.parsed,
    indexRaw: indexRawResult,
    evaluation,
  };
}

function buildDecision(cycle1, cycle2) {
  const cycle1Ready =
    cycle1.evaluation.discoveryNotImproved === true &&
    cycle1.evaluation.sameStaleRouteSet === true &&
    cycle1.evaluation.expectedRoutesStillMissingMetadata === true;
  const cycle2Ready =
    cycle2.evaluation.discoveryNotImproved === true &&
    cycle2.evaluation.sameStaleRouteSet === true &&
    cycle2.evaluation.expectedRoutesStillMissingMetadata === true;

  return {
    unchanged: cycle1Ready && cycle2Ready,
    cycle1Ready,
    cycle2Ready,
    criteria: {
      discoveryNotImproved: cycle2.evaluation.discoveryNotImproved,
      sameStaleRouteSet: cycle2.evaluation.sameStaleRouteSet,
      expectedRoutesStillMissingMetadata: cycle2.evaluation.expectedRoutesStillMissingMetadata,
    },
  };
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const packetDir = resolvePacketDir(repoRoot, args.supportDir);
  const baseline = loadBaseline(packetDir);

  const cdpDraftPath = path.join(packetDir, "cdp-bazaar-ticket.md");
  const indexDraftPath = path.join(packetDir, "402index-manual-import-request.md");
  if (!fs.existsSync(cdpDraftPath) || !fs.existsSync(indexDraftPath)) {
    throw new Error(
      `Expected ticket drafts not found in packet directory: ${packetDir}`,
    );
  }

  const startedAt = new Date().toISOString();
  log(`Support packet: ${packetDir}`);
  log(`Cycle schedule: +${args.cycle1Minutes}m and +${args.cycle2Minutes}m`);
  log(`Submission mode: ${args.liveSubmit ? "LIVE" : "DRY-RUN"}`);
  log(`Submit channel: ${args.submitMode}`);

  const startMs = Date.now();
  const cycle1 = await runCycle({
    cycleNumber: 1,
    scheduledAtMs: startMs + args.cycle1Minutes * 60 * 1000,
    label: "Cycle 1",
    repoRoot,
    packetDir,
    host: args.host,
    searchLimit: args.searchLimit,
    baseline,
  });

  const cycle2 = await runCycle({
    cycleNumber: 2,
    scheduledAtMs: startMs + args.cycle2Minutes * 60 * 1000,
    label: "Cycle 2",
    repoRoot,
    packetDir,
    host: args.host,
    searchLimit: args.searchLimit,
    baseline,
  });

  const decision = buildDecision(cycle1, cycle2);
  const submissions = [];

  if (decision.unchanged && args.liveSubmit) {
    log("Unchanged criteria matched. Submitting both ticket drafts.");
    const effectiveSubmitMode =
      args.submitMode === "auto"
        ? process.env.RESEND_API_KEY
          ? "email"
          : "webhook"
        : args.submitMode;

    const cdpSubmission = await submitDraft({
      submitMode: effectiveSubmitMode,
      webhookUrl: process.env.CDP_TICKET_WEBHOOK_URL || "",
      bearerToken: process.env.CDP_TICKET_WEBHOOK_BEARER_TOKEN || "",
      resendApiKey: process.env.RESEND_API_KEY || "",
      fromEmail: process.env.SUPPORT_EMAIL_FROM || "",
      toEmail: process.env.CDP_SUPPORT_EMAIL_TO || "",
      draftPath: cdpDraftPath,
      packetDir,
      triggerDecision: decision,
      name: "cdp-bazaar",
    });
    submissions.push(cdpSubmission);

    const indexSubmission = await submitDraft({
      submitMode: effectiveSubmitMode,
      webhookUrl: process.env.INDEX402_TICKET_WEBHOOK_URL || "",
      bearerToken: process.env.INDEX402_TICKET_WEBHOOK_BEARER_TOKEN || "",
      resendApiKey: process.env.RESEND_API_KEY || "",
      fromEmail: process.env.SUPPORT_EMAIL_FROM || "",
      toEmail: process.env.INDEX402_SUPPORT_EMAIL_TO || INDEX402_DEFAULT_TO,
      draftPath: indexDraftPath,
      packetDir,
      triggerDecision: decision,
      name: "402index",
    });
    submissions.push(indexSubmission);
  } else if (decision.unchanged) {
    log("Unchanged criteria matched, but run is dry-run. No submissions sent.");
  } else {
    log("Criteria not met. No submissions sent.");
  }

  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    config: {
      host: args.host,
      searchLimit: args.searchLimit,
      cycle1Minutes: args.cycle1Minutes,
      cycle2Minutes: args.cycle2Minutes,
      liveSubmit: args.liveSubmit,
      submitMode: args.submitMode,
      packetDir: path.relative(repoRoot, packetDir),
    },
    baseline,
    cycles: [cycle1, cycle2].map((cycle) => ({
      cycle: cycle.cycle,
      label: cycle.label,
      scheduledAt: cycle.scheduledAt,
      ranAt: cycle.ranAt,
      discoveryPath: cycle.discoveryPath,
      indexPath: cycle.indexPath,
      evaluation: cycle.evaluation,
    })),
    decision,
    submissions,
  };

  const reportPath = path.join(packetDir, REPORT_FILE);
  writeJson(reportPath, report);
  log(`Report written: ${path.relative(repoRoot, reportPath)}`);

  if (args.liveSubmit && decision.unchanged) {
    const failed = submissions.some((entry) => !entry.ok && !entry.skipped);
    const skipped = submissions.some((entry) => entry.skipped);
    if (failed || skipped) {
      process.exitCode = 2;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
