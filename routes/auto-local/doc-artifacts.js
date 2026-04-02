const crypto = require("node:crypto");
const { generateDocxBuffer } = require("./docx-generator");
const { generateXlsxBuffer } = require("./xlsx-generator");
const { generateInvoicePdfBuffer } = require("./pdf-invoice-generator");
const {
  generateContractPdfBuffer,
  generateProposalPdfBuffer,
  generateMarkdownPdfBuffer,
} = require("./pdf-generators");

const DOCUMENT_PATH_MARKERS = [
  "/pdf/",
  "/docx/",
  "/xlsx/",
  "/invoice/",
  "/receipt/",
  "/contract/",
  "/certificate/",
  "/resume/",
  "/report/",
  "/label/",
  "/bizcard/",
  "/cover-letter/",
  "/meeting-minutes/",
  "/privacy-policy/",
  "/tos/",
  "/proposal/",
  "/ticket/",
  "/html-to-pdf",
  "/markdown-to-pdf",
  "/csv-to-pdf",
];

const PDF_PATH_MARKERS = DOCUMENT_PATH_MARKERS.filter((marker) => marker !== "/docx/" && marker !== "/xlsx/");

const MIME_BY_TYPE = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObject(value) {
  return isPlainObject(value) ? value : {};
}

function readString(value, fallback = "") {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      continue;
    }
    return value;
  }
  return undefined;
}

function normalizeSlug(value) {
  return readString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSourceResponse(data, source = "auto-local-doc-artifacts") {
  return {
    success: true,
    data,
    source,
  };
}

function buildError(error, message) {
  return {
    success: false,
    error,
    message,
  };
}

function xmlEscape(value) {
  return readString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pdfEscape(value) {
  return readString(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n\t]/g, " ");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashText(value) {
  return crypto.createHash("sha256").update(readString(value)).digest("hex");
}

function crc32(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = readString(entry.name || "").replace(/\\/g, "/");
    const nameBuffer = Buffer.from(name, "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(readString(entry.data), "utf8");
    const checksum = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildPdfBuffer(title, lines) {
  const safeLines = [title, ...lines].map((line) => pdfEscape(line)).filter(Boolean).slice(0, 28);
  if (safeLines.length === 0) {
    safeLines.push("Generated document");
  }

  const streamCommands = ["BT", "/F1 12 Tf", "72 760 Td"];
  for (let i = 0; i < safeLines.length; i += 1) {
    if (i > 0) {
      streamCommands.push("0 -16 Td");
    }
    streamCommands.push(`(${safeLines[i]}) Tj`);
  }
  streamCommands.push("ET");

  const streamText = streamCommands.join("\n");
  const streamBuffer = Buffer.from(streamText, "utf8");

  const object1 = Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "utf8");
  const object2 = Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "utf8");
  const object3 = Buffer.from(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "utf8",
  );
  const object4 = Buffer.from("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n", "utf8");
  const object5 = Buffer.concat([
    Buffer.from(`5 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n`, "utf8"),
    streamBuffer,
    Buffer.from("\nendstream\nendobj\n", "utf8"),
  ]);

  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
  const objects = [object1, object2, object3, object4, object5];
  const parts = [header];
  const offsets = [0];

  let position = header.length;
  for (const objectBuffer of objects) {
    offsets.push(position);
    parts.push(objectBuffer);
    position += objectBuffer.length;
  }

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(`${xref}${trailer}`, "utf8"));

  return Buffer.concat(parts);
}

function buildDocxBuffer(title, lines) {
  const paragraphXml = [title, ...lines]
    .filter(Boolean)
    .slice(0, 60)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`)
    .join("");

  const documentXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
    "<w:body>" +
    paragraphXml +
    "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>" +
    "</w:body></w:document>";

  return createZipArchive([
    {
      name: "[Content_Types].xml",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
        "</Relationships>",
    },
    { name: "word/document.xml", data: documentXml },
  ]);
}

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    output = String.fromCharCode(65 + mod) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function buildSheetRows(title, lines, body) {
  const rows = [["Field", "Value"], ["title", title], ["line_count", String(lines.length)]];
  if (Object.keys(body).length > 0) {
    for (const [key, value] of Object.entries(body).slice(0, 100)) {
      rows.push([key, typeof value === "string" ? value : stableStringify(value)]);
    }
  } else {
    lines.slice(0, 60).forEach((line, index) => rows.push([`line_${index + 1}`, line]));
  }
  return rows;
}

function sanitizeSheetName(value, fallback) {
  const base = readString(value, fallback).trim() || fallback;
  const withoutInvalidChars = base.replace(/[\\/*?:\[\]]/g, " ").replace(/\s+/g, " ").trim();
  const safe = withoutInvalidChars || fallback;
  return safe.slice(0, 31);
}

function normalizeSheetRows(rows, columns = null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length === 0) {
    return [];
  }

  const hasArrayRows = sourceRows.some((row) => Array.isArray(row));
  const hasObjectRows = sourceRows.some((row) => isPlainObject(row));

  if (hasArrayRows && !hasObjectRows) {
    const outputRows = sourceRows
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((cell) => readString(cell)));
    if (Array.isArray(columns) && columns.length > 0) {
      outputRows.unshift(columns.map((column) => readString(column)));
    }
    return outputRows;
  }

  if (hasObjectRows) {
    const normalizedRows = sourceRows.filter((row) => isPlainObject(row)).map((row) => toObject(row));
    const headerColumns = Array.isArray(columns) && columns.length > 0
      ? columns.map((column) => readString(column))
      : Array.from(
        normalizedRows.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set()),
      );

    if (headerColumns.length === 0) {
      return [];
    }

    const outputRows = [headerColumns];
    for (const row of normalizedRows) {
      outputRows.push(
        headerColumns.map((column) => {
          const value = row[column];
          if (value == null) {
            return "";
          }
          return typeof value === "string" ? value : stableStringify(value);
        }),
      );
    }
    return outputRows;
  }

  return sourceRows.map((row) => [readString(row)]);
}

function deriveWorkbookSheets(title, lines, body) {
  const payload = toObject(body);
  const sheetsInput = Array.isArray(payload.sheets) ? payload.sheets : [];
  const workbookSheets = [];

  if (sheetsInput.length > 0) {
    for (let i = 0; i < sheetsInput.length && workbookSheets.length < 20; i += 1) {
      const sheet = toObject(sheetsInput[i]);
      const rows = normalizeSheetRows(sheet.rows, sheet.columns);
      if (rows.length === 0) {
        continue;
      }
      workbookSheets.push({
        name: sanitizeSheetName(sheet.name, `Sheet${workbookSheets.length + 1}`),
        rows,
      });
    }
  }

  if (workbookSheets.length === 0 && Array.isArray(payload.rows)) {
    const rows = normalizeSheetRows(payload.rows, payload.columns);
    if (rows.length > 0) {
      workbookSheets.push({
        name: sanitizeSheetName(payload.sheetName, "Sheet1"),
        rows,
      });
    }
  }

  if (workbookSheets.length === 0) {
    workbookSheets.push({
      name: "Sheet1",
      rows: buildSheetRows(title, lines, body),
    });
  }

  return workbookSheets;
}

function buildWorksheetXml(rows) {
  const sheetRowsXml = rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellXml = cells
        .map((cell, cellIndex) => {
          const ref = `${columnName(cellIndex)}${rowNumber}`;
          return `<c r=\"${ref}\" t=\"inlineStr\"><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r=\"${rowNumber}\">${cellXml}</row>`;
    })
    .join("");

  return (
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
    `<sheetData>${sheetRowsXml}</sheetData>` +
    "</worksheet>"
  );
}

function buildXlsxBuffer(title, lines, body) {
  const workbookSheets = deriveWorkbookSheets(title, lines, body);
  const sheetContentTypeOverrides = workbookSheets
    .map(
      (_sheet, index) =>
        `<Override PartName=\"/xl/worksheets/sheet${index + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>`,
    )
    .join("");

  const workbookSheetsXml = workbookSheets
    .map(
      (sheet, index) =>
        `<sheet name=\"${xmlEscape(sheet.name)}\" sheetId=\"${index + 1}\" r:id=\"rId${index + 1}\"/>`,
    )
    .join("");

  const workbookRelsXml = workbookSheets
    .map(
      (_sheet, index) =>
        `<Relationship Id=\"rId${index + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet${index + 1}.xml\"/>`,
    )
    .join("");

  const entries = [
    {
      name: "[Content_Types].xml",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
        sheetContentTypeOverrides +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
        `<sheets>${workbookSheetsXml}</sheets>` +
        "</workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        workbookRelsXml +
        "</Relationships>",
    },
  ];

  for (let i = 0; i < workbookSheets.length; i += 1) {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: buildWorksheetXml(workbookSheets[i].rows),
    });
  }

  return createZipArchive(entries);
}

function buildDeterministicFallbackBuffer(type, descriptor, error) {
  const payload = {
    type,
    title: descriptor.title,
    endpoint: descriptor.endpoint,
    preview: descriptor.preview,
    checksum: hashText(stableStringify(descriptor.body || {})).slice(0, 16),
    reason: readString(error && error.message, "fallback"),
  };
  return Buffer.from(stableStringify(payload), "utf8");
}

function createArtifact(type, name, buffer) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  return {
    type,
    name,
    sizeBytes: payload.length,
    contentBase64: payload.toString("base64"),
  };
}

function isDocumentArtifactPath(path) {
  const normalizedPath = readString(path).toLowerCase();
  return DOCUMENT_PATH_MARKERS.some((marker) => normalizedPath.includes(marker));
}

function resolveDocumentType(path) {
  const normalizedPath = readString(path).toLowerCase();
  if (normalizedPath.includes("/docx/")) {
    return "docx";
  }
  if (normalizedPath.includes("/xlsx/")) {
    return "xlsx";
  }
  if (PDF_PATH_MARKERS.some((marker) => normalizedPath.includes(marker))) {
    return "pdf";
  }
  return null;
}

function normalizeContext(input) {
  const context = toObject(input);
  const body = toObject(context.body);
  const path = readString(pick(context.path, context.routePath, context.resourcePath), "").toLowerCase();
  const endpoint = readString(pick(context.endpoint, context.key, `POST ${path}`), "");
  const title = readString(
    pick(body.title, body.subject, body.name, context.title, "Generated Document"),
    "Generated Document",
  );
  const preview = Object.entries(body)
    .slice(0, 12)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : stableStringify(value)}`);

  const lines = [
    `Generated from ${endpoint || path || "auto-local endpoint"}`,
    ...preview,
  ];

  return {
    path,
    body,
    endpoint,
    title,
    lines,
    preview: preview.slice(0, 6),
  };
}

async function buildDocumentArtifact(contextInput) {
  const context = normalizeContext(contextInput);

  if (!isDocumentArtifactPath(context.path)) {
    return buildError(
      "unsupported_document_artifact_path",
      `Path does not match document artifact routes: ${context.path || "(empty)"}`,
    );
  }

  const docType = resolveDocumentType(context.path);
  if (!docType) {
    return buildError("unsupported_document_artifact_type", `Unable to resolve artifact type for path: ${context.path}`);
  }

  const baseName = normalizeSlug(context.title) || "document";
  let fileName = `${baseName}.${docType}`;

  let binaryBuffer;
  let mode = "real-binary";
  let errorMessage = null;

  try {
    if (docType === "pdf" && context.path.includes("/invoice/")) {
      const result = await generateInvoicePdfBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    } else if (docType === "pdf" && context.path.includes("/contract/")) {
      const result = await generateContractPdfBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    } else if (docType === "pdf" && context.path.includes("/proposal/")) {
      const result = await generateProposalPdfBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    } else if (docType === "pdf" && context.path.includes("/markdown-to-pdf")) {
      const result = await generateMarkdownPdfBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    } else if (docType === "pdf") {
      binaryBuffer = buildPdfBuffer(context.title, context.lines);
    } else if (docType === "docx") {
      const result = await generateDocxBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    } else {
      const result = await generateXlsxBuffer(context.body);
      binaryBuffer = result.buffer;
      fileName = result.fileName || fileName;
    }
  } catch (error) {
    mode = "fallback";
    errorMessage = readString(error && error.message, "artifact generation failure");
    binaryBuffer = buildDeterministicFallbackBuffer(docType, context, error);
  }

  const artifact = createArtifact(docType, fileName, binaryBuffer);

  const data = {
    documentType: docType,
    fileName,
    mimeType: MIME_BY_TYPE[docType],
    artifact,
    preview: context.preview,
    capabilities: {
      pdf: { mode: "real-binary", fallbackMode: "deterministic-text-base64" },
      docx: { mode: "real-binary", fallbackMode: "deterministic-text-base64" },
      xlsx: { mode: "real-binary", fallbackMode: "deterministic-text-base64" },
      selected: {
        type: docType,
        mode,
        realBinary: mode === "real-binary",
        usedFallback: mode !== "real-binary",
      },
    },
  };

  if (errorMessage) {
    data.capabilities.selected.error = errorMessage;
  }

  return buildSourceResponse(data);
}

module.exports = {
  buildDocumentArtifact,
  isDocumentArtifactPath,
};
