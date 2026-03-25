const { createRouteConfig, PAY_TO } = require("../app");
const { SELLER_BLUEPRINTS } = require("./blueprints");
const { getSellerStrategy } = require("./strategy");

const LAUNCH_TIER_WEIGHT = {
  P1: 60,
  P2: 35,
  P3: 15,
};

const TRACK_WEIGHT = {
  core: 140,
  "legacy-keep": 20,
  "legacy-kill": -120,
};

const TRACK_SORT_PRIORITY = {
  core: 0,
  "legacy-keep": 1,
  "legacy-kill": 2,
};

function getPrimaryAccept(config = {}) {
  if (Array.isArray(config.accepts)) {
    return config.accepts[0] ?? {};
  }

  return config.accepts ?? {};
}

function normalizePriceValue(price) {
  if (price == null) {
    return null;
  }

  const normalized = String(price).replace(/\s*USDC$/i, "").trim();
  return normalized.startsWith("$") ? normalized.slice(1) : normalized;
}

function toResourcePath(resource) {
  if (!resource) {
    return null;
  }

  try {
    const parsed = new URL(resource);
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return String(resource);
  }
}

function normalizeComparableUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const entries = [...parsed.searchParams.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const search = new URLSearchParams(entries).toString();
    return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`;
  } catch (error) {
    return String(value).trim();
  }
}

function getQueryExample(config = {}) {
  return config.extensions?.bazaar?.info?.input?.queryParams ?? {};
}

function getOutputExample(config = {}) {
  return config.extensions?.bazaar?.info?.output?.example ?? null;
}

function formatRoutePriceLabel(price) {
  if (price == null) {
    return null;
  }

  const normalizedPrice = String(price).startsWith("$") ? String(price) : `$${price}`;
  return `${normalizedPrice} USDC`;
}

function createRouteMeta(routeKey, routes) {
  const config = routes[routeKey];
  if (!config) {
    throw new Error(`Unknown route key in seller portfolio: ${routeKey}`);
  }

  const [method, routePath] = routeKey.split(" ");
  const accept = getPrimaryAccept(config);

  return {
    key: routeKey,
    method,
    routePath,
    description: config.description ?? "",
    price: normalizePriceValue(accept.price ?? config.price ?? null),
    priceLabel: formatRoutePriceLabel(accept.price ?? config.price ?? null),
    payTo: accept.payTo ?? PAY_TO,
    resource: config.resource ?? null,
    resourcePath: toResourcePath(config.resource),
    queryExample: getQueryExample(config),
    outputExample: getOutputExample(config),
  };
}

function createRouteMetaFromSurfaceRoute(route) {
  const normalized = normalizeSurfaceRoute(route);
  return {
    key: normalized.key,
    method: normalized.method,
    routePath: normalized.routePath,
    description: normalized.description,
    price: normalized.price,
    priceLabel: normalized.priceLabel,
    payTo: normalized.payTo,
    resource: normalized.resource,
    resourcePath: normalized.resourcePath,
    canonicalPath: normalized.canonicalPath,
    expressPath: normalized.expressPath,
    queryExample: normalized.queryExample,
    outputExample: normalized.outputExample,
  };
}

function normalizeSurfaceRoute(route, defaultPayTo = PAY_TO) {
  const [derivedMethod, ...derivedPathParts] = String(route.key ?? "").split(" ");
  const routePath = route.routePath ?? derivedPathParts.join(" ");
  const price = normalizePriceValue(route.price ?? null);

  return {
    key: route.key,
    method: route.method ?? derivedMethod,
    routePath,
    expressPath: route.expressPath ?? routePath,
    description: route.description ?? "",
    price,
    priceLabel: formatRoutePriceLabel(price),
    payTo: route.payTo ?? defaultPayTo,
    resource: route.resource ?? route.resourcePath ?? null,
    resourcePath: route.resourcePath ?? toResourcePath(route.resource),
    canonicalPath: route.canonicalPath ?? route.resourcePath ?? toResourcePath(route.resource),
    queryExample: route.queryExample ?? {},
    outputExample: route.outputExample ?? null,
  };
}

function deriveExpressPath(routeMeta, blueprint) {
  if (blueprint.heroExpressPath) {
    return blueprint.heroExpressPath;
  }

  if (!routeMeta.routePath.includes("*")) {
    return routeMeta.routePath;
  }

  throw new Error(
    `Seller blueprint ${blueprint.id} needs heroExpressPath for wildcard route ${routeMeta.key}`,
  );
}

function createSellerPortfolio(options = {}) {
  const routes = options.routes ?? createRouteConfig();
  const blueprints = options.blueprints ?? SELLER_BLUEPRINTS;

  return blueprints.map((blueprint) => {
    const strategy = getSellerStrategy(blueprint.id);
    const routeKeys = [...new Set(blueprint.routeKeys ?? [blueprint.heroRouteKey])];
    const routeEntries = routeKeys.map((routeKey) => {
      if (routes[routeKey]) {
        return createRouteMeta(routeKey, routes);
      }

      const fallbackRoute = Array.isArray(blueprint.surfaceRoutes)
        ? blueprint.surfaceRoutes.find((route) => route.key === routeKey)
        : null;

      if (fallbackRoute) {
        return createRouteMetaFromSurfaceRoute(fallbackRoute);
      }

      throw new Error(`Unknown route key in seller portfolio: ${routeKey}`);
    });
    const heroRoute = routeEntries.find((entry) => entry.key === blueprint.heroRouteKey);

    if (!heroRoute) {
      throw new Error(`Seller blueprint ${blueprint.id} is missing its hero route`);
    }

    const surfaceRoutes =
      Array.isArray(blueprint.surfaceRoutes) && blueprint.surfaceRoutes.length
        ? blueprint.surfaceRoutes.map((route) =>
            normalizeSurfaceRoute(route, heroRoute.payTo ?? PAY_TO),
          )
        : routeEntries;
    const surfaceHeroRoute =
      surfaceRoutes.find(
        (entry) => entry.key === (blueprint.surfaceHeroRouteKey ?? blueprint.heroRouteKey),
      ) ?? surfaceRoutes[0];

    return {
      ...blueprint,
      ...strategy,
      routeKeys,
      routes: routeEntries,
      surfaceRoutes,
      heroRoute,
      surfaceHeroRoute,
      heroExpressPath: deriveExpressPath(heroRoute, blueprint),
      payTo: heroRoute.payTo,
    };
  });
}

function getSellerBlueprintById(id, options = {}) {
  const portfolio = options.portfolio ?? createSellerPortfolio(options);
  const seller = portfolio.find((entry) => entry.id === id);

  if (!seller) {
    const knownIds = portfolio.map((entry) => entry.id).join(", ");
    throw new Error(`Unknown seller id "${id}". Known sellers: ${knownIds}`);
  }

  return seller;
}

function buildSellerScaffoldConfig(id, options = {}) {
  const seller = getSellerBlueprintById(id, options);
  const scaffoldRoute = seller.surfaceHeroRoute ?? seller.heroRoute;
  const packageName = options.packageName ?? seller.id;
  const serviceName = options.serviceName ?? seller.serviceName;
  const baseUrl = options.baseUrl ?? `https://${packageName}.vercel.app`;
  const heroQueryExample =
    options.queryExample ??
    seller.heroQueryExample ??
    scaffoldRoute.queryExample ??
    {};

  return {
    packageName,
    payTo: options.payTo ?? seller.payTo ?? PAY_TO,
    serviceName,
    serviceDescription: options.serviceDescription ?? seller.serviceDescription,
    baseUrl,
    route: {
      key: scaffoldRoute.key,
      expressPath: options.expressPath ?? scaffoldRoute.expressPath,
      resourcePath: options.resourcePath ?? scaffoldRoute.resourcePath,
      canonicalPath: scaffoldRoute.canonicalPath,
      price: options.routePrice ?? scaffoldRoute.price,
      description: options.routeDescription ?? scaffoldRoute.description,
      queryExample: heroQueryExample,
      outputExample: options.outputExample ?? scaffoldRoute.outputExample,
    },
    portfolio: {
      sellerId: seller.id,
      category: seller.category,
      launchTier: seller.launchTier,
      routeKeys: seller.routeKeys,
      surfaceRouteKeys: seller.surfaceRoutes.map((route) => route.key),
      bazaarSearchTerms: seller.bazaarSearchTerms,
      upstreams: seller.upstreams,
      why: seller.why,
    },
  };
}

function aggregateRouteMetrics(routeMetricsList) {
  const empty = {
    total: 0,
    success: 0,
    paidSuccess: 0,
    paymentRequired: 0,
    clientErrors: 0,
    serverErrors: 0,
    averageLatencyMs: null,
    lastSeenAt: null,
  };

  if (!routeMetricsList.length) {
    return empty;
  }

  let latencyNumerator = 0;
  let latencyDenominator = 0;
  let lastSeenAt = null;

  const aggregate = routeMetricsList.reduce((accumulator, entry) => {
    accumulator.total += entry.total ?? 0;
    accumulator.success += entry.success ?? 0;
    accumulator.paidSuccess += entry.paidSuccess ?? 0;
    accumulator.paymentRequired += entry.paymentRequired ?? 0;
    accumulator.clientErrors += entry.clientErrors ?? 0;
    accumulator.serverErrors += entry.serverErrors ?? 0;

    if (Number.isFinite(entry.averageLatencyMs) && Number.isFinite(entry.total)) {
      latencyNumerator += entry.averageLatencyMs * entry.total;
      latencyDenominator += entry.total;
    }

    if (entry.lastSeenAt && (!lastSeenAt || entry.lastSeenAt > lastSeenAt)) {
      lastSeenAt = entry.lastSeenAt;
    }

    return accumulator;
  }, empty);

  aggregate.averageLatencyMs =
    latencyDenominator > 0 ? Math.round(latencyNumerator / latencyDenominator) : null;
  aggregate.lastSeenAt = lastSeenAt;
  return aggregate;
}

function collectDiscoveryResources(item) {
  const resources = [];

  if (item?.resource) {
    resources.push(item.resource);
  }

  const accepts = Array.isArray(item?.accepts) ? item.accepts : [item?.accepts];
  for (const accept of accepts) {
    if (accept?.resource) {
      resources.push(accept.resource);
    }
  }

  return resources;
}

function summarizeDiscovery(seller, discoveryItems = []) {
  const wantedResources = seller.routes
    .map((route) => normalizeComparableUrl(route.resource))
    .filter(Boolean);
  const matches = discoveryItems.filter((item) =>
    collectDiscoveryResources(item)
      .map((value) => normalizeComparableUrl(value))
      .some((value) => wantedResources.includes(value)),
  );

  return {
    indexed: matches.length > 0,
    matchCount: matches.length,
    matches: matches.map((item) => ({
      resource: item.resource ?? null,
      description: item.description ?? null,
      lastUpdated: item.lastUpdated ?? null,
    })),
  };
}

function recommendAction(seller, metrics, discovery) {
  if (seller.track === "legacy-kill") {
    return metrics.total > 0 ? "hold-or-retire" : "retire-when-safe";
  }

  if (seller.track === "legacy-keep") {
    if (metrics.serverErrors > 0) {
      return "stabilize-only";
    }

    if (discovery.indexed && metrics.paidSuccess >= 1) {
      return "keep-live";
    }

    if (metrics.paymentRequired >= 1 || metrics.paidSuccess >= 1) {
      return "freeze-and-monitor";
    }

    return "freeze";
  }

  if (metrics.serverErrors > 0) {
    return "fix-before-scale";
  }

  if (!discovery.indexed && metrics.paidSuccess >= 1) {
    return "prove-distribution";
  }

  if (!discovery.indexed && metrics.paymentRequired >= 25) {
    return "index-now";
  }

  if (!discovery.indexed && metrics.paidSuccess >= 1) {
    return "verify-and-index";
  }

  if (discovery.indexed && metrics.paidSuccess >= 1) {
    return "scale";
  }

  if (metrics.paymentRequired >= 1) {
    return "monitor";
  }

  return seller.launchTier === "P1" ? "scaffold-now" : "catalog-later";
}

function scoreSeller(seller, metrics, discovery) {
  const tierWeight = LAUNCH_TIER_WEIGHT[seller.launchTier] ?? 0;
  const trackWeight = TRACK_WEIGHT[seller.track] ?? 0;
  const demandScore =
    metrics.paymentRequired * 2 + metrics.paidSuccess * 12 + metrics.success * 4;
  const discoveryGapBonus = discovery.indexed
    ? 0
    : Math.min(120, 20 + metrics.paymentRequired + metrics.paidSuccess * 10);
  const reliabilityPenalty = metrics.serverErrors * 80 + metrics.clientErrors * 8;

  return Math.max(
    0,
    tierWeight + trackWeight + demandScore + discoveryGapBonus - reliabilityPenalty,
  );
}

function createPortfolioReport(options = {}) {
  const portfolio = options.portfolio ?? createSellerPortfolio(options);
  const metricsRoutes = Array.isArray(options.metricsSummary?.routes)
    ? options.metricsSummary.routes
    : [];
  const metricsByKey = new Map(metricsRoutes.map((entry) => [entry.key, entry]));
  const discoveryItems = Array.isArray(options.discoveryItems)
    ? options.discoveryItems
    : Array.isArray(options.discoverySummary?.items)
      ? options.discoverySummary.items
      : [];

  const sellers = portfolio
    .map((seller) => {
      const routeMetrics = seller.routeKeys
        .map((routeKey) => metricsByKey.get(routeKey))
        .filter(Boolean);
      const aggregateMetrics = aggregateRouteMetrics(routeMetrics);
      const heroMetrics = metricsByKey.get(seller.heroRoute.key) ?? null;
      const discovery = summarizeDiscovery(seller, discoveryItems);
      const action = recommendAction(seller, aggregateMetrics, discovery);
      const score = scoreSeller(seller, aggregateMetrics, discovery);

      return {
        ...seller,
        metrics: aggregateMetrics,
        heroMetrics,
        discovery,
        action,
        score,
      };
    })
    .sort((left, right) => {
      const leftPriority = TRACK_SORT_PRIORITY[left.track] ?? 99;
      const rightPriority = TRACK_SORT_PRIORITY[right.track] ?? 99;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return right.score - left.score || left.serviceName.localeCompare(right.serviceName);
    });

  return {
    generatedAt: new Date().toISOString(),
    metricsGeneratedAt: options.metricsSummary?.generatedAt ?? null,
    discoveryCount: discoveryItems.length,
    sellers,
  };
}

module.exports = {
  SELLER_BLUEPRINTS,
  aggregateRouteMetrics,
  buildSellerScaffoldConfig,
  createPortfolioReport,
  createRouteMeta,
  createSellerPortfolio,
  getSellerBlueprintById,
  normalizeComparableUrl,
  normalizePriceValue,
  recommendAction,
  scoreSeller,
  summarizeDiscovery,
  toResourcePath,
};
