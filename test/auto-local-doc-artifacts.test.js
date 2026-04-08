const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const { buildDocumentArtifact, isDocumentArtifactPath } = require("../routes/auto-local/doc-artifacts");
const { htmlToMarkdownLike } = require("../routes/auto-local/pdf-generators");
const {
  buildStructuredReport,
  createAssumptionsTable,
  createHeadlineMetric,
  createTable,
} = require("../lib/report-builder");

function decodeArtifactBuffer(payload) {
  assert.equal(payload.success, true);
  assert.equal(typeof payload.data?.artifact?.contentBase64, "string");
  return Buffer.from(payload.data.artifact.contentBase64, "base64");
}

function extractPdfText(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  const matches = [];
  const text = source.toString("latin1");
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamPattern.exec(text)) !== null) {
    const chunk = Buffer.from(match[1], "latin1");
    try {
      matches.push(zlib.inflateSync(chunk).toString("latin1"));
      continue;
    } catch {}
    matches.push(chunk.toString("latin1"));
  }
  matches.push(text);
  const combined = matches.join("\n");
  return combined
    .replace(/\[([\s\S]*?)\]\s*TJ/g, (_match, content) => {
      const parts = [];
      content.replace(/<([0-9A-Fa-f]+)>|\(((?:\\.|[^\\)])*)\)/g, (_token, hex, literal) => {
        if (hex) {
          parts.push(Buffer.from(hex, "hex").toString("latin1"));
        } else if (literal) {
          parts.push(literal.replace(/\\([\\()])/g, "$1"));
        }
        return "";
      });
      return parts.join("");
    })
    .replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (_match, literal) => literal.replace(/\\([\\()])/g, "$1"))
    .replace(/<([0-9A-Fa-f]+)>/g, (_match, hex) => {
      try {
        return Buffer.from(hex, "hex").toString("latin1");
      } catch {
        return "";
      }
    })
    .replace(/\\([\\()])/g, "$1");
}

function normalizePdfSearchText(value) {
  return String(value || "")
    .replace(/\b-?\d+(?:\.\d+)?\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

async function readZipEntryText(payload, entryName) {
  const bytes = decodeArtifactBuffer(payload);
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(entryName);
  assert.ok(entry, `missing zip entry: ${entryName}`);
  return entry.async("string");
}

async function readWorkbook(payload) {
  const bytes = decodeArtifactBuffer(payload);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

function worksheetContains(worksheet, needle) {
  for (const row of worksheet.getSheetValues().slice(1)) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const cell of row) {
      if (cell == null) {
        continue;
      }
      if (String(cell).includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

function buildSharedReportFixture() {
  return buildStructuredReport({
    reportMeta: {
      report_type: "vendor-brief",
      title: "Vendor onboarding brief",
      author: "AurelianFlo",
    },
    executiveSummary: [
      "Counterparty passed data-quality checks.",
      "Manual review is still recommended before payout.",
    ],
    headlineMetrics: [
      createHeadlineMetric("Risk tier", "medium", "label"),
      createHeadlineMetric("Screened lists", 4, "count"),
      createHeadlineMetric("Manual review recommended", true, "boolean"),
    ],
    tables: {
      headline_metrics: createTable(
        ["label", "value", "unit"],
        [
          { label: "Risk tier", value: "medium", unit: "label" },
          { label: "Screened lists", value: 4, unit: "count" },
        ],
      ),
      counterparties: createTable(
        ["name", "country", "status"],
        [{ name: "Example Co", country: "US", status: "review" }],
      ),
      assumptions: createAssumptionsTable([
        { field: "workflow", value: "vendor_onboarding" },
        { field: "screening_date", value: "2026-04-03" },
      ]),
    },
    result: {
      status: "review",
    },
  });
}

function buildWorkflowReportFixture() {
  return {
    workflow_meta: {
      workflow: "sports.playoff_forecast",
      league: "nba",
      as_of_date: "2026-04-03",
      mode: "standings_snapshot",
      model_version: "1.0.0",
    },
    inputs_echo: {
      field: "top_6_only",
    },
    prediction: {
      predicted_winner: "Oklahoma City Thunder",
      championship_probability: 0.5036,
    },
    ranking: [
      { rank: 1, team: "Oklahoma City Thunder", probability: 0.5036 },
      { rank: 2, team: "San Antonio Spurs", probability: 0.4632 },
    ],
    assumptions: [
      "Modeled field: top 6 seeds in each conference",
      "Signals: win percentage, point differential, recent form, and seed strength",
    ],
    diagnostics: {
      simulations_run: 10000,
      seed: 12345,
    },
    report: buildStructuredReport({
      reportMeta: {
        report_type: "sports-playoff-forecast",
        title: "NBA Playoff Forecast",
        author: "AurelianFlo",
      },
      executiveSummary: [
        "Oklahoma City Thunder is the top-ranked title favorite in this snapshot.",
        "San Antonio Spurs is the strongest challenger in the modeled field.",
      ],
      headlineMetrics: [
        createHeadlineMetric("Predicted winner", "Oklahoma City Thunder", "team"),
        createHeadlineMetric("Championship probability", "50.36%", "percent"),
      ],
      tables: {
        contender_ranking: createTable(
          ["rank", "team", "probability"],
          [
            { rank: 1, team: "Oklahoma City Thunder", probability: "50.36%" },
            { rank: 2, team: "San Antonio Spurs", probability: "46.32%" },
          ],
        ),
      },
      exportArtifacts: {
        recommended_local_path: "outputs/nba-playoff-forecast-2026-04-03.xlsx",
      },
      result: {
        predicted_winner: "Oklahoma City Thunder",
      },
    }),
  };
}

function buildVendorWorkflowReportFixture() {
  return {
    workflow_meta: {
      workflow: "vendor.risk_forecast",
      as_of_date: "2026-04-03",
      mode: "vendor_batch",
      model_version: "1.0.0",
    },
    inputs_echo: {
      vendor_count: 3,
      screening_threshold: 90,
      screening_limit: 3,
    },
    summary: {
      status: "manual-review-required",
      recommended_action: "pause-and-review",
      risk_tier: "high",
      flagged_vendor_count: 2,
      clear_vendor_count: 1,
    },
    vendors: [
      {
        rank: 1,
        name: "SBERBANK",
        country: "CZ",
        risk_tier: "critical",
        risk_score: 0.97,
        recommended_action: "reject-or-escalate",
        manual_review_required: true,
      },
      {
        rank: 2,
        name: "VTB BANK PJSC",
        country: "RU",
        risk_tier: "high",
        risk_score: 0.88,
        recommended_action: "pause-and-review",
        manual_review_required: true,
      },
      {
        rank: 3,
        name: "Example Co",
        country: "US",
        risk_tier: "low",
        risk_score: 0.12,
        recommended_action: "proceed",
        manual_review_required: false,
      },
    ],
    assumptions: [
      "This workflow is a triage and screening aid, not legal clearance.",
      "Risk scoring uses sanctions and entity-resolution signals plus vendor context.",
    ],
    diagnostics: {
      vendors_processed: 3,
      brief_calls: 2,
      batch_screen_calls: 1,
      seed: 12345,
    },
    report: buildStructuredReport({
      reportMeta: {
        report_type: "vendor-risk-forecast",
        title: "Vendor Risk Forecast",
        author: "AurelianFlo",
      },
      executiveSummary: [
        "Two vendors require manual review before onboarding.",
        "One vendor is currently clear under the configured threshold.",
      ],
      headlineMetrics: [
        createHeadlineMetric("Risk tier", "high", "label"),
        createHeadlineMetric("Flagged vendors", 2, "count"),
        createHeadlineMetric("Vendors processed", 3, "count"),
      ],
      tables: {
        vendor_ranking: createTable(
          ["rank", "name", "country", "risk_tier", "recommended_action"],
          [
            { rank: 1, name: "SBERBANK", country: "CZ", risk_tier: "critical", recommended_action: "reject-or-escalate" },
            { rank: 2, name: "VTB BANK PJSC", country: "RU", risk_tier: "high", recommended_action: "pause-and-review" },
            { rank: 3, name: "Example Co", country: "US", risk_tier: "low", recommended_action: "proceed" },
          ],
        ),
      },
      exportArtifacts: {
        recommended_local_path: "outputs/vendor-risk-forecast-2026-04-03.xlsx",
      },
      result: {
        status: "manual-review-required",
      },
    }),
  };
}

test("isDocumentArtifactPath matches document-like auto-local paths", () => {
  assert.equal(isDocumentArtifactPath("/api/tools/pdf/generate"), true);
  assert.equal(isDocumentArtifactPath("/api/tools/invoice/generate"), true);
  assert.equal(isDocumentArtifactPath("/api/tools/convert/markdown-to-pdf"), true);
  assert.equal(isDocumentArtifactPath("/api/tools/random/joke"), false);
});

test("buildDocumentArtifact returns real binary PDF for /pdf/ paths", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: { title: "Quarterly Plan", owner: "Ops" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.artifact.type, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  assert.ok(bytes.length > 0);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
});

test("buildDocumentArtifact rejects empty generic PDF payloads instead of minting stub PDFs", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: {},
  });

  assert.equal(payload.success, false);
  assert.equal(payload.error, "invalid_input");
  assert.match(String(payload.message || ""), /pdf/i);
});

test("buildDocumentArtifact renders markdown payloads on generic pdf route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: {
      title: "Meridian x402 Marketplace",
      format: "markdown",
      content: "# Meridian x402 Marketplace\n\n- Paid APIs\n- Structured reports\n",
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = extractPdfText(bytes);
  assert.ok(bytes.toString("latin1").startsWith("%PDF"));
  const normalized = normalizePdfSearchText(asText);
  assert.match(normalized, /meridianx402marketplace/);
  assert.match(normalized, /paidapis/);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/pdf\/generate/);
});

test("buildDocumentArtifact renders html payloads on generic pdf route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: {
      title: "Rendered HTML",
      html: "<!DOCTYPE html><html><body><h1>Rendered HTML</h1><p>Paragraph body.</p><ul><li>One</li><li>Two</li></ul></body></html>",
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = extractPdfText(bytes);
  assert.ok(bytes.toString("latin1").startsWith("%PDF"));
  const normalized = normalizePdfSearchText(asText);
  assert.match(normalized, /renderedhtml/);
  assert.match(normalized, /paragraphbody/);
  assert.match(normalized, /one/);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/pdf\/generate/);
});

test("buildDocumentArtifact returns real binary PDF for invoice/receipt-like paths", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/invoice/generate",
    endpoint: "POST /api/tools/invoice/generate",
    body: { title: "Invoice 1024", amount: "250.00" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.artifact.type, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  assert.ok(bytes.length > 0);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
});

test("buildDocumentArtifact returns real binary PDF for conversion-to-pdf paths", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/convert/markdown-to-pdf",
    endpoint: "POST /api/tools/convert/markdown-to-pdf",
    body: { title: "Release Notes", markdown: "# v1.2.3\\n\\n- Added feature" },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.artifact.type, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  assert.ok(bytes.length > 0);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
});

test("buildDocumentArtifact returns real binary XLSX for structured sheet payloads", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/generate",
    endpoint: "POST /api/tools/xlsx/generate",
    body: {
      title: "Quarterly Workbook",
      sheets: [
        {
          name: "Scores",
          headers: ["name", "score"],
          rows: [
            ["Alice", 91],
            ["Bob", 84],
          ],
        },
        {
          name: "Summary",
          headers: ["metric", "value"],
          rows: [
            { metric: "avg_score", value: 87.5 },
            { metric: "count", value: 2 },
          ],
        },
      ],
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.artifact.type, "xlsx");

  const bytes = decodeArtifactBuffer(payload);
  assert.ok(bytes.length > 0);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");

  const workbook = await readWorkbook(payload);
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Scores", "Summary"]);
  assert.equal(workbook.getWorksheet("Scores").getCell("A2").value, "Alice");
  assert.equal(workbook.getWorksheet("Scores").getCell("B2").value, 91);
  assert.equal(workbook.getWorksheet("Summary").getCell("A2").value, "avg_score");
});

test("buildDocumentArtifact ingests shared report model directly into XLSX sheets", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/generate",
    endpoint: "POST /api/tools/xlsx/generate",
    body: buildSharedReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");

  const workbook = await readWorkbook(payload);
  assert.ok(workbook.getWorksheet("Headline Metrics"));
  assert.ok(workbook.getWorksheet("Counterparties"));
  assert.ok(workbook.getWorksheet("Assumptions"));
  assert.equal(worksheetContains(workbook.getWorksheet("Counterparties"), "Example Co"), true);
});

test("buildDocumentArtifact ingests nested workflow report payloads into XLSX and preserves recommended path", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/generate",
    endpoint: "POST /api/tools/xlsx/generate",
    body: buildWorkflowReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.recommended_local_path, "outputs/nba-playoff-forecast-2026-04-03.xlsx");

  const workbook = await readWorkbook(payload);
  assert.ok(workbook.getWorksheet("Contender Ranking"));
  assert.equal(
    worksheetContains(workbook.getWorksheet("Contender Ranking"), "Oklahoma City Thunder"),
    true,
  );
});

test("buildDocumentArtifact ingests vendor workflow reports into XLSX and preserves vendor path", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/generate",
    endpoint: "POST /api/tools/xlsx/generate",
    body: buildVendorWorkflowReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.recommended_local_path, "outputs/vendor-risk-forecast-2026-04-03.xlsx");

  const workbook = await readWorkbook(payload);
  assert.ok(workbook.getWorksheet("Vendor Ranking"));
  assert.equal(
    worksheetContains(workbook.getWorksheet("Vendor Ranking"), "SBERBANK"),
    true,
  );
});

test("buildDocumentArtifact renders NDA-specific DOCX content instead of preview stub text", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/docx/generate",
    endpoint: "POST /api/tools/docx/generate",
    body: {
      title: "Mutual NDA",
      template: "nda",
      parties: {
        party_a: { name: "Acme Labs" },
        party_b: { name: "Beta Ventures" },
        effective_date: "2026-04-02",
      },
      company: { state: "Texas" },
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "docx");
  assert.equal(payload.data.artifact.type, "docx");

  const documentXml = await readZipEntryText(payload, "word/document.xml");
  assert.match(documentXml, /Definition of Confidential Information/);
  assert.match(documentXml, /Acme Labs/);
  assert.match(documentXml, /Beta Ventures/);
  assert.doesNotMatch(documentXml, /Generated from POST \/api\/tools\/docx\/generate/);
});

test("buildDocumentArtifact ingests shared report model directly into DOCX report layout", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/docx/generate",
    endpoint: "POST /api/tools/docx/generate",
    body: buildSharedReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "docx");

  const documentXml = await readZipEntryText(payload, "word/document.xml");
  assert.match(documentXml, /Vendor onboarding brief/);
  assert.match(documentXml, /Counterparty passed data-quality checks/);
  assert.match(documentXml, /Example Co/);
});

test("buildDocumentArtifact renders invoice XLSX template content instead of generic preview rows", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/generate",
    endpoint: "POST /api/tools/xlsx/generate",
    body: {
      title: "April Invoice",
      template: "invoice",
      company: { name: "AurelianFlo" },
      client: { name: "Kent Egan" },
      invoice_number: "INV-2026-0042",
      items: [
        { description: "Endpoint audit", quantity: 2, price: 125 },
        { description: "Doc generation upgrade", quantity: 1, price: 400 },
      ],
      tax_rate: 8.25,
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.artifact.type, "xlsx");

  const workbook = await readWorkbook(payload);
  const worksheet = workbook.getWorksheet("Invoice");
  assert.ok(worksheet);
  assert.equal(worksheet.getCell("B5").value, "INVOICE");
  assert.equal(worksheet.getCell("E5").value, "INV-2026-0042");
  assert.equal(worksheetContains(worksheet, "Subtotal:"), true);
  assert.equal(worksheetContains(worksheet, "TOTAL:"), true);
  assert.equal(worksheetContains(worksheet, "Generated from POST /api/tools/xlsx/generate"), false);
});

test("buildDocumentArtifact renders formatted invoice PDF instead of placeholder preview text", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/invoice/generate",
    endpoint: "POST /api/tools/invoice/generate",
    body: {
      company: { name: "AurelianFlo", email: "ops@aurelianflo.com" },
      client: { name: "Kent Egan", email: "kent@example.com" },
      invoice_number: "INV-2026-0042",
      items: [{ description: "Doc generation upgrade", quantity: 1, price: 400 }],
      tax_rate: 8.25,
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.artifact.type, "pdf");
  assert.equal(payload.data.fileName, "INV-2026-0042.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.ok(bytes.length > 1500);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/invoice\/generate/);
});

test("buildDocumentArtifact renders contract PDFs with legal-layout output instead of generic stubs", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/contract/generate",
    endpoint: "POST /api/tools/contract/generate",
    body: {
      type: "nda",
      effectiveDate: "2026-04-02",
      jurisdiction: "Texas",
      duration: "3 years",
      partyA: { name: "Acme Labs", company: "Acme Labs" },
      partyB: { name: "Beta Ventures", company: "Beta Ventures" },
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.fileName, "nda-2026-04-02.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.ok(bytes.length > 3000);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/contract\/generate/);
});

test("buildDocumentArtifact renders proposal PDFs with proposal-specific filename and non-stub size", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/proposal/generate",
    endpoint: "POST /api/tools/proposal/generate",
    body: {
      projectName: "AurelianFlo Discovery Upgrade",
      client: "Kent Egan",
      preparedBy: { name: "AurelianFlo", company: "AurelianFlo" },
      scope: "Replace stub outputs with production-ready document generators.",
      deliverables: ["Contract PDF", "Proposal PDF", "Markdown PDF"],
      pricing: {
        currency: "USD",
        total: 1200,
        items: [
          { description: "Implementation", amount: 900 },
          { description: "Verification", amount: 300 },
        ],
      },
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.fileName, "proposal-aurelianflo-discovery-upgrade.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.ok(bytes.length > 1800);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/proposal\/generate/);
});

test("buildDocumentArtifact renders markdown PDFs with dedicated filename and richer output size", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/markdown-to-pdf",
    endpoint: "POST /api/tools/markdown-to-pdf",
    body: {
      markdown: [
        "# Release Notes",
        "",
        "## Summary",
        "- Added **contract** generator",
        "- Added `markdown-to-pdf` support",
        "",
        "> Stub outputs replaced",
        "",
        "```js",
        "console.log('hello');",
        "```",
      ].join("\n"),
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.fileName, "document.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.ok(bytes.length > 1800);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/markdown-to-pdf/);
});

test("buildDocumentArtifact renders premium markdown tables and inline formatting on pdf/generate", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: {
      title: "Premium Markdown",
      format: "markdown",
      content: [
        "# Premium Markdown",
        "",
        "Use **premium** formatting with `inline_code` and a proper table:",
        "",
        "| Route | Status |",
        "| --- | --- |",
        "| report/generate | healthy |",
        "| pdf/generate | upgraded |",
      ].join("\n"),
    },
  });

  assert.equal(payload.success, true);
  const bytes = decodeArtifactBuffer(payload);
  const normalized = normalizePdfSearchText(extractPdfText(bytes));
  assert.match(normalized, /premiummarkdown/);
  assert.match(normalized, /premium/);
  assert.match(normalized, /inlinecode/);
  assert.match(normalized, /route/);
  assert.match(normalized, /status/);
  assert.match(normalized, /reportgenerate/);
  assert.match(normalized, /healthy/);
  assert.match(normalized, /pdfgenerate/);
  assert.match(normalized, /upgraded/);
  assert.doesNotMatch(extractPdfText(bytes), /\*\*premium\*\*/);
  assert.doesNotMatch(extractPdfText(bytes), /\|\s*Route\s*\|/);
});

test("htmlToMarkdownLike preserves emphasis, lists, and table rows for premium html rendering", () => {
  assert.equal(typeof htmlToMarkdownLike, "function");

  const markdown = htmlToMarkdownLike(`
    <!doctype html>
    <html>
      <body>
        <h1>Revenue Overview</h1>
        <p><strong>Premium</strong> plan with <em>faster</em> reporting.</p>
        <ul><li>Launch</li><li>Verify</li></ul>
        <table>
          <thead><tr><th>Quarter</th><th>Revenue</th></tr></thead>
          <tbody>
            <tr><td>Q1</td><td>$10</td></tr>
            <tr><td>Q2</td><td>$12</td></tr>
          </tbody>
        </table>
      </body>
    </html>
  `);

  assert.match(markdown, /^# Revenue Overview/m);
  assert.match(markdown, /\*\*Premium\*\* plan with \*faster\* reporting\./);
  assert.match(markdown, /- Launch/);
  assert.match(markdown, /\| Quarter \| Revenue \|/);
  assert.match(markdown, /\| Q1 \| \$10 \|/);
  assert.match(markdown, /\| Q2 \| \$12 \|/);
});

test("buildDocumentArtifact renders direct HTML ordered lists and code blocks without flattening them into bullets", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/generate",
    endpoint: "POST /api/tools/pdf/generate",
    body: {
      title: "Premium HTML",
      format: "html",
      content: `
        <html>
          <body>
            <h1>Launch Checklist</h1>
            <ol>
              <li>Plan rollout</li>
              <li>Verify payments</li>
            </ol>
            <pre><code>npm run build
npm run deploy</code></pre>
          </body>
        </html>
      `,
    },
  });

  assert.equal(payload.success, true);
  const extracted = extractPdfText(decodeArtifactBuffer(payload));
  assert.match(extracted, /1\./);
  assert.match(extracted, /2\./);
  assert.match(extracted, /npm run build/);
  assert.match(extracted, /npm run deploy/);
  assert.doesNotMatch(extracted, /<ol>|<pre>|<code>/);
});

test("buildDocumentArtifact ingests shared report model directly into report PDF output", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/generate",
    endpoint: "POST /api/tools/report/generate",
    body: buildSharedReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.capabilities.selected.realBinary, true);
  assert.equal(payload.data.capabilities.selected.usedFallback, false);
  assert.notEqual(payload.data.capabilities.selected.engine, "pdf-fallback");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.ok(bytes.length > 1800);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/report\/generate/);
});

test("buildDocumentArtifact renders premium report metadata and metrics from the shared report model", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/generate",
    endpoint: "POST /api/tools/report/generate",
    body: buildStructuredReport({
      reportMeta: {
        report_type: "ops-brief",
        title: "Weekly Ops Brief",
        author: "AurelianFlo",
        date: "2026-04-05",
        version: "v2.0",
      },
      executiveSummary: [
        "Core routes stayed available through the reporting window.",
      ],
      headlineMetrics: [
        createHeadlineMetric("Uptime", "99.9%", "percent"),
        createHeadlineMetric("Incidents", 1, "count"),
      ],
      tables: {
        route_health: createTable(
          ["route", "status"],
          [{ route: "/api/tools/report/generate", status: "healthy" }],
        ),
      },
    }),
  });

  assert.equal(payload.success, true);
  const extracted = extractPdfText(decodeArtifactBuffer(payload));
  const normalized = normalizePdfSearchText(extracted);
  assert.match(normalized, /weeklyopsbrief/);
  assert.match(normalized, /opsbrief/);
  assert.match(normalized, /aurelianflo/);
  assert.match(extracted, /2026-04-05/);
  assert.match(extracted, /v2\.0/);
  assert.match(normalized, /uptime/);
  assert.match(normalized, /percent/);
  assert.match(normalized, /incidents/);
  assert.match(normalized, /count/);
});

test("buildDocumentArtifact keeps enhanced due diligence reports on the premium compliance PDF lane", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/pdf/generate",
    endpoint: "POST /api/tools/report/pdf/generate",
    body: buildStructuredReport({
      reportMeta: {
        report_type: "enhanced-due-diligence",
        title: "Enhanced Due Diligence Memo",
        author: "AurelianFlo",
        date: "2026-04-08T00:00:00.000Z",
        version: "v1.0",
      },
      executiveSummary: [
        "Enhanced due diligence memo prepared after screening 1 wallet.",
        "This memo records the screening evidence and reviewer handoff fields.",
      ],
      headlineMetrics: [
        createHeadlineMetric("Workflow status", "screening_complete_no_exact_match", "label"),
        createHeadlineMetric("Total screened", 1, "count"),
        createHeadlineMetric("Match count", 0, "count"),
      ],
      tables: {
        case_metadata: createTable(
          ["subject_name", "case_name", "review_reason", "jurisdiction", "requested_by"],
          [{
            subject_name: "Public Example Wallet",
            case_name: "Live AurelianFlo EDD Demo PDF",
            review_reason: "Demonstrate paid EDD report tool behavior with PDF output",
            jurisdiction: "US",
            requested_by: "Codex",
          }],
        ),
        screening_results: createTable(
          ["screened_address", "normalized_address", "asset_filter", "screening_status", "match_count"],
          [{
            screened_address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            normalized_address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
            asset_filter: "ETH",
            screening_status: "clear",
            match_count: 0,
          }],
        ),
        source_freshness: createTable(
          ["source_url", "refreshed_at", "dataset_published_at", "address_count", "covered_assets"],
          [{
            source_url: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml",
            refreshed_at: "2026-04-07T06:26:58.819Z",
            dataset_published_at: "2026-04-03T14:17:12.000Z",
            address_count: 772,
            covered_assets: "ARB, BCH, BSC, ETH, USDC",
          }],
        ),
      },
    }),
  });

  assert.equal(payload.success, true);
  const extracted = extractPdfText(decodeArtifactBuffer(payload));
  const normalized = normalizePdfSearchText(extracted);
  assert.doesNotMatch(normalized, /aurelianflodossier/);
  assert.match(extracted, /Enhanced Due Diligence Memo/);
  assert.match(normalized, /headlinemetrics/);
  assert.match(normalized, /casemetadata/);
  assert.match(extracted, /Screening[\s\S]*Results/);
  assert.match(extracted, /Source[\s\S]*Freshness/);
  assert.match(normalized, /workflowstatus/);
});

test("buildDocumentArtifact renders legacy report payloads into styled report PDFs", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/generate",
    endpoint: "POST /api/tools/report/generate",
    body: {
      title: "Meridian x402 Marketplace",
      subtitle: "Positioning brief",
      summary: "Decision workflows for agents.",
      sections: [
        {
          heading: "Core Offering",
          body: "Simulation, due diligence, and report generation.",
        },
        {
          heading: "Why It Matters",
          bullets: ["Pay per call", "Report-ready output"],
        },
      ],
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = extractPdfText(bytes);
  assert.ok(bytes.toString("latin1").startsWith("%PDF"));
  const normalized = normalizePdfSearchText(asText);
  assert.match(normalized, /meridianx402marketplace/);
  assert.match(normalized, /decisionworkflowsforagents/);
  assert.match(normalized, /coreoffering/);
  assert.match(normalized, /paypercall/);
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/report\/generate/);
});

test("buildDocumentArtifact derives document-specific recommended path for workflow-backed report PDFs", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/generate",
    endpoint: "POST /api/tools/report/generate",
    body: buildWorkflowReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.recommended_local_path, "outputs/nba-playoff-forecast-2026-04-03.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/report\/generate/);
});

test("buildDocumentArtifact derives document-specific recommended path for vendor report PDFs", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/generate",
    endpoint: "POST /api/tools/report/generate",
    body: buildVendorWorkflowReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.recommended_local_path, "outputs/vendor-risk-forecast-2026-04-03.pdf");

  const bytes = decodeArtifactBuffer(payload);
  const asText = bytes.toString("latin1");
  assert.ok(asText.startsWith("%PDF"));
  assert.doesNotMatch(asText, /Generated from POST \/api\/tools\/report\/generate/);
});

test("buildDocumentArtifact supports explicit premium report DOCX route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/docx/generate",
    endpoint: "POST /api/tools/report/docx/generate",
    body: buildSharedReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "docx");
  assert.equal(payload.data.capabilities.selected.lane, "premium-report");
  assert.match(String(payload.data.capabilities.selected.engine || ""), /report-docx|docx/);

  const documentXml = await readZipEntryText(payload, "word/document.xml");
  assert.match(documentXml, /Vendor onboarding brief/);
  assert.match(documentXml, /Counterparty passed data-quality checks/);
});

test("buildDocumentArtifact supports explicit premium report XLSX route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/report/xlsx/generate",
    endpoint: "POST /api/tools/report/xlsx/generate",
    body: buildSharedReportFixture(),
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.capabilities.selected.lane, "premium-report");
  assert.match(String(payload.data.capabilities.selected.engine || ""), /report-xlsx|xlsx/);

  const workbook = await readWorkbook(payload);
  assert.ok(workbook.worksheets.length >= 1);
  assert.ok(workbook.worksheets.some((worksheet) => worksheetContains(worksheet, "Counterparty passed data-quality checks.")));
  assert.ok(workbook.worksheets.some((worksheet) => worksheetContains(worksheet, "Risk tier")));
});

test("buildDocumentArtifact supports explicit max-fidelity PDF render-html route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/pdf/render-html",
    endpoint: "POST /api/tools/pdf/render-html",
    body: {
      title: "Styled HTML Brief",
      html: "<html><body><h1>Styled HTML Brief</h1><ol><li>First</li><li>Second</li></ol><table><tr><th>Metric</th><th>Value</th></tr><tr><td>ARR</td><td>$42k</td></tr></table></body></html>",
      css: "table{border-collapse:collapse}th,td{border:1px solid #000;padding:4px}",
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "pdf");
  assert.equal(payload.data.capabilities.selected.lane, "max-fidelity");
  assert.equal(payload.data.capabilities.selected.requestedEngine, "chromium");
  assert.equal(typeof payload.data.capabilities.selected.degraded, "boolean");
  if (payload.data.capabilities.selected.degraded) {
    assert.equal(typeof payload.data.capabilities.selected.degradationReason, "string");
  }
  assert.match(String(payload.data.capabilities.selected.engine || ""), /chromium|semantic/);

  const extracted = extractPdfText(decodeArtifactBuffer(payload));
  assert.match(extracted, /Styled HTML Brief/);
  assert.match(extracted, /First/);
  assert.match(extracted, /Metric/);
});

test("buildDocumentArtifact supports explicit template XLSX route", async () => {
  const payload = await buildDocumentArtifact({
    path: "/api/tools/xlsx/render-template",
    endpoint: "POST /api/tools/xlsx/render-template",
    body: {
      title: "Revenue Tracker",
      template: "tracker",
      items: [
        { name: "Launch docs", owner: "Ops", due_date: "2026-04-10", status: "In Progress" },
      ],
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.data.documentType, "xlsx");
  assert.equal(payload.data.capabilities.selected.lane, "max-fidelity");
  assert.match(String(payload.data.capabilities.selected.engine || ""), /template-xlsx|xlsx/);

  const workbook = await readWorkbook(payload);
  assert.ok(workbook.getWorksheet("Revenue Tracker"));
});

test("buildDocumentArtifact preserves a real PDF artifact when report rendering throws", async () => {
  const pdfGeneratorsPath = require.resolve("../routes/auto-local/pdf-generators");
  const docArtifactsPath = require.resolve("../routes/auto-local/doc-artifacts");
  const pdfGenerators = require(pdfGeneratorsPath);
  const originalGenerateReportPdfBuffer = pdfGenerators.generateReportPdfBuffer;

  pdfGenerators.generateReportPdfBuffer = async () => {
    throw new Error("forced pdf failure");
  };
  delete require.cache[docArtifactsPath];

  try {
    const { buildDocumentArtifact: buildFreshDocumentArtifact } = require("../routes/auto-local/doc-artifacts");
    const payload = await buildFreshDocumentArtifact({
      path: "/api/tools/report/generate",
      endpoint: "POST /api/tools/report/generate",
      body: buildSharedReportFixture(),
    });

    assert.equal(payload.success, true);
    assert.equal(payload.data.documentType, "pdf");
    assert.equal(payload.data.capabilities.selected.realBinary, true);
    assert.equal(payload.data.capabilities.selected.usedFallback, true);
    assert.equal(payload.data.capabilities.selected.mode, "real-binary-fallback");

    const bytes = decodeArtifactBuffer(payload);
    assert.match(bytes.toString("latin1"), /^%PDF/);
    const extracted = extractPdfText(bytes);
    assert.match(extracted, /AURELIANFLO DOSSIER/i);
    assert.match(extracted, /forced pdf failure/i);
  } finally {
    pdfGenerators.generateReportPdfBuffer = originalGenerateReportPdfBuffer;
    delete require.cache[docArtifactsPath];
    require("../routes/auto-local/doc-artifacts");
  }
});
