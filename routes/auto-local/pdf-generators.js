const PDFKIT_MODULE = require("pdfkit");
const PDFDocument =
  PDFKIT_MODULE && typeof PDFKIT_MODULE === "object" && PDFKIT_MODULE.default
    ? PDFKIT_MODULE.default
    : PDFKIT_MODULE;
const OPTIONAL_PLAYWRIGHT = (() => {
  try {
    return require("playwright");
  } catch {
    return null;
  }
})();
const OPTIONAL_PLAYWRIGHT_CORE = (() => {
  try {
    return require("playwright-core");
  } catch {
    return null;
  }
})();
const OPTIONAL_SPARTICUZ_CHROMIUM_MIN = (() => {
  try {
    const chromium = require("@sparticuz/chromium-min");
    if (chromium && typeof chromium === "object") {
      chromium.packageName = "@sparticuz/chromium-min";
    }
    return chromium;
  } catch {
    return null;
  }
})();
const OPTIONAL_SPARTICUZ_CHROMIUM = (() => {
  try {
    const chromium = require("@sparticuz/chromium");
    if (chromium && typeof chromium === "object") {
      chromium.packageName = "@sparticuz/chromium";
    }
    return chromium;
  } catch {
    return null;
  }
})();
const OPTIONAL_PUPPETEER = (() => {
  try {
    return require("puppeteer");
  } catch {
    return null;
  }
})();

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "document")
      .replace(/[^a-zA-Z0-9-_ ]/g, "-")
      .replace(/-+/g, "-")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function collectPdf(document, fileName) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve({ buffer: Buffer.concat(chunks), fileName }));
    document.on("error", reject);
  });
}

async function generateContractPdfBuffer(payload = {}) {
  const type = String(payload.type || "nda").toLowerCase();
  const partyA = payload.partyA && typeof payload.partyA === "object" ? payload.partyA : {};
  const partyB = payload.partyB && typeof payload.partyB === "object" ? payload.partyB : {};
  const effectiveDate = String(payload.effectiveDate || new Date().toISOString().slice(0, 10));
  const jurisdiction = String(payload.jurisdiction || "Delaware");
  const duration = String(payload.duration || "2 years");
  const additionalClauses = Array.isArray(payload.additionalClauses) ? payload.additionalClauses : [];

  const titleMap = {
    nda: "NON-DISCLOSURE AGREEMENT",
    msa: "MASTER SERVICE AGREEMENT",
    consulting: "CONSULTING AGREEMENT",
    employment: "EMPLOYMENT AGREEMENT",
  };

  const document = new PDFDocument({ size: "LETTER", margin: 72 });
  const result = collectPdf(document, `${sanitizeFileName(type, "contract")}-${effectiveDate}.pdf`);

  document.fontSize(18).font("Helvetica-Bold").fillColor("#1a1a1a").text(titleMap[type] || type.toUpperCase(), { align: "center" });
  document.moveDown(0.5);
  document.fontSize(10).font("Helvetica").fillColor("#666666").text(`Effective Date: ${effectiveDate}`, { align: "center" });
  document.moveDown(1.5);

  document.fontSize(11).font("Helvetica").fillColor("#333333").text("This Agreement is entered into by and between:");
  document.moveDown(0.5);

  document.font("Helvetica-Bold").text(partyA.name || "Party A");
  document.font("Helvetica");
  if (partyA.title) document.text(`Title: ${partyA.title}`);
  if (partyA.company) document.text(`Company: ${partyA.company}`);
  if (partyA.address) document.text(`Address: ${partyA.address}`);
  document.text('(hereinafter referred to as the "Disclosing Party")');
  document.moveDown(0.5);
  document.text("AND", { align: "center" });
  document.moveDown(0.5);

  document.font("Helvetica-Bold").text(partyB.name || "Party B");
  document.font("Helvetica");
  if (partyB.title) document.text(`Title: ${partyB.title}`);
  if (partyB.company) document.text(`Company: ${partyB.company}`);
  if (partyB.address) document.text(`Address: ${partyB.address}`);
  document.text('(hereinafter referred to as the "Receiving Party")');
  document.moveDown(1);
  document.moveTo(72, document.y).lineTo(540, document.y).strokeColor("#cccccc").stroke();
  document.moveDown(1);

  const clauses = [
    {
      title: "1. DEFINITION OF CONFIDENTIAL INFORMATION",
      body:
        '"Confidential Information" shall mean any non-public technical, business, financial, or operational information disclosed by one party to the other.',
    },
    {
      title: "2. OBLIGATIONS OF THE RECEIVING PARTY",
      body:
        "The Receiving Party shall hold Confidential Information in confidence, restrict access on a need-to-know basis, and use the information solely for the permitted purpose.",
    },
    {
      title: "3. EXCLUSIONS FROM CONFIDENTIAL INFORMATION",
      body:
        "The obligations do not apply to information that is public, previously known, independently developed, or lawfully received from a third party.",
    },
    {
      title: "4. TERM AND DURATION",
      body: `This Agreement remains in effect for ${duration} from the Effective Date, and confidentiality obligations survive for the same duration thereafter.`,
    },
    {
      title: "5. RETURN OF MATERIALS",
      body:
        "Upon request or termination, the Receiving Party shall return or destroy all Confidential Information and certify compliance.",
    },
    {
      title: "6. REMEDIES",
      body:
        "The parties acknowledge that unauthorized disclosure may cause irreparable harm and that equitable relief may be sought in addition to legal remedies.",
    },
    {
      title: "7. GOVERNING LAW AND JURISDICTION",
      body: `This Agreement is governed by the laws of ${jurisdiction}, and disputes shall be brought in the applicable courts of that jurisdiction.`,
    },
    {
      title: "8. MISCELLANEOUS",
      body:
        "This Agreement constitutes the entire understanding of the parties, may be amended only in writing, and may be executed in counterparts.",
    },
  ];

  for (const clause of clauses) {
    document.fontSize(11).font("Helvetica-Bold").fillColor("#1a1a1a").text(clause.title);
    document.moveDown(0.3);
    document.fontSize(10).font("Helvetica").fillColor("#333333").text(clause.body, { lineGap: 2 });
    document.moveDown(0.8);
  }

  for (const [index, clause] of additionalClauses.entries()) {
    document.fontSize(11).font("Helvetica-Bold").fillColor("#1a1a1a").text(`${clauses.length + index + 1}. ${clause.title || "ADDITIONAL CLAUSE"}`);
    document.moveDown(0.3);
    document.fontSize(10).font("Helvetica").fillColor("#333333").text(String(clause.body || ""), { lineGap: 2 });
    document.moveDown(0.8);
  }

  document.addPage();
  document.fontSize(12).font("Helvetica-Bold").fillColor("#1a1a1a").text(
    "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.",
    { lineGap: 3 },
  );
  document.moveDown(2);

  for (const party of [partyA, partyB]) {
    document.fontSize(10).font("Helvetica").fillColor("#999999").text("________________________________________");
    document.fontSize(11).font("Helvetica-Bold").fillColor("#333333").text(party.name || "Name");
    document.font("Helvetica");
    if (party.title) document.text(party.title);
    if (party.company) document.text(party.company);
    document.moveDown(0.3);
    document.fillColor("#999999").text("Date: ____________________");
    document.moveDown(1.5);
  }

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by AurelianFlo", 72, 720, { width: 468, align: "center" });
  document.end();

  return result;
}

async function generateProposalPdfBuffer(payload = {}) {
  const projectName = String(payload.projectName || "Project Proposal");
  const client = String(payload.client || "Client");
  const preparedBy = payload.preparedBy && typeof payload.preparedBy === "object" ? payload.preparedBy : {};
  const scope = String(payload.scope || "");
  const deliverables = Array.isArray(payload.deliverables) ? payload.deliverables : [];
  const timeline = String(payload.timeline || "");
  const pricing = payload.pricing && typeof payload.pricing === "object" ? payload.pricing : {};
  const terms = String(payload.terms || "");
  const sections = Array.isArray(payload.sections) ? payload.sections : [];

  const fileName = `proposal-${sanitizeFileName(projectName, "project-proposal").toLowerCase()}.pdf`;
  const document = new PDFDocument({ size: "LETTER", margin: 60 });
  const result = collectPdf(document, fileName);

  document.rect(0, 0, 612, 200).fill("#2563eb");
  document.fontSize(32).font("Helvetica-Bold").fillColor("#ffffff").text("PROPOSAL", 60, 60);
  document.fontSize(18).font("Helvetica").fillColor("#dbeafe").text(projectName, 60, 100);
  document.fontSize(11).fillColor("#93c5fd").text(`Prepared for: ${client}`, 60, 135);
  if (preparedBy.name) {
    document.text(`Prepared by: ${preparedBy.name}${preparedBy.company ? ` — ${preparedBy.company}` : ""}`, 60, 150);
  }
  document.text(`Date: ${new Date().toISOString().slice(0, 10)}`, 60, 165);
  document.y = 220;

  function sectionHeading(label) {
    document.fontSize(14).font("Helvetica-Bold").fillColor("#2563eb").text(label, 60);
    document.moveDown(0.3);
    document.moveTo(60, document.y).lineTo(552, document.y).strokeColor("#e2e8f0").stroke();
    document.moveDown(0.5);
  }

  if (scope) {
    sectionHeading("PROJECT SCOPE");
    document.fontSize(10).font("Helvetica").fillColor("#333333").text(scope, 60, document.y, { width: 492, lineGap: 2 });
    document.moveDown(1);
  }

  if (deliverables.length > 0) {
    sectionHeading("DELIVERABLES");
    document.fontSize(10).font("Helvetica").fillColor("#333333");
    deliverables.forEach((entry, index) => {
      const text = typeof entry === "string" ? entry : entry.description || entry.name || "";
      document.text(`${index + 1}. ${text}`, 70, document.y, { width: 482 });
      document.moveDown(0.3);
    });
    document.moveDown(0.5);
  }

  if (timeline) {
    sectionHeading("TIMELINE");
    document.fontSize(10).font("Helvetica").fillColor("#333333").text(timeline, 60, document.y, { width: 492 });
    document.moveDown(1);
  }

  if (pricing.total || Array.isArray(pricing.items)) {
    sectionHeading("PRICING");
    const symbol = pricing.currency === "EUR" ? "€" : pricing.currency === "GBP" ? "£" : "$";
    if (Array.isArray(pricing.items) && pricing.items.length > 0) {
      const tableY = document.y;
      document.rect(60, tableY, 492, 20).fill("#2563eb");
      document.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
      document.text("Item", 68, tableY + 5, { width: 300 });
      document.text("Amount", 400, tableY + 5, { width: 140, align: "right" });
      let y = tableY + 25;
      pricing.items.forEach((item, index) => {
        if (index % 2 === 0) document.rect(60, y - 3, 492, 18).fill("#f8fafc");
        document.fontSize(9).font("Helvetica").fillColor("#333333");
        document.text(item.description || item.name || "", 68, y, { width: 300 });
        document.text(`${symbol}${Number(item.amount || item.price || 0).toFixed(2)}`, 400, y, { width: 140, align: "right" });
        y += 20;
      });
      y += 5;
      document.moveTo(350, y).lineTo(552, y).strokeColor("#cccccc").stroke();
      y += 8;
      document.fontSize(12).font("Helvetica-Bold").fillColor("#2563eb");
      document.text("TOTAL:", 350, y, { width: 100, align: "right" });
      document.text(`${symbol}${Number(pricing.total || 0).toFixed(2)}`, 460, y, { width: 80, align: "right" });
      document.y = y + 30;
    } else {
      document.fontSize(16).font("Helvetica-Bold").fillColor("#2563eb").text(`${symbol}${Number(pricing.total || 0).toFixed(2)}`, 60);
      document.moveDown(1);
    }
  }

  for (const section of sections) {
    if (section.heading) {
      sectionHeading(String(section.heading).toUpperCase());
    }
    if (section.body) {
      document.fontSize(10).font("Helvetica").fillColor("#333333").text(String(section.body), 60, document.y, { width: 492, lineGap: 2 });
      document.moveDown(1);
    }
  }

  if (terms) {
    sectionHeading("TERMS & CONDITIONS");
    document.fontSize(9).font("Helvetica").fillColor("#555555").text(terms, 60, document.y, { width: 492, lineGap: 2 });
  }

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by AurelianFlo", 60, 720, { width: 492, align: "center" });
  document.end();

  return result;
}

function stripHtmlTags(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlPreserveWhitespace(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .trim();
}

function splitMarkdownTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(lines, startIndex) {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (!headerLine || !separatorLine) {
    return null;
  }
  if (!String(headerLine).trim().startsWith("|") || !String(separatorLine).trim().startsWith("|")) {
    return null;
  }
  if (!isMarkdownTableSeparator(separatorLine)) {
    return null;
  }

  const headers = splitMarkdownTableRow(headerLine);
  const rows = [];
  let nextIndex = startIndex + 2;

  while (nextIndex < lines.length && String(lines[nextIndex] || "").trim().startsWith("|")) {
    const values = splitMarkdownTableRow(lines[nextIndex]);
    const row = {};
    headers.forEach((header, index) => {
      row[header || `column_${index + 1}`] = values[index] || "";
    });
    rows.push(row);
    nextIndex += 1;
  }

  return {
    headers,
    rows,
    nextIndex: nextIndex - 1,
  };
}

function parseInlineMarkdownSegments(value) {
  const text = String(value || "");
  const segments = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), font: "Helvetica" });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      segments.push({ text: token.slice(2, -2), font: "Helvetica-Bold" });
    } else if (token.startsWith("`")) {
      segments.push({ text: token.slice(1, -1), font: "Courier" });
    } else {
      segments.push({ text: token.slice(1, -1), font: "Helvetica-Oblique" });
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), font: "Helvetica" });
  }

  return segments.filter((segment) => segment.text);
}

function renderInlineMarkdown(document, text, x, fontSize, color, options = {}) {
  const width = options.width || 552 - x;
  const lineGap = options.lineGap ?? 0;
  const segments = parseInlineMarkdownSegments(text);

  if (segments.length === 0) {
    document.fontSize(fontSize).fillColor(color).font("Helvetica").text("", x, document.y, { width, lineGap });
    return;
  }

  let isFirst = true;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    document
      .fontSize(fontSize)
      .fillColor(color)
      .font(segment.font)
      .text(segment.text, isFirst ? x : undefined, isFirst ? document.y : undefined, {
        width,
        lineGap,
        continued: index < segments.length - 1,
      });
    isFirst = false;
  }
}

function ensureSpaceFor(document, height) {
  if (document.y + height > 720) {
    document.addPage();
  }
}

function normalizeHeadingKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function getReportTableByHeading(tables, heading) {
  const target = normalizeHeadingKey(heading);
  return (Array.isArray(tables) ? tables : []).find(
    (table) => normalizeHeadingKey(table && table.heading) === target,
  ) || null;
}

function toBooleanLabel(value) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true") return "Yes";
  if (normalized === "false") return "No";
  return String(value || "");
}

function chunkLongText(value, chunkSize = 18) {
  const text = String(value || "").trim();
  if (!text || /\s/.test(text) || text.length <= chunkSize) {
    return text;
  }

  const parts = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    parts.push(text.slice(index, index + chunkSize));
  }
  return parts.join("\n");
}

function measureTextHeight(document, text, options = {}) {
  const font = options.font || "Helvetica";
  const fontSize = options.fontSize || 10;
  const width = options.width || 400;
  const lineGap = options.lineGap ?? 2;
  document.font(font).fontSize(fontSize);
  return document.heightOfString(String(text || ""), { width, lineGap });
}

function drawSectionHeading(document, label, options = {}) {
  const x = options.x || 54;
  const width = options.width || 504;
  ensureSpaceFor(document, 28);
  document.fontSize(14).font("Helvetica-Bold").fillColor(options.color || "#0f172a").text(String(label || ""), x, document.y, {
    width,
  });
  document.moveDown(0.15);
  document.moveTo(x, document.y).lineTo(x + width, document.y).strokeColor(options.ruleColor || "#d4af37").lineWidth(1).stroke();
  document.moveDown(0.45);
}

function renderBulletList(document, items, options = {}) {
  const bulletX = options.bulletX || 58;
  const textX = options.textX || 76;
  const width = options.width || 468;
  const color = options.color || "#334155";
  const bulletColor = options.bulletColor || "#b7791f";
  const lineGap = options.lineGap ?? 3;

  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item || "").trim();
    if (!text) {
      continue;
    }
    const height = measureTextHeight(document, text, {
      font: "Helvetica",
      fontSize: 10.5,
      width,
      lineGap,
    });
    ensureSpaceFor(document, height + 12);
    const startY = document.y;
    document.fontSize(10.5).font("Helvetica").fillColor(color).text(text, textX, startY, {
      width,
      lineGap,
    });
    document.fontSize(11).font("Helvetica-Bold").fillColor(bulletColor).text("•", bulletX, startY + 1);
    document.y = startY + height + 8;
  }
}

function renderKeyValueRows(document, rows, options = {}) {
  const x = options.x || 54;
  const width = options.width || 504;
  const labelWidth = options.labelWidth || 150;
  const valueWidth = width - labelWidth;
  const rowGap = options.rowGap ?? 10;
  const background = options.background || null;
  const border = options.border || null;
  const inset = 12;

  const normalizedRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => row && String(row.label || "").trim() && String(row.value || row.value === 0 ? row.value : "").trim(),
  );
  if (normalizedRows.length === 0) {
    return;
  }

  const heights = normalizedRows.map((row) => {
    const value = String(row.value || "");
    return Math.max(
      18,
      measureTextHeight(document, value, {
        font: row.monospace ? "Courier" : "Helvetica",
        fontSize: row.fontSize || 10,
        width: valueWidth - inset * 2,
        lineGap: 2,
      }),
    ) + 6;
  });
  const blockHeight =
    heights.reduce((sum, current) => sum + current, 0)
    + Math.max(0, normalizedRows.length - 1) * rowGap
    + inset * 2;

  ensureSpaceFor(document, blockHeight + 8);
  const top = document.y;
  if (background) {
    document.roundedRect(x, top, width, blockHeight, 10).fill(background);
  }
  if (border) {
    document.roundedRect(x, top, width, blockHeight, 10).lineWidth(1).strokeColor(border).stroke();
  }

  let currentY = top + inset;
  normalizedRows.forEach((row, index) => {
    const value = String(row.value || "");
    document.fontSize(9).font("Helvetica-Bold").fillColor("#475569").text(String(row.label || ""), x + inset, currentY, {
      width: labelWidth - inset,
    });
    document.fontSize(row.fontSize || 10)
      .font(row.monospace ? "Courier" : "Helvetica")
      .fillColor("#0f172a")
      .text(value, x + labelWidth, currentY, {
        width: valueWidth - inset * 2,
        lineGap: 2,
      });
    currentY += heights[index] + rowGap;
  });

  document.y = top + blockHeight + 12;
}

function renderOfacWalletScreeningPdf(document, payload = {}) {
  const title = String(payload.title || "OFAC Wallet Screening Report");
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const headlineMetrics = Array.isArray(payload.headlineMetrics) ? payload.headlineMetrics : [];
  const executiveSummary = Array.isArray(payload.executiveSummary) ? payload.executiveSummary : [];
  const tables = Array.isArray(payload.tables) ? payload.tables : [];

  const queryRow = getReportTableByHeading(tables, "Wallet Screening Query")?.rows?.[0] || {};
  const matchRow = getReportTableByHeading(tables, "Wallet Screening Matches")?.rows?.[0] || {};
  const freshnessRow = getReportTableByHeading(tables, "Source Freshness")?.rows?.[0] || {};
  const statusMetric = headlineMetrics.find((metric) => normalizeHeadingKey(metric.label) === "screening status");
  const matchCountMetric = headlineMetrics.find((metric) => normalizeHeadingKey(metric.label) === "match count");
  const manualReviewMetric = headlineMetrics.find(
    (metric) => normalizeHeadingKey(metric.label) === "manual review recommended",
  );
  const statusValue = String(statusMetric?.value || queryRow.status || "unknown");
  const isMatch = statusValue.toLowerCase() === "match";
  const decisionAccent = isMatch ? "#9f1239" : "#166534";
  const decisionFill = isMatch ? "#fff1f2" : "#f0fdf4";
  const decisionText = isMatch ? "Match" : "Clear";
  const reviewText = toBooleanLabel(manualReviewMetric?.value ?? queryRow.manual_review_recommended);
  const primaryEntity = String(matchRow.entity_name || "").trim();

  document.rect(0, 0, 612, 118).fill("#121a2f");
  document.rect(54, 103, 504, 2).fill("#d4af37");
  document.fontSize(26).font("Helvetica-Bold").fillColor("#fffaf0").text(title, 54, 40, { width: 504 });
  const metaLine = [
    metadata.author ? `Author: ${metadata.author}` : null,
    metadata.date ? `Date: ${metadata.date}` : null,
  ].filter(Boolean).join("  |  ");
  if (metaLine) {
    document.fontSize(10).font("Helvetica").fillColor("#d8dee9").text(metaLine, 54, 79, { width: 504 });
  }
  document.y = 132;

  drawSectionHeading(document, "Screening Decision", { color: "#121a2f", ruleColor: "#d4af37" });

  const decisionTop = document.y;
  ensureSpaceFor(document, 118);
  document.roundedRect(54, decisionTop, 236, 106, 12).fill(decisionFill);
  document.roundedRect(310, decisionTop, 248, 106, 12).fill("#f8fafc");

  document.fontSize(9).font("Helvetica-Bold").fillColor("#6b7280").text("Disposition", 72, decisionTop + 14);
  document.fontSize(28).font("Helvetica-Bold").fillColor(decisionAccent).text(decisionText, 72, decisionTop + 34);
  document.fontSize(10).font("Helvetica").fillColor("#334155").text(
    `${Number(matchCountMetric?.value || 0)} designation${Number(matchCountMetric?.value || 0) === 1 ? "" : "s"} matched`,
    72,
    decisionTop + 70,
    { width: 180 },
  );
  if (primaryEntity) {
    document.fontSize(10).font("Helvetica").fillColor("#334155").text(
      `Primary entity: ${primaryEntity}`,
      72,
      decisionTop + 84,
      { width: 180 },
    );
  }

  document.fontSize(9).font("Helvetica-Bold").fillColor("#6b7280").text("Manual Review", 328, decisionTop + 14);
  document.fontSize(24).font("Helvetica-Bold").fillColor("#0f172a").text(reviewText, 328, decisionTop + 34);
  document.fontSize(10).font("Helvetica").fillColor("#334155").text(
    isMatch
      ? "Do not release or route funds until a compliance reviewer clears the address."
      : "No exact OFAC wallet hit found. Preserve the memo for audit support.",
    328,
    decisionTop + 66,
    { width: 206, lineGap: 2 },
  );
  document.y = decisionTop + 126;

  renderKeyValueRows(document, [
    {
      label: "Wallet Reviewed",
      value: chunkLongText(queryRow.address || ""),
      monospace: true,
      fontSize: 9.5,
    },
    {
      label: "Normalized Address",
      value: chunkLongText(queryRow.normalized_address || ""),
      monospace: true,
      fontSize: 9.5,
    },
    {
      label: "Asset Filter",
      value: String(queryRow.asset_filter || "all"),
    },
  ], {
    background: "#fffaf0",
    border: "#e5dcc7",
  });

  if (executiveSummary.length > 0) {
    drawSectionHeading(document, "Executive Summary", { color: "#121a2f", ruleColor: "#d4af37" });
    renderBulletList(document, executiveSummary, {
      bulletColor: "#b7791f",
      color: "#253047",
    });
    document.moveDown(0.2);
  }

  drawSectionHeading(document, "Dataset Freshness", { color: "#121a2f", ruleColor: "#d4af37" });
  renderKeyValueRows(document, [
    {
      label: "Source URL",
      value: chunkLongText(String(freshnessRow.source_url || ""), 28),
      fontSize: 9,
    },
    { label: "Refreshed At", value: String(freshnessRow.refreshed_at || "") },
    { label: "Dataset Published", value: String(freshnessRow.dataset_published_at || "") },
    { label: "Address Count", value: String(freshnessRow.address_count || "") },
    {
      label: "Covered Assets",
      value: String(freshnessRow.covered_assets || ""),
    },
  ], {
    background: "#fffaf0",
    border: "#e5dcc7",
  });

  drawSectionHeading(document, "Sanctions Match", { color: "#121a2f", ruleColor: "#d4af37" });
  renderKeyValueRows(document, [
    { label: "Entity", value: String(matchRow.entity_name || "No match found") },
    { label: "Status", value: String(matchRow.status || statusValue || "unknown") },
    { label: "Asset", value: String(matchRow.asset || queryRow.asset_filter || "") },
    { label: "Programs", value: String(matchRow.programs || "None provided") },
    { label: "Listed On", value: String(matchRow.listed_on || "Not provided") },
    {
      label: "Sanctioned Address",
      value: chunkLongText(matchRow.sanctioned_address || queryRow.address || ""),
      monospace: true,
      fontSize: 9.5,
    },
  ], {
    background: "#f8fafc",
    border: "#d7dee7",
  });
}

function renderLegacyPdfTable(document, options = {}) {
  const headers = Array.isArray(options.headers) ? options.headers.filter(Boolean).slice(0, 5) : [];
  const rows = Array.isArray(options.rows) ? options.rows.slice(0, options.maxRows || 24) : [];
  if (headers.length === 0 || rows.length === 0) {
    return;
  }

  const x = options.x || 54;
  const width = options.width || 500;
  const headerHeight = options.headerHeight || 22;
  const rowHeight = options.rowHeight || 20;
  const columnWidth = width / headers.length;

  ensureSpaceFor(document, headerHeight + rowHeight * Math.min(rows.length + 1, 8) + 20);
  let y = document.y;

  document.rect(x, y, width, headerHeight).fill(options.headerColor || "#2563eb");
  headers.forEach((header, index) => {
    document.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff").text(
      String(header),
      x + 8 + index * columnWidth,
      y + 6,
      { width: columnWidth - 16, ellipsis: true },
    );
  });
  y += headerHeight;

  rows.forEach((row, rowIndex) => {
    ensureSpaceFor(document, rowHeight + 20);
    if (rowIndex % 2 === 0) {
      document.rect(x, y, width, rowHeight).fill(options.rowStripeColor || "#f8fafc");
    }
    headers.forEach((header, index) => {
      const value = row && typeof row === "object" ? row[header] : "";
      document.fontSize(options.fontSize || 8.5).font("Helvetica").fillColor(options.textColor || "#334155").text(
        value == null ? "" : String(value),
        x + 8 + index * columnWidth,
        y + 5,
        { width: columnWidth - 16, ellipsis: true },
      );
    });
    y += rowHeight;
  });

  document.y = y + 14;
}

async function generateMarkdownPdfBuffer(payload = {}) {
  const markdown = String(payload.markdown || "");
  const pageSize = String(payload.pageSize || "LETTER");
  const document = new PDFDocument({ size: pageSize, margin: 60 });
  const result = collectPdf(document, "document.pdf");

  const lines = markdown.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      document.moveDown(0.5);
      continue;
    }

    if (line.startsWith("# ")) {
      document.fontSize(24).font("Helvetica-Bold").fillColor("#1a1a1a").text(line.slice(2).trim());
      document.moveDown(0.3);
      document.moveTo(60, document.y).lineTo(552, document.y).strokeColor("#2563eb").lineWidth(2).stroke();
      document.moveDown(0.5);
      continue;
    }
    if (line.startsWith("## ")) {
      document.moveDown(0.3);
      document.fontSize(18).font("Helvetica-Bold").fillColor("#2563eb").text(line.slice(3).trim());
      document.moveDown(0.2);
      document.moveTo(60, document.y).lineTo(552, document.y).strokeColor("#e2e8f0").lineWidth(1).stroke();
      document.moveDown(0.4);
      continue;
    }
    if (line.startsWith("### ")) {
      document.fontSize(14).font("Helvetica-Bold").fillColor("#333333").text(line.slice(4).trim());
      document.moveDown(0.3);
      continue;
    }
    if (line.startsWith("#### ")) {
      document.fontSize(12).font("Helvetica-Bold").fillColor("#555555").text(line.slice(5).trim());
      document.moveDown(0.2);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      document.moveDown(0.3);
      document.moveTo(60, document.y).lineTo(552, document.y).strokeColor("#dddddd").lineWidth(1).stroke();
      document.moveDown(0.5);
      continue;
    }
    const markdownTable = parseMarkdownTable(lines, index);
    if (markdownTable) {
      renderPdfTable(document, {
        headers: markdownTable.headers,
        rows: markdownTable.rows,
        x: 60,
        width: 492,
        headerColor: "#0f172a",
        rowStripeColor: "#eef2ff",
      });
      index = markdownTable.nextIndex;
      continue;
    }
    if (/^[-*+]\s/.test(trimmed)) {
      const text = trimmed.slice(2);
      renderInlineMarkdown(document, text, 78, 10, "#333333");
      document.fontSize(10).font("Helvetica").fillColor("#2563eb").text("•", 64, document.y - 10);
      document.moveDown(0.15);
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s(.+)/);
    if (numbered) {
      document.fontSize(10).font("Helvetica-Bold").fillColor("#2563eb").text(`${numbered[1]}.`, 64, document.y, {
        continued: true,
        width: 20,
      });
      renderInlineMarkdown(document, numbered[2], 82, 10, "#333333");
      document.moveDown(0.15);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteText = trimmed.slice(1).trim();
      const quoteY = document.y;
      document.fontSize(10).font("Helvetica-Oblique").fillColor("#666666").text(quoteText, 78, document.y, { width: 460 });
      document.rect(64, quoteY - 2, 3, document.y - quoteY + 4).fill("#2563eb");
      document.moveDown(0.3);
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const codeY = document.y;
      document.fontSize(9).font("Courier").fillColor("#333333").text(codeLines.join("\n"), 72, document.y, { width: 468 });
      document.rect(64, codeY - 4, 484, document.y - codeY + 8).strokeColor("#e2e8f0").lineWidth(1).stroke();
      document.moveDown(0.5);
      continue;
    }

    renderInlineMarkdown(document, trimmed, 60, 10, "#333333");
    document.moveDown(0.2);
  }

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by AurelianFlo", 60, 720, { width: 492, align: "center" });
  document.end();

  return result;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function htmlToMarkdownLike(html) {
  const source = decodeHtmlEntities(String(html || ""));
  const tableToMarkdown = (tableHtml) => {
    const rows = Array.from(String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
      .map((match) =>
        Array.from(match[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi))
          .map((cell) => stripHtmlTags(cell[2])),
      )
      .filter((cells) => cells.length > 0);

    if (rows.length === 0) {
      return "";
    }

    const headers = rows[0];
    const separator = headers.map(() => "---");
    return [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
      "",
    ].join("\n");
  };
  const listToMarkdown = (listHtml, ordered) => {
    const items = Array.from(String(listHtml).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
      .map((match) => stripHtmlTags(match[1]))
      .filter(Boolean);
    if (items.length === 0) {
      return "";
    }
    return items
      .map((item, index) => (ordered ? `${index + 1}. ${item}` : `- ${item}`))
      .join("\n");
  };
  const preToMarkdown = (preHtml) => {
    const inner = stripHtmlPreserveWhitespace(preHtml);
    if (!inner) {
      return "";
    }
    return `\n\`\`\`\n${inner}\n\`\`\`\n\n`;
  };

  return source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (preHtml) => preToMarkdown(preHtml))
    .replace(/<ol\b[^>]*>[\s\S]*?<\/ol>/gi, (listHtml) => `${listToMarkdown(listHtml, true)}\n\n`)
    .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, (listHtml) => `${listToMarkdown(listHtml, false)}\n\n`)
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => `${tableToMarkdown(tableHtml)}\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, text) => `**${stripHtmlTags(text)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, text) => `*${stripHtmlTags(text)}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, text) => `\`${stripHtmlTags(text)}\``)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, text) => `\n> ${stripHtmlTags(text)}\n\n`)
    .replace(/<(h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag, text) => {
      const level = Number(String(tag).slice(1));
      return `${"#".repeat(level)} ${stripHtmlTags(text)}\n\n`;
    })
    .replace(/<(p|div|section|article|header|footer|main|aside|blockquote|pre|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|aside|blockquote|pre|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(ul|ol)>/gi, "\n\n")
    .replace(/<td\b[^>]*>/gi, " ")
    .replace(/<\/td>/gi, " ")
    .replace(/<th\b[^>]*>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportTableHtml(table = {}) {
  const heading = escapeHtml(String(table.heading || "Section"));
  const columns = Array.isArray(table.columns) ? table.columns.filter(Boolean).slice(0, 5) : [];
  const rows = Array.isArray(table.rows) ? table.rows.slice(0, table.maxRows || 24) : [];
  if (columns.length === 0 || rows.length === 0) {
    return "";
  }

  const headerHtml = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const value = row && typeof row === "object" ? row[column] : "";
          return `<td>${escapeHtml(value == null ? "" : String(value))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <section class="report-section avoid-break">
      <div class="section-heading">${heading}</div>
      <table class="report-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </section>
  `;
}

function buildReportSectionHtml(section = {}) {
  const heading = escapeHtml(String(section.heading || section.title || "Section"));
  const body = String(section.body || section.text || "").trim();
  const bullets = Array.isArray(section.bullets) ? section.bullets.filter(Boolean) : [];
  const rows = Array.isArray(section.table) ? section.table : [];
  const bodyHtml = body ? `<p class="section-body">${escapeHtml(body)}</p>` : "";
  const bulletHtml = bullets.length > 0
    ? `<ul class="summary-list">${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
    : "";

  let tableHtml = "";
  if (rows.length > 0) {
    const columns = Array.from(
      rows.reduce((set, row) => {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          Object.keys(row).forEach((key) => set.add(key));
        }
        return set;
      }, new Set()),
    ).slice(0, 4);
    tableHtml = buildReportTableHtml({
      heading,
      columns,
      rows,
    }).replace(
      `<div class="section-heading">${heading}</div>`,
      "",
    );
  }

  return `
    <section class="report-section avoid-break">
      <div class="section-heading">${heading}</div>
      ${bodyHtml}
      ${bulletHtml}
      ${tableHtml}
    </section>
  `;
}

function buildBrandedReportHtml(payload = {}) {
  const title = escapeHtml(String(payload.title || "Structured Report"));
  const executiveSummary = Array.isArray(payload.executiveSummary) ? payload.executiveSummary.filter(Boolean) : [];
  const headlineMetrics = Array.isArray(payload.headlineMetrics) ? payload.headlineMetrics.filter((metric) => metric && metric.label).slice(0, 3) : [];
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const metaLine = [
    metadata.report_type ? `Type: ${metadata.report_type}` : null,
    metadata.author ? `Author: ${metadata.author}` : null,
    metadata.date ? `Date: ${metadata.date}` : null,
    metadata.version ? `Version: ${metadata.version}` : null,
  ].filter(Boolean).map((entry) => escapeHtml(entry)).join(" &nbsp;|&nbsp; ");

  const metricsHtml = headlineMetrics.length > 0
    ? `<section class="metric-grid">
        ${headlineMetrics.map((metric, index) => `
          <article class="metric-card${index === 0 ? " metric-card--primary" : ""}">
            <div class="metric-label">${escapeHtml(String(metric.label || "").toUpperCase())}</div>
            <div class="metric-value">${escapeHtml(metric.value == null ? "" : String(metric.value))}</div>
            ${metric.unit ? `<div class="metric-unit">${escapeHtml(String(metric.unit))}</div>` : ""}
          </article>
        `).join("")}
      </section>`
    : "";

  const summaryHtml = executiveSummary.length > 0
    ? `<section class="report-section avoid-break">
        <div class="section-heading">Executive Summary</div>
        <ul class="summary-list">
          ${executiveSummary.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}
        </ul>
      </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: Letter; margin: 0.55in; }
      :root {
        --ink: #121a2f;
        --gold: #d4af37;
        --gold-dark: #8a6a16;
        --slate: #334155;
        --muted: #64748b;
        --panel: #f8fafc;
        --panel-warm: #f4efe3;
        --line: #d8dee8;
        --soft-line: #dbeafe;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        color: var(--slate);
        background: #ffffff;
      }
      .report {
        border-top: 10px solid var(--gold);
      }
      .hero {
        background: var(--ink);
        color: #ffffff;
        padding: 22px 26px 26px;
        border-bottom: 2px solid var(--gold);
      }
      .eyebrow {
        color: var(--gold);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        margin-bottom: 10px;
      }
      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.12;
      }
      .subtitle {
        margin-top: 10px;
        color: #d8dee9;
        font-size: 12px;
      }
      .meta {
        margin-top: 12px;
        color: #d8dee9;
        font-size: 11px;
      }
      main {
        padding: 20px 0 0;
      }
      .metric-grid {
        display: grid;
        grid-template-columns: repeat(${Math.max(1, headlineMetrics.length || 1)}, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 18px;
      }
      .metric-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px 15px 13px;
      }
      .metric-card--primary {
        background: var(--panel-warm);
        border-color: var(--gold);
      }
      .metric-label {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .metric-card--primary .metric-label,
      .summary-list li::marker {
        color: var(--gold-dark);
      }
      .metric-value {
        margin-top: 8px;
        color: var(--ink);
        font-size: 24px;
        font-weight: 700;
        line-height: 1.1;
      }
      .metric-unit {
        margin-top: 6px;
        color: var(--muted);
        font-size: 11px;
      }
      .report-section {
        margin-bottom: 18px;
      }
      .section-heading {
        color: #2563eb;
        font-size: 17px;
        font-weight: 700;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--soft-line);
        margin-bottom: 10px;
      }
      .summary-list {
        margin: 0;
        padding-left: 20px;
      }
      .summary-list li {
        margin: 0 0 8px;
        line-height: 1.45;
      }
      .section-body {
        margin: 0 0 10px;
        line-height: 1.5;
      }
      .report-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 11px;
      }
      .report-table thead th {
        background: #285fda;
        color: #ffffff;
        font-weight: 700;
        text-align: left;
        padding: 8px 9px;
        word-break: break-word;
      }
      .report-table tbody td {
        padding: 8px 9px;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
        word-break: break-word;
      }
      .report-table tbody tr:nth-child(odd) td {
        background: #f8fafc;
      }
      .footer {
        margin-top: 18px;
        padding-top: 12px;
        border-top: 1px solid var(--line);
        color: #94a3b8;
        font-size: 10px;
        text-align: center;
      }
      .avoid-break {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    </style>
  </head>
  <body>
    <div class="report">
      <header class="hero avoid-break">
        <div class="eyebrow">AURELIANFLO DOSSIER</div>
        <h1>${title}</h1>
        ${metadata.subtitle ? `<div class="subtitle">${escapeHtml(String(metadata.subtitle))}</div>` : ""}
        ${metaLine ? `<div class="meta">${metaLine}</div>` : ""}
      </header>
      <main>
        ${metricsHtml}
        ${summaryHtml}
        ${tables.map((table) => buildReportTableHtml(table)).join("")}
        ${sections.map((section) => buildReportSectionHtml(section)).join("")}
        <div class="footer">Generated by AurelianFlo</div>
      </main>
    </div>
  </body>
</html>`;
}

async function generateHtmlPdfBuffer(payload = {}) {
  const html = String(payload.html || payload.content || "");
  const markdown = htmlToMarkdownLike(html);
  return generateMarkdownPdfBuffer({
    ...payload,
    markdown,
  });
}

function toChromiumPageFormat(value) {
  const normalized = String(value || "LETTER").trim().toUpperCase();
  if (normalized === "LETTER") return "Letter";
  if (normalized === "LEGAL") return "Legal";
  if (normalized === "TABLOID") return "Tabloid";
  if (normalized === "A3") return "A3";
  if (normalized === "A4") return "A4";
  return "Letter";
}

function buildChromiumPdfOptions(payload = {}) {
  const margins = payload.margins && typeof payload.margins === "object" ? payload.margins : {};
  return {
    format: toChromiumPageFormat(payload.pageSize),
    printBackground: payload.printBackground !== false,
    preferCSSPageSize: payload.preferCSSPageSize !== false,
    margin: {
      top: String(margins.top || "0.5in"),
      right: String(margins.right || "0.5in"),
      bottom: String(margins.bottom || "0.5in"),
      left: String(margins.left || "0.5in"),
    },
  };
}

function createPlaywrightChromiumAdapter(chromium) {
  if (!chromium || typeof chromium.launch !== "function") {
    return null;
  }
  return {
    engine: "chromium",
    async renderHtmlToPdfBuffer({ html, pdfOptions, launchOptions }) {
      const browser = await chromium.launch({
        headless: true,
        ...(launchOptions && typeof launchOptions === "object" ? launchOptions : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(String(html || ""), { waitUntil: "networkidle" });
        const bytes = await page.pdf(pdfOptions);
        return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
      } finally {
        await browser.close();
      }
    },
  };
}

function createManagedPlaywrightChromiumAdapter(playwright, chromiumRuntime, options = {}) {
  const chromium = playwright && playwright.chromium;
  if (!chromium || typeof chromium.launch !== "function") {
    return null;
  }

  const runtime = chromiumRuntime && typeof chromiumRuntime === "object"
    ? (chromiumRuntime.default || chromiumRuntime)
    : chromiumRuntime;

  if (!runtime || typeof runtime.executablePath !== "function") {
    return null;
  }

  return {
    engine: "chromium",
    async renderHtmlToPdfBuffer({ html, pdfOptions, launchOptions }) {
      const executablePath = await runtime.executablePath(options.packLocation);
      const browser = await chromium.launch({
        headless: true,
        executablePath,
        args: Array.isArray(runtime.args) ? runtime.args : undefined,
        ...(launchOptions && typeof launchOptions === "object" ? launchOptions : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(String(html || ""), { waitUntil: "networkidle" });
        const bytes = await page.pdf(pdfOptions);
        return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
      } finally {
        await browser.close();
      }
    },
  };
}

function resolveChromiumPackLocation(runtime) {
  if (!runtime || !["object", "function"].includes(typeof runtime)) {
    return undefined;
  }

  if (!/chromium-min/i.test(String(runtime.packageName || ""))) {
    return undefined;
  }

  return process.env.CHROMIUM_PACK_URL
    || "https://github.com/Sparticuz/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.x64.tar";
}

function createPuppeteerChromiumAdapter(puppeteer) {
  if (!puppeteer || typeof puppeteer.launch !== "function") {
    return null;
  }
  return {
    engine: "chromium",
    async renderHtmlToPdfBuffer({ html, pdfOptions, launchOptions }) {
      const browser = await puppeteer.launch({
        headless: "new",
        ...(launchOptions && typeof launchOptions === "object" ? launchOptions : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(String(html || ""), { waitUntil: "networkidle0" });
        const bytes = await page.pdf(pdfOptions);
        return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
      } finally {
        await browser.close();
      }
    },
  };
}

function loadRuntimeChromiumAdapter() {
  const playwrightAdapter = createPlaywrightChromiumAdapter(OPTIONAL_PLAYWRIGHT && OPTIONAL_PLAYWRIGHT.chromium);
  if (playwrightAdapter) {
    return playwrightAdapter;
  }

  const managedPlaywrightAdapter = createManagedPlaywrightChromiumAdapter(
    OPTIONAL_PLAYWRIGHT_CORE,
    OPTIONAL_SPARTICUZ_CHROMIUM,
  );
  if (managedPlaywrightAdapter) {
    return managedPlaywrightAdapter;
  }

  const minManagedPlaywrightAdapter = createManagedPlaywrightChromiumAdapter(
    OPTIONAL_PLAYWRIGHT_CORE,
    OPTIONAL_SPARTICUZ_CHROMIUM_MIN,
    {
      packLocation: resolveChromiumPackLocation(OPTIONAL_SPARTICUZ_CHROMIUM_MIN),
    },
  );
  if (minManagedPlaywrightAdapter) {
    return minManagedPlaywrightAdapter;
  }

  const puppeteerAdapter = createPuppeteerChromiumAdapter(OPTIONAL_PUPPETEER);
  if (puppeteerAdapter) {
    return puppeteerAdapter;
  }

  return null;
}

async function generateChromiumHtmlPdfBuffer(payload = {}, runtime = {}) {
  const html = String(payload.html || payload.content || "");
  const hasExplicitAdapter = runtime && Object.prototype.hasOwnProperty.call(runtime, "chromiumAdapter");
  const adapter = hasExplicitAdapter
    ? runtime.chromiumAdapter
    : runtime && runtime.disableRuntimeChromium
      ? null
      : loadRuntimeChromiumAdapter();

  if (adapter && typeof adapter.renderHtmlToPdfBuffer === "function") {
    try {
      const bytes = await adapter.renderHtmlToPdfBuffer({
        html,
        payload,
        pdfOptions: buildChromiumPdfOptions(payload),
        launchOptions: payload.chromiumLaunchOptions,
      });
      return {
        buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || ""),
        fileName: "document.pdf",
        engine: adapter.engine || "chromium",
      };
    } catch (error) {
      // If Chromium is installed but cannot launch in the current runtime,
      // keep the max-fidelity route usable by degrading to the semantic lane.
      const fallback = await generateHtmlPdfBuffer(payload);
      return {
        ...fallback,
        engine: "semantic",
        degradationReason: error && error.message ? String(error.message) : "chromium launch failed",
      };
    }
  }

  const fallback = await generateHtmlPdfBuffer(payload);
  return {
    ...fallback,
    engine: "semantic",
    degradationReason: adapter ? "chromium adapter unavailable" : "chromium adapter unavailable",
  };
}

async function generateLegacyReportPdfBuffer(payload = {}) {
  const title = String(payload.title || "Structured Report");
  const executiveSummary = Array.isArray(payload.executiveSummary) ? payload.executiveSummary : [];
  const headlineMetrics = Array.isArray(payload.headlineMetrics) ? payload.headlineMetrics : [];
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};

  const document = new PDFDocument({ size: "LETTER", margin: 54 });
  const result = collectPdf(document, `${sanitizeFileName(title, "structured-report")}.pdf`);

  if (String(metadata.report_type || "").trim().toLowerCase() === "ofac-wallet-screening") {
    renderOfacWalletScreeningPdf(document, payload);
    document.fontSize(8).font("Helvetica").fillColor("#94a3b8").text(
      "Generated by AurelianFlo",
      54,
      730,
      { width: 504, align: "center" },
    );
    document.end();
    return result;
  }

  document.rect(0, 0, 612, 120).fill("#0f172a");
  document.fontSize(24).font("Helvetica-Bold").fillColor("#ffffff").text(title, 54, 42, {
    width: 504,
  });
  if (metadata.subtitle) {
    document.fontSize(11).font("Helvetica").fillColor("#cbd5e1").text(String(metadata.subtitle), 54, 72, {
      width: 504,
    });
  }
  const metaLine = [
    metadata.report_type ? `Type: ${metadata.report_type}` : null,
    metadata.author ? `Author: ${metadata.author}` : null,
    metadata.date ? `Date: ${metadata.date}` : null,
    metadata.version ? `Version: ${metadata.version}` : null,
  ].filter(Boolean).join("  |  ");
  if (metaLine) {
    document.fontSize(10).font("Helvetica").fillColor("#cbd5e1").text(metaLine, 54, metadata.subtitle ? 92 : 80, {
      width: 504,
    });
  }
  document.y = 145;

  if (headlineMetrics.length > 0) {
    const cards = headlineMetrics.slice(0, 3);
    const cardWidth = 156;
    const gap = 16;
    const cardY = document.y;
    cards.forEach((metric, index) => {
      const x = 54 + index * (cardWidth + gap);
      document.roundedRect(x, cardY, cardWidth, 62, 8).fill(index === 0 ? "#eff6ff" : "#f8fafc");
      document.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text(String(metric.label || "").toUpperCase(), x + 12, cardY + 10, {
        width: cardWidth - 24,
      });
      document.fontSize(18).font("Helvetica-Bold").fillColor("#0f172a").text(String(metric.value == null ? "" : metric.value), x + 12, cardY + 24, {
        width: cardWidth - 24,
      });
      if (metric.unit) {
        document.fontSize(8).font("Helvetica").fillColor("#475569").text(String(metric.unit), x + 12, cardY + 46, {
          width: cardWidth - 24,
        });
      }
    });
    document.y = cardY + 80;
  }

  if (executiveSummary.length > 0) {
    document.fontSize(14).font("Helvetica-Bold").fillColor("#0f172a").text("Executive Summary");
    document.moveDown(0.2);
    executiveSummary.forEach((entry) => {
      const startY = document.y;
      document.fontSize(10).font("Helvetica").fillColor("#334155").text(String(entry), 72, startY, {
        width: 470,
        lineGap: 2,
      });
      document.fontSize(10).font("Helvetica-Bold").fillColor("#2563eb").text("•", 58, startY);
      document.moveDown(0.35);
    });
    document.moveDown(0.6);
  }

  for (const table of tables) {
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    if (rows.length === 0 || columns.length === 0) {
      continue;
    }

    if (document.y > 640) {
      document.addPage();
    }

    document.fontSize(13).font("Helvetica-Bold").fillColor("#2563eb").text(String(table.heading || "Section"));
    document.moveDown(0.25);

    renderLegacyPdfTable(document, {
      headers: columns,
      rows,
      x: 54,
      width: 500,
      headerColor: "#2563eb",
      rowStripeColor: "#f8fafc",
    });
  }

  for (const section of sections) {
    const normalizedSection = section && typeof section === "object" ? section : {};
    const heading = String(normalizedSection.heading || normalizedSection.title || "Section");
    const body = String(normalizedSection.body || normalizedSection.text || "").trim();
    const bullets = Array.isArray(normalizedSection.bullets) ? normalizedSection.bullets : [];
    const rows = Array.isArray(normalizedSection.table) ? normalizedSection.table : [];

    if (document.y > 640) {
      document.addPage();
    }

    document.fontSize(13).font("Helvetica-Bold").fillColor("#2563eb").text(heading);
    document.moveDown(0.25);

    if (body) {
      document.fontSize(10).font("Helvetica").fillColor("#334155").text(body, {
        width: 500,
        lineGap: 2,
      });
      document.moveDown(0.45);
    }

    for (const bullet of bullets) {
      const startY = document.y;
      document.fontSize(10).font("Helvetica").fillColor("#334155").text(String(bullet), 72, startY, {
        width: 470,
        lineGap: 2,
      });
      document.fontSize(10).font("Helvetica-Bold").fillColor("#2563eb").text("•", 58, startY);
      document.moveDown(0.25);
    }

    if (rows.length > 0) {
      const columns = Array.from(
        rows.reduce((set, row) => {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            Object.keys(row).forEach((key) => set.add(key));
          }
          return set;
        }, new Set()),
      ).slice(0, 4);

      if (columns.length > 0) {
        renderLegacyPdfTable(document, {
          headers: columns,
          rows,
          x: 54,
          width: 500,
          headerColor: "#2563eb",
          rowStripeColor: "#f8fafc",
        });
      }
    } else {
      document.moveDown(0.45);
    }
  }

  document.fontSize(8).font("Helvetica").fillColor("#94a3b8").text(
    "Generated by AurelianFlo",
    54,
    730,
    { width: 504, align: "center" },
  );
  document.end();

  return result;
}

function renderAsciiBulletList(document, items, options = {}) {
  const bulletX = options.bulletX || 58;
  const textX = options.textX || 76;
  const width = options.width || 468;
  const color = options.color || "#334155";
  const bulletColor = options.bulletColor || "#2563eb";
  const lineGap = options.lineGap ?? 3;

  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item || "").trim();
    if (!text) {
      continue;
    }
    const height = measureTextHeight(document, text, {
      font: "Helvetica",
      fontSize: 10.5,
      width,
      lineGap,
    });
    ensureSpaceFor(document, height + 12);
    const startY = document.y;
    document.fontSize(10.5).font("Helvetica").fillColor(color).text(text, textX, startY, {
      width,
      lineGap,
    });
    document.fontSize(11).font("Helvetica-Bold").fillColor(bulletColor).text("-", bulletX, startY + 1);
    document.y = startY + height + 8;
  }
}

function renderMetricCards(document, metrics, options = {}) {
  const cards = (Array.isArray(metrics) ? metrics : []).filter((metric) => metric && metric.label).slice(0, 3);
  if (cards.length === 0) {
    return;
  }

  const x = options.x || 54;
  const y = options.y || document.y;
  const width = options.width || 504;
  const gap = options.gap || 16;
  const cardWidth = (width - gap * (cards.length - 1)) / cards.length;
  const cardHeight = cards.reduce((largest, metric) => {
    const label = String(metric.label || "").toUpperCase();
    const value = String(metric.value == null ? "" : metric.value);
    const valueFontSize = value.length > 16 ? 16 : 20;
    const candidate = 24
      + measureTextHeight(document, label, {
        font: "Helvetica-Bold",
        fontSize: 8,
        width: cardWidth - 24,
        lineGap: 1,
      })
      + measureTextHeight(document, value, {
        font: "Helvetica-Bold",
        fontSize: valueFontSize,
        width: cardWidth - 24,
        lineGap: 1,
      })
      + (metric.unit
        ? measureTextHeight(document, String(metric.unit), {
          font: "Helvetica",
          fontSize: 8,
          width: cardWidth - 24,
          lineGap: 1,
        })
        : 0)
      + 10;
    return Math.max(largest, Math.max(78, candidate));
  }, 78);

  ensureSpaceFor(document, cardHeight + 18);

  cards.forEach((metric, index) => {
    const cardX = x + index * (cardWidth + gap);
    const label = String(metric.label || "").toUpperCase();
    const value = String(metric.value == null ? "" : metric.value);
    const valueFontSize = value.length > 16 ? 16 : 20;
    const background = index === 0 ? "#f4efe3" : "#f8fafc";
    const border = index === 0 ? "#d4af37" : "#d8dee8";

    document.roundedRect(cardX, y, cardWidth, cardHeight, 10).fill(background);
    document.roundedRect(cardX, y, cardWidth, cardHeight, 10).lineWidth(1).strokeColor(border).stroke();
    document.fontSize(8).font("Helvetica-Bold").fillColor(index === 0 ? "#8a6a16" : "#64748b").text(label, cardX + 12, y + 12, {
      width: cardWidth - 24,
      lineGap: 1,
    });

    const labelHeight = measureTextHeight(document, label, {
      font: "Helvetica-Bold",
      fontSize: 8,
      width: cardWidth - 24,
      lineGap: 1,
    });
    const valueY = y + 16 + labelHeight;
    document.fontSize(valueFontSize).font("Helvetica-Bold").fillColor(index === 0 ? "#121a2f" : "#0f172a").text(value, cardX + 12, valueY, {
      width: cardWidth - 24,
      lineGap: 1,
    });

    if (metric.unit) {
      const valueHeight = measureTextHeight(document, value, {
        font: "Helvetica-Bold",
        fontSize: valueFontSize,
        width: cardWidth - 24,
        lineGap: 1,
      });
      document.fontSize(8).font("Helvetica").fillColor(index === 0 ? "#6f5a1d" : "#475569").text(String(metric.unit), cardX + 12, valueY + valueHeight + 6, {
        width: cardWidth - 24,
      });
    }
  });

  document.y = y + cardHeight + 18;
}

function renderPdfTable(document, options = {}) {
  const headers = Array.isArray(options.headers) ? options.headers.filter(Boolean).slice(0, 5) : [];
  const rows = Array.isArray(options.rows) ? options.rows.slice(0, options.maxRows || 24) : [];
  if (headers.length === 0 || rows.length === 0) {
    return;
  }

  const x = options.x || 54;
  const width = options.width || 500;
  const headerHeight = options.headerHeight || 22;
  const minimumRowHeight = options.rowHeight || 20;
  const columnWidth = width / headers.length;

  const drawHeader = (top) => {
    document.rect(x, top, width, headerHeight).fill(options.headerColor || "#2563eb");
    headers.forEach((header, index) => {
      document.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff").text(
        String(header),
        x + 8 + index * columnWidth,
        top + 6,
        { width: columnWidth - 16, ellipsis: true },
      );
    });
  };

  ensureSpaceFor(document, headerHeight + minimumRowHeight * Math.min(rows.length + 1, 8) + 20);
  let y = document.y;
  drawHeader(y);
  y += headerHeight;

  rows.forEach((row, rowIndex) => {
    const values = headers.map((header) => {
      const value = row && typeof row === "object" ? row[header] : "";
      return value == null ? "" : String(value);
    });
    const rowHeight = values.reduce((largest, value) => {
      return Math.max(
        largest,
        measureTextHeight(document, value, {
          font: "Helvetica",
          fontSize: options.fontSize || 8.5,
          width: columnWidth - 16,
          lineGap: 1,
        }) + 10,
      );
    }, minimumRowHeight);

    if (y + rowHeight + 20 > 720) {
      document.addPage();
      y = document.y;
      drawHeader(y);
      y += headerHeight;
    }

    if (rowIndex % 2 === 0) {
      document.rect(x, y, width, rowHeight).fill(options.rowStripeColor || "#f8fafc");
    }

    values.forEach((value, index) => {
      document.fontSize(options.fontSize || 8.5).font("Helvetica").fillColor(options.textColor || "#334155").text(
        value,
        x + 8 + index * columnWidth,
        y + 5,
        { width: columnWidth - 16, lineGap: 1 },
      );
    });
    document.y = y;
    y += rowHeight;
  });

  document.y = y + 14;
}

function generateReportPdfBuffer(payload = {}) {
  const title = String(payload.title || "Structured Report");
  const executiveSummary = Array.isArray(payload.executiveSummary) ? payload.executiveSummary : [];
  const headlineMetrics = Array.isArray(payload.headlineMetrics) ? payload.headlineMetrics : [];
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const reportType = String(metadata.report_type || "").trim().toLowerCase();

  const document = new PDFDocument({ size: "LETTER", margin: 54 });
  const result = collectPdf(document, `${sanitizeFileName(title, "structured-report")}.pdf`);

  if (reportType === "ofac-wallet-screening") {
    renderOfacWalletScreeningPdf(document, payload);
    document.fontSize(8).font("Helvetica").fillColor("#94a3b8").text(
      "Generated by AurelianFlo",
      54,
      730,
      { width: 504, align: "center" },
    );
    document.end();
    return result;
  }

  if (reportType === "enhanced-due-diligence" || reportType === "edd-memo") {
    return generateLegacyReportPdfBuffer(payload);
  }

  return generateChromiumHtmlPdfBuffer({
    title,
    html: buildBrandedReportHtml(payload),
    pageSize: "LETTER",
    printBackground: true,
    preferCSSPageSize: true,
  }).then((rendered) => ({
    ...rendered,
    fileName: `${sanitizeFileName(title, "structured-report")}.pdf`,
    engine: rendered.engine || "chromium",
  }));
}

module.exports = {
  htmlToMarkdownLike,
  generateContractPdfBuffer,
  generateProposalPdfBuffer,
  generateHtmlPdfBuffer,
  generateChromiumHtmlPdfBuffer,
  generateMarkdownPdfBuffer,
  generateReportPdfBuffer,
  resolveChromiumPackLocation,
};
