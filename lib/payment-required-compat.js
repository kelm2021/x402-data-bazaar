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

function isSimulationPath(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    return new URL(trimmed).pathname.startsWith("/api/sim/");
  } catch (_error) {
    return trimmed.startsWith("/api/sim/");
  }
}

function compactAcceptRequirement(accept) {
  if (!isPlainObject(accept)) {
    return null;
  }

  const compact = {
    scheme: String(accept.scheme || "exact"),
    network: String(accept.network || ""),
    amount: String(accept.amount || ""),
    asset: String(accept.asset || ""),
    payTo: accept.payTo,
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
    ...(isPlainObject(accept.extra) ? { extra: deepClone(accept.extra) } : {}),
  };

  if (!compact.network || !compact.amount || !compact.asset || !compact.payTo) {
    return null;
  }

  return compact;
}

function compactMcpMetadata(mcp) {
  if (!isPlainObject(mcp)) {
    return null;
  }

  const compact = {
    ...(typeof mcp.type === "string" && mcp.type.trim()
      ? { type: mcp.type.trim() }
      : {}),
    ...(typeof mcp.tool === "string" && mcp.tool.trim()
      ? { tool: mcp.tool.trim() }
      : {}),
    ...(typeof mcp.description === "string" && mcp.description.trim()
      ? { description: mcp.description.trim() }
      : {}),
    ...(typeof mcp.transport === "string" && mcp.transport.trim()
      ? { transport: mcp.transport.trim() }
      : {}),
    ...(typeof mcp.mcpServerUrl === "string" && mcp.mcpServerUrl.trim()
      ? { mcpServerUrl: mcp.mcpServerUrl.trim() }
      : {}),
  };

  return Object.keys(compact).length ? compact : null;
}

function rewriteNestedDefsRefs(schemaNode, defsBasePointer) {
  if (Array.isArray(schemaNode)) {
    return schemaNode.map((entry) => rewriteNestedDefsRefs(entry, defsBasePointer));
  }

  if (!isPlainObject(schemaNode)) {
    return schemaNode;
  }

  const nextNode = {};
  for (const [key, value] of Object.entries(schemaNode)) {
    if (key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")) {
      nextNode[key] = `${defsBasePointer}/${value.slice("#/$defs/".length)}`;
      continue;
    }
    nextNode[key] = rewriteNestedDefsRefs(value, defsBasePointer);
  }
  return nextNode;
}

function enforceStrictSimulationInputSchema(bazaarSchema) {
  if (!isPlainObject(bazaarSchema?.properties?.input)) {
    return;
  }

  const inputSchema = bazaarSchema.properties.input;
  if (!isPlainObject(inputSchema.properties)) {
    inputSchema.properties = {};
  }

  inputSchema.properties.type = { type: "string", const: "http" };
  inputSchema.properties.method = { type: "string", enum: ["POST"] };
  inputSchema.properties.bodyType = { type: "string", enum: ["json"] };

  if (isPlainObject(inputSchema.properties.body)) {
    const rewrittenBody = rewriteNestedDefsRefs(
      inputSchema.properties.body,
      "#/properties/input/properties/body/$defs",
    );
    inputSchema.properties.body = rewrittenBody;
  }

  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const requiredSet = new Set(required);
  requiredSet.add("type");
  requiredSet.add("method");
  requiredSet.add("bodyType");
  if (isPlainObject(inputSchema.properties.body)) {
    requiredSet.add("body");
  }
  inputSchema.required = Array.from(requiredSet);
}

function compactSimulationDiscoveryExtension(paymentRequired) {
  if (!isPlainObject(paymentRequired?.extensions?.bazaar)) {
    return;
  }

  const bazaar = paymentRequired.extensions.bazaar;
  const info = isPlainObject(bazaar.info) ? bazaar.info : null;
  if (!info) {
    return;
  }
  const isMcpInput = String(info?.input?.type || "").trim().toLowerCase() === "mcp";

  const compactInfo = {
    ...(typeof info.category === "string" && info.category.trim()
      ? { category: info.category.trim() }
      : {}),
    ...(typeof info.description === "string" && info.description.trim()
      ? { description: info.description.trim() }
      : {}),
    ...(typeof info.price === "string" && info.price.trim()
      ? { price: info.price.trim() }
      : {}),
    ...(Array.isArray(info.tags) && info.tags.length
      ? {
          tags: info.tags
            .map((tag) => String(tag).trim())
            .filter(Boolean),
        }
      : {}),
  };

  if (isPlainObject(info.input)) {
    if (isMcpInput) {
      const compactInput = {
        type: "mcp",
        ...(typeof info.input.toolName === "string" && info.input.toolName.trim()
          ? { toolName: info.input.toolName.trim() }
          : {}),
        ...(typeof info.input.description === "string" && info.input.description.trim()
          ? { description: info.input.description.trim() }
          : {}),
        ...(typeof info.input.transport === "string" && info.input.transport.trim()
          ? { transport: info.input.transport.trim() }
          : {}),
        ...(isPlainObject(info.input.inputSchema)
          ? { inputSchema: deepClone(info.input.inputSchema) }
          : {}),
        ...(isPlainObject(info.input.example)
          ? { example: deepClone(info.input.example) }
          : {}),
      };
      if (Object.keys(compactInput).length) {
        compactInfo.input = compactInput;
      }
    } else {
      let compactBody = null;
      if (isPlainObject(info.input.body)) {
        compactBody = deepClone(info.input.body);
        while (
          isPlainObject(compactBody) &&
          Object.keys(compactBody).length === 1 &&
          isPlainObject(compactBody.body)
        ) {
          compactBody = compactBody.body;
        }
      }

      const compactInput = {
        ...(typeof info.input.type === "string" && info.input.type.trim()
          ? { type: info.input.type.trim() }
          : {}),
        ...(typeof info.input.method === "string" && info.input.method.trim()
          ? { method: info.input.method.trim() }
          : {}),
        ...(typeof info.input.bodyType === "string" && info.input.bodyType.trim()
          ? { bodyType: info.input.bodyType.trim() }
          : {}),
        ...(isPlainObject(compactBody) ? { body: compactBody } : {}),
      };

      if (Object.keys(compactInput).length) {
        compactInfo.input = compactInput;
      }
    }
  }

  const compactMcp = compactMcpMetadata(info.mcp);
  if (compactMcp) {
    compactInfo.mcp = compactMcp;
  }

  bazaar.info = compactInfo;

  // Keep route-specific simulation schemas so discovery UIs can render concrete
  // body fields for each sim endpoint (probability/compare/forecast/composed/optimize/sensitivity).
  // If a schema is missing entirely, fall back to a minimal generic contract.
  if (!isPlainObject(bazaar.schema)) {
    if (isMcpInput) {
      bazaar.schema = {
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: {
              type: { type: "string", const: "mcp" },
              toolName: { type: "string" },
              inputSchema: {
                type: "object",
                additionalProperties: true,
              },
            },
            required: ["type", "toolName", "inputSchema"],
            additionalProperties: false,
          },
          output: {
            type: "object",
            properties: {
              type: { type: "string" },
            },
            required: ["type"],
            additionalProperties: true,
          },
        },
        required: ["input"],
      };
    } else {
      bazaar.schema = {
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: {
              type: { type: "string", const: "http" },
              method: { type: "string", enum: ["POST"] },
              bodyType: { type: "string", enum: ["json"] },
              body: {
                type: "object",
                additionalProperties: true,
              },
            },
            required: ["type", "method"],
            additionalProperties: false,
          },
          output: {
            type: "object",
            properties: {
              type: { type: "string", const: "json" },
            },
            required: ["type"],
            additionalProperties: true,
          },
        },
        required: ["input", "output"],
      };
    }
  }

  if (!isMcpInput) {
    enforceStrictSimulationInputSchema(bazaar.schema);
  }
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
  const bodySchemaCandidate = isPlainObject(inputSchemaProps.body)
    ? inputSchemaProps.body
    : isPlainObject(inputInfo.body) && isPlainObject(inputInfo.body.properties)
      ? inputInfo.body
      : null;
  const bodyInfoCandidate =
    isPlainObject(inputInfo.body) && !isPlainObject(inputInfo.body.properties)
      ? inputInfo.body
      : null;
  const bodyFields = normalizeDiscoveryFieldMap(
    bodySchemaCandidate,
    bodyInfoCandidate,
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
  const inputType = String(bazaar?.info?.input?.type || "").trim().toLowerCase();
  if (inputType === "mcp") {
    return;
  }

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
  const isSimulationRoute =
    isSimulationPath(routeConfig?.resource) || isSimulationPath(result?.resource?.url);

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
      accept.outputSchema = isSimulationRoute
        ? { input: deepClone(legacyOutputSchema.input) }
        : deepClone(legacyOutputSchema);
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
  if (isSimulationRoute) {
    compactSimulationDiscoveryExtension(result);
  }
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
