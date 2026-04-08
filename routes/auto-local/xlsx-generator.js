const ExcelJS = require("exceljs");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeFileName(value, fallback) {
  return (
    String(value || fallback || "spreadsheet")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-") || fallback
  );
}

function sanitizeSheetName(value, fallback) {
  const base = String(value || fallback || "Sheet")
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || fallback || "Sheet").slice(0, 31);
}

function titleCase(value) {
  return String(value || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
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

  const statusIndex = columns.findIndex((entry) => entry.toLowerCase() === "status");
  const priorityIndex = columns.findIndex((entry) => entry.toLowerCase() === "priority");
  const priorityColors = { High: "FFEF4444", Medium: "FFF59E0B", Low: "FF22C55E" };

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

      if (columnNumber === statusIndex + 1 && statusColors[cell.value]) {
        cell.font = { bold: true, color: { argb: statusColors[cell.value] } };
      }

      if (columnNumber === priorityIndex + 1 && priorityColors[cell.value]) {
        cell.font = { bold: true, color: { argb: priorityColors[cell.value] } };
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

function buildForecastModelSheets(workbook, data) {
  const assumptions = isPlainObject(data.assumptions) ? data.assumptions : {};
  const growthRate = Number.isFinite(Number(assumptions.growth_rate)) ? Number(assumptions.growth_rate) : 0.1;
  const startingRevenue = Number.isFinite(Number(assumptions.starting_revenue))
    ? Number(assumptions.starting_revenue)
    : 100000;
  const months = Math.max(1, Math.min(60, Number(assumptions.months) || 12));

  const assumptionSheet = workbook.addWorksheet("Assumptions");
  assumptionSheet.columns = [{ width: 22 }, { width: 16 }, { width: 35 }];
  const assumptionHeader = assumptionSheet.addRow(["Parameter", "Value", "Notes"]);
  assumptionHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
  const assumptionRows = [
    ["growth_rate", growthRate, "Monthly growth rate"],
    ["starting_revenue", startingRevenue, "Initial monthly revenue"],
    ["months", months, "Model horizon"],
  ];
  assumptionRows.forEach((values) => {
    const row = assumptionSheet.addRow(values);
    row.getCell(2).numFmt = values[0] === "growth_rate" ? "0.00%" : "#,##0.00";
  });
  assumptionSheet.views = [{ state: "frozen", ySplit: 1 }];

  const modelSheet = workbook.addWorksheet("Forecast Model");
  modelSheet.columns = [
    { width: 10 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];
  const modelHeader = modelSheet.addRow(["Month", "Revenue", "Delta", "Growth %"]);
  modelHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  for (let month = 1; month <= months; month += 1) {
    const rowIndex = modelSheet.rowCount + 1;
    if (month === 1) {
      modelSheet.addRow([
        month,
        startingRevenue,
        0,
        growthRate,
      ]);
      modelSheet.getCell(`B${rowIndex}`).numFmt = "#,##0.00";
      modelSheet.getCell(`C${rowIndex}`).numFmt = "#,##0.00";
      modelSheet.getCell(`D${rowIndex}`).numFmt = "0.00%";
      continue;
    }

    const previousRow = rowIndex - 1;
    modelSheet.addRow([
      month,
      { formula: `B${previousRow}*(1+Assumptions!$B$2)` },
      { formula: `B${rowIndex}-B${previousRow}` },
      { formula: `IF(B${previousRow}=0,0,(B${rowIndex}-B${previousRow})/B${previousRow})` },
    ]);
    modelSheet.getCell(`B${rowIndex}`).numFmt = "#,##0.00";
    modelSheet.getCell(`C${rowIndex}`).numFmt = "#,##0.00";
    modelSheet.getCell(`D${rowIndex}`).numFmt = "0.00%";
  }

  modelSheet.addRow([]);
  const totalRow = modelSheet.addRow([
    "Total",
    { formula: `SUM(B2:B${months + 1})` },
    { formula: `SUM(C2:C${months + 1})` },
    "",
  ]);
  totalRow.getCell(1).font = { bold: true, color: { argb: "FF1E3A8A" } };
  totalRow.getCell(2).font = { bold: true, color: { argb: "FF1E3A8A" } };
  totalRow.getCell(3).font = { bold: true, color: { argb: "FF1E3A8A" } };
  totalRow.getCell(2).numFmt = "#,##0.00";
  totalRow.getCell(3).numFmt = "#,##0.00";

  modelSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: months + 1, column: 4 },
  };
  modelSheet.views = [{ state: "frozen", ySplit: 1 }];
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

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseMarkdownTable(markdown) {
  const lines = String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index];
    const separatorLine = lines[index + 1];
    if (!headerLine.includes("|")) {
      continue;
    }
    if (!/^[:|\-\s]+$/.test(separatorLine) || !separatorLine.includes("-")) {
      continue;
    }

    const headers = headerLine
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    if (headers.length === 0) {
      continue;
    }

    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex];
      if (!rowLine.includes("|")) {
        break;
      }
      const cells = rowLine
        .split("|")
        .map((part) => part.trim())
        .filter((part, cellIndex, array) => !(cellIndex === 0 && !part && array.length > 1))
        .slice(0, headers.length);
      if (cells.length === 0) {
        break;
      }
      rows.push(cells);
    }

    if (rows.length > 0) {
      return { headers, rows };
    }
  }

  return null;
}

function parseHtmlTables(html) {
  const source = String(html || "");
  const tableMatches = source.match(/<table[\s\S]*?<\/table>/gi) || [];
  return tableMatches
    .map((table, tableIndex) => {
      const rowMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      const parsedRows = rowMatches
        .map((row) => {
          const cellMatches = [...row.matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)];
          return cellMatches.map((match) => stripHtml(match[2]));
        })
        .filter((cells) => cells.length > 0);

      if (parsedRows.length === 0) {
        return null;
      }

      const headerSource = parsedRows[0];
      const headers = headerSource.map((cell, index) => cell || `column_${index + 1}`);
      const rows = parsedRows.slice(1).map((cells) => headers.map((_header, index) => cells[index] || ""));

      return {
        name: sanitizeSheetName(tableIndex === 0 ? "HTML" : `HTML ${tableIndex + 1}`, `HTML${tableIndex + 1}`),
        headers,
        rows,
      };
    })
    .filter(Boolean);
}

function normalizeRows(rows, headers) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const normalizedHeaders = Array.isArray(headers) && headers.length > 0 ? headers.map((entry) => String(entry)) : null;
  if (rows.every((row) => Array.isArray(row))) {
    if (normalizedHeaders && normalizedHeaders.length > 0) {
      return rows.map((row) => normalizedHeaders.map((_header, index) => row[index] ?? ""));
    }
    return rows.map((row) => row.slice());
  }

  if (rows.every((row) => isPlainObject(row))) {
    const columns = normalizedHeaders && normalizedHeaders.length > 0
      ? normalizedHeaders
      : Array.from(rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set()));
    return rows.map((row) => columns.map((column) => row[column] ?? row[String(column).toLowerCase()] ?? ""));
  }

  return rows.map((row) => [String(row)]);
}

function normalizeSheetsFromPayload(payload) {
  const sheets = Array.isArray(payload.sheets) ? payload.sheets : [];
  if (sheets.length === 0) {
    return [];
  }

  return sheets
    .map((entry, index) => {
      const sheet = isPlainObject(entry) ? entry : {};
      const headers = Array.isArray(sheet.headers)
        ? sheet.headers.map((value) => String(value))
        : Array.isArray(sheet.columns)
          ? sheet.columns.map((value) => String(value))
          : null;
      const rows = normalizeRows(sheet.rows, headers);
      if (rows.length === 0) {
        return null;
      }
      return {
        name: sanitizeSheetName(sheet.name, `Sheet${index + 1}`),
        headers,
        rows,
        formulas: Array.isArray(sheet.formulas) ? sheet.formulas : [],
      };
    })
    .filter(Boolean);
}

function rowsFromStructuredTable(table) {
  const normalized = isPlainObject(table) ? table : {};
  if (Array.isArray(normalized.rows)) {
    return normalized.rows.filter((row) => isPlainObject(row)).map((row) => ({ ...row }));
  }
  return [];
}

function extractStructuredReportPayload(payload) {
  if (isPlainObject(payload.report) && isPlainObject(payload.report.report_meta)) {
    return payload.report;
  }
  return payload;
}

function isStructuredReportPayload(payload) {
  const report = extractStructuredReportPayload(payload);
  return isPlainObject(report.report_meta)
    && (Array.isArray(report.executive_summary)
      || Array.isArray(report.headline_metrics)
      || isPlainObject(report.tables));
}

function buildSheetsFromStructuredReport(payload) {
  const report = extractStructuredReportPayload(payload);
  const sheets = [];

  if (Array.isArray(report.executive_summary) && report.executive_summary.length > 0) {
    sheets.push({
      name: "Executive Summary",
      headers: ["order", "summary"],
      rows: report.executive_summary.map((entry, index) => [index + 1, String(entry)]),
      formulas: [],
    });
  }

  if (Array.isArray(report.headline_metrics) && report.headline_metrics.length > 0) {
    const rows = report.headline_metrics
      .filter((entry) => isPlainObject(entry))
      .map((entry) => [String(entry.label || ""), entry.value ?? "", String(entry.unit || "")]);
    if (rows.length > 0) {
      sheets.push({
        name: "Headline Metrics",
        headers: ["label", "value", "unit"],
        rows,
        formulas: [],
      });
    }
  }

  const tables = isPlainObject(report.tables) ? report.tables : {};
  for (const [key, table] of Object.entries(tables)) {
    const rows = rowsFromStructuredTable(table);
    if (rows.length === 0) {
      continue;
    }
    const columns = Array.isArray(table.columns) && table.columns.length > 0
      ? table.columns.map((entry) => String(entry))
      : Array.from(rows.reduce((set, row) => {
        Object.keys(row).forEach((field) => set.add(field));
        return set;
      }, new Set()));

    sheets.push({
      name: sanitizeSheetName(titleCase(key), `Sheet${sheets.length + 1}`),
      headers: columns,
      rows: rows.map((row) => columns.map((column) => row[column] ?? "")),
      formulas: [],
    });
  }

  return sheets;
}

function buildSimpleSheets(payload) {
  const normalizedSheets = normalizeSheetsFromPayload(payload);
  if (normalizedSheets.length > 0) {
    return normalizedSheets;
  }

  if (Array.isArray(payload.rows) && payload.rows.length > 0) {
    const payloadRows = payload.rows;
    const headers = Array.isArray(payload.columns) && payload.columns.length > 0
      ? payload.columns.map((entry) => String(entry))
      : payloadRows.every((row) => isPlainObject(row))
        ? Array.from(payloadRows.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set()))
      : null;
    const rows = normalizeRows(payloadRows, headers);
    return [{
      name: sanitizeSheetName(payload.sheetName || "Sheet1", "Sheet1"),
      headers,
      rows,
      formulas: Array.isArray(payload.formulas) ? payload.formulas : [],
    }];
  }

  if (String(payload.markdown || "").trim()) {
    const parsed = parseMarkdownTable(payload.markdown);
    if (parsed) {
      return [{
        name: sanitizeSheetName(payload.sheetName || "Markdown", "Markdown"),
        headers: parsed.headers,
        rows: parsed.rows,
        formulas: [],
      }];
    }
    const lines = String(payload.markdown)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return [{
      name: sanitizeSheetName(payload.sheetName || "Markdown", "Markdown"),
      headers: ["line", "content"],
      rows: lines.map((line, index) => [index + 1, line]),
      formulas: [],
    }];
  }

  if (String(payload.html || "").trim()) {
    const htmlTableSheets = parseHtmlTables(payload.html);
    if (htmlTableSheets.length > 0) {
      return htmlTableSheets.map((entry) => ({
        name: entry.name,
        headers: entry.headers,
        rows: entry.rows,
        formulas: [],
      }));
    }

    const text = stripHtml(payload.html);
    return [{
      name: sanitizeSheetName(payload.sheetName || "HTML", "HTML"),
      headers: ["line", "content"],
      rows: text ? [[1, text]] : [],
      formulas: [],
    }];
  }

  return [{ name: "Sheet1", headers: ["Column A", "Column B"], rows: [], formulas: [] }];
}

function writeDataSheets(workbook, sheets) {
  const entries = Array.isArray(sheets) && sheets.length > 0
    ? sheets
    : [{ name: "Sheet1", headers: ["Column A", "Column B"], rows: [], formulas: [] }];

  for (const entry of entries) {
    const sheet = workbook.addWorksheet(String(entry.name || "Sheet"));
    const headers = Array.isArray(entry.headers) ? entry.headers.map((value) => String(value)) : null;

    if (headers && headers.length > 0) {
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
        const values = Array.isArray(row)
          ? row
          : (headers || []).map((header) => (isPlainObject(row) ? row[header] ?? "" : ""));
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

function createWorkbook(payload) {
  const workbook = new ExcelJS.Workbook();
  const company = payload.company && typeof payload.company === "object" ? payload.company : {};
  workbook.creator = company.name || "AurelianFlo";
  workbook.created = new Date();
  return workbook;
}

async function finalizeWorkbook(workbook, title, fallbackName = "spreadsheet") {
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: `${sanitizeFileName(title, fallbackName)}.xlsx`,
  };
}

async function generateTemplateXlsxBuffer(payload = {}) {
  const workbook = createWorkbook(payload);
  const template = String(payload.template || "").toLowerCase();
  const title = String(payload.title || "Spreadsheet");

  if (template === "invoice") {
    buildInvoiceSheet(workbook, payload);
  } else if (template === "tracker") {
    buildTrackerSheet(workbook, payload);
  } else if (template === "forecast_model" || template === "financial_model") {
    buildForecastModelSheets(workbook, payload);
  } else {
    throw new Error(`Unsupported XLSX template: ${template || "(empty)"}`);
  }

  return finalizeWorkbook(workbook, title, template || "spreadsheet-template");
}

async function generateReportXlsxBuffer(payload = {}) {
  const workbook = createWorkbook(payload);
  const report = extractStructuredReportPayload(payload);
  const title = String(report.title || report.report_meta?.title || "Structured Report");
  const sheets = buildSheetsFromStructuredReport(report);

  if (sheets.length === 0) {
    const fallback = buildSimpleSheets(payload);
    writeDataSheets(workbook, fallback);
  } else {
    writeDataSheets(workbook, sheets);
  }

  return finalizeWorkbook(workbook, title, "structured-report");
}

async function generateSimpleXlsxBuffer(payload = {}) {
  const workbook = createWorkbook(payload);
  const title = String(payload.title || "Spreadsheet");
  const sheets = buildSimpleSheets(payload);
  writeDataSheets(workbook, sheets);
  return finalizeWorkbook(workbook, title, "spreadsheet");
}

function resolveTier(payload = {}) {
  const template = String(payload.template || "").toLowerCase();
  if (template && template !== "general") {
    return "template";
  }
  if (isStructuredReportPayload(payload)) {
    return "report";
  }
  return "simple";
}

async function generateXlsxBuffer(payload = {}) {
  const tier = resolveTier(payload);
  if (tier === "template") {
    return generateTemplateXlsxBuffer(payload);
  }
  if (tier === "report") {
    return generateReportXlsxBuffer(payload);
  }
  return generateSimpleXlsxBuffer(payload);
}

module.exports = {
  generateXlsxBuffer,
  generateSimpleXlsxBuffer,
  generateReportXlsxBuffer,
  generateTemplateXlsxBuffer,
};
