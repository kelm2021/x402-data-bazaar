const ExcelJS = require("exceljs");

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "spreadsheet")
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

function buildInvoiceSheet(workbook, data) {
  const company = data.company && typeof data.company === "object" ? data.company : {};
  const client = data.client && typeof data.client === "object" ? data.client : {};
  const invoiceNumber = String(data.invoice_number || "INV-0001");
  const date = String(data.date || new Date().toISOString().slice(0, 10));
  const dueDate = data.due_date ? String(data.due_date) : "";
  const items = Array.isArray(data.items) ? data.items : [];
  const taxRate = Number.isFinite(Number(data.tax_rate)) ? Number(data.tax_rate) : 0;
  const notes = data.notes ? String(data.notes) : "";
  const symbol = getCurrencySymbol(data.currency || "USD");

  const sheet = workbook.addWorksheet("Invoice", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true },
  });

  sheet.columns = [
    { width: 5 },
    { width: 40 },
    { width: 12 },
    { width: 15 },
    { width: 18 },
  ];

  const titleRow = sheet.addRow(["", company.name || "Company Name"]);
  titleRow.getCell(2).font = { bold: true, size: 18, color: { argb: "FF2563EB" } };
  sheet.addRow(["", company.address || ""]);
  sheet.addRow(["", [company.email, company.phone].filter(Boolean).join(" | ")]);
  sheet.addRow([]);

  const invoiceRow = sheet.addRow(["", "INVOICE", "", "", invoiceNumber]);
  invoiceRow.getCell(2).font = { bold: true, size: 14 };
  invoiceRow.getCell(5).font = { bold: true, size: 14 };
  invoiceRow.getCell(5).alignment = { horizontal: "right" };

  sheet.addRow(["", "Date:", "", "", date]).getCell(5).alignment = { horizontal: "right" };
  if (dueDate) {
    sheet.addRow(["", "Due Date:", "", "", dueDate]).getCell(5).alignment = { horizontal: "right" };
  }
  sheet.addRow([]);

  const billToRow = sheet.addRow(["", "BILL TO:"]);
  billToRow.getCell(2).font = { bold: true, color: { argb: "FF555555" } };
  if (client.name) sheet.addRow(["", client.name]).getCell(2).font = { bold: true };
  if (client.company) sheet.addRow(["", client.company]);
  if (client.address) sheet.addRow(["", client.address]);
  if (client.email) sheet.addRow(["", client.email]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(["", "Description", "Qty", "Unit Price", "Total"]);
  headerRow.eachCell((cell, colNumber) => {
    if (colNumber < 2) return;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { horizontal: colNumber >= 4 ? "right" : "left" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  const startRow = sheet.rowCount + 1;
  for (const [index, item] of items.entries()) {
    const quantity = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    const rowIndex = sheet.rowCount + 1;
    const row = sheet.addRow([
      "",
      item.description || item.name || "",
      quantity,
      price,
      { formula: `C${rowIndex}*D${rowIndex}` },
    ]);

    row.eachCell((cell, colNumber) => {
      if (colNumber < 2) return;
      if (index % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (colNumber >= 4) {
        cell.numFmt = `${symbol}#,##0.00`;
        cell.alignment = { horizontal: "right" };
      }
      if (colNumber === 3) {
        cell.alignment = { horizontal: "center" };
      }
    });
  }

  const endRow = Math.max(sheet.rowCount, startRow);
  sheet.addRow([]);

  const subtotalRowIndex = sheet.rowCount + 1;
  const subtotalRow = sheet.addRow(["", "", "", "Subtotal:", { formula: `SUM(E${startRow}:E${endRow})` }]);
  subtotalRow.getCell(4).font = { bold: true };
  subtotalRow.getCell(5).numFmt = `${symbol}#,##0.00`;
  subtotalRow.getCell(5).alignment = { horizontal: "right" };

  let totalFormula = `E${subtotalRowIndex}`;
  if (taxRate > 0) {
    const taxRow = sheet.addRow(["", "", "", `Tax (${taxRate}%):`, { formula: `E${subtotalRowIndex}*${taxRate / 100}` }]);
    taxRow.getCell(5).numFmt = `${symbol}#,##0.00`;
    taxRow.getCell(5).alignment = { horizontal: "right" };
    totalFormula = `E${subtotalRowIndex}+E${sheet.rowCount}`;
  }

  const totalRow = sheet.addRow(["", "", "", "TOTAL:", { formula: totalFormula }]);
  totalRow.getCell(4).font = { bold: true, size: 13, color: { argb: "FF2563EB" } };
  totalRow.getCell(5).font = { bold: true, size: 13, color: { argb: "FF2563EB" } };
  totalRow.getCell(5).numFmt = `${symbol}#,##0.00`;
  totalRow.getCell(5).alignment = { horizontal: "right" };

  if (notes) {
    sheet.addRow([]);
    sheet.addRow(["", "Notes:"]).getCell(2).font = { bold: true, size: 10, color: { argb: "FF888888" } };
    sheet.addRow(["", notes]).getCell(2).font = { size: 10, color: { argb: "FF888888" } };
  }
}

function buildTrackerSheet(workbook, data) {
  const title = String(data.title || "Task Tracker");
  const columns = Array.isArray(data.columns) && data.columns.length > 0
    ? data.columns.map((entry) => String(entry))
    : ["Task", "Assignee", "Status", "Priority", "Due Date", "Notes"];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const statusColors = data.status_colors && typeof data.status_colors === "object"
    ? data.status_colors
    : { Done: "FF22C55E", "In Progress": "FF3B82F6", Blocked: "FFEF4444", Todo: "FFAAAAAA" };

  const sheet = workbook.addWorksheet(title);
  sheet.mergeCells(`A1:${String.fromCharCode(64 + Math.min(columns.length, 26))}1`);
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF2563EB" } };
  sheet.getCell("A1").alignment = { horizontal: "center" };
  sheet.addRow([]);

  const headerRow = sheet.addRow(columns);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  sheet.columns = columns.map((_entry, index) => ({
    width: index === 0 ? 35 : index === columns.length - 1 ? 30 : 15,
  }));

  for (const [rowIndex, row] of rows.entries()) {
    const values = Array.isArray(row) ? row : columns.map((column) => row[column] || row[column.toLowerCase()] || "");
    const dataRow = sheet.addRow(values);
    dataRow.eachCell((cell, columnNumber) => {
      if (rowIndex % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      const statusIndex = columns.findIndex((entry) => entry.toLowerCase() === "status");
      if (columnNumber === statusIndex + 1 && statusColors[cell.value]) {
        cell.font = { bold: true, color: { argb: statusColors[cell.value] } };
      }

      const priorityIndex = columns.findIndex((entry) => entry.toLowerCase() === "priority");
      if (columnNumber === priorityIndex + 1) {
        const priorityColors = { High: "FFEF4444", Medium: "FFF59E0B", Low: "FF22C55E" };
        if (priorityColors[cell.value]) {
          cell.font = { bold: true, color: { argb: priorityColors[cell.value] } };
        }
      }
    });
  }

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + rows.length, column: columns.length },
  };
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  const summaryRow = sheet.addRow([`Total tasks: ${rows.length}`]);
  summaryRow.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
}

function buildDataSheets(workbook, sheets) {
  const entries = Array.isArray(sheets) && sheets.length > 0 ? sheets : [{ name: "Sheet1", headers: ["Column A", "Column B"], rows: [] }];

  for (const entry of entries) {
    const sheet = workbook.addWorksheet(String(entry.name || "Sheet"));
    const headers = Array.isArray(entry.headers) ? entry.headers.map((value) => String(value)) : null;

    if (headers) {
      sheet.columns = headers.map((header) => ({ header, width: Math.max(header.length + 5, 15) }));
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });
    }

    if (Array.isArray(entry.rows)) {
      entry.rows.forEach((row, index) => {
        const values = Array.isArray(row) ? row : (headers || []).map((header) => row[header] ?? "");
        const dataRow = sheet.addRow(values);
        dataRow.eachCell((cell) => {
          if (index % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
          }
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });
      });
    }

    if (Array.isArray(entry.formulas)) {
      for (const formula of entry.formulas) {
        if (!formula || !formula.cell || !formula.formula) continue;
        sheet.getCell(formula.cell).value = { formula: formula.formula };
        if (formula.numFmt) {
          sheet.getCell(formula.cell).numFmt = formula.numFmt;
        }
      }
    }

    if (headers && Array.isArray(entry.rows) && entry.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1 + entry.rows.length, column: headers.length },
      };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    }
  }
}

async function generateXlsxBuffer(payload = {}) {
  const workbook = new ExcelJS.Workbook();
  const company = payload.company && typeof payload.company === "object" ? payload.company : {};
  const title = String(payload.title || "Spreadsheet");
  const template = String(payload.template || "general").toLowerCase();
  const sheets = Array.isArray(payload.sheets) ? payload.sheets : [];

  workbook.creator = company.name || "Meridian Doc-Gen";
  workbook.created = new Date();

  if (template === "invoice") {
    buildInvoiceSheet(workbook, payload);
  } else if (template === "tracker") {
    buildTrackerSheet(workbook, payload);
  } else {
    buildDataSheets(workbook, sheets);
  }

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: `${sanitizeFileName(title, "spreadsheet")}.xlsx`,
  };
}

module.exports = {
  generateXlsxBuffer,
};
