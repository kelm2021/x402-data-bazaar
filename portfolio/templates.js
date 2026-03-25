const fs = require("node:fs/promises");
const path = require("node:path");
const { getSellerBlueprintById } = require("./index");

const HANDLER_TEMPLATE_BY_SELLER_ID = {
  "weather-decision": "handlers/weather-decision.js",
  "calendar-business-days": "handlers/calendar-business-days.js",
  "fx-conversion-quotes": "handlers/fx-conversion-quotes.js",
  "vehicle-vin": "handlers/vehicle-vin.js",
};

function getHandlerTemplatePath(sellerId) {
  const relativePath = HANDLER_TEMPLATE_BY_SELLER_ID[sellerId];
  if (!relativePath) {
    return null;
  }

  return path.join(__dirname, relativePath);
}

function toPersistedRoute(route) {
  return {
    key: route.key,
    method: route.method,
    routePath: route.routePath,
    expressPath: route.expressPath,
    resourcePath: route.resourcePath,
    canonicalPath: route.canonicalPath ?? route.resourcePath,
    price: route.price,
    description: route.description,
    queryExample: route.queryExample ?? {},
    outputExample: route.outputExample ?? null,
  };
}

async function syncPortfolioSellerConfig({ sellerId, sellerDir }) {
  const seller = getSellerBlueprintById(sellerId);
  const configPath = path.join(sellerDir, "seller.config.json");
  const persistedRoutes = (seller.surfaceRoutes ?? []).map((route) => toPersistedRoute(route));

  if (!persistedRoutes.length) {
    return { updated: false, configPath };
  }

  const raw = await fs.readFile(configPath, "utf8");
  const sellerConfig = JSON.parse(raw);
  sellerConfig.route = toPersistedRoute(seller.surfaceHeroRoute ?? persistedRoutes[0]);
  sellerConfig.routes = persistedRoutes;
  await fs.writeFile(configPath, `${JSON.stringify(sellerConfig, null, 2)}\n`, "utf8");

  return { updated: true, configPath };
}

async function installPortfolioTemplate({ sellerId, sellerDir }) {
  const templatePath = getHandlerTemplatePath(sellerId);
  const configSync = await syncPortfolioSellerConfig({ sellerId, sellerDir });
  if (!templatePath) {
    return { installed: false, reason: "no-template", configSync };
  }

  const targetPath = path.join(sellerDir, "handlers", "primary.js");
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(templatePath, targetPath);

  return {
    installed: true,
    templatePath,
    targetPath,
    configSync,
  };
}

module.exports = {
  getHandlerTemplatePath,
  installPortfolioTemplate,
};
