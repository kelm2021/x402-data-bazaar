const {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

function readString(value, fallback = "") {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "document")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-") || fallback
  );
}

function decodeHtmlEntities(value) {
  return readString(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function normalizePlainText(value) {
  return decodeHtmlEntities(readString(value))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSection(section) {
  if (typeof section === "string") {
    const body = normalizePlainText(section);
    return body ? { body } : null;
  }

  if (!section || typeof section !== "object") {
    return null;
  }

  const heading = normalizePlainText(section.heading);
  const body = normalizePlainText(section.body);
  const bullets = Array.isArray(section.bullets)
    ? section.bullets.map((entry) => normalizePlainText(entry)).filter(Boolean)
    : [];
  const table = Array.isArray(section.table)
    ? section.table.filter((entry) => entry && typeof entry === "object")
    : [];

  if (!heading && !body && bullets.length === 0 && table.length === 0) {
    return null;
  }

  return {
    ...(heading ? { heading } : {}),
    ...(body ? { body } : {}),
    ...(bullets.length > 0 ? { bullets } : {}),
    ...(table.length > 0 ? { table } : {}),
  };
}

function readSections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const sections = [];
  for (const entry of value) {
    const normalized = normalizeSection(entry);
    if (normalized) {
      sections.push(normalized);
    }
  }
  return sections;
}

function htmlToPlainText(html) {
  const withLineBreaks = readString(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|section|article|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return normalizePlainText(withLineBreaks);
}

function markdownToPlainText(markdown) {
  const source = normalizePlainText(markdown);
  if (!source) {
    return "";
  }

  return source
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linesToSection(lines, heading) {
  if (!Array.isArray(lines)) {
    return null;
  }
  const normalizedLines = lines.map((line) => normalizePlainText(line)).filter(Boolean);
  if (normalizedLines.length === 0) {
    return null;
  }
  return {
    ...(heading ? { heading } : {}),
    body: normalizedLines.join("\n"),
  };
}

function inferSectionsFromSimpleInputs(payload) {
  const sections = [];
  const format = readString(payload.format).toLowerCase();
  const content = normalizePlainText(payload.content);
  const markdown = normalizePlainText(payload.markdown);
  const html = normalizePlainText(payload.html);
  const text = normalizePlainText(payload.text || payload.note || payload.summary);

  if (markdown) {
    sections.push({ heading: "Content", body: markdownToPlainText(markdown) });
  }

  if (html) {
    sections.push({ heading: "Content", body: htmlToPlainText(html) });
  }

  if (content) {
    if (format === "html") {
      sections.push({ heading: "Content", body: htmlToPlainText(content) });
    } else if (format === "markdown" || format === "md") {
      sections.push({ heading: "Content", body: markdownToPlainText(content) });
    } else {
      sections.push({ heading: "Content", body: content });
    }
  }

  if (text) {
    sections.push({ heading: "Summary", body: text });
  }

  const linesSection = linesToSection(payload.lines, "Details");
  if (linesSection) {
    sections.push(linesSection);
  }

  return sections;
}

function resolveTemplate(value, fallback = "general") {
  const template = readString(value, fallback).toLowerCase().trim();
  if (!template) {
    return fallback;
  }

  if (template === "premium-report" || template === "report-premium") {
    return "report";
  }
  if (template === "premium-simple" || template === "simple") {
    return "general";
  }
  if (template === "template" || template === "max-fidelity") {
    return "nda";
  }
  return template;
}

function normalizeDocxPayload(payload = {}, options = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const template = resolveTemplate(
    options.template || body.template || (options.mode === "report" ? "report" : "general"),
  );
  const sections = readSections(body.sections);
  const inferredSections = inferSectionsFromSimpleInputs(body);

  return {
    ...body,
    title: readString(body.title || "Untitled Document"),
    template,
    sections: sections.length > 0 ? sections : inferredSections,
  };
}

function buildNda(title, parties = {}, sections = [], company = {}) {
  const partyA = parties.party_a || { name: "Party A" };
  const partyB = parties.party_b || { name: "Party B" };
  const effectiveDate = parties.effective_date || new Date().toISOString().slice(0, 10);
  const duration = parties.duration || "2 years";

  const children = [
    new Paragraph({
      text: title || "NON-DISCLOSURE AGREEMENT",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "This Non-Disclosure Agreement (\"Agreement\") is entered into as of " }),
        new TextRun({ text: effectiveDate, bold: true }),
        new TextRun({ text: " by and between:" }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "Disclosing Party: ", bold: true }),
        new TextRun({ text: String(partyA.name || "Party A") }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "Receiving Party: ", bold: true }),
        new TextRun({ text: String(partyB.name || "Party B") }),
      ],
    }),
  ];

  const clauses = [
    {
      heading: "1. Definition of Confidential Information",
      body:
        "\"Confidential Information\" means non-public technical, business, financial, and operational information disclosed by one party to the other.",
    },
    {
      heading: "2. Obligations of the Receiving Party",
      body:
        "The Receiving Party will hold Confidential Information in confidence, avoid unauthorized disclosure, and use it only for the permitted business purpose.",
    },
    {
      heading: "3. Exclusions from Confidential Information",
      body:
        "The confidentiality obligations do not apply to information that is public, previously known, independently developed, or lawfully received from a third party.",
    },
    {
      heading: "4. Term and Duration",
      body: `This Agreement remains in effect for ${duration} from the Effective Date unless earlier terminated in writing.`,
    },
    {
      heading: "5. Return of Materials",
      body:
        "Upon request, the Receiving Party will return or destroy copies of Confidential Information in its possession.",
    },
    {
      heading: "6. Remedies",
      body:
        "Each party acknowledges that unauthorized disclosure may cause irreparable harm and that equitable relief may be appropriate.",
    },
    {
      heading: "7. Governing Law",
      body: `This Agreement is governed by the laws of the State of ${company.state || "Delaware"}.`,
    },
  ];

  const customClauses = sections.map((section, index) => ({
    heading: `${clauses.length + index + 1}. ${section.heading || `Additional Section ${index + 1}`}`,
    body: String(section.body || ""),
  }));

  for (const clause of [...clauses, ...customClauses]) {
    children.push(
      new Paragraph({
        text: clause.heading,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      }),
      new Paragraph({ text: clause.body, spacing: { after: 200 } }),
    );
  }

  children.push(
    new Paragraph({ text: "", spacing: { before: 500 } }),
    new Paragraph({
      text: "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.",
      spacing: { after: 300 },
    }),
  );

  for (const party of [partyA, partyB]) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "________________________________", color: "999999" })],
        spacing: { before: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: String(party.name || ""), bold: true })],
      }),
      new Paragraph({
        children: [new TextRun({ text: "Date: ________________", color: "999999" })],
        spacing: { after: 150 },
      }),
    );
  }

  return children;
}

function buildReport(title, sections = [], metadata = {}) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 100 } }),
  ];

  const metaParts = [];
  if (metadata.author) metaParts.push(`Author: ${metadata.author}`);
  if (metadata.date) metaParts.push(`Date: ${metadata.date}`);
  if (metadata.version) metaParts.push(`Version: ${metadata.version}`);

  if (metaParts.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaParts.join(" | "), italics: true, color: "888888", size: 18 })],
        spacing: { after: 300 },
      }),
    );
  }

  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
        }),
      );
    }

    if (Array.isArray(section.bullets)) {
      for (const bullet of section.bullets) {
        children.push(
          new Paragraph({
            text: String(bullet),
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
      }
    }

    if (section.body) {
      for (const paragraph of String(section.body).split("\n").filter(Boolean)) {
        children.push(new Paragraph({ text: paragraph, spacing: { after: 120 } }));
      }
    }

    if (Array.isArray(section.table) && section.table.length > 0) {
      const headers = Object.keys(section.table[0]);
      const rows = [
        new TableRow({
          tableHeader: true,
          children: headers.map((header) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: header, bold: true, color: "FFFFFF", size: 18 })],
                }),
              ],
              shading: { fill: "2563EB", type: ShadingType.SOLID },
              width: { size: Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
            }),
          ),
        }),
        ...section.table.map((row, index) =>
          new TableRow({
            children: headers.map((header) =>
              new TableCell({
                children: [new Paragraph({ text: String(row[header] ?? ""), spacing: { after: 40 } })],
                shading: index % 2 === 0 ? { fill: "F8FAFC", type: ShadingType.SOLID } : undefined,
                width: { size: Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
              }),
            ),
          }),
        ),
      ];

      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
  }

  return children;
}

function normalizeHeadingKey(value) {
  return readString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function getSectionByHeading(sections, heading) {
  const target = normalizeHeadingKey(heading);
  return (Array.isArray(sections) ? sections : []).find(
    (section) => normalizeHeadingKey(section && section.heading) === target,
  ) || null;
}

function toBooleanLabel(value) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  const normalized = readString(value).trim().toLowerCase();
  if (normalized === "true") return "Yes";
  if (normalized === "false") return "No";
  return readString(value);
}

function chunkLongText(value, chunkSize = 20) {
  const text = readString(value).trim();
  if (!text || /\s/.test(text) || text.length <= chunkSize) {
    return text;
  }

  const parts = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    parts.push(text.slice(index, index + chunkSize));
  }
  return parts.join("\n");
}

function pushBodyParagraphs(children, value, options = {}) {
  const text = readString(value).trim();
  if (!text) {
    return;
  }

  const paragraphs = text.split("\n").filter(Boolean);
  for (const paragraph of paragraphs) {
    children.push(new Paragraph({
      text: paragraph,
      spacing: { after: options.after ?? 80 },
      style: options.style,
    }));
  }
}

function pushLabelValueBlock(children, label, value, options = {}) {
  const text = readString(value).trim();
  if (!text) {
    return;
  }

  children.push(
    new Paragraph({
      text: readString(label),
      heading: options.headingLevel || HeadingLevel.HEADING_3,
      spacing: { before: options.before ?? 200, after: 60 },
    }),
  );
  pushBodyParagraphs(children, text, { after: options.after ?? 100 });
}

function buildOfacWalletScreeningReport(title, sections = [], metadata = {}) {
  const executiveSummarySection = getSectionByHeading(sections, "Executive Summary") || {};
  const headlineMetricsSection = getSectionByHeading(sections, "Headline Metrics") || {};
  const querySection = getSectionByHeading(sections, "Wallet Screening Query") || {};
  const matchesSection = getSectionByHeading(sections, "Wallet Screening Matches") || {};
  const freshnessSection = getSectionByHeading(sections, "Source Freshness") || {};

  const metrics = Array.isArray(headlineMetricsSection.table) ? headlineMetricsSection.table : [];
  const queryRow = Array.isArray(querySection.table) ? querySection.table[0] || {} : {};
  const matchRow = Array.isArray(matchesSection.table) ? matchesSection.table[0] || {} : {};
  const freshnessRow = Array.isArray(freshnessSection.table) ? freshnessSection.table[0] || {} : {};

  const screeningStatus = readString(
    metrics.find((entry) => normalizeHeadingKey(entry.label) === "screening status")?.value
      || queryRow.status
      || "unknown",
  );
  const matchCount = readString(
    metrics.find((entry) => normalizeHeadingKey(entry.label) === "match count")?.value
      || (Array.isArray(matchesSection.table) ? matchesSection.table.length : 0),
  );
  const manualReview = toBooleanLabel(
    metrics.find((entry) => normalizeHeadingKey(entry.label) === "manual review recommended")?.value
      ?? queryRow.manual_review_recommended,
  );
  const primaryEntity = readString(matchRow.entity_name || "").trim();
  const isMatch = screeningStatus.trim().toLowerCase() === "match";
  const disposition = isMatch ? "Match" : "Clear";
  const decisionNote = isMatch
    ? `Exact OFAC digital currency designation found. ${matchCount} designation${matchCount === "1" ? "" : "s"} matched.${primaryEntity ? ` Primary entity: ${primaryEntity}.` : ""}`
    : "No exact OFAC wallet designation found in the current Treasury dataset.";

  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 100 } }),
  ];

  const metaParts = [];
  if (metadata.author) metaParts.push(`Author: ${metadata.author}`);
  if (metadata.date) metaParts.push(`Date: ${metadata.date}`);
  if (metadata.version) metaParts.push(`Version: ${metadata.version}`);

  if (metaParts.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaParts.join(" | "), italics: true, color: "888888", size: 18 })],
        spacing: { after: 260 },
      }),
    );
  }

  children.push(
    new Paragraph({
      text: "Screening Decision",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 120 },
    }),
  );
  pushLabelValueBlock(children, "Disposition", disposition, { before: 0 });
  pushBodyParagraphs(children, decisionNote, { after: 120 });
  pushLabelValueBlock(children, "Manual Review", manualReview, { before: 120 });
  pushBodyParagraphs(
    children,
    isMatch
      ? "Do not release or route funds until a compliance reviewer clears the address."
      : "No exact OFAC wallet hit found. Preserve this memo for audit support.",
    { after: 140 },
  );

  children.push(
    new Paragraph({
      text: "Wallet Reviewed",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 120 },
    }),
  );
  pushLabelValueBlock(children, "Submitted Address", chunkLongText(queryRow.address), { before: 0 });
  pushLabelValueBlock(children, "Normalized Address", chunkLongText(queryRow.normalized_address), { before: 120 });
  pushLabelValueBlock(children, "Asset Filter", readString(queryRow.asset_filter || "All"), { before: 120 });

  if (Array.isArray(executiveSummarySection.bullets) && executiveSummarySection.bullets.length > 0) {
    children.push(
      new Paragraph({
        text: "Executive Summary",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 120 },
      }),
    );
    for (const bullet of executiveSummarySection.bullets) {
      children.push(
        new Paragraph({
          text: readString(bullet),
          bullet: { level: 0 },
          spacing: { after: 60 },
        }),
      );
    }
  }

  children.push(
    new Paragraph({
      text: "Sanctions Match",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 180, after: 120 },
    }),
  );
  pushLabelValueBlock(children, "Entity", readString(matchRow.entity_name || "No designation found"), { before: 0 });
  pushLabelValueBlock(children, "Asset", readString(matchRow.asset || queryRow.asset_filter || ""), { before: 120 });
  pushLabelValueBlock(children, "Programs", readString(matchRow.programs || ""), { before: 120 });
  pushLabelValueBlock(children, "List", readString(matchRow.list_name || ""), { before: 120 });
  pushLabelValueBlock(children, "Listed On", readString(matchRow.listed_on || ""), { before: 120 });
  pushLabelValueBlock(children, "Sanctioned Address", chunkLongText(matchRow.sanctioned_address || ""), { before: 120 });

  children.push(
    new Paragraph({
      text: "Dataset Freshness",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 180, after: 120 },
    }),
  );
  pushLabelValueBlock(children, "Source URL", readString(freshnessRow.source_url || ""), { before: 0 });
  pushLabelValueBlock(children, "Refreshed At", readString(freshnessRow.refreshed_at || ""), { before: 120 });
  pushLabelValueBlock(children, "Dataset Published", readString(freshnessRow.dataset_published_at || ""), { before: 120 });
  pushLabelValueBlock(children, "Address Count", readString(freshnessRow.address_count || ""), { before: 120 });
  if (freshnessRow.covered_assets) {
    pushLabelValueBlock(children, "Covered Assets", readString(freshnessRow.covered_assets), { before: 120 });
  }

  return children;
}

function buildLetter(title, sections = [], company = {}, parties = {}) {
  const recipient = parties.recipient || {};
  const sender = parties.sender || company || {};
  const date = parties.date || new Date().toISOString().slice(0, 10);

  const children = [
    new Paragraph({ text: date, alignment: AlignmentType.RIGHT, spacing: { after: 400 } }),
  ];

  for (const value of [recipient.name, recipient.title, recipient.company, recipient.address]) {
    if (value) {
      children.push(new Paragraph({ text: String(value) }));
    }
  }

  children.push(
    new Paragraph({ text: "", spacing: { after: 250 } }),
    new Paragraph({
      text: `Dear ${recipient.name || "Sir/Madam"},`,
      spacing: { after: 200 },
    }),
  );

  if (title) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Re: ${title}`, bold: true, underline: {} })],
        spacing: { after: 200 },
      }),
    );
  }

  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
      );
    }
    if (section.body) {
      for (const paragraph of String(section.body).split("\n").filter(Boolean)) {
        children.push(new Paragraph({ text: paragraph, spacing: { after: 120 } }));
      }
    }
  }

  children.push(
    new Paragraph({ text: "", spacing: { after: 250 } }),
    new Paragraph({ text: "Sincerely,", spacing: { after: 300 } }),
    new Paragraph({ children: [new TextRun({ text: "________________________________", color: "999999" })] }),
    new Paragraph({ children: [new TextRun({ text: String(sender.name || "Sender Name"), bold: true })] }),
  );

  if (sender.title) {
    children.push(new Paragraph({ text: String(sender.title) }));
  }
  if (sender.company) {
    children.push(new Paragraph({ text: String(sender.company) }));
  }

  return children;
}

function buildGeneral(title, sections = []) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 300 } }),
  ];

  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
        }),
      );
    }
    if (section.body) {
      for (const paragraph of String(section.body).split("\n").filter(Boolean)) {
        children.push(new Paragraph({ text: paragraph, spacing: { after: 120 } }));
      }
    }
    if (Array.isArray(section.bullets)) {
      for (const bullet of section.bullets) {
        children.push(
          new Paragraph({
            text: String(bullet),
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
      }
    }
  }

  return children;
}

async function generateDocxBuffer(payload = {}) {
  const normalizedPayload = normalizeDocxPayload(payload);
  const title = normalizedPayload.title;
  const template = normalizedPayload.template;
  const sections = normalizedPayload.sections;
  const company = payload.company && typeof payload.company === "object" ? payload.company : {};
  const parties = payload.parties && typeof payload.parties === "object" ? payload.parties : {};
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const letterhead = payload.letterhead !== false;

  const headerChildren = letterhead
    ? [
        new Paragraph({
          children: [
            new TextRun({ text: String(company.name || "Company Name"), bold: true, size: 20, font: "Helvetica" }),
            new TextRun({ text: "  |  ", color: "AAAAAA", size: 18 }),
            new TextRun({ text: String(company.tagline || ""), italics: true, size: 18, color: "666666" }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: [company.address, company.email, company.phone].filter(Boolean).join(" | "),
              size: 16,
              color: "888888",
            }),
          ],
          spacing: { after: 200 },
        }),
      ]
    : [];

  let children;
  if (template === "nda") {
    children = buildNda(title, parties, sections, company);
  } else if (template === "report") {
    children = String(metadata.report_type || "").trim().toLowerCase() === "ofac-wallet-screening"
      ? buildOfacWalletScreeningReport(title, sections, metadata)
      : buildReport(title, sections, metadata);
  } else if (template === "letter") {
    children = buildLetter(title, sections, company, parties);
  } else {
    children = buildGeneral(title, sections);
  }

  const document = new Document({
    styles: {
      default: {
        document: { run: { size: 22, font: "Calibri" } },
        heading1: { run: { size: 32, bold: true, color: "2563EB", font: "Calibri" } },
        heading2: { run: { size: 26, bold: true, color: "1E40AF", font: "Calibri" } },
        heading3: { run: { size: 24, bold: true, color: "333333", font: "Calibri" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: letterhead ? { default: new Header({ children: headerChildren }) } : undefined,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 16, color: "AAAAAA" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "AAAAAA" }),
                  new TextRun({ text: " of ", size: 16, color: "AAAAAA" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "AAAAAA" }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `Generated by AurelianFlo | ${new Date().toISOString().slice(0, 10)}`,
                    size: 14,
                    color: "CCCCCC",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return {
    buffer: await Packer.toBuffer(document),
    fileName: `${sanitizeFileName(title, "document")}.docx`,
  };
}

async function generatePremiumReportDocxBuffer(payload = {}) {
  return generateDocxBuffer({
    ...payload,
    template: "report",
  });
}

async function generatePremiumSimpleDocxBuffer(payload = {}) {
  return generateDocxBuffer({
    ...payload,
    template: "general",
  });
}

async function generateTemplateDocxBuffer(payload = {}) {
  const template = resolveTemplate(payload.template, "");
  if (!template || template === "general") {
    throw new Error("template_docx requires a non-general template such as nda, letter, or report");
  }
  return generateDocxBuffer({
    ...payload,
    template,
  });
}

async function generateDocxFromTemplate(template, payload = {}) {
  return generateTemplateDocxBuffer({
    ...payload,
    template,
  });
}

module.exports = {
  generateDocxBuffer,
  generateDocxFromTemplate,
  generatePremiumReportDocxBuffer,
  generatePremiumSimpleDocxBuffer,
  generateTemplateDocxBuffer,
  normalizeDocxPayload,
};
