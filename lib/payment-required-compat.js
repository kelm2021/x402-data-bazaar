"use strict";

const USDC_BY_NETWORK = {
  "eip155:8453": {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
    legacyNetwork: "base",
  },
  base: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
    legacyNetwork: "base",
  },
  "eip155:84532": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    extra: { name: "USDC", version: "2" },
    legacyNetwork: "base-sepolia",
  },
  "base-sepolia": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    extra: { name: "USDC", version: "2" },
    legacyNetwork: "base-sepolia",
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  if (value == null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function inferType(value) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value == null) {
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

function parseUsdPrice(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^\$/, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function formatUsdLabel(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }

  const raw = value.toFixed(6);
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return `$${trimmed}`;
}

function normalizeFacilitatorUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return null;
  }

  return normalized;
}

function toLegacyNetwork(network) {
  const known = USDC_BY_NETWORK[String(network ?? "")];
  if (known?.legacyNetwork) {
    return known.legacyNetwork;
  }

  return String(network ?? "");
}

function toTokenUnits(decimalAmount, decimals) {
  const scale = 10 ** decimals;
  const value = Math.round(decimalAmount * scale);
  return String(Math.max(0, value));
}

function getAssetMetadata(network) {
  return USDC_BY_NETWORK[String(network ?? "")] ?? null;
}

function toAcceptsArray(accepts) {
  if (Array.isArray(accepts)) {
    return accepts;
  }

  if (isPlainObject(accepts)) {
    return [accepts];
  }

  return [];
}

function normalizeRequirementFromOption(option) {
  if (!isPlainObject(option)) {
    return null;
  }

  if (typeof option.amount === "string" && typeof option.asset === "string") {
    const passthrough = {
      scheme: String(option.scheme || "exact"),
      network: String(option.network || ""),
      amount: option.amount,
      asset: option.asset,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds,
      ...(isPlainObject(option.extra) ? { extra: deepClone(option.extra) } : {}),
    };

    if (!passthrough.network) {
      return null;
    }

    return passthrough;
  }

  const usdPrice = parseUsdPrice(option.price);
  if (usdPrice == null) {
    return null;
  }

  const network = String(option.network || "");
  if (!network) {
    return null;
  }

  const asset = getAssetMetadata(network);
  if (!asset) {
    return null;
  }

  const requirement = {
    scheme: String(option.scheme || "exact"),
    network,
    amount: toTokenUnits(usdPrice, asset.decimals),
    asset: asset.address,
    payTo: option.payTo,
    maxTimeoutSeconds: option.maxTimeoutSeconds,
    extra: {
      ...asset.extra,
      ...(isPlainObject(option.extra) ? deepClone(option.extra) : {}),
    },
  };

  return requirement;
}

function normalizeDiscoveryFieldMap(schemaShape, infoShape, fallbackRequired = []) {
  const fromSchema =
    isPlainObject(schemaShape) && isPlainObject(schemaShape.properties)
      ? schemaShape.properties
      : null;
  const schemaRequired = Array.isArray(schemaShape?.required) ? schemaShape.required : fallbackRequired;
  const source = fromSchema || (isPlainObject(infoShape) ? infoShape : null);
  if (!source) {
    return null;
  }

  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) {
      const entry = {};

      if (typeof value.type === "string") {
        entry.type = value.type;
      } else if (Array.isArray(value.enum) && value.enum.length) {
        entry.type = inferType(value.enum[0]);
      } else if ("const" in value) {
        entry.type = inferType(value.const);
      }

      if (typeof value.description === "string" && value.description) {
        entry.description = value.description;
      }

      if (Array.isArray(value.enum) && value.enum.length) {
        entry.enum = deepClone(value.enum);
      }

      if (entry.type == null) {
        entry.type = "string";
      }

      if (schemaRequired.includes(key)) {
        entry.required = true;
      }

      result[key] = entry;
      continue;
    }

    result[key] = {
      type: inferType(value),
      ...(schemaRequired.includes(key) ? { required: true } : {}),
    };
  }

  return Object.keys(result).length ? result : null;
}

function buildLegacyOutputSchema(routeConfig, method) {
  const bazaar = routeConfig?.extensions?.bazaar;
  const info = isPlainObject(bazaar?.info) ? bazaar.info : {};
  const schema = isPlainObject(bazaar?.schema) ? bazaar.schema : {};
  const inputInfo = isPlainObject(info.input) ? info.input : {};
  const inputSchema = isPlainObject(schema.properties?.input)
    ? schema.properties.input
    : {};
  const inputSchemaProps = isPlainObject(inputSchema.properties)
    ? inputSchema.properties
    : {};

  const queryParams = normalizeDiscoveryFieldMap(
    inputSchemaProps.queryParams,
    inputInfo.queryParams,
    [],
  );
  const bodyFields = normalizeDiscoveryFieldMap(
    inputSchemaProps.body,
    inputInfo.body,
    [],
  );

  const input = {
    type: "http",
    method: inputInfo.method || method || "GET",
    discoverable: true,
    ...(queryParams ? { queryParams } : {}),
    ...(bodyFields
      ? {
          bodyType: String(inputInfo.bodyType || "json"),
          bodyFields,
        }
      : {}),
    ...(isPlainObject(inputInfo.headers) && Object.keys(inputInfo.headers).length
      ? { headerFields: deepClone(inputInfo.headers) }
      : {}),
  };

  const outputInfo = isPlainObject(info.output) ? info.output : null;
  let output = null;
  if (outputInfo && isPlainObject(outputInfo.example)) {
    output = deepClone(outputInfo.example);
  } else if (outputInfo && isPlainObject(outputInfo.schema)) {
    output = deepClone(outputInfo.schema);
  } else if (outputInfo && Object.keys(outputInfo).length) {
    output = deepClone(outputInfo);
  }

  return {
    input,
    ...(output ? { output } : {}),
  };
}

function patchBazaarMethod(paymentRequired, method) {
  if (!isPlainObject(paymentRequired?.extensions?.bazaar) || !method) {
    return;
  }

  const bazaar = paymentRequired.extensions.bazaar;
  if (isPlainObject(bazaar.info) && isPlainObject(bazaar.info.input)) {
    if (!bazaar.info.input.method) {
      bazaar.info.input.method = method;
    }
  }

  if (
    isPlainObject(bazaar.schema) &&
    isPlainObject(bazaar.schema.properties) &&
    isPlainObject(bazaar.schema.properties.input)
  ) {
    const inputSchema = bazaar.schema.properties.input;
    const inputProperties = isPlainObject(inputSchema.properties)
      ? inputSchema.properties
      : {};
    if (!isPlainObject(inputProperties.method)) {
      inputProperties.method = {
        type: "string",
        enum: [method],
      };
      inputSchema.properties = inputProperties;
    }

    const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
    if (!required.includes("method")) {
      inputSchema.required = [...required, "method"];
    }
  }
}

function getPrimaryRouteOption(routeConfig) {
  const routeAccepts = toAcceptsArray(routeConfig?.accepts);
  return routeAccepts[0] || null;
}

function annotatePaymentRequired(paymentRequired, options = {}) {
  const routeConfig = options.routeConfig ?? null;
  const method = options.method ? String(options.method).toUpperCase() : null;
  const result = deepClone(paymentRequired);

  if (!result || !routeConfig || !Array.isArray(result.accepts)) {
    return result;
  }

  const primaryRouteOption = getPrimaryRouteOption(routeConfig);
  const priceUsd = parseUsdPrice(primaryRouteOption?.price ?? routeConfig?.price ?? null);
  const maxAmountRequiredUSD = priceUsd == null ? null : formatUsdLabel(priceUsd);
  const legacyOutputSchema = buildLegacyOutputSchema(routeConfig, method);
  const category =
    typeof routeConfig.category === "string" && routeConfig.category.trim()
      ? routeConfig.category.trim()
      : null;
  const tags = Array.isArray(routeConfig.tags)
    ? routeConfig.tags
        .map((tag) => String(tag).trim())
        .filter(Boolean)
    : [];
  const facilitatorUrl = normalizeFacilitatorUrl(options.facilitatorUrl);

  const resource = {
    url: result.resource?.url || routeConfig.resource || null,
    description: result.resource?.description || routeConfig.description || null,
    mimeType: result.resource?.mimeType || routeConfig.mimeType || "application/json",
  };

  if (resource.url || resource.description || resource.mimeType) {
    result.resource = {
      ...(resource.url ? { url: resource.url } : {}),
      ...(resource.description ? { description: resource.description } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    };
  }

  for (const accept of result.accepts) {
    if (!isPlainObject(accept)) {
      continue;
    }

    if (accept.amount && !accept.maxAmountRequired) {
      accept.maxAmountRequired = String(accept.amount);
    }

    if (resource.url && !accept.resource) {
      accept.resource = resource.url;
    }

    if (resource.description && !accept.description) {
      accept.description = resource.description;
    }

    if (resource.mimeType && !accept.mimeType) {
      accept.mimeType = resource.mimeType;
    }

    if (!accept.networkLegacy && accept.network) {
      accept.networkLegacy = toLegacyNetwork(accept.network);
    }

    if (maxAmountRequiredUSD && !accept.maxAmountRequiredUSD) {
      accept.maxAmountRequiredUSD = maxAmountRequiredUSD;
    }

    if (legacyOutputSchema && !accept.outputSchema) {
      accept.outputSchema = deepClone(legacyOutputSchema);
    }

    if (accept.discoverable == null) {
      accept.discoverable = true;
    }

    if (category && !accept.category) {
      accept.category = category;
    }

    if (tags.length && !Array.isArray(accept.tags)) {
      accept.tags = deepClone(tags);
    }

    if (facilitatorUrl && typeof accept.facilitator !== "string") {
      accept.facilitator = facilitatorUrl;
    }
  }

  patchBazaarMethod(result, method);
  return result;
}

function buildPaymentRequiredFromRoute(routeEntry, options = {}) {
  if (!routeEntry || !isPlainObject(routeEntry.config)) {
    return null;
  }

  const routeConfig = routeEntry.config;
  const accepts = toAcceptsArray(routeConfig.accepts)
    .map((option) => normalizeRequirementFromOption(option))
    .filter(Boolean);

  if (!accepts.length) {
    return null;
  }

  const paymentRequired = {
    x402Version: 2,
    error: options.errorMessage || "Payment required",
    accepts,
    resource: {
      url: routeConfig.resource || null,
      description: routeConfig.description || "",
      mimeType: routeConfig.mimeType || "application/json",
    },
    ...(isPlainObject(routeConfig.extensions)
      ? { extensions: deepClone(routeConfig.extensions) }
      : {}),
  };

  return annotatePaymentRequired(paymentRequired, {
    routeConfig,
    method: routeEntry.method,
    facilitatorUrl: options.facilitatorUrl,
  });
}

module.exports = {
  annotatePaymentRequired,
  buildPaymentRequiredFromRoute,
  parseUsdPrice,
};
