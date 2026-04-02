# @agentcash/discovery

Canonical discovery runtime for the agentcash ecosystem.

Use one library for MCP, CLI, router, and audit so discovery behavior is identical everywhere.

## Why One Library

- Same parsing logic across surfaces: no CLI/server/client drift.
- Shared Zod schema that the router can test against at compile-time.
- Same warning codes and precedence rules: fewer integration surprises.
- Same compatibility adapters in one place: legacy behavior is isolated and removable.

## L0-L5 Mental Model

- `L0` trigger layer: intents like `x402`, `pay for` should route to agentcash.
- `L1` installed domain index: which domains are installed and when to fan out.
- `L2` domain resources: token-light list (`discover <domain>`).
- `L3` resource details: schema and deep metadata (`discover <domain> --verbose`).
- `L4` domain guidance: unstructured guidance (`llms.txt`) when available.
- `L5` cross-domain composition: intentionally out of scope for discovery v1.

Design rule: `L0` + `L1` are zero-hop critical. `L2+` should be fetched on demand.

In practice, each layer should guide the agent to discover the next:

| Layer  | Surface                                             | What the agent gets                                                                                                                          |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0** | MCP tool description / `agentcash --help`           | First impression of agentcash. Should encourage the agent to use it and explicitly explain `discoverOriginSchema` and `checkEndpointSchema`. |
| **L1** | Same location as L0                                 | List of domains available to the agent. Each entry should be descriptive enough for the agent to understand what it does at a high level.    |
| **L2** | `discoverOriginSchema` result                       | Detailed description of the origin and its supported endpoints.                                                                              |
| **L3** | `checkEndpointSchema` result                        | Specific guidance for a single endpoint: input/output schema, auth mode, and a detailed description of what the endpoint does.               |
| **L4** | `discoverOriginSchema` with `includeGuidance: true` | Composition guidance for 2+ resources at an origin. Sourced from the `guidance` field in OpenAPI.                                            |

## Install

```bash
pnpm add @agentcash/discovery
```

## CLI

Two commands: `discover` (list endpoints at an origin) and `check` (inspect a specific URL).

```bash
# Discover all endpoints at an origin
npx @agentcash/discovery stabletravel.dev
npx @agentcash/discovery discover stabletravel.dev

# Inspect a specific endpoint URL
npx @agentcash/discovery check https://stabletravel.dev/search
```

Flags:

| Flag     | Description                                        |
| -------- | -------------------------------------------------- |
| `--json` | Machine-readable JSON output                       |
| `-v`     | Verbose — includes guidance text and warning hints |

JSON output shape (`discover`):

```json
{
  "ok": true,
  "selectedStage": "openapi",
  "resources": [{ "resourceKey": "GET /search", "method": "GET", "path": "/search" }],
  "warnings": [],
  "meta": { "origin": "https://stabletravel.dev", "specUrl": "..." }
}
```

JSON output shape (`check`):

```json
{
  "url": "https://stabletravel.dev/search",
  "found": true,
  "origin": "https://stabletravel.dev",
  "path": "/search",
  "advisories": [{ "method": "GET", "authMode": "bearer", "estimatedPrice": "$0.01" }],
  "warnings": []
}
```

## Programmatic Usage

```ts
import { discoverOriginSchema, checkEndpointSchema } from '@agentcash/discovery';

// Discover all endpoints at an origin
const result = await discoverOriginSchema({ target: 'stabletravel.dev' });
// result.found === true → result.endpoints (L2Route[]), result.guidance?, result.guidanceTokens?

// Inspect a specific endpoint URL
const check = await checkEndpointSchema({ url: 'https://stabletravel.dev/search' });
// check.found === true → check.advisories (per-method: authMode, estimatedPrice, protocols, inputSchema)
```

## Exported API

### Core discovery

| Export                   | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `discoverOriginSchema()` | Progressive discovery — returns endpoints + advisory data |
| `checkEndpointSchema()`  | Per-endpoint inspection — returns per-method advisories   |

### Layer fetchers (low-level)

| Export                     | Layer | Description                           |
| -------------------------- | ----- | ------------------------------------- |
| `getOpenAPI(origin)`       | —     | Fetch OpenAPI spec from origin        |
| `getWellKnown(origin)`     | —     | Fetch `/.well-known/x402` document    |
| `getProbe(url, body?)`     | —     | Live endpoint probe                   |
| `checkL2ForOpenAPI(spec)`  | L2    | Extract route list from OpenAPI       |
| `checkL2ForWellknown(doc)` | L2    | Extract route list from well-known    |
| `getL3(origin, path)`      | L3    | Get detailed metadata for an endpoint |
| `checkL4ForOpenAPI(spec)`  | L4    | Extract guidance from OpenAPI         |
| `checkL4ForWellknown(doc)` | L4    | Extract guidance from well-known      |

### Validation

| Export                              | Description                                  |
| ----------------------------------- | -------------------------------------------- |
| `validatePaymentRequiredDetailed()` | Full 402 payload validation with diagnostics |
| `evaluateMetadataCompleteness()`    | Metadata quality score                       |
| `VALIDATION_CODES`                  | Stable issue code constants                  |

### Audit

| Export                      | Description                    |
| --------------------------- | ------------------------------ |
| `getWarningsForOpenAPI()`   | Warnings for OpenAPI source    |
| `getWarningsForWellKnown()` | Warnings for well-known source |
| `getWarningsForL2()`        | Warnings for route list        |
| `getWarningsForL3()`        | Warnings for endpoint metadata |
| `getWarningsForL4()`        | Warnings for guidance layer    |
| `AUDIT_CODES`               | Stable audit code constants    |

Ownership boundary:

- `@agentcash/discovery` owns discovery/advisory contracts.
- `@agentcash` should own all signing logic, but should be composable with the methods for probing built in this package.

Philosophy boundary:

- Machine-parsable discovery metadata belongs in OpenAPI.
- Discovery is advisory. Runtime payment challenge/probe is authoritative.
