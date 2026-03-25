const fs = require("node:fs");
const path = require("node:path");
const { Redis } = require("@upstash/redis");
const { createRouteCatalog, createRouteConfig } = require("../app");

const METRICS_NAMESPACE = "metrics:v1";

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex);
        let value = line.slice(separatorIndex + 1);

        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        return [key, value.replace(/\\n/g, "\n")];
      }),
  );
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function createRedisClient(env) {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required.");
  }

  return new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
    enableTelemetry: false,
  });
}

function toMicros(price) {
  const numeric = Number(price);
  return Number.isFinite(numeric) ? Math.round(numeric * 1_000_000) : 0;
}

async function main() {
  const defaultEnvPath = path.join(process.cwd(), ".env.vercel.production.check");
  const envFile = getArgValue("--env-file") || defaultEnvPath;
  const fileEnv = loadEnvFile(envFile);
  const env = {
    ...fileEnv,
    ...process.env,
  };
  const redis = createRedisClient(env);
  const routeCatalog = createRouteCatalog(createRouteConfig());
  const routeCatalogMap = new Map(routeCatalog.map((route) => [route.key, route]));

  const routeKeys = Array.from(
    new Set([
      ...routeCatalogMap.keys(),
      ...((await redis.smembers(`${METRICS_NAMESPACE}:route-keys`)) ?? []).map(String),
    ]),
  );

  let routeRevenueUpdates = 0;
  let totalPaidUsdMicros = 0;

  for (const routeKey of routeKeys) {
    const redisKey = `${METRICS_NAMESPACE}:route:${encodeURIComponent(routeKey)}`;
    const saved = await redis.hgetall(redisKey);
    if (!saved || Object.keys(saved).length === 0) {
      continue;
    }

    const paidSuccess = Number(saved.paidSuccess || 0);
    const priceUsdMicros =
      Number(saved.priceUsdMicros || 0) ||
      Number(routeCatalogMap.get(routeKey)?.priceUsdMicros || 0);
    const paidUsdMicros = paidSuccess > 0 && priceUsdMicros > 0 ? paidSuccess * priceUsdMicros : 0;

    totalPaidUsdMicros += paidUsdMicros;

    await redis.hset(redisKey, {
      priceUsdMicros: String(priceUsdMicros),
      paidUsdMicros: String(paidUsdMicros),
    });
    routeRevenueUpdates += 1;
  }

  const sourceKeys = ((await redis.smembers(`${METRICS_NAMESPACE}:source-keys`)) ?? []).map(String);
  let attributedExternalPaidSuccess = 0;
  let attributedSelfTaggedPaidSuccess = 0;
  let sourceSplitUpdates = 0;

  for (const sourceId of sourceKeys) {
    const redisKey = `${METRICS_NAMESPACE}:source:${encodeURIComponent(sourceId)}`;
    const saved = await redis.hgetall(redisKey);
    if (!saved || Object.keys(saved).length === 0) {
      continue;
    }

    const paidSuccess = Number(saved.paidSuccess || 0);
    let externalPaidSuccess = 0;
    let selfTaggedPaidSuccess = 0;

    if (saved.sourceKind === "self-tagged") {
      selfTaggedPaidSuccess = paidSuccess;
    } else {
      externalPaidSuccess = paidSuccess;
    }

    attributedExternalPaidSuccess += externalPaidSuccess;
    attributedSelfTaggedPaidSuccess += selfTaggedPaidSuccess;

    await redis.hset(redisKey, {
      externalPaidSuccess: String(externalPaidSuccess),
      selfTaggedPaidSuccess: String(selfTaggedPaidSuccess),
    });
    sourceSplitUpdates += 1;
  }

  await redis.hset(`${METRICS_NAMESPACE}:totals`, {
    paidUsdMicros: String(totalPaidUsdMicros),
    externalPaidSuccess: String(attributedExternalPaidSuccess),
    selfTaggedPaidSuccess: String(attributedSelfTaggedPaidSuccess),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        envFile,
        routeRevenueUpdates,
        sourceSplitUpdates,
        totalPaidUsd: Number((totalPaidUsdMicros / 1_000_000).toFixed(3)),
        attributedExternalPaidSuccess,
        attributedSelfTaggedPaidSuccess,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error?.message || "Unknown error",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
