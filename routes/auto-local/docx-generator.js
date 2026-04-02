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

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "document")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-") || fallback
  );
}

function readSections(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
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
  const title = String(payload.title || "Untitled Document");
  const template = String(payload.template || "general").toLowerCase();
  const sections = readSections(payload.sections);
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
              text: [company.address, company.email, company.phone].filter(Boolean).join(" • "),
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
    children = buildReport(title, sections, metadata);
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
                    text: `Generated by Meridian Doc-Gen • ${new Date().toISOString().slice(0, 10)}`,
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

module.exports = {
  generateDocxBuffer,
};
