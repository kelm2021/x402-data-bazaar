const PDFDocument = require("pdfkit");

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "invoice")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-") || fallback
  );
}

function getCurrencySymbol(currency) {
  const normalized = String(currency || "USD").toUpperCase();
  if (normalized === "EUR") return "\u20ac";
  if (normalized === "GBP") return "\u00a3";
  return "$";
}

async function generateInvoicePdfBuffer(payload = {}) {
  const company = payload.company && typeof payload.company === "object" ? payload.company : {};
  const client = payload.client && typeof payload.client === "object" ? payload.client : {};
  const invoiceNumber = String(payload.invoice_number || "INV-0001");
  const date = String(payload.date || new Date().toISOString().slice(0, 10));
  const dueDate = payload.due_date ? String(payload.due_date) : "";
  const items = Array.isArray(payload.items) ? payload.items : [];
  const notes = payload.notes ? String(payload.notes) : "";
  const taxRate = Number.isFinite(Number(payload.tax_rate)) ? Number(payload.tax_rate) : 0;
  const symbol = getCurrencySymbol(payload.currency || "USD");
  const formatAmount = (value) => `${symbol}${Number(value || 0).toFixed(2)}`;

  return await new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "LETTER", margin: 50 });
    const buffers = [];
    document.on("data", (chunk) => buffers.push(chunk));
    document.on("error", reject);
    document.on("end", () => {
      resolve({
        buffer: Buffer.concat(buffers),
        fileName: `${sanitizeFileName(invoiceNumber, "invoice")}.pdf`,
      });
    });

    document.fontSize(24).font("Helvetica-Bold").text(company.name || "Your Company", 50, 50);
    document.fontSize(9).font("Helvetica").fillColor("#555555");
    let companyY = 80;
    if (company.address) { document.text(company.address, 50, companyY); companyY += 12; }
    if (company.email) { document.text(company.email, 50, companyY); companyY += 12; }
    if (company.phone) { document.text(company.phone, 50, companyY); companyY += 12; }

    document.fontSize(28).font("Helvetica-Bold").fillColor("#2563eb").text("INVOICE", 350, 50, { width: 200, align: "right" });
    document.fontSize(9).font("Helvetica").fillColor("#555555");
    document.text(`Invoice #: ${invoiceNumber}`, 350, 85, { width: 200, align: "right" });
    document.text(`Date: ${date}`, 350, 97, { width: 200, align: "right" });
    if (dueDate) {
      document.text(`Due: ${dueDate}`, 350, 109, { width: 200, align: "right" });
    }

    document.moveTo(50, 130).lineTo(562, 130).strokeColor("#dddddd").stroke();

    document.fontSize(10).font("Helvetica-Bold").fillColor("#333333").text("BILL TO", 50, 145);
    document.fontSize(10).font("Helvetica").fillColor("#333333");
    let billToY = 162;
    if (client.name) { document.text(client.name, 50, billToY); billToY += 14; }
    if (client.company) { document.text(client.company, 50, billToY); billToY += 14; }
    if (client.address) { document.text(client.address, 50, billToY); billToY += 14; }
    if (client.email) { document.text(client.email, 50, billToY); billToY += 14; }

    const tableTop = Math.max(billToY + 20, 230);
    const columns = { description: 50, quantity: 320, price: 400, total: 480 };

    document.rect(50, tableTop - 5, 512, 22).fill("#2563eb");
    document.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    document.text("Description", columns.description + 8, tableTop, { width: 260 });
    document.text("Qty", columns.quantity, tableTop, { width: 60, align: "center" });
    document.text("Unit Price", columns.price, tableTop, { width: 70, align: "right" });
    document.text("Total", columns.total, tableTop, { width: 80, align: "right" });

    let rowY = tableTop + 25;
    let subtotal = 0;
    for (const [index, item] of items.entries()) {
      const quantity = Number(item.quantity) || 1;
      const price = Number(item.price) || 0;
      const lineTotal = quantity * price;
      subtotal += lineTotal;

      if (index % 2 === 0) {
        document.rect(50, rowY - 5, 512, 20).fill("#f8fafc");
      }

      document.fontSize(9).font("Helvetica").fillColor("#333333");
      document.text(item.description || item.name || "", columns.description + 8, rowY, { width: 260 });
      document.text(String(quantity), columns.quantity, rowY, { width: 60, align: "center" });
      document.text(formatAmount(price), columns.price, rowY, { width: 70, align: "right" });
      document.text(formatAmount(lineTotal), columns.total, rowY, { width: 80, align: "right" });
      rowY += 22;
    }

    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    rowY += 10;
    document.moveTo(380, rowY).lineTo(562, rowY).strokeColor("#dddddd").stroke();
    rowY += 10;
    document.fontSize(10).font("Helvetica").fillColor("#555555");
    document.text("Subtotal:", 380, rowY, { width: 100, align: "right" });
    document.text(formatAmount(subtotal), columns.total, rowY, { width: 80, align: "right" });
    rowY += 18;

    if (taxRate > 0) {
      document.text(`Tax (${taxRate}%):`, 380, rowY, { width: 100, align: "right" });
      document.text(formatAmount(tax), columns.total, rowY, { width: 80, align: "right" });
      rowY += 18;
    }

    document.fontSize(13).font("Helvetica-Bold").fillColor("#2563eb");
    document.text("TOTAL:", 380, rowY, { width: 100, align: "right" });
    document.text(formatAmount(total), columns.total, rowY, { width: 80, align: "right" });

    if (notes) {
      rowY += 40;
      document.fontSize(9).font("Helvetica-Bold").fillColor("#333333").text("Notes:", 50, rowY);
      document.fontSize(9).font("Helvetica").fillColor("#555555").text(notes, 50, rowY + 14, { width: 300 });
    }

    document.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text("Generated by AurelianFlo", 50, 720, {
      width: 512,
      align: "center",
    });

    document.end();
  });
}

module.exports = {
  generateInvoicePdfBuffer,
};
