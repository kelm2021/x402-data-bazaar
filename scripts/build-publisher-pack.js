#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { importBeehiivExport, importEmdashExport, importMarkdownCorpus, importWordpressWxr } = require("../lib/publisher-stack-import");
const { writePublisherPack } = require("../lib/publisher-stack-pack");

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
  node scripts/build-publisher-pack.js --corpus <file> --outdir <dir>
  node scripts/build-publisher-pack.js --input <dir> --outdir <dir> [options]
  node scripts/build-publisher-pack.js --wxr <file> --outdir <dir> [options]
  node scripts/build-publisher-pack.js --emdash <file> --outdir <dir> [options]
  node scripts/build-publisher-pack.js --beehiiv <file> --outdir <dir> [options]

Options:
  --corpus <file>               Existing normalized corpus JSON file
  --input <dir>                 Markdown directory to import
  --wxr <file>                  WordPress WXR export file to import
  --emdash <file>               EmDash export JSON file to import
  --beehiiv <file>              Beehiiv export JSON file to import
  --outdir <dir>                Output directory for pack artifacts
  --name <text>                 Corpus name override
  --description <text>          Corpus description override
  --default-author <text>       Default author name
  --default-author-slug <text>  Default author slug
  --wrapped-origin <url>        Wrapped origin URL
  --wrapped-wallet <address>    Wrapped payout wallet
  --wrapped-price <usdc>        Wrapped per-request price
  --wrapped-path <pattern>      Wrapped path pattern
  --help                        Show this help message
`);
}

function commonOptions(args) {
  return {
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
}

function main() {
  const args = process.argv.slice(2);
  if (hasArg(args, "--help") || !args.length) {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }

  const outdir = readArg(args, "--outdir");
  if (!outdir) {
    throw new Error("--outdir is required.");
  }

  const corpusPath = readArg(args, "--corpus");
  const markdownDir = readArg(args, "--input");
  const wxrFile = readArg(args, "--wxr");
  const emdashFile = readArg(args, "--emdash");
  const beehiivFile = readArg(args, "--beehiiv");

  let document;
  if (corpusPath) {
    document = JSON.parse(fs.readFileSync(path.resolve(corpusPath), "utf8"));
  } else if (beehiivFile) {
    document = importBeehiivExport({ inputFile: beehiivFile, ...commonOptions(args) });
  } else if (emdashFile) {
    document = importEmdashExport({ inputFile: emdashFile, ...commonOptions(args) });
  } else if (wxrFile) {
    document = importWordpressWxr({ inputFile: wxrFile, ...commonOptions(args) });
  } else if (markdownDir) {
    document = importMarkdownCorpus({ inputDir: markdownDir, ...commonOptions(args) });
  } else {
    throw new Error("Provide --corpus, --input, --wxr, --emdash, or --beehiiv.");
  }

  const result = writePublisherPack({ outputDir: outdir, document });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
