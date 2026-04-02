import express from "express";
import axios from "axios";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { wrapAxiosWithPayment, x402Client } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
const SIM_API_BASE_URL = String(process.env.SIM_API_BASE_URL || "https://x402.aurelianflo.com")
    .trim()
    .replace(/\/+$/, "");
const SIM_INTERNAL_BYPASS_TOKEN = String(process.env.SIM_INTERNAL_BYPASS_TOKEN || "").trim();
const privateKey = String(process.env.EVM_PRIVATE_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("EVM_PRIVATE_KEY must be set to a 0x-prefixed 32-byte private key");
}
const signer = privateKeyToAccount(privateKey);
const paymentClient = new x402Client();
paymentClient.register("eip155:*", new ExactEvmScheme(signer));
const api = wrapAxiosWithPayment(axios.create({
    baseURL: SIM_API_BASE_URL,
    timeout: 30000,
    headers: {
        "content-type": "application/json",
        ...(SIM_INTERNAL_BYPASS_TOKEN
            ? { "x-sim-internal-bypass-token": SIM_INTERNAL_BYPASS_TOKEN }
            : {}),
    },
}), paymentClient);
const MCP_SERVER_INFO = {
    name: "aurelian-sim",
    version: "1.0.0",
};
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const finiteNumberSchema = z.preprocess((value) => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return value;
        }
        const coerced = Number(trimmed);
        return Number.isFinite(coerced) ? coerced : value;
    }
    return value;
}, z.number().finite());
const scenarioSchema = z.object({
    parameters: z.record(finiteNumberSchema),
    weights: z.record(finiteNumberSchema).optional(),
    uncertainty: z.record(finiteNumberSchema).optional(),
    bias: finiteNumberSchema.optional(),
    threshold: finiteNumberSchema.optional(),
});
const toolEnvelopeShape = {
    type: z.string().optional(),
    method: z.string().optional(),
    bodyType: z.string().optional(),
    body: z.unknown().optional(),
};
const scenarioInputSchema = z.union([z.string(), scenarioSchema, z.object({}).passthrough()]);
function coerceFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return undefined;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}
function coerceNumericRecord(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const output = {};
    for (const [key, raw] of Object.entries(value)) {
        const numeric = coerceFiniteNumber(raw);
        if (numeric !== undefined) {
            output[key] = numeric;
        }
    }
    return output;
}
function coerceScenarioLike(value) {
    if (!isPlainObject(value)) {
        return value;
    }
    const normalized = { ...value };
    if ("parameters" in value) {
        normalized.parameters = coerceNumericRecord(value.parameters);
    }
    if ("weights" in value) {
        normalized.weights = coerceNumericRecord(value.weights);
    }
    if ("uncertainty" in value) {
        normalized.uncertainty = coerceNumericRecord(value.uncertainty);
    }
    if ("bias" in value) {
        const bias = coerceFiniteNumber(value.bias);
        normalized.bias = bias ?? value.bias;
    }
    if ("threshold" in value) {
        const threshold = coerceFiniteNumber(value.threshold);
        normalized.threshold = threshold ?? value.threshold;
    }
    return normalized;
}
function unwrapToolPayload(input) {
    let current = input;
    for (let index = 0; index < 4; index += 1) {
        if (!isPlainObject(current)) {
            break;
        }
        if (!isPlainObject(current.body)) {
            break;
        }
        const keys = Object.keys(current);
        const hasEnvelopeShape = keys.length === 1 ||
            "type" in current ||
            "bodyType" in current ||
            "method" in current ||
            keys.every((key) => ["type", "method", "bodyType", "body", "queryParams"].includes(key));
        if (!hasEnvelopeShape) {
            break;
        }
        current = current.body;
    }
    return current;
}
function normalizeScenario(input, fieldName) {
    let candidate = input;
    if (typeof candidate === "string") {
        try {
            candidate = JSON.parse(candidate);
        }
        catch (error) {
            throw new Error(`${fieldName} must be valid scenario JSON when provided as a string`);
        }
    }
    if (isPlainObject(candidate) && isPlainObject(candidate.scenario)) {
        candidate = candidate.scenario;
    }
    candidate = coerceScenarioLike(candidate);
    try {
        return scenarioSchema.parse(candidate);
    }
    catch (error) {
        throw new Error(`${fieldName} must be a valid scenario object with numeric parameters`);
    }
}
function normalizeBounds(bounds) {
    if (!isPlainObject(bounds)) {
        return undefined;
    }
    const normalized = {};
    for (const [key, value] of Object.entries(bounds)) {
        if (Array.isArray(value)) {
            const min = coerceFiniteNumber(value[0]);
            const max = coerceFiniteNumber(value[1]);
            if (min === undefined || max === undefined) {
                continue;
            }
            normalized[key] = { min, max };
            continue;
        }
        if (!isPlainObject(value)) {
            continue;
        }
        const min = coerceFiniteNumber(value.min);
        const max = coerceFiniteNumber(value.max);
        if (min === undefined || max === undefined) {
            continue;
        }
        normalized[key] = {
            min,
            max,
        };
    }
    return Object.keys(normalized).length ? normalized : undefined;
}
function extractScenarioFromPayload(payload, fieldName) {
    if (payload.scenario !== undefined) {
        return normalizeScenario(payload.scenario, fieldName);
    }
    if (payload.parameters !== undefined) {
        return normalizeScenario(payload, fieldName);
    }
    throw new Error(`${fieldName} is required`);
}
function readStringAlias(payload, keys) {
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}
async function callSim(path, args) {
    try {
        const response = await api.post(path, args);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(response.data, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const axiosError = error;
        const payload = {
            error: axiosError.message || "sim_call_failed",
            status: axiosError.response?.status || null,
            details: axiosError.response?.data || null,
            endpoint: `${SIM_API_BASE_URL}${path}`,
        };
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: JSON.stringify(payload, null, 2),
                },
            ],
        };
    }
}
function parseProbabilityArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("probability input must be an object");
    }
    return extractScenarioFromPayload(payload, "scenario");
}
function parseCompareArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("compare input must be an object");
    }
    let baselineRaw = payload.baseline;
    let candidateRaw = payload.candidate;
    if (Array.isArray(payload.scenarios) && payload.scenarios.length >= 2) {
        const first = payload.scenarios[0];
        const second = payload.scenarios[1];
        baselineRaw = isPlainObject(first) && first.scenario !== undefined ? first.scenario : first;
        candidateRaw = isPlainObject(second) && second.scenario !== undefined ? second.scenario : second;
    }
    if (baselineRaw === undefined || candidateRaw === undefined) {
        throw new Error("compare requires baseline and candidate scenarios");
    }
    return {
        baseline: normalizeScenario(baselineRaw, "baseline"),
        candidate: normalizeScenario(candidateRaw, "candidate"),
        ...(isPlainObject(payload.labels) ? { labels: payload.labels } : {}),
    };
}
function parseSensitivityArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("sensitivity input must be an object");
    }
    const parameter = readStringAlias(payload, [
        "parameter",
        "target_parameter",
        "feature",
        "variable",
        "vary",
        "parameter_name",
    ]);
    if (!parameter) {
        throw new Error("sensitivity requires a parameter field");
    }
    const parsed = {
        scenario: extractScenarioFromPayload(payload, "scenario"),
        parameter,
    };
    const delta = coerceFiniteNumber(payload.delta ?? payload.step);
    if (delta !== undefined) {
        parsed.delta = delta;
    }
    const mode = readStringAlias(payload, ["mode"]);
    if (mode) {
        if (mode !== "absolute" && mode !== "relative") {
            throw new Error('mode must be "absolute" or "relative"');
        }
        parsed.mode = mode;
    }
    return parsed;
}
function parseForecastArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("forecast input must be an object");
    }
    const parsed = {
        scenario: extractScenarioFromPayload(payload, "scenario"),
    };
    const periods = coerceFiniteNumber(payload.periods ?? payload.horizon ?? payload.steps);
    if (periods !== undefined) {
        parsed.periods = Math.trunc(periods);
    }
    const drift = coerceNumericRecord(payload.drift);
    if (drift && Object.keys(drift).length > 0) {
        parsed.drift = drift;
    }
    const uncertaintyGrowth = coerceFiniteNumber(payload.uncertainty_growth ?? payload.uncertaintyGrowth);
    if (uncertaintyGrowth !== undefined) {
        parsed.uncertainty_growth = uncertaintyGrowth;
    }
    const growthMode = readStringAlias(payload, ["growth_mode", "growthMode"]);
    if (growthMode) {
        if (growthMode !== "additive" && growthMode !== "multiplicative") {
            throw new Error('growth_mode must be "additive" or "multiplicative"');
        }
        parsed.growth_mode = growthMode;
    }
    return parsed;
}
function parseComposedArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("composed input must be an object");
    }
    const sourceComponents = Array.isArray(payload.components)
        ? payload.components
        : Array.isArray(payload.scenarios)
            ? payload.scenarios
            : null;
    if (!sourceComponents || sourceComponents.length === 0) {
        throw new Error("composed requires a non-empty components array");
    }
    const components = sourceComponents.map((entry, index) => {
        if (!isPlainObject(entry)) {
            throw new Error(`components[${index}] must be an object`);
        }
        const weight = coerceFiniteNumber(entry.weight ?? entry.w ?? 1);
        if (weight === undefined || weight <= 0) {
            throw new Error(`components[${index}].weight must be a positive number`);
        }
        const scenarioInput = entry.scenario !== undefined
            ? entry.scenario
            : entry.parameters !== undefined
                ? entry
                : null;
        if (scenarioInput === null) {
            throw new Error(`components[${index}] must include scenario or parameters`);
        }
        const scenario = normalizeScenario(scenarioInput, `components[${index}].scenario`);
        const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : undefined;
        return {
            ...(label ? { label } : {}),
            weight,
            scenario,
        };
    });
    return { components };
}
function parseOptimizeArgs(rawArgs) {
    const payload = unwrapToolPayload(rawArgs);
    if (!isPlainObject(payload)) {
        throw new Error("optimize input must be an object");
    }
    const parsed = {
        scenario: extractScenarioFromPayload(payload, "scenario"),
    };
    const bounds = normalizeBounds(payload.bounds ?? payload.parameter_bounds);
    if (bounds) {
        parsed.bounds = bounds;
    }
    const iterations = coerceFiniteNumber(payload.iterations ?? payload.iteration_count ?? payload.max_iterations);
    if (iterations !== undefined) {
        parsed.iterations = Math.trunc(iterations);
    }
    const objectiveRaw = readStringAlias(payload, ["objective", "target"]);
    if (objectiveRaw) {
        const objectiveAlias = objectiveRaw.toLowerCase();
        const normalizedObjective = objectiveAlias === "probability" ||
            objectiveAlias === "maximize" ||
            objectiveAlias === "maximize_probability" ||
            objectiveAlias === "maximize_outcome_probability"
            ? "outcome_probability"
            : objectiveAlias === "mean" ||
                objectiveAlias === "score" ||
                objectiveAlias === "maximize_mean" ||
                objectiveAlias === "maximize_mean_score"
                ? "mean_score"
                : objectiveRaw;
        if (normalizedObjective !== "outcome_probability" && normalizedObjective !== "mean_score") {
            throw new Error('objective must be "outcome_probability" or "mean_score"');
        }
        parsed.objective = normalizedObjective;
    }
    return parsed;
}
function registerTools(server) {
    server.tool("run_probability_sim", "Estimate outcome probability for a scenario using Monte Carlo simulation over parameter uncertainty.", toolEnvelopeShape, async (args) => callSim("/api/sim/probability", parseProbabilityArgs(args)));
    server.tool("compare_scenarios", "Compare baseline and candidate scenarios and return uplift deltas with diagnostics.", toolEnvelopeShape, async (args) => callSim("/api/sim/compare", parseCompareArgs(args)));
    server.tool("run_sensitivity", "Measure sensitivity of one parameter via plus/minus perturbation runs.", toolEnvelopeShape, async (args) => callSim("/api/sim/sensitivity", parseSensitivityArgs(args)));
    server.tool("forecast_probability", "Generate a forward probability path across future periods under trend assumptions.", toolEnvelopeShape, async (args) => callSim("/api/sim/forecast", parseForecastArgs(args)));
    server.tool("compose_scenarios", "Blend weighted scenario components into a single probability estimate.", toolEnvelopeShape, async (args) => callSim("/api/sim/composed", parseComposedArgs(args)));
    server.tool("optimize_scenario", "Search bounded parameter ranges to maximize objective value.", toolEnvelopeShape, async (args) => callSim("/api/sim/optimize", parseOptimizeArgs(args)));
}
function createMcpServer() {
    const server = new McpServer(MCP_SERVER_INFO);
    registerTools(server);
    return server;
}
const app = express();
app.use(express.json({ limit: "1mb" }));
app.post("/mcp", async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.error("MCP request handling failed", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal server error",
                },
                id: null,
            });
        }
    }
    finally {
        await transport.close().catch(() => { });
        await server.close().catch(() => { });
    }
});
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "aurelian-sim-mcp",
        simApiBaseUrl: SIM_API_BASE_URL,
    });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`aurelian-sim MCP server running on :${port}`);
});
