const assert = require("node:assert/strict");
const test = require("node:test");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const { buildDocumentArtifact, isDocumentArtifactPath } = require("../routes/auto-local/doc-artifacts");

function decodeArtifactBuffer(payload) {
  assert.equal(payload.success, true);
  assert.equal(typeof payload.data?.artifact?.contentBase64, "string");
  return Buffer.from(payload.data.artifact.contentBase64, "base64");
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
