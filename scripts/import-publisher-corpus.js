#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { importBeehiivExport, importEmdashExport, importMarkdownCorpus, importWordpressWxr } = require("../lib/publisher-stack-import");

function readArg(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return "";
  }
  return String(args[index + 1] || "").trim();
}

function hasArg(args, flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Usage:
  node scripts/import-publisher-corpus.js --input <dir> [options]
  node scripts/import-publisher-corpus.js --wxr <file> [options]
  node scripts/import-publisher-corpus.js --emdash <file> [options]
  node scripts/import-publisher-corpus.js --beehiiv <file> [options]

Options:
  --input <dir>                 Markdown directory to import
  --wxr <file>                  WordPress WXR export file to import
  --emdash <file>               EmDash export JSON file to import
  --beehiiv <file>              Beehiiv export JSON file to import
  --output <file>               Write normalized corpus JSON to file
  --name <text>                 Corpus name
  --description <text>          Corpus description
  --default-author <text>       Default author name for files without front matter
  --default-author-slug <text>  Default author slug
  --wrapped-origin <url>        Optional Wrapped origin URL metadata
  --wrapped-wallet <address>    Optional Wrapped payout wallet metadata
  --wrapped-price <usdc>        Optional Wrapped per-request price metadata
  --wrapped-path <pattern>      Optional Wrapped path pattern metadata
  --stdout                      Print JSON to stdout even when --output is used
  --help                        Show this help message
`);
}

function main() {
  const args = process.argv.slice(2);
  if (hasArg(args, "--help") || !args.length) {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }

  const inputDir = readArg(args, "--input");
  const wxrFile = readArg(args, "--wxr");
  const emdashFile = readArg(args, "--emdash");
  const beehiivFile = readArg(args, "--beehiiv");
  if (!inputDir && !wxrFile && !emdashFile && !beehiivFile) {
    throw new Error("--input, --wxr, --emdash, or --beehiiv is required.");
  }

  const commonOptions = {
    corpusName: readArg(args, "--name"),
    corpusDescription: readArg(args, "--description"),
    defaultAuthorName: readArg(args, "--default-author"),
    defaultAuthorSlug: readArg(args, "--default-author-slug"),
    wrapped: {
      originUrl: readArg(args, "--wrapped-origin"),
      paymentWallet: readArg(args, "--wrapped-wallet"),
      price: readArg(args, "--wrapped-price"),
      pathPattern: readArg(args, "--wrapped-path"),
    },
  };

  const payload = beehiivFile
    ? importBeehiivExport({
      inputFile: beehiivFile,
      ...commonOptions,
    })
    : emdashFile
    ? importEmdashExport({
      inputFile: emdashFile,
      ...commonOptions,
    })
    : wxrFile
    ? importWordpressWxr({
      inputFile: wxrFile,
      ...commonOptions,
    })
    : importMarkdownCorpus({
      inputDir,
      ...commonOptions,
    });

  const outputJson = `${JSON.stringify(payload, null, 2)}\n`;
  const outputPath = readArg(args, "--output");
  if (outputPath) {
    const absoluteOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, outputJson, "utf8");
    console.error(`Wrote corpus JSON to ${absoluteOutputPath}`);
  }

  if (!outputPath || hasArg(args, "--stdout")) {
    process.stdout.write(outputJson);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
