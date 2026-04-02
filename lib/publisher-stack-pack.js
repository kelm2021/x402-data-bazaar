const fs = require("node:fs");
const path = require("node:path");

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePublisherPack(options = {}) {
  const outputDir = path.resolve(String(options.outputDir || "").trim());
  if (!outputDir) {
    throw new Error("outputDir is required.");
  }
  const document = options.document;
  if (!document || !document.corpus || !Array.isArray(document.corpus.articles)) {
    throw new Error("document.corpus.articles is required.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const files = {
    corpus: path.join(outputDir, "publisher-corpus.json"),
    runtimeEnv: path.join(outputDir, ".env.publisher-stack"),
    wrappedRegistration: path.join(outputDir, "wrapped-registration.json"),
    manifest: path.join(outputDir, "pack-manifest.json"),
  };

  writeJson(files.corpus, document);

  const runtimeEnvLines = [
    "# Publisher Stack runtime env",
    "PUBLISHER_STACK_CORPUS_PATH=./publisher-corpus.json",
  ];
  fs.writeFileSync(files.runtimeEnv, `${runtimeEnvLines.join("\n")}\n`, "utf8");

  const wrappedRegistration = document.distribution?.wrapped || {};
  writeJson(files.wrappedRegistration, wrappedRegistration);

  const manifest = {
    generatedAt: new Date().toISOString(),
    corpus: {
      name: document.corpus.name,
      description: document.corpus.description || "",
      articleCount: document.corpus.articles.length,
    },
    files: {
      corpus: path.basename(files.corpus),
      runtimeEnv: path.basename(files.runtimeEnv),
      wrappedRegistration: path.basename(files.wrappedRegistration),
    },
    runtime: {
      env: {
        PUBLISHER_STACK_CORPUS_PATH: "./publisher-corpus.json",
      },
    },
    wrapped: wrappedRegistration,
  };
  writeJson(files.manifest, manifest);

  return { outputDir, files, manifest };
}

module.exports = {
  writePublisherPack,
};
