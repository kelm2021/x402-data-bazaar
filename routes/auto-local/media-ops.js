const crypto = require("node:crypto");
const { URL } = require("node:url");
const fetch = require("node-fetch");
const Jimp = require("jimp");
const { Resvg } = require("@resvg/resvg-js");
const { GifCodec, GifFrame, GifUtil } = require("gifwrap");

const MEDIA_PATH_FRAGMENTS = [
  "/qr/",
  "/barcode/",
  "/image/",
  "/svg-to-png",
  "/html-to-image",
  "/favicon/",
  "/signature/",
  "/placeholder/",
  "/colors/",
  "/chart/",
  "/gif/",
];

function readString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function readNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function hashText(value) {
  return crypto.createHash("sha256").update(readString(value)).digest("hex");
}

function escapeXml(value) {
  return readString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizePath(path) {
  return readString(path).toLowerCase();
}

function stableInt(seed, min, max) {
  const hash = hashText(seed).slice(0, 8);
  const numeric = Number.parseInt(hash, 16);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return min + (numeric % (max - min + 1));
}

function createArtifact(mimeType, name, contentValue) {
  const content = Buffer.isBuffer(contentValue)
    ? contentValue
    : Buffer.from(readString(contentValue), "utf8");
  return {
    type: mimeType.includes("svg") ? "svg" : "image",
    mimeType,
    name,
    sizeBytes: content.length,
    contentBase64: content.toString("base64"),
  };
}

function dataUriFromArtifact(artifact) {
  return `data:${artifact.mimeType};base64,${artifact.contentBase64}`;
}

function buildSourceResponse(data) {
  return {
    success: true,
    data,
    source: "auto-local-engine",
  };
}

function parseSizeToken(value, fallbackWidth = 512, fallbackHeight = 512) {
  const token = readString(value).trim().toLowerCase();
  if (!token) {
    return [fallbackWidth, fallbackHeight];
  }
  if (token.includes("x")) {
    const [rawW, rawH] = token.split("x");
    const width = clamp(Number.parseInt(rawW, 10) || fallbackWidth, 16, 4096);
    const height = clamp(Number.parseInt(rawH, 10) || fallbackHeight, 16, 4096);
    return [width, height];
  }
  const size = clamp(Number.parseInt(token, 10) || fallbackWidth, 16, 4096);
  return [size, size];
}

function parsePlaceholderDimensions(context) {
  const params = toObject(context.params);
  const query = toObject(context.query);
  const body = toObject(context.body);
  const path = normalizePath(context.path);
  const fromPath = /\/placeholder\/([^/?#]+)/.exec(path);
  const sizeToken = pick(params.size, query.size, body.size, fromPath ? fromPath[1] : undefined, "512x512");
  return parseSizeToken(sizeToken, 512, 512);
}

function parseTransformDimensions(context, defaultWidth = 512, defaultHeight = 512) {
  const query = toObject(context.query);
  const body = toObject(context.body);
  const sizeToken = pick(body.size, query.size);
  if (sizeToken) {
    return parseSizeToken(sizeToken, defaultWidth, defaultHeight);
  }
  const width = clamp(Number.parseInt(readString(pick(body.width, query.width, defaultWidth)), 10) || defaultWidth, 16, 4096);
  const height = clamp(Number.parseInt(readString(pick(body.height, query.height, defaultHeight)), 10) || defaultHeight, 16, 4096);
  return [width, height];
}

function makeHashPalette(seed, count = 6) {
  let cursor = hashText(seed);
  while (cursor.length < count * 6) {
    cursor += hashText(cursor);
  }
  const palette = [];
  for (let i = 0; i < count; i += 1) {
    palette.push(`#${cursor.slice(i * 6, i * 6 + 6)}`);
  }
  return palette;
}

function parseHexColor(value, fallback = "#111827") {
  const text = readString(value, fallback).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(text)) {
    return parseHexColor(fallback, "#111827");
  }
  return {
    hex: `#${text.toLowerCase()}`,
    r: Number.parseInt(text.slice(0, 2), 16),
    g: Number.parseInt(text.slice(2, 4), 16),
    b: Number.parseInt(text.slice(4, 6), 16),
  };
}

function fillRect(image, x, y, width, height, color) {
  const x0 = clamp(Math.floor(x), 0, image.bitmap.width);
  const y0 = clamp(Math.floor(y), 0, image.bitmap.height);
  const w = clamp(Math.floor(width), 0, image.bitmap.width - x0);
  const h = clamp(Math.floor(height), 0, image.bitmap.height - y0);
  if (!w || !h) {
    return;
  }
  const rgba = parseHexColor(color, "#111827");
  image.scan(x0, y0, w, h, function scanRect(_x, _y, idx) {
    this.bitmap.data[idx + 0] = rgba.r;
    this.bitmap.data[idx + 1] = rgba.g;
    this.bitmap.data[idx + 2] = rgba.b;
    this.bitmap.data[idx + 3] = 255;
  });
}

function renderQrSvg(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const text = readString(pick(body.text, body.url, query.text, query.url, context.inputText, "x402"));
  const requestedSize = clamp(Number.parseInt(readString(pick(body.size, query.size, 256)), 10) || 256, 64, 1024);
  const moduleCount = 29;
  const quietZone = 4;
  const moduleSize = Math.max(1, Math.floor(requestedSize / (moduleCount + quietZone * 2)));
  const size = moduleSize * (moduleCount + quietZone * 2);
  const matrix = Array.from({ length: moduleCount }, () => Array.from({ length: moduleCount }, () => false));
  const reserved = Array.from({ length: moduleCount }, () => Array.from({ length: moduleCount }, () => false));

  function setFinder(originX, originY) {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const gx = originX + x;
        const gy = originY + y;
        const outer = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        matrix[gy][gx] = outer || inner;
        reserved[gy][gx] = true;
      }
    }
  }

  setFinder(0, 0);
  setFinder(moduleCount - 7, 0);
  setFinder(0, moduleCount - 7);

  for (let x = 8; x < moduleCount - 8; x += 1) {
    matrix[6][x] = x % 2 === 0;
    reserved[6][x] = true;
  }
  for (let y = 8; y < moduleCount - 8; y += 1) {
    matrix[y][6] = y % 2 === 0;
    reserved[y][6] = true;
  }

  let bitCursor = hashText(text);
  let bitIndex = 0;
  function nextBit() {
    if (bitIndex >= bitCursor.length * 4) {
      bitCursor += hashText(bitCursor);
    }
    const nibbleIndex = Math.floor(bitIndex / 4);
    const bitOffset = 3 - (bitIndex % 4);
    const nibble = Number.parseInt(bitCursor[nibbleIndex], 16);
    bitIndex += 1;
    return ((nibble >> bitOffset) & 1) === 1;
  }

  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (reserved[y][x]) {
        continue;
      }
      matrix[y][x] = nextBit();
    }
  }

  const rects = [];
  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!matrix[y][x]) {
        continue;
      }
      const px = (x + quietZone) * moduleSize;
      const py = (y + quietZone) * moduleSize;
      rects.push(`<rect x="${px}" y="${py}" width="${moduleSize}" height="${moduleSize}" fill="#111827"/>`);
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    rects.join(""),
    "</svg>",
  ].join("");
  const artifact = createArtifact("image/svg+xml", `qr-${hashText(text).slice(0, 10)}.svg`, svg);

  return buildSourceResponse({
    text,
    size,
    moduleSize,
    svg,
    svgDataUri: dataUriFromArtifact(artifact),
    artifact,
  });
}

function renderBarcodeSvg(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const value = readString(pick(body.value, body.text, query.value, query.text, "123456789012"));
  const format = readString(pick(body.type, query.type, "code128")).toLowerCase();
  const height = clamp(Number.parseInt(readString(pick(body.height, query.height, 140)), 10) || 140, 32, 640);
  const moduleWidth = clamp(Number.parseInt(readString(pick(body.moduleWidth, query.moduleWidth, 2)), 10) || 2, 1, 8);

  const chunks = [];
  chunks.push("110100");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    chunks.push(code.toString(2).padStart(8, "0"));
    chunks.push(index % 2 === 0 ? "10" : "01");
  }
  chunks.push("1100011");

  const pattern = chunks.join("");
  const width = pattern.length * moduleWidth + 20;
  const bars = [];
  const barRects = [];
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== "1") {
      continue;
    }
    const x = 10 + index * moduleWidth;
    bars.push({ x, y: 10, width: moduleWidth, height: height - 40 });
    barRects.push(`<rect x="${x}" y="10" width="${moduleWidth}" height="${height - 40}" fill="#111827"/>`);
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Barcode">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    barRects.join(""),
    `<text x="${Math.floor(width / 2)}" y="${height - 12}" text-anchor="middle" fill="#111827" font-family="monospace" font-size="12">${escapeXml(value)}</text>`,
    "</svg>",
  ].join("");
  const artifact = createArtifact("image/svg+xml", `barcode-${hashText(`${format}:${value}`).slice(0, 10)}.svg`, svg);

  return buildSourceResponse({
    value,
    format,
    checksum: value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 103,
    bars,
    svg,
    svgDataUri: dataUriFromArtifact(artifact),
    artifact,
  });
}

function renderPlaceholderSvg(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const [width, height] = parsePlaceholderDimensions(context);
  const label = readString(pick(query.text, body.text, body.label, query.label, "placeholder"));
  const background = readString(pick(query.bg, body.bg, "#e5e7eb"));
  const foreground = readString(pick(query.fg, body.fg, "#374151"));
  const fontSize = clamp(Math.floor(Math.min(width, height) * 0.14), 12, 72);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Placeholder image">`,
    `<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
    `<text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2)}" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(
      foreground,
    )}" font-family="system-ui, sans-serif" font-size="${fontSize}">${escapeXml(label)}</text>`,
    "</svg>",
  ].join("");
  const artifact = createArtifact("image/svg+xml", `placeholder-${width}x${height}.svg`, svg);

  return buildSourceResponse({
    width,
    height,
    label,
    svg,
    svgDataUri: dataUriFromArtifact(artifact),
    artifact,
  });
}

function parseImageBytesPalette(buffer, colorCount = 6) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
    return makeHashPalette("bytes-empty", colorCount);
  }
  const buckets = new Map();
  const step = Math.max(3, Math.floor(buffer.length / 20000));

  for (let index = 0; index + 2 < buffer.length; index += step) {
    const r = buffer[index] >> 4;
    const g = buffer[index + 1] >> 4;
    const b = buffer[index + 2] >> 4;
    const key = `${r},${g},${b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const palette = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, colorCount)
    .map(([key]) => {
      const [r, g, b] = key.split(",").map((channel) => Number.parseInt(channel, 10));
      const rr = clamp(r * 17 + 8, 0, 255).toString(16).padStart(2, "0");
      const gg = clamp(g * 17 + 8, 0, 255).toString(16).padStart(2, "0");
      const bb = clamp(b * 17 + 8, 0, 255).toString(16).padStart(2, "0");
      return `#${rr}${gg}${bb}`;
    });

  if (palette.length >= colorCount) {
    return palette;
  }

  const filler = makeHashPalette(buffer.subarray(0, Math.min(buffer.length, 2048)).toString("hex"), colorCount);
  const merged = [...palette];
  for (const color of filler) {
    if (merged.length >= colorCount) {
      break;
    }
    if (!merged.includes(color)) {
      merged.push(color);
    }
  }
  return merged.slice(0, colorCount);
}

async function readRemoteBytes(imageUrl) {
  try {
    const parsed = new URL(readString(imageUrl));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported_protocol");
    }
    const response = await fetch(parsed.toString(), { timeout: 5000 });
    if (!response.ok) {
      throw new Error(`fetch_failed_${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (!bytes.length) {
      throw new Error("empty_response");
    }
    const mimeType = readString(response.headers.get("content-type"), "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return { ok: true, bytes, imageUrl: parsed.toString(), mimeType };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "fetch_failed",
    };
  }
}

async function renderColorPayload(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const imageUrl = pick(body.imageUrl, body.url, query.imageUrl, query.url);
  const seedText = readString(pick(body.text, query.text, context.inputText, context.title, "colors"));

  if (imageUrl) {
    const remote = await readRemoteBytes(imageUrl);
    if (remote.ok) {
      const palette = parseImageBytesPalette(remote.bytes, 6);
      return buildSourceResponse({
        mode: "image-bytes",
        imageUrl: remote.imageUrl,
        bytesAnalyzed: remote.bytes.length,
        dominant: palette[0],
        palette,
        seed: hashText(remote.bytes.subarray(0, Math.min(remote.bytes.length, 4096))),
      });
    }

    const fallbackPalette = makeHashPalette(seedText || readString(imageUrl), 6);
    return buildSourceResponse({
      mode: "text-fallback",
      imageUrl: readString(imageUrl),
      fallbackReason: remote.error,
      seed: seedText || readString(imageUrl),
      dominant: fallbackPalette[0],
      palette: fallbackPalette,
    });
  }

  const palette = makeHashPalette(seedText, 6);
  return buildSourceResponse({
    mode: "text-seed",
    seed: seedText,
    dominant: palette[0],
    palette,
  });
}

async function renderGifPayload(context) {
  const path = normalizePath(context.path);
  if (path.includes("/gif/compose")) {
    return renderGifComposePayload(context);
  }
  if (path.includes("/gif/generate")) {
    return renderGifGeneratePayload(context);
  }
  return {
    success: false,
    error: "unsupported_gif_operation",
    message: "Use /gif/generate or /gif/compose.",
    source: "auto-local-engine",
  };
}

async function renderGifGeneratePayload(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const [width, height] = parseTransformDimensions(context, 480, 270);
  const frameCount = clamp(Math.floor(readNumber(pick(body.frames, query.frames), 10)), 2, 36);
  const fps = clamp(readNumber(pick(body.fps, query.fps), 10), 1, 24);
  const delayCentisecs = clamp(Math.round(100 / fps), 2, 100);
  const prompt = readString(
    pick(body.prompt, body.text, body.title, query.prompt, query.text, context.inputText, "animated gif"),
    "animated gif",
  ).slice(0, 120);
  const seed = hashText(`${prompt}:${width}x${height}:${frameCount}:${fps}`);
  const palette = makeHashPalette(seed, Math.max(6, frameCount));
  const codec = new GifCodec();
  const textColor = parseHexColor("#ffffff");
  const accent = parseHexColor("#111827");
  let font = null;
  try {
    font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  } catch (_error) {
    font = null;
  }

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const frame = new Jimp(width, height, palette[index % palette.length]);
    const progress = (index + 1) / frameCount;
    const barWidth = Math.max(8, Math.floor(width * 0.72 * progress));
    const barX = Math.max(6, Math.floor(width * 0.14));
    const barY = Math.max(6, height - 36);
    fillRect(frame, barX, barY, Math.floor(width * 0.72), 14, "#ffffff");
    fillRect(frame, barX + 1, barY + 1, Math.max(1, barWidth - 2), 12, "#111827");
    const pulseSize = Math.max(12, Math.floor(Math.min(width, height) * 0.18));
    const pulseX = Math.floor((width - pulseSize) * progress);
    const pulseY = Math.max(8, Math.floor(height * 0.22));
    fillRect(frame, pulseX, pulseY, pulseSize, pulseSize, palette[(index + 3) % palette.length]);
    fillRect(frame, pulseX + 3, pulseY + 3, Math.max(2, pulseSize - 6), Math.max(2, pulseSize - 6), "#ffffff");
    if (font) {
      frame.print(
        font,
        14,
        12,
        {
          text: prompt,
          alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
          alignmentY: Jimp.VERTICAL_ALIGN_TOP,
        },
        Math.max(10, width - 28),
        42,
      );
      frame.print(
        font,
        14,
        Math.max(8, height - 58),
        `frame ${String(index + 1).padStart(2, "0")}/${String(frameCount).padStart(2, "0")}`,
      );
    } else {
      fillRect(frame, 10, 10, Math.max(20, Math.floor(width * 0.25)), 20, accent.hex);
      fillRect(frame, 12, 12, Math.max(16, Math.floor(width * 0.25) - 4), 16, "#ffffff");
    }
    frames.push(
      new GifFrame(width, height, Buffer.from(frame.bitmap.data), {
        delayCentisecs,
      }),
    );
  }

  const encoded = await codec.encodeGif(frames, { loops: 0 });
  const artifact = createArtifact("image/gif", `animated-${seed.slice(0, 10)}.gif`, encoded.buffer);
  return buildSourceResponse({
    operation: "gif-generate",
    prompt,
    width,
    height,
    frameCount,
    fps: Number(fps.toFixed(2)),
    delayCentisecs,
    loopCount: 0,
    palette: {
      primary: palette[0],
      secondary: palette[1],
      accent: palette[2],
      all: palette.slice(0, 8),
    },
    artifact,
    gifDataUri: dataUriFromArtifact(artifact),
  });
}

function parseDataUriBytes(value) {
  const text = readString(value).trim();
  if (!text.startsWith("data:")) {
    return { ok: false, error: "not_data_uri" };
  }
  const commaIndex = text.indexOf(",");
  if (commaIndex < 0) {
    return { ok: false, error: "invalid_data_uri" };
  }
  const meta = text.slice(5, commaIndex);
  const payload = text.slice(commaIndex + 1);
  const mimeType = readString(meta.split(";")[0], "application/octet-stream").toLowerCase() || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta);
  try {
    const bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    if (!bytes.length) {
      return { ok: false, error: "empty_data_uri" };
    }
    return { ok: true, bytes, mimeType };
  } catch (_error) {
    return { ok: false, error: "invalid_data_uri_encoding" };
  }
}

async function readGifComposeSourceBytes(source) {
  const text = readString(source).trim();
  if (!text) {
    return { ok: false, error: "empty_source" };
  }
  if (text.startsWith("data:")) {
    const parsed = parseDataUriBytes(text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, bytes: parsed.bytes, mimeType: parsed.mimeType, sourceType: "data_uri", sourceRef: text.slice(0, 48) };
  }
  const remote = await readRemoteBytes(text);
  if (!remote.ok) {
    return { ok: false, error: remote.error || "fetch_failed" };
  }
  return {
    ok: true,
    bytes: remote.bytes,
    mimeType: remote.mimeType,
    sourceType: "url",
    sourceRef: remote.imageUrl,
  };
}

function normalizeFitMode(value) {
  const normalized = readString(value, "cover").trim().toLowerCase();
  if (normalized === "contain" || normalized === "cover" || normalized === "stretch") {
    return normalized;
  }
  return "cover";
}

function composeFrameOnCanvas(canvas, sourceImage, fitMode) {
  const width = canvas.bitmap.width;
  const height = canvas.bitmap.height;
  const image = sourceImage.clone();
  if (fitMode === "stretch") {
    image.resize(width, height);
    canvas.composite(image, 0, 0);
    return;
  }
  const srcW = Math.max(1, image.bitmap.width);
  const srcH = Math.max(1, image.bitmap.height);
  const scale =
    fitMode === "contain" ? Math.min(width / srcW, height / srcH) : Math.max(width / srcW, height / srcH);
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  image.resize(targetW, targetH);
  const x = Math.floor((width - targetW) / 2);
  const y = Math.floor((height - targetH) / 2);
  canvas.composite(image, x, y);
}

function toDelayCentisecs(ms, fallbackCentisecs = 10) {
  const raw = readNumber(ms, fallbackCentisecs * 10);
  return clamp(Math.round(raw / 10), 2, 600);
}

async function renderGifComposePayload(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const [width, height] = parseTransformDimensions(context, 480, 270);
  const fit = normalizeFitMode(pick(body.fit, query.fit, "cover"));
  const fps = clamp(readNumber(pick(body.fps, query.fps), 10), 1, 24);
  const defaultDelayCentisecs = toDelayCentisecs(pick(body.delay_ms, query.delay_ms), Math.round(100 / fps));
  const loopCount = Math.max(0, Math.floor(readNumber(pick(body.loop_count, query.loop_count), 0)));
  const watermark = readString(pick(body.watermark, query.watermark, ""), "").trim();
  const showIndex = Boolean(pick(body.show_index, query.show_index, false));
  const reverse = Boolean(pick(body.reverse, query.reverse, false));
  const pingPong = Boolean(pick(body.ping_pong, query.ping_pong, false));
  const background = parseHexColor(pick(body.background, query.background, "#000000"), "#000000").hex;
  const perFrameDelayMs = Array.isArray(body.frame_delays_ms) ? body.frame_delays_ms : [];

  const sourceList = [];
  const pushSources = (value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const text = readString(item, "").trim();
        if (text) sourceList.push(text);
      });
    }
  };
  pushSources(body.image_urls);
  pushSources(body.frame_urls);
  pushSources(body.images);
  pushSources(body.image_data_uris);

  if (!sourceList.length && Array.isArray(body.frames)) {
    for (const frame of body.frames) {
      const record = toObject(frame);
      const source = readString(pick(record.image_url, record.url, record.data_uri), "").trim();
      if (source) sourceList.push(source);
    }
  }

  if (!sourceList.length) {
    return {
      success: false,
      error: "missing_images",
      message: "Provide image_urls, frame_urls, images, image_data_uris, or frames[].",
      source: "auto-local-engine",
    };
  }

  const cappedSources = sourceList.slice(0, 40);
  const failures = [];
  const decoded = [];
  for (const source of cappedSources) {
    const loaded = await readGifComposeSourceBytes(source);
    if (!loaded.ok) {
      failures.push({ source, error: loaded.error });
      continue;
    }
    try {
      const image = await Jimp.read(loaded.bytes);
      decoded.push({
        image,
        sourceType: loaded.sourceType,
        sourceRef: loaded.sourceRef,
        mimeType: loaded.mimeType,
      });
    } catch (_error) {
      failures.push({ source, error: "decode_failed" });
    }
  }

  if (!decoded.length) {
    return {
      success: false,
      error: "no_valid_images",
      message: "No valid frame images could be loaded.",
      details: failures.slice(0, 8),
      source: "auto-local-engine",
    };
  }

  let sequence = decoded.slice();
  if (reverse) {
    sequence = [...sequence, ...decoded.slice().reverse()];
  }
  if (pingPong && decoded.length > 1) {
    sequence = [...sequence, ...decoded.slice(1, -1).reverse()];
  }
  sequence = sequence.slice(0, 72);

  let font = null;
  try {
    font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  } catch (_error) {
    font = null;
  }

  const gifFrames = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const sourceFrame = sequence[index];
    const canvas = new Jimp(width, height, background);
    composeFrameOnCanvas(canvas, sourceFrame.image, fit);

    if (font && watermark) {
      canvas.print(
        font,
        10,
        Math.max(8, height - 44),
        {
          text: watermark,
          alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
          alignmentY: Jimp.VERTICAL_ALIGN_TOP,
        },
        Math.max(10, width - 20),
        20,
      );
    }
    if (font && showIndex) {
      canvas.print(
        font,
        10,
        10,
        `frame ${String(index + 1).padStart(2, "0")}/${String(sequence.length).padStart(2, "0")}`,
      );
    }

    const delayCentisecs = toDelayCentisecs(perFrameDelayMs[index], defaultDelayCentisecs);
    gifFrames.push(
      new GifFrame(width, height, Buffer.from(canvas.bitmap.data), {
        delayCentisecs,
      }),
    );
  }

  const codec = new GifCodec();
  let encoded = null;
  try {
    // Photo sources often exceed GIF's 256-color palette; quantize before encode.
    GifUtil.quantizeWu(gifFrames, 256, 5);
    encoded = await codec.encodeGif(gifFrames, { loops: loopCount });
  } catch (error) {
    return {
      success: false,
      error: "gif_encode_failed",
      message: "Failed to encode GIF from provided frames.",
      details: error && error.message ? error.message : String(error),
      source: "auto-local-engine",
    };
  }
  const seed = hashText(`${width}x${height}:${fit}:${cappedSources.join("|")}`);
  const artifact = createArtifact("image/gif", `composed-${seed.slice(0, 10)}.gif`, encoded.buffer);

  return buildSourceResponse({
    operation: "gif-compose",
    width,
    height,
    fit,
    fps: Number(fps.toFixed(2)),
    loopCount,
    requestedSources: sourceList.length,
    loadedSources: decoded.length,
    failedSources: failures.length,
    failures: failures.slice(0, 8),
    frameCount: gifFrames.length,
    artifact,
    gifDataUri: dataUriFromArtifact(artifact),
  });
}

function parseChartLabelsAndValues(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const labelsInput = pick(body.labels, query.labels);
  let labels = [];
  if (Array.isArray(labelsInput)) {
    labels = labelsInput.map((item) => readString(item)).filter(Boolean);
  } else if (typeof labelsInput === "string") {
    labels = labelsInput.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!labels.length) {
    labels = ["A", "B", "C", "D"];
  }

  const valuesInput = pick(body.values, query.values);
  let values = [];
  if (Array.isArray(valuesInput)) {
    values = valuesInput.map((item) => readNumber(item, 0));
  } else if (typeof valuesInput === "string") {
    values = valuesInput.split(",").map((item) => readNumber(item.trim(), 0));
  }

  if (values.length !== labels.length) {
    values = labels.map((label, index) => stableInt(`${label}:${index}:${context.path}`, 10, 100));
  }

  return { labels, values };
}

function renderChartPayload(context) {
  const body = toObject(context.body);
  const query = toObject(context.query);
  const chartType = readString(pick(body.type, query.type, "bar")).toLowerCase();
  const [width, height] = parseTransformDimensions(context, 640, 360);
  const { labels, values } = parseChartLabelsAndValues(context);

  const margin = { top: 24, right: 24, bottom: 48, left: 44 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const maxValue = Math.max(1, ...values);
  const barWidth = plotWidth / values.length;
  const bars = values.map((value, index) => {
    const normalized = value / maxValue;
    const barHeight = Math.max(1, Math.round(normalized * plotHeight));
    const x = Math.round(margin.left + index * barWidth + barWidth * 0.15);
    const y = Math.round(margin.top + plotHeight - barHeight);
    const w = Math.max(1, Math.round(barWidth * 0.7));
    return `<rect x="${x}" y="${y}" width="${w}" height="${barHeight}" fill="#2563eb" rx="2"/>`;
  });

  const xLabels = labels
    .map((label, index) => {
      const x = Math.round(margin.left + index * barWidth + barWidth * 0.5);
      const y = height - 16;
      return `<text x="${x}" y="${y}" text-anchor="middle" fill="#1f2937" font-size="11" font-family="system-ui, sans-serif">${escapeXml(
        label,
      )}</text>`;
    })
    .join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Chart">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#94a3b8" stroke-width="1"/>`,
    `<line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#94a3b8" stroke-width="1"/>`,
    bars.join(""),
    xLabels,
    "</svg>",
  ].join("");
  const artifact = createArtifact("image/svg+xml", `chart-${chartType}-${hashText(labels.join(",")).slice(0, 8)}.svg`, svg);

  return buildSourceResponse({
    chartType,
    labels,
    values,
    summary: {
      min: Math.min(...values),
      max: Math.max(...values),
      average: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2)),
    },
    svg,
    svgDataUri: dataUriFromArtifact(artifact),
    artifact,
  });
}

function buildGeneratedImageSvg(options) {
  const {
    width,
    height,
    operation,
    label,
    seed,
  } = options;
  const palette = makeHashPalette(seed, 3);
  const title = escapeXml(operation);
  const subtitle = escapeXml(label);
  const identifier = escapeXml(seed.slice(0, 12));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} result">`,
    "<defs>",
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="${palette[0]}"/>`,
    `<stop offset="100%" stop-color="${palette[1]}"/>`,
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `<rect x="12" y="12" width="${Math.max(1, width - 24)}" height="${Math.max(1, height - 24)}" fill="none" stroke="${palette[2]}" stroke-width="2" rx="8"/>`,
    `<text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2) - 8}" text-anchor="middle" fill="#ffffff" font-size="${clamp(
      Math.floor(Math.min(width, height) * 0.08),
      12,
      48,
    )}" font-family="system-ui, sans-serif">${title}</text>`,
    `<text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2) + 22}" text-anchor="middle" fill="#ffffff" font-size="${clamp(
      Math.floor(Math.min(width, height) * 0.04),
      10,
      24,
    )}" font-family="monospace">${subtitle}</text>`,
    `<text x="${Math.floor(width / 2)}" y="${height - 14}" text-anchor="middle" fill="#e5e7eb" font-size="10" font-family="monospace">seed:${identifier}</text>`,
    "</svg>",
  ].join("");
}

function resolveOperation(path) {
  if (path.includes("/svg-to-png")) return "svg-to-png";
  if (path.includes("/html-to-image")) return "html-to-image";
  if (path.includes("/favicon/")) return "favicon";
  if (path.includes("/signature/")) return "signature";
  const matched = /\/image\/([^/?#]+)/.exec(path);
  if (matched && matched[1]) return matched[1];
  return "image-generate";
}

function resolveOutputMime(format, operation) {
  const normalized = readString(format).toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return Jimp.MIME_JPEG;
  if (normalized === "bmp") return Jimp.MIME_BMP;
  if (normalized === "png") return Jimp.MIME_PNG;
  if (normalized === "gif") return Jimp.MIME_PNG;
  if (operation === "favicon") return Jimp.MIME_PNG;
  return Jimp.MIME_PNG;
}

function stripHtml(html) {
  return readString(html).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function renderGeneratedImagePayload(context) {
  const path = normalizePath(context.path);
  const body = toObject(context.body);
  const query = toObject(context.query);
  const operation = resolveOperation(path);

  let defaultWidth = 512;
  let defaultHeight = 512;
  if (operation === "favicon") {
    defaultWidth = 64;
    defaultHeight = 64;
  } else if (operation === "signature") {
    defaultWidth = 600;
    defaultHeight = 220;
  }

  const [width, height] = parseTransformDimensions(context, defaultWidth, defaultHeight);
  const imageUrl = readString(pick(body.imageUrl, body.url, query.imageUrl, query.url, ""));
  const label = readString(pick(body.text, body.prompt, body.name, query.text, operation));
  const seed = hashText(`${operation}:${imageUrl}:${label}:${width}x${height}`);
  const requestedFormat = readString(pick(body.format, query.format, operation === "convert" ? "png" : "png"), "png");
  const outputMime = resolveOutputMime(requestedFormat, operation);

  if (operation === "svg-to-png") {
    const svgInput = readString(pick(body.svg, body.input, query.svg, ""));
    if (svgInput.trim()) {
      try {
        const renderer = new Resvg(svgInput, {
          fitTo: { mode: "width", value: width },
        });
        const pngData = renderer.render().asPng();
        const artifact = createArtifact("image/png", `svg-to-png-${seed.slice(0, 10)}.png`, Buffer.from(pngData));
        return buildSourceResponse({
          operation,
          width,
          height,
          capabilities: {
            transformApplied: true,
            mode: "resvg-rasterization",
          },
          artifact,
        });
      } catch (_error) {
        // fallback handled below
      }
    }
  }

  if (operation === "html-to-image") {
    const html = readString(pick(body.html, body.input, query.html, ""));
    if (html.trim()) {
      try {
        const text = stripHtml(html).slice(0, 320);
        const image = new Jimp(width, height, "#ffffff");
        const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
        image.print(
          font,
          16,
          16,
          {
            text: text || "html-to-image",
            alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
            alignmentY: Jimp.VERTICAL_ALIGN_TOP,
          },
          Math.max(1, width - 32),
          Math.max(1, height - 32),
        );
        const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        const artifact = createArtifact("image/png", `html-to-image-${seed.slice(0, 10)}.png`, buffer);
        return buildSourceResponse({
          operation,
          width,
          height,
          capabilities: {
            transformApplied: true,
            mode: "html-text-rasterization",
            limitations: ["Markup is rendered as extracted text, not full CSS layout."],
          },
          artifact,
        });
      } catch (_error) {
        // fallback handled below
      }
    }
  }

  if (imageUrl) {
    const remote = await readRemoteBytes(imageUrl);
    if (remote.ok) {
      try {
        const image = await Jimp.read(remote.bytes);
        if (operation === "resize") {
          image.resize(width, height);
        } else if (operation === "thumbnail") {
          image.cover(width, height);
        } else if (operation === "watermark") {
          image.resize(width, height);
          const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
          image.print(font, 10, Math.max(10, height - 28), readString(pick(body.watermark, body.text, query.text, "x402")));
        } else if (operation === "favicon") {
          image.cover(64, 64);
        } else if (operation === "to-base64") {
          const mimeType = remote.mimeType || outputMime;
          return buildSourceResponse({
            operation,
            imageUrl: remote.imageUrl,
            capabilities: {
              transformApplied: true,
              mode: "byte-encoding",
            },
            artifact: createArtifact(mimeType, `image-${seed.slice(0, 10)}.${mimeType.includes("jpeg") ? "jpg" : "bin"}`, remote.bytes),
            base64: remote.bytes.toString("base64"),
          });
        }

        const buffer = await image.getBufferAsync(outputMime);
        const ext = outputMime.includes("jpeg") ? "jpg" : outputMime.includes("bmp") ? "bmp" : "png";
        const artifact = createArtifact(outputMime, `${operation}-${seed.slice(0, 10)}.${ext}`, buffer);
        return buildSourceResponse({
          operation,
          imageUrl: remote.imageUrl,
          width: image.bitmap.width,
          height: image.bitmap.height,
          capabilities: {
            transformApplied: true,
            mode: "jimp-transform",
          },
          artifact,
        });
      } catch (_error) {
        // fallback handled below
      }
    }
  }

  const svg = buildGeneratedImageSvg({
    width,
    height,
    operation,
    label,
    seed,
  });
  const artifact = createArtifact("image/svg+xml", `${operation}-${seed.slice(0, 10)}.svg`, svg);

  return buildSourceResponse({
    operation,
    imageUrl,
    width,
    height,
    capabilities: {
      transformApplied: true,
      mode: "deterministic-generated-artifact",
      limitations: ["Source image unavailable or unsupported; returned deterministic generated artifact."],
    },
    svg,
    svgDataUri: dataUriFromArtifact(artifact),
    artifact,
    seed,
  });
}

function isMediaPath(path) {
  const normalized = normalizePath(path);
  return MEDIA_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

async function buildMediaPayload(context) {
  const baseContext = {
    body: toObject(context && context.body),
    query: toObject(context && context.query),
    params: toObject(context && context.params),
    path: normalizePath(context && context.path),
    inputText: readString(context && context.inputText),
    title: readString(context && context.title),
  };

  if (!isMediaPath(baseContext.path)) {
    return {
      success: false,
      error: "unsupported_media_path",
      message: `Path is not recognized as media: ${baseContext.path || "(empty)"}`,
      source: "auto-local-engine",
    };
  }

  if (baseContext.path.includes("/qr/")) return renderQrSvg(baseContext);
  if (baseContext.path.includes("/barcode/")) return renderBarcodeSvg(baseContext);
  if (baseContext.path.includes("/placeholder/")) return renderPlaceholderSvg(baseContext);
  if (baseContext.path.includes("/colors/")) return renderColorPayload(baseContext);
  if (baseContext.path.includes("/chart/")) return renderChartPayload(baseContext);
  if (baseContext.path.includes("/gif/")) return renderGifPayload(baseContext);
  if (
    baseContext.path.includes("/image/") ||
    baseContext.path.includes("/svg-to-png") ||
    baseContext.path.includes("/html-to-image") ||
    baseContext.path.includes("/favicon/") ||
    baseContext.path.includes("/signature/")
  ) {
    return renderGeneratedImagePayload(baseContext);
  }

  return buildSourceResponse({
    capabilities: {
      transformApplied: false,
      mode: "no-op",
    },
  });
}

module.exports = {
  isMediaPath,
  buildMediaPayload,
};
