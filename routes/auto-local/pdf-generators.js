const PDFDocument = require("pdfkit");

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

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by Meridian Doc-Gen", 72, 720, { width: 468, align: "center" });
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

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by Meridian Doc-Gen", 60, 720, { width: 492, align: "center" });
  document.end();

  return result;
}

function renderInlineMarkdown(document, text, x, fontSize, color) {
  document.fontSize(fontSize).fillColor(color).font("Helvetica").text(String(text || ""), x, document.y, { width: 552 - x });
  return { height: fontSize };
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

  document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by Meridian Doc-Gen", 60, 720, { width: 492, align: "center" });
  document.end();

  return result;
}

module.exports = {
  generateContractPdfBuffer,
  generateProposalPdfBuffer,
  generateMarkdownPdfBuffer,
};
