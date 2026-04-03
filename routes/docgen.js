const { Router } = require("express");
const PDFDocument = require("pdfkit");
const docx = require("docx");
const ExcelJS = require("exceljs");

const router = Router();

// ─── Agent-friendly response helper ─────────────────────────────
// If caller sends Accept: application/json, return base64-wrapped JSON
// instead of raw binary. MCP tools and agent frameworks need this.
function sendDocumentResponse(res, req, buffer, { filename, mimeType }) {
  const wantsJson = (req.headers.accept || "").includes("application/json") ||
                    req.query.format === "json";
  if (wantsJson) {
    return res.json({
      type: "document",
      filename,
      mimeType,
      encoding: "base64",
      data: Buffer.from(buffer).toString("base64"),
      sizeBytes: buffer.length,
    });
  }
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

// ─── DOCX Generator ─────────────────────────────────────────────
router.post("/api/tools/docx/generate", async (req, res) => {
  const { template = "general", company = {}, title, subject, body, sections, parties, sender, recipient } = req.body || {};

  const doc = new docx.Document({
    sections: [{
      properties: {},
      children: buildDocxContent({ template, company, title, subject, body, sections, parties, sender, recipient }),
    }],
  });

  const buffer = await docx.Packer.toBuffer(doc);
  sendDocumentResponse(res, req, buffer, { filename: `${template}.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
});

function buildDocxContent({ template, company, title, subject, body, sections, parties, sender, recipient }) {
  const children = [];
  const heading = (text) => new docx.Paragraph({ children: [new docx.TextRun({ text, bold: true, size: 32 })], spacing: { after: 200 } });
  const para = (text) => new docx.Paragraph({ children: [new docx.TextRun({ text, size: 22 })], spacing: { after: 100 } });

  children.push(heading(title || company.name || "Document"));

  if (template === "nda" && parties) {
    children.push(para(`MUTUAL NON-DISCLOSURE AGREEMENT`));
    children.push(para(`Between ${parties.party_a?.name || "Party A"} (${parties.party_a?.company || ""}) and ${parties.party_b?.name || "Party B"} (${parties.party_b?.company || ""})`));
    children.push(para("1. Both parties agree to keep confidential information private."));
    children.push(para("2. This agreement is effective for 2 years from signing."));
    children.push(para("3. Neither party shall disclose without written consent."));
  } else if (template === "report" && sections) {
    for (const s of sections) {
      children.push(heading(s.title || "Section"));
      children.push(para(s.content || ""));
    }
  } else if (template === "letter") {
    if (sender) children.push(para(`From: ${sender.name || ""}, ${sender.title || ""}, ${sender.company || ""}`));
    if (recipient) children.push(para(`To: ${recipient.name || ""}, ${recipient.title || ""}, ${recipient.company || ""}`));
    children.push(para(subject ? `Re: ${subject}` : ""));
    children.push(para(body || ""));
  } else {
    children.push(para(body || subject || "Generated document content."));
  }

  return children;
}

// ─── XLSX Generator ─────────────────────────────────────────────
router.post("/api/tools/xlsx/generate", async (req, res) => {
  const { template = "general", company, client, items, rows, columns, title } = req.body || {};
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title || template);

  if (template === "invoice" && items) {
    sheet.columns = [
      { header: "Description", key: "description", width: 40 },
      { header: "Qty", key: "quantity", width: 10 },
      { header: "Price", key: "price", width: 15 },
      { header: "Total", key: "total", width: 15 },
    ];
    let subtotal = 0;
    for (const item of items) {
      const qty = item.quantity || 1;
      const price = item.price || 0;
      const total = qty * price;
      subtotal += total;
      sheet.addRow({ description: item.description || item.name || "Item", quantity: qty, price, total });
    }
    sheet.addRow({});
    sheet.addRow({ description: "Subtotal", total: subtotal });
  } else if (template === "tracker" && items) {
    sheet.columns = [
      { header: "Task", key: "task", width: 35 },
      { header: "Status", key: "status", width: 15 },
      { header: "Assignee", key: "assignee", width: 20 },
      { header: "Due Date", key: "due", width: 15 },
      { header: "Priority", key: "priority", width: 12 },
    ];
    for (const item of items) {
      sheet.addRow({
        task: item.task || item.name || item.description || "Task",
        status: item.status || "To Do",
        assignee: item.assignee || "",
        due: item.due || item.due_date || "",
        priority: item.priority || "Medium",
      });
    }
  } else if (template === "data" && (rows || items)) {
    const dataRows = rows || items;
    if (columns && columns.length > 0) {
      sheet.columns = columns.map(c => ({ header: c, key: c.toLowerCase().replace(/\s+/g, "_"), width: 20 }));
    } else if (dataRows.length > 0) {
      const keys = Object.keys(dataRows[0]);
      sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
    }
    for (const row of dataRows) sheet.addRow(row);
  } else if (rows && columns) {
    sheet.columns = columns.map(c => ({ header: c, key: c.toLowerCase().replace(/\s+/g, "_"), width: 20 }));
    for (const row of rows) sheet.addRow(row);
  } else if (items) {
    // General template with items array
    if (items.length > 0) {
      const keys = Object.keys(items[0]);
      sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
      for (const item of items) sheet.addRow(item);
    }
  } else {
    sheet.addRow(["No data provided"]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  sendDocumentResponse(res, req, Buffer.from(buffer), { filename: `${template}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
});

// ─── PDF Invoice ────────────────────────────────────────────────
router.post("/api/tools/invoice/generate", (req, res) => {
  const { from = {}, to = {}, invoice_number = "INV-0001", date, items = [], tax_rate = 0, currency = "USD", notes } = req.body || {};
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const buffers = [];
  doc.on("data", d => buffers.push(d));
  doc.on("end", () => {
    const pdf = Buffer.concat(buffers);
    sendDocumentResponse(res, req, pdf, { filename: `${invoice_number}.pdf`, mimeType: "application/pdf" });
  });

  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  doc.fontSize(20).text(from.name || "Company", 50, 50);
  doc.fontSize(10).text(from.address || "", 50, 75);
  doc.fontSize(24).text("INVOICE", 350, 50, { align: "right" });
  doc.fontSize(10).text(`#${invoice_number}`, 350, 80, { align: "right" });
  doc.fontSize(10).text(`To: ${to.name || "Client"}`, 50, 120);

  let y = 160;
  let subtotal = 0;
  for (const item of items) {
    const qty = item.quantity || 1;
    const price = item.price || 0;
    const total = qty * price;
    subtotal += total;
    doc.text(`${item.description || "Item"}`, 50, y);
    doc.text(`${qty}`, 300, y);
    doc.text(`${sym}${price.toFixed(2)}`, 380, y);
    doc.text(`${sym}${total.toFixed(2)}`, 460, y);
    y += 20;
  }

  const tax = subtotal * (tax_rate / 100);
  y += 20;
  doc.text(`Subtotal: ${sym}${subtotal.toFixed(2)}`, 380, y);
  if (tax_rate > 0) { y += 20; doc.text(`Tax (${tax_rate}%): ${sym}${tax.toFixed(2)}`, 380, y); }
  y += 20;
  doc.fontSize(14).text(`Total: ${sym}${(subtotal + tax).toFixed(2)}`, 380, y);
  if (notes) { y += 40; doc.fontSize(9).text(`Notes: ${notes}`, 50, y); }
  doc.end();
});

// ─── PDF Contract ───────────────────────────────────────────────
router.post("/api/tools/contract/generate", (req, res) => {
  const { partyA = {}, partyB = {}, type = "nda", effective_date, jurisdiction = "State of Texas" } = req.body || {};
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const buffers = [];
  doc.on("data", d => buffers.push(d));
  doc.on("end", () => { sendDocumentResponse(res, req, Buffer.concat(buffers), { filename: "contract.pdf", mimeType: "application/pdf" }); });

  doc.fontSize(18).text("MUTUAL NON-DISCLOSURE AGREEMENT", { align: "center" });
  doc.moveDown();
  doc.fontSize(10).text(`This Agreement is entered into as of ${effective_date || new Date().toISOString().split("T")[0]} by and between:`);
  doc.moveDown();
  doc.text(`${partyA.name || "Party A"} (${partyA.company || ""}) and ${partyB.name || "Party B"} (${partyB.company || ""})`);
  doc.moveDown();

  const clauses = [
    "1. DEFINITION: Confidential Information means any non-public information disclosed by either party.",
    "2. OBLIGATIONS: The Receiving Party shall protect Confidential Information using reasonable care.",
    "3. EXCLUSIONS: Information that is publicly known or independently developed is excluded.",
    "4. TERM: This Agreement remains in effect for two (2) years from the Effective Date.",
    "5. RETURN: Upon termination, all materials shall be returned or destroyed.",
    "6. NO LICENSE: Nothing herein grants any license to intellectual property.",
    "7. REMEDIES: Breach may cause irreparable harm; injunctive relief may be sought.",
    `8. GOVERNING LAW: This Agreement is governed by the laws of ${jurisdiction}.`,
  ];
  for (const c of clauses) { doc.text(c); doc.moveDown(0.5); }

  doc.moveDown(2);
  doc.text(`________________________          ________________________`);
  doc.text(`${partyA.name || "Party A"}                    ${partyB.name || "Party B"}`);
  doc.end();
});

// ─── PDF Proposal ───────────────────────────────────────────────
router.post("/api/tools/proposal/generate", (req, res) => {
  const { title = "Proposal", company = {}, client = {}, deliverables = [], pricing = [], timeline } = req.body || {};
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const buffers = [];
  doc.on("data", d => buffers.push(d));
  doc.on("end", () => { sendDocumentResponse(res, req, Buffer.concat(buffers), { filename: "proposal.pdf", mimeType: "application/pdf" }); });

  doc.rect(0, 0, 612, 200).fill("#2563eb");
  doc.fontSize(28).fillColor("#fff").text(title, 50, 60);
  doc.fontSize(14).text(`Prepared by ${company.name || "Company"}`, 50, 100);
  doc.fontSize(12).text(`For ${client.name || client.company || "Client"}`, 50, 130);

  doc.fillColor("#333");
  let y = 230;
  if (deliverables.length > 0) {
    doc.fontSize(16).text("Deliverables", 50, y); y += 30;
    for (const d of deliverables) {
      doc.fontSize(11).text(`• ${d.name || d.description || ""}`, 60, y); y += 18;
    }
  }
  if (pricing.length > 0) {
    y += 20;
    doc.fontSize(16).text("Pricing", 50, y); y += 30;
    let total = 0;
    for (const p of pricing) {
      doc.fontSize(11).text(`${p.item || "Item"}: $${(p.amount || 0).toFixed(2)}`, 60, y); y += 18;
      total += p.amount || 0;
    }
    y += 10;
    doc.fontSize(13).text(`Total: $${total.toFixed(2)}`, 60, y);
  }
  if (timeline) { y += 30; doc.fontSize(11).text(`Timeline: ${timeline}`, 50, y); }
  doc.end();
});

// ─── Markdown to PDF ────────────────────────────────────────────
router.post("/api/tools/markdown-to-pdf", (req, res) => {
  const { markdown = "", title, author } = req.body || {};
  if (!markdown) return res.status(400).json({ error: "markdown field required" });

  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const buffers = [];
  doc.on("data", d => buffers.push(d));
  doc.on("end", () => { sendDocumentResponse(res, req, Buffer.concat(buffers), { filename: `${title || "document"}.pdf`, mimeType: "application/pdf" }); });

  if (title) { doc.fontSize(20).text(title); doc.moveDown(0.5); }
  if (author) { doc.fontSize(10).fillColor("#666").text(`By ${author}`); doc.moveDown(); doc.fillColor("#333"); }

  const lines = markdown.split("\n");
  for (const line of lines) {
    if (line.startsWith("# ")) { doc.fontSize(20).text(line.slice(2)); doc.moveDown(0.3); }
    else if (line.startsWith("## ")) { doc.fontSize(16).text(line.slice(3)); doc.moveDown(0.3); }
    else if (line.startsWith("### ")) { doc.fontSize(13).text(line.slice(4)); doc.moveDown(0.2); }
    else if (line.startsWith("- ") || line.startsWith("* ")) { doc.fontSize(11).text(`  • ${line.slice(2)}`); }
    else if (line.startsWith("> ")) { doc.fontSize(11).fillColor("#555").text(`  │ ${line.slice(2)}`); doc.fillColor("#333"); }
    else if (line.startsWith("---")) { doc.moveDown(0.5); }
    else if (line.trim() === "") { doc.moveDown(0.3); }
    else { doc.fontSize(11).text(line); }
  }
  doc.end();
});

module.exports = router;
