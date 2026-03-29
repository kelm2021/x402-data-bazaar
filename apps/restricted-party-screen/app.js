const express = require("express");
const sellerConfig = require("./seller.config.json");
const batchHandler = require("./handlers/batch");
const primaryHandler = require("./handlers/primary");
const {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} = require("@x402/extensions/bazaar");
const { siwxResourceServerExtension } = require("@x402/extensions/sign-in-with-x");
const {
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createRouteCatalog,
} = require("./metrics");
const {
  createSIWxHooks,
  createSIWxPublicConfig,
  createSIWxRouteExtension,
} = require("./lib/siwx");
const {
  annotatePaymentRequired,
  buildPaymentRequiredFromRoute,
} = require("./lib/payment-required-compat");
const {
  getConfiguredFacilitatorUrl,
  loadCoinbaseFacilitator: loadCoinbaseFacilitatorForEnv,
  loadFacilitator: loadFacilitatorForEnv,
} = require("../../lib/facilitator-loader");

const PAY_TO = sellerConfig.payTo;
const X402_NETWORK = sellerConfig.network || "eip155:8453";
const DEFAULT_TIMEOUT_SECONDS = sellerConfig.maxTimeoutSeconds || 60;
const CANONICAL_BASE_URL =
  process.env.PUBLIC_BASE_URL || sellerConfig.baseUrl || "https://example.vercel.app";

function buildCanonicalResourceUrl(resourcePath) {
  if (!resourcePath) {
    return null;
  }

  if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
    return resourcePath;
  }

  return `${CANONICAL_BASE_URL}${resourcePath}`;
}

function getCanonicalRoutePath(route) {
  return route.canonicalPath || route.resourcePath;
}

function getSellerRoutes() {
  if (Array.isArray(sellerConfig.routes) && sellerConfig.routes.length) {
    return sellerConfig.routes;
  }

  return sellerConfig.route ? [sellerConfig.route] : [];
}

function getRouteSpecificity(route) {
  const segments = String(route.routePath ?? "")
    .split("/")
    .filter(Boolean);
  const wildcardCount = segments.filter((segment) => segment === "*" || segment.startsWith(":")).length;
  const staticSegmentCount = segments.length - wildcardCount;

  return {
    staticSegmentCount,
    segmentCount: segments.length,
    wildcardCount,
  };
}

function getMatchOrderedRoutes() {
  return [...getSellerRoutes()].sort((left, right) => {
    const leftSpecificity = getRouteSpecificity(left);
    const rightSpecificity = getRouteSpecificity(right);

    if (leftSpecificity.staticSegmentCount !== rightSpecificity.staticSegmentCount) {
      return rightSpecificity.staticSegmentCount - leftSpecificity.staticSegmentCount;
    }

    if (leftSpecificity.segmentCount !== rightSpecificity.segmentCount) {
      return rightSpecificity.segmentCount - leftSpecificity.segmentCount;
    }

    return leftSpecificity.wildcardCount - rightSpecificity.wildcardCount;
  });
}

function inferSchemaType(value) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "string";
  }

  switch (typeof value) {
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function buildQuerySchema(queryExample = {}) {
  const entries = Object.entries(queryExample);
  if (!entries.length) {
    return null;
  }

  return {
    properties: Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        {
          type: inferSchemaType(value),
          description: `${key} query parameter`,
        },
      ]),
    ),
    required: entries.map(([key]) => key),
    additionalProperties: false,
  };
}

function createDiscoveryExtension(route) {
  const querySchema = buildQuerySchema(route.queryExample);

  return declareDiscoveryExtension({
    ...(route.queryExample && Object.keys(route.queryExample).length
      ? { input: route.queryExample }
      : {}),
    ...(querySchema ? { inputSchema: querySchema } : {}),
    ...(route.outputExample ? { output: { example: route.outputExample } } : {}),
  });
}

function createPricedRoute(route, options = {}) {
  const normalizedPrice =
    typeof route.price === "string" && !route.price.startsWith("$")
      ? `$${route.price}`
      : route.price;
  const siwxRouteExtension =
    options.siwxRouteExtension ?? options.siwxHooks?.routeExtension ?? null;

  return {
    resource: buildCanonicalResourceUrl(getCanonicalRoutePath(route)),
    accepts: {
      scheme: "exact",
      network: X402_NETWORK,
      payTo: PAY_TO,
      price: normalizedPrice,
      maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    },
    description: route.description,
    mimeType: "application/json",
    ...(route.category ? { category: route.category } : {}),
    ...(Array.isArray(route.tags) ? { tags: route.tags } : {}),
    extensions: {
      ...createDiscoveryExtension(route),
      ...(siwxRouteExtension ?? {}),
    },
  };
}

function createRouteConfig(options = {}) {
  const siwxRouteExtension =
    options.siwxRouteExtension ?? createSIWxRouteExtension(options);

  return Object.fromEntries(
    getSellerRoutes().map((route) => [
      route.key,
      createPricedRoute(route, { ...options, siwxRouteExtension }),
    ]),
  );
}

const routeConfig = createRouteConfig();

function getPrimaryPaymentOption(config) {
  if (!config) {
    return null;
  }

  if (Array.isArray(config.accepts)) {
    return config.accepts[0] || null;
  }

  return config.accepts || null;
}

function formatUsdPrice(price) {
  if (price == null) {
    return null;
  }

  if (typeof price === "number") {
    return `$${price} USDC`;
  }

  const normalizedPrice = price.startsWith("$") ? price : `$${price}`;
  return `${normalizedPrice} USDC`;
}

function getRoutePrice(config) {
  const paymentOption = getPrimaryPaymentOption(config);
  return formatUsdPrice(paymentOption?.price ?? null);
}

function parseUsdPriceValue(price) {
  if (price == null) {
    return null;
  }

  if (typeof price === "number" && Number.isFinite(price)) {
    return price;
  }

  const normalized = String(price).trim().replace(/^\$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getExamplePathFromResource(resourceUrl, fallbackPath = null) {
  if (resourceUrl) {
    try {
      const parsed = new URL(resourceUrl);
      return `${parsed.pathname}${parsed.search}`;
    } catch (error) {
      // Fall through to the fallback path.
    }
  }

  if (fallbackPath) {
    return fallbackPath;
  }

  return null;
}

function createRouteMatcher(routes = routeConfig) {
  const exactMatches = new Map();
  const wildcardMatches = [];

  for (const [key, config] of Object.entries(routes)) {
    const [method, routePath] = key.split(" ");
    const entry = {
      key,
      config,
      method: String(method || "").toUpperCase(),
      routePath,
    };

    if (routePath.includes("*")) {
      wildcardMatches.push(entry);
    } else {
      exactMatches.set(`${entry.method} ${routePath}`, entry);
    }
  }

  return function matchRoute(method, requestPath) {
    const normalizedMethod = String(method || "").toUpperCase();
    const exactKey = `${normalizedMethod} ${requestPath}`;
    if (exactMatches.has(exactKey)) {
      return exactMatches.get(exactKey);
    }

    for (const route of wildcardMatches) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const prefix = route.routePath.slice(0, route.routePath.indexOf("*"));
      if (requestPath.startsWith(prefix)) {
        return route;
      }
    }

    return null;
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAcceptedRequirements(accepted) {
  if (!isPlainObject(accepted)) {
    return accepted;
  }

  const allowedKeys = [
    "scheme",
    "network",
    "amount",
    "asset",
    "payTo",
    "maxTimeoutSeconds",
    "extra",
  ];
  const sanitized = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(accepted, key)) {
      sanitized[key] = accepted[key];
    }
  }

  return sanitized;
}

function sanitizePaymentPayloadForMatching(payload) {
  if (!isPlainObject(payload) || Number(payload.x402Version) !== 2) {
    return payload;
  }

  const originalAccepted = payload.accepted;
  const sanitizedAccepted = sanitizeAcceptedRequirements(originalAccepted);

  if (!isPlainObject(originalAccepted) || !isPlainObject(sanitizedAccepted)) {
    return payload;
  }

  const originalKeys = Object.keys(originalAccepted);
  const sanitizedKeys = Object.keys(sanitizedAccepted);
  const changed =
    originalKeys.length !== sanitizedKeys.length ||
    originalKeys.some((key) => !Object.prototype.hasOwnProperty.call(sanitizedAccepted, key));

  if (!changed) {
    return payload;
  }

  return {
    ...payload,
    accepted: sanitizedAccepted,
  };
}

async function loadCoinbaseFacilitator(env = process.env) {
  return loadCoinbaseFacilitatorForEnv(env);
}

async function loadFacilitator(env = process.env) {
  return loadFacilitatorForEnv(env);
}

function createFacilitatorClient(facilitator) {
  if (
    facilitator &&
    typeof facilitator.verify === "function" &&
    typeof facilitator.settle === "function" &&
    typeof facilitator.getSupported === "function"
  ) {
    return facilitator;
  }

  const { HTTPFacilitatorClient } = require("@x402/core/server");
  return new HTTPFacilitatorClient(facilitator);
}

function createPaymentResourceServer(options = {}) {
  const {
    facilitator,
    logger = console,
    afterSettleHooks = [],
    resourceServerClass,
    resourceServerExtensions = [bazaarResourceServerExtension, siwxResourceServerExtension],
    schemeFactory = () => {
      const { ExactEvmScheme } = require("@x402/evm/exact/server");
      return new ExactEvmScheme();
    },
  } = options;

  const { x402ResourceServer } = require("@x402/core/server");
  const ResourceServerClass = resourceServerClass || x402ResourceServer;
  const resourceServer = new ResourceServerClass(
    createFacilitatorClient(facilitator),
  );
  resourceServer.register(X402_NETWORK, schemeFactory());
  for (const extension of resourceServerExtensions) {
    resourceServer.registerExtension(extension);
  }
  for (const afterSettleHook of afterSettleHooks) {
    resourceServer.onAfterSettle(afterSettleHook);
  }

  resourceServer.onVerifyFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 verify failure:",
      JSON.stringify({
        name: error?.name || "Error",
        message: error?.message || "Verification failed",
        network: requirements.network,
      }),
    );
  });

  resourceServer.onSettleFailure(async ({ error, requirements }) => {
    logger.error(
      "x402 settle failure:",
      JSON.stringify({
        name: error?.name || "Error",
        message: error?.message || "Settlement failed",
        network: requirements.network,
        errorReason: error?.errorReason || null,
        errorMessage: error?.errorMessage || null,
        transaction: error?.transaction || null,
      }),
    );
  });

  return resourceServer;
}

function createPaymentGate(options = {}) {
  const routes = options.routes ?? routeConfig;
  const matchRoute = createRouteMatcher(routes);
  const paymentEnv = options.env ?? process.env;
  const facilitatorLoader = options.facilitatorLoader ?? (() => loadFacilitator(paymentEnv));
  const initRetryCount = Math.max(1, Number(options.paymentInitRetryCount ?? 2));
  const extractFacilitatorUrl = (value) => {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized ? normalized : null;
    }

    if (typeof value.url === "string") {
      const normalized = value.url.trim();
      return normalized ? normalized : null;
    }

    return null;
  };
  const siwxHooks = options.siwxHooks ?? null;
  const paymentMiddlewareFactory =
    options.paymentMiddlewareFactory ??
    ((middlewareRoutes, resourceServer) => {
      const {
        paymentMiddleware,
        paymentMiddlewareFromHTTPServer,
        x402HTTPResourceServer,
      } = require("@x402/express");

      if (!siwxHooks?.requestHook) {
        return paymentMiddleware(middlewareRoutes, resourceServer);
      }

      const httpServer = new x402HTTPResourceServer(resourceServer, middlewareRoutes);
      httpServer.onProtectedRequest(siwxHooks.requestHook);
      return paymentMiddlewareFromHTTPServer(httpServer);
    });
  const resourceServerFactory =
    options.resourceServerFactory ??
    ((factoryOptions) => createPaymentResourceServer(factoryOptions));
  const logger = options.logger ?? console;
  const fastUnpaidResponse = options.fastUnpaidResponse ?? false;
  let facilitatorUrl =
    extractFacilitatorUrl(
      options.facilitatorUrl ?? getConfiguredFacilitatorUrl(paymentEnv),
    );

  let paymentReady = null;
  const isFacilitatorInitFailure = (error) =>
    typeof error?.message === "string" &&
    error.message.includes(
      "Failed to initialize: no supported payment kinds loaded from any facilitator.",
    );

  async function initializePaymentMiddleware() {
    let lastError = null;

    for (let attempt = 1; attempt <= initRetryCount; attempt += 1) {
      try {
        const facilitator = await facilitatorLoader();
        const discoveredFacilitatorUrl = extractFacilitatorUrl(facilitator);
        if (discoveredFacilitatorUrl) {
          facilitatorUrl = discoveredFacilitatorUrl;
        }

        const resourceServer = await resourceServerFactory({
          afterSettleHooks: siwxHooks?.settleHook ? [siwxHooks.settleHook] : [],
          facilitator,
          logger,
        });
        return await paymentMiddlewareFactory(routes, resourceServer);
      } catch (error) {
        lastError = error;
        if (!isFacilitatorInitFailure(error) || attempt >= initRetryCount) {
          throw error;
        }

        logger.warn(
          "x402 middleware init failed; retrying facilitator bootstrap",
          JSON.stringify({
            attempt,
            retryCount: initRetryCount,
            message: error?.message || String(error),
          }),
        );
      }
    }

    throw lastError ?? new Error("Payment middleware initialization failed");
  }

  async function getPaymentMiddleware() {
    if (!paymentReady) {
      paymentReady = initializePaymentMiddleware()
        .catch((error) => {
          paymentReady = null;
          throw error;
        });
    }

    return paymentReady;
  }

  return async function paymentGate(req, res, next) {
    const routeEntry = matchRoute(req.method, req.path);
    let hasPaymentSignature = false;

    try {
      if (!req.headers["payment-signature"] && req.headers["x-payment"]) {
        req.headers["payment-signature"] = req.headers["x-payment"];
      }

      hasPaymentSignature = Boolean(req.headers["payment-signature"]);

      if (req.headers["payment-signature"]) {
        try {
          const { decodePaymentSignatureHeader, encodePaymentSignatureHeader } = require("@x402/core/http");
          const decodedPayment = decodePaymentSignatureHeader(String(req.headers["payment-signature"]));
          const sanitizedPayment = sanitizePaymentPayloadForMatching(decodedPayment);

          if (sanitizedPayment !== decodedPayment) {
            const normalizedHeader = encodePaymentSignatureHeader(sanitizedPayment);
            req.headers["payment-signature"] = normalizedHeader;
            req.headers["x-payment"] = normalizedHeader;
          }
        } catch (sanitizeError) {
          logger.warn(
            "x402 payment header normalization failed:",
            JSON.stringify({
              path: req.path,
              method: req.method,
              message:
                sanitizeError instanceof Error
                  ? sanitizeError.message
                  : String(sanitizeError),
            }),
          );
        }
      }

      if (fastUnpaidResponse && routeEntry && !hasPaymentSignature) {
        const { encodePaymentRequiredHeader } = require("@x402/core/http");
        const paymentRequired = buildPaymentRequiredFromRoute(routeEntry, {
          errorMessage: "Payment required",
          facilitatorUrl,
        });

        if (paymentRequired) {
          res.set(
            "PAYMENT-REQUIRED",
            encodePaymentRequiredHeader(paymentRequired),
          );
          return res.status(402).json(paymentRequired);
        }
      }

      const originalJson = res.json.bind(res);
      res.json = function patchedJson(body) {
        const paymentRequiredHeader = res.getHeader("PAYMENT-REQUIRED");
        const paymentResponseHeader = res.getHeader("PAYMENT-RESPONSE");
        const isEmptyObject =
          body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          Object.keys(body).length === 0;

        if (res.statusCode === 402 && paymentResponseHeader && isEmptyObject) {
          res.statusCode = 500;
          return originalJson({
            error: "Payment settlement failed",
          });
        }

        if (res.statusCode === 402 && paymentRequiredHeader && isEmptyObject) {
          const {
            decodePaymentRequiredHeader,
            encodePaymentRequiredHeader,
          } = require("@x402/core/http");
          const decoded = decodePaymentRequiredHeader(
            String(paymentRequiredHeader),
          );
          const enriched = annotatePaymentRequired(decoded, {
            routeConfig: routeEntry?.config ?? null,
            method: routeEntry?.method ?? req.method,
            facilitatorUrl,
          });

          if (enriched) {
            res.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(enriched));
            return originalJson(enriched);
          }

          return originalJson(decoded);
        }

        return originalJson(body);
      };

      const middleware = await getPaymentMiddleware();
      return await middleware(req, res, next);
    } catch (err) {
      if (isFacilitatorInitFailure(err) && routeEntry && !hasPaymentSignature) {
        logger.warn(
          "x402 middleware init failed; returning route-configured unpaid 402 fallback",
          JSON.stringify({
            path: req.path,
            method: req.method,
            routeKey: routeEntry.key,
          }),
        );
        const { encodePaymentRequiredHeader } = require("@x402/core/http");
        const paymentRequired = buildPaymentRequiredFromRoute(routeEntry, {
          errorMessage: "Payment required",
          facilitatorUrl,
        });
        const enriched = annotatePaymentRequired(paymentRequired, {
          routeConfig: routeEntry.config,
          method: routeEntry.method,
          facilitatorUrl,
        });
        const fallbackPayload = enriched || paymentRequired;
        res.set(
          "PAYMENT-REQUIRED",
          encodePaymentRequiredHeader(fallbackPayload),
        );
        return res.status(402).json(fallbackPayload);
      }

      return res.status(500).json({
        error: "Payment middleware init failed",
        details: err?.message || String(err),
      });
    }
  };
}

function getCanonicalRouteEntries(routes = routeConfig) {
  return getSellerRoutes().map((route) => {
    const config = routes[route.key];
    const [method, routePath] = route.key.split(" ");

    return {
      method,
      path: routePath,
      canonicalUrl: config?.resource ?? buildCanonicalResourceUrl(getCanonicalRoutePath(route)),
      price: getRoutePrice(config ?? createPricedRoute(route)),
      description: config?.description ?? route.description ?? null,
      category: config?.category ?? route.category ?? null,
      tags: Array.isArray(config?.tags) ? config.tags : Array.isArray(route.tags) ? route.tags : [],
    };
  });
}

function buildCatalogEntries(routes = routeConfig) {
  return getSellerRoutes().map((route) => {
    const config = routes[route.key] ?? createPricedRoute(route);
    const [method, path] = route.key.split(" ");
    const paymentOption = getPrimaryPaymentOption(config);
    const resourceUrl = config.resource ?? paymentOption?.resource ?? null;

    return {
      method,
      path,
      routeKey: route.key,
      price: getRoutePrice(config),
      priceUsd: parseUsdPriceValue(paymentOption?.price ?? route.price ?? null),
      description: config.description ?? route.description ?? null,
      category: config.category ?? route.category ?? null,
      tags: Array.isArray(config.tags) ? config.tags : Array.isArray(route.tags) ? route.tags : [],
      examplePath: getExamplePathFromResource(resourceUrl, path),
      exampleUrl: resourceUrl,
      payment: {
        scheme: paymentOption?.scheme ?? null,
        network: paymentOption?.network ?? null,
        asset: paymentOption?.asset ?? null,
        payTo: paymentOption?.payTo ?? null,
        amount: paymentOption?.amount ?? null,
        maxTimeoutSeconds: paymentOption?.maxTimeoutSeconds ?? null,
      },
    };
  });
}

function createApiDiscoveryHandler(routes = routeConfig) {
  return function apiDiscoveryHandler(req, res) {
    const catalog = buildCatalogEntries(routes);
    const baseUrl = String(CANONICAL_BASE_URL).replace(/\/$/, "");

    res.json({
      name: `${sellerConfig.serviceName} API Discovery`,
      description:
        "Machine-readable endpoint catalog for indexing and health probes. Use `exampleUrl` for concrete checks.",
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      baseUrl,
      discoveryUrl: `${CANONICAL_BASE_URL}/api`,
      healthUrl: `${CANONICAL_BASE_URL}/`,
      endpoints: catalog.length,
      catalog,
      payment: {
        protocol: "x402",
        network: "Base",
        chainId: X402_NETWORK,
        currency: "USDC",
      },
    });
  };
}

function createPaymentsMcpIntegration(routes = routeConfig) {
  const routeEntries = getCanonicalRouteEntries(routes);
  const primaryRoute = routeEntries[0] ?? null;
  const vendorBatchRoute =
    routeEntries.find((entry) => entry.path === "/api/vendor-onboarding/restricted-party-batch") ??
    null;
  const primaryPrompt = primaryRoute
    ? `Use payments-mcp to pay ${primaryRoute.canonicalUrl} and return the JSON response.`
    : null;
  const canonicalTemplateUrl =
    `${CANONICAL_BASE_URL}/api/ofac-sanctions-screening/<COUNTERPARTY_NAME>?minScore=90&limit=5`;
  const vendorBatchTemplateUrl =
    `${CANONICAL_BASE_URL}/api/vendor-onboarding/restricted-party-batch?names=<NAME_1>%7C<NAME_2>%7C<NAME_3>&workflow=vendor-onboarding&minScore=90&limit=3`;
  const scenarioPrompts = [
    {
      id: "smoke-test",
      title: "Smoke Test",
      prompt:
        primaryPrompt ??
        `Use payments-mcp to pay ${canonicalTemplateUrl} and return the JSON response.`,
    },
    {
      id: "supplier-onboarding",
      title: "Supplier Onboarding Gate",
      prompt: vendorBatchRoute
        ? `Use payments-mcp to pay ${vendorBatchTemplateUrl}. Return the JSON, then tell me whether vendor onboarding should proceed or pause based on data.summary.recommendedAction.`
        : `Use payments-mcp to pay ${canonicalTemplateUrl}. Return the JSON, then tell me whether onboarding should proceed or pause for human review based on summary.manualReviewRecommended.`,
    },
    {
      id: "payout-screening",
      title: "Payout Screening Gate",
      prompt: `Before sending funds to <COUNTERPARTY_NAME>, use payments-mcp to pay ${canonicalTemplateUrl}. If the response shows potential matches, tell me to block payment and escalate.`,
    },
    {
      id: "cross-border-check",
      title: "Cross-Border Counterparty Check",
      prompt: `Use payments-mcp to pay ${canonicalTemplateUrl} for the counterparty in this transaction. Summarize the top match, the sanctions programs involved, and whether a human review is recommended.`,
    },
    {
      id: "vendor-batch-screening",
      title: "Vendor Batch Screen",
      prompt: `Use payments-mcp to pay ${vendorBatchTemplateUrl}. Return the JSON, then summarize which counterparties are clear, which require manual review, and whether the batch should proceed or pause.`,
    },
  ];
  const shareCopy = {
    shortPost:
      "Built a low-friction x402 restricted-party screening seller at restricted-party-screen.vercel.app for procurement, payout, and onboarding workflows. It now supports both single-name OFAC checks and a batch vendor screen through Payments MCP, with SIWX-enabled repeat access.",
    developerDm:
      "If you are building procurement, payout, or cross-border agents, I have a live x402 seller for OFAC restricted-party screening. Use the single-name route as the cheap default gate, then use the batch screen when a workflow needs a quick proceed-or-pause call across multiple counterparties.",
    docsSnippet:
      "Install Payments MCP, then call either the single-name OFAC route or the batch vendor-screening route through MCP. The seller returns grouped matches, sanctions programs, source freshness, and a clear manual-review signal for agent workflows.",
  };

  return {
    integrationName: "Payments MCP",
    installerNote:
      "Use the package name exactly as shown for installation compatibility.",
    installerPackage: "@coinbase/payments-mcp",
    installCommands: {
      codex: "npx @coinbase/payments-mcp --client codex --auto-config",
      claudeCode: "npx @coinbase/payments-mcp --client claude-code --auto-config",
      gemini: "npx @coinbase/payments-mcp --client gemini --auto-config",
    },
    primaryPrompt,
    routePrompts: routeEntries.map((entry) => ({
      method: entry.method,
      path: entry.path,
      canonicalUrl: entry.canonicalUrl,
      prompt: `Use payments-mcp to pay ${entry.canonicalUrl} and return the JSON response.`,
    })),
    scenarioPrompts,
    shareCopy,
  };
}

function createPaymentsMcpIntegrationHandler(routes = routeConfig, options = {}) {
  const siwxPublicConfig = options.siwxPublicConfig ?? createSIWxPublicConfig();
  const paymentsMcp = createPaymentsMcpIntegration(routes);

  return function paymentsMcpIntegrationHandler(req, res) {
    res.json({
      service: sellerConfig.serviceName,
      protocol: "x402",
      paymentsMcp,
      signInWithX: siwxPublicConfig,
    });
  };
}

function createHealthHandler(routes = routeConfig, options = {}) {
  const siwxPublicConfig = options.siwxPublicConfig ?? createSIWxPublicConfig();
  const paymentsMcp = createPaymentsMcpIntegration(routes);

  return function healthHandler(req, res) {
    const catalog = getCanonicalRouteEntries(routes).map((entry) => ({
      method: entry.method,
      path: entry.path,
      price: entry.price,
      description: entry.description,
      canonicalUrl: entry.canonicalUrl,
      category: entry.category,
      tags: entry.tags,
    }));

    res.json({
      name: sellerConfig.serviceName,
      description: sellerConfig.serviceDescription,
      version: "1.0.0",
      endpoints: catalog.length,
      catalog,
      payment: {
        network: "Base",
        pricingDenomination: "USDC",
        protocol: "x402",
        buyerAssetSupport:
          "Supported x402 payment clients can use Base EIP-3009 and Permit2-backed ERC-20 tokens.",
      },
      extensions: {
        signInWithX: siwxPublicConfig,
      },
      integrations: {
        paymentsMcp,
      },
    });
  };
}

function mountPaidRoutes(target) {
  for (const route of getMatchOrderedRoutes()) {
    const method = route.method.toLowerCase();
    if (typeof target[method] !== "function") {
      throw new Error(`Unsupported HTTP method in route key: ${route.method}`);
    }

    const handler = route.handlerId === "batch" ? batchHandler : primaryHandler;
    target[method](route.expressPath, handler);
  }
}

function createApp(options = {}) {
  const env = options.env ?? process.env;
  const routes = options.routes ?? routeConfig;
  const siwxHooks =
    options.siwxHooks ??
    createSIWxHooks({
      backend: options.siwxBackend,
      env,
      nonceTtlSeconds: options.siwxNonceTtlSeconds ?? env.SIWX_NONCE_TTL_SECONDS,
      redis: options.siwxRedisClient,
      statement: options.siwxStatement,
      verifyOptions: options.siwxVerifyOptions,
    });
  const siwxPublicConfig =
    options.siwxPublicConfig ??
    createSIWxPublicConfig({
      backend: siwxHooks.backend,
      nonceTtlSeconds: options.siwxNonceTtlSeconds ?? env.SIWX_NONCE_TTL_SECONDS,
      statement: options.siwxStatement,
    });
  const metricsRouteCatalog = options.metricsRouteCatalog ?? createRouteCatalog(routes);
  const metricsAttribution =
    options.metricsAttribution ??
    createMetricsAttribution({
      env,
      sourceSalt: options.metricsSourceSalt,
    });
  const metricsStore =
    options.metricsStore ??
    createMetricsStore({
      env,
      routes,
      routeCatalog: metricsRouteCatalog,
    });
  const paymentGate =
    options.paymentGate ?? createPaymentGate({ ...options, routes, siwxHooks });
  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.get("/api", createApiDiscoveryHandler(routes));
  app.get("/", createHealthHandler(routes, { siwxPublicConfig }));
  app.get(
    "/integrations/payments-mcp",
    createPaymentsMcpIntegrationHandler(routes, { siwxPublicConfig }),
  );
  app.get(
    "/ops/metrics",
    createMetricsDashboardHandler({
      password: options.metricsPassword ?? env.METRICS_DASHBOARD_PASSWORD,
      attribution: metricsAttribution,
      store: metricsStore,
    }),
  );
  app.get(
    "/ops/metrics/data",
    createMetricsDataHandler({
      password: options.metricsPassword ?? env.METRICS_DASHBOARD_PASSWORD,
      attribution: metricsAttribution,
      store: metricsStore,
    }),
  );
  app.use(
    createMetricsMiddleware({
      attribution: metricsAttribution,
      logger: options.logger ?? console,
      routeCatalog: metricsRouteCatalog,
      routes,
      store: metricsStore,
    }),
  );

  const paidRouter = express.Router();
  mountPaidRoutes(paidRouter);
  app.use(paymentGate, paidRouter);

  return app;
}

module.exports = {
  PAY_TO,
  X402_NETWORK,
  createApp,
  createMetricsAttribution,
  createMetricsDashboardHandler,
  createMetricsDataHandler,
  createMetricsMiddleware,
  createMetricsStore,
  createPaymentGate,
  createPaymentResourceServer,
  createPaymentsMcpIntegration,
  createPaymentsMcpIntegrationHandler,
  createRouteCatalog,
  createRouteConfig,
  loadFacilitator,
  loadCoinbaseFacilitator,
  routeConfig,
  sellerConfig,
};
