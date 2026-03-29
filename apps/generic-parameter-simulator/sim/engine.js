const MODEL_VERSION = "3.0.0";
const DEFAULT_PARAMETER_WEIGHT = 1;
const DEFAULT_PARAMETER_UNCERTAINTY = 0.1;
const DEFAULT_FORECAST_PERIODS = 12;
const DEFAULT_OPTIMIZATION_ITERATIONS = 25;
const Z_SCORE_95 = 1.96;

const SCENARIO_KEYS = new Set(["parameters", "weights", "uncertainty", "bias", "threshold"]);

function createError(error, message, details) {
  if (details === undefined) {
    return { error, message };
  }

  return { error, message, details };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validateAllowedKeys(payload, allowedKeys, code = "invalid_request") {
  if (!isPlainObject(payload)) {
    return {
      error: createError(code, "request body must be an object"),
    };
  }

  const extras = Object.keys(payload).filter((key) => !allowedKeys.has(key));
  if (extras.length > 0) {
    return {
      error: createError(
        code,
        `unexpected field(s): ${extras.join(", ")}`,
        { unexpected_fields: extras },
      ),
    };
  }

  return { value: payload };
}

function validateSimCount(numSims) {
  if (!Number.isInteger(numSims) || numSims < 1) {
    return {
      error: createError(
        "invalid_sims",
        "numSims must be a positive integer",
        { numSims },
      ),
    };
  }

  return { value: numSims };
}

function percentile(sortedValues, quantile) {
  if (!sortedValues.length) {
    return 0;
  }

  if (quantile <= 0) {
    return sortedValues[0];
  }

  if (quantile >= 1) {
    return sortedValues[sortedValues.length - 1];
  }

  const index = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

function randomNormal(mean, stddev) {
  if (stddev === 0) {
    return mean;
  }

  let u1 = 0;
  let u2 = 0;

  while (u1 <= Number.EPSILON) {
    u1 = Math.random();
  }

  while (u2 <= Number.EPSILON) {
    u2 = Math.random();
  }

  const radius = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  const z = radius * Math.cos(theta);
  return mean + z * stddev;
}

function summarizeScores(scores) {
  if (!scores.length) {
    return {
      mean: 0,
      stddev: 0,
      min: 0,
      p10: 0,
      p50: 0,
      p90: 0,
      max: 0,
    };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const sum = scores.reduce((acc, value) => acc + value, 0);
  const mean = sum / scores.length;
  const variance =
    scores.reduce((acc, value) => acc + (value - mean) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);

  return {
    mean: round(mean),
    stddev: round(stddev),
    min: round(sorted[0]),
    p10: round(percentile(sorted, 0.1)),
    p50: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    max: round(sorted[sorted.length - 1]),
  };
}

function normalizeScenario(rawScenario, options = {}) {
  const {
    requireParameters = true,
    allowedTopLevelKeys = SCENARIO_KEYS,
  } = options;

  if (!isPlainObject(rawScenario)) {
    return {
      error: createError("invalid_scenario", "scenario must be an object"),
    };
  }

  const extraKeys = Object.keys(rawScenario).filter(
    (key) => !allowedTopLevelKeys.has(key),
  );
  if (extraKeys.length > 0) {
    return {
      error: createError(
        "invalid_scenario",
        `unexpected scenario field(s): ${extraKeys.join(", ")}`,
        { unexpected_fields: extraKeys },
      ),
    };
  }

  const rawParameters = rawScenario.parameters;
  if (!isPlainObject(rawParameters)) {
    return {
      error: createError("invalid_parameters", "parameters must be an object"),
    };
  }

  const parameterKeys = Object.keys(rawParameters);
  if (requireParameters && parameterKeys.length === 0) {
    return {
      error: createError("invalid_parameters", "parameters must include at least one key"),
    };
  }

  const parameters = {};
  for (const key of parameterKeys) {
    const value = rawParameters[key];
    if (!isFiniteNumber(value)) {
      return {
        error: createError(
          "invalid_parameters",
          `parameter "${key}" must be a finite number`,
          { field: `parameters.${key}` },
        ),
      };
    }
    parameters[key] = value;
  }

  const rawWeights = rawScenario.weights ?? {};
  if (!isPlainObject(rawWeights)) {
    return {
      error: createError("invalid_weights", "weights must be an object when provided"),
    };
  }

  const unknownWeightKeys = Object.keys(rawWeights).filter((key) => !(key in parameters));
  if (unknownWeightKeys.length > 0) {
    return {
      error: createError(
        "invalid_weights",
        `weights includes unknown parameter(s): ${unknownWeightKeys.join(", ")}`,
        { unknown_parameters: unknownWeightKeys },
      ),
    };
  }

  const weights = {};
  for (const key of parameterKeys) {
    const value = rawWeights[key];
    if (value === undefined) {
      weights[key] = DEFAULT_PARAMETER_WEIGHT;
      continue;
    }

    if (!isFiniteNumber(value)) {
      return {
        error: createError(
          "invalid_weights",
          `weight "${key}" must be a finite number`,
          { field: `weights.${key}` },
        ),
      };
    }

    weights[key] = value;
  }

  const rawUncertainty = rawScenario.uncertainty ?? {};
  if (!isPlainObject(rawUncertainty)) {
    return {
      error: createError(
        "invalid_uncertainty",
        "uncertainty must be an object when provided",
      ),
    };
  }

  const unknownUncertaintyKeys = Object.keys(rawUncertainty).filter(
    (key) => !(key in parameters),
  );
  if (unknownUncertaintyKeys.length > 0) {
    return {
      error: createError(
        "invalid_uncertainty",
        `uncertainty includes unknown parameter(s): ${unknownUncertaintyKeys.join(", ")}`,
        { unknown_parameters: unknownUncertaintyKeys },
      ),
    };
  }

  const uncertainty = {};
  for (const key of parameterKeys) {
    const value = rawUncertainty[key];
    if (value === undefined) {
      uncertainty[key] = DEFAULT_PARAMETER_UNCERTAINTY;
      continue;
    }

    if (!isFiniteNumber(value) || value < 0) {
      return {
        error: createError(
          "invalid_uncertainty",
          `uncertainty "${key}" must be a finite number >= 0`,
          { field: `uncertainty.${key}` },
        ),
      };
    }

    uncertainty[key] = value;
  }

  const bias = rawScenario.bias ?? 0;
  if (!isFiniteNumber(bias)) {
    return {
      error: createError("invalid_bias", "bias must be a finite number"),
    };
  }

  const threshold = rawScenario.threshold ?? 0;
  if (!isFiniteNumber(threshold)) {
    return {
      error: createError("invalid_threshold", "threshold must be a finite number"),
    };
  }

  return {
    value: {
      parameters,
      weights,
      uncertainty,
      bias,
      threshold,
      parameterKeys,
    },
  };
}

function runTrials(numSims, normalizedScenario) {
  const scores = new Array(numSims);
  const sampleSums = Object.fromEntries(
    normalizedScenario.parameterKeys.map((key) => [key, 0]),
  );
  const contributionSums = Object.fromEntries(
    normalizedScenario.parameterKeys.map((key) => [key, 0]),
  );

  let successes = 0;

  for (let i = 0; i < numSims; i += 1) {
    let score = normalizedScenario.bias;

    for (const key of normalizedScenario.parameterKeys) {
      const sample = randomNormal(
        normalizedScenario.parameters[key],
        normalizedScenario.uncertainty[key],
      );
      const contribution = sample * normalizedScenario.weights[key];
      score += contribution;
      sampleSums[key] += sample;
      contributionSums[key] += contribution;
    }

    scores[i] = score;
    if (score >= normalizedScenario.threshold) {
      successes += 1;
    }
  }

  const probability = successes / numSims;
  const margin =
    Z_SCORE_95 * Math.sqrt((probability * (1 - probability)) / Math.max(1, numSims));

  const parameterContributions = {};
  for (const key of normalizedScenario.parameterKeys) {
    parameterContributions[key] = {
      mean_sample: round(sampleSums[key] / numSims),
      weight: round(normalizedScenario.weights[key]),
      mean_contribution: round(contributionSums[key] / numSims),
    };
  }

  return {
    simulation_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      success_rule: "score >= threshold",
    },
    outcome_probability: round(probability),
    confidence_interval_95: {
      low: round(clamp(probability - margin, 0, 1)),
      high: round(clamp(probability + margin, 0, 1)),
    },
    score_distribution: summarizeScores(scores),
    parameter_contributions: parameterContributions,
  };
}

function runSimulation(numSims, scenario) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  const normalized = normalizeScenario(scenario);
  if (normalized.error) {
    return normalized.error;
  }

  return runTrials(numSims, normalized.value);
}

function toScenarioPayload(payload, options = {}) {
  if (!isPlainObject(payload)) {
    return {
      error: createError("invalid_request", "request body must be an object"),
    };
  }

  if (isPlainObject(payload.scenario)) {
    return { value: payload.scenario };
  }

  const allowedMetaKeys = options.metaKeys ?? new Set();
  const hasScenarioFields = Object.keys(payload).some((key) => SCENARIO_KEYS.has(key));
  if (!hasScenarioFields) {
    return {
      error: createError("invalid_scenario", "scenario is required"),
    };
  }

  const scenario = {};
  for (const key of Object.keys(payload)) {
    if (SCENARIO_KEYS.has(key)) {
      scenario[key] = payload[key];
    }
  }

  const extras = Object.keys(payload).filter(
    (key) => !allowedMetaKeys.has(key) && !SCENARIO_KEYS.has(key),
  );
  if (extras.length > 0) {
    return {
      error: createError(
        "invalid_request",
        `unexpected field(s): ${extras.join(", ")}`,
        { unexpected_fields: extras },
      ),
    };
  }

  return { value: scenario };
}
function runCompare(numSims, payload) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  if (!isPlainObject(payload)) {
    return createError("invalid_compare_request", "request body must be an object");
  }

  let baselineRaw = payload.baseline;
  let candidateRaw = payload.candidate;
  let labels = payload.labels;

  if (Array.isArray(payload.scenarios)) {
    if (payload.scenarios.length !== 2) {
      return createError(
        "invalid_compare_request",
        "scenarios array must contain exactly two entries",
      );
    }

    const [first, second] = payload.scenarios;
    baselineRaw = isPlainObject(first) && isPlainObject(first.scenario) ? first.scenario : first;
    candidateRaw = isPlainObject(second) && isPlainObject(second.scenario) ? second.scenario : second;

    labels = labels || {
      baseline:
        isPlainObject(first) && typeof first.label === "string"
          ? first.label
          : "baseline",
      candidate:
        isPlainObject(second) && typeof second.label === "string"
          ? second.label
          : "candidate",
    };
  }

  const allowedKeys = new Set(["baseline", "candidate", "scenarios", "labels"]);
  const keyCheck = validateAllowedKeys(payload, allowedKeys, "invalid_compare_request");
  if (keyCheck.error) {
    return keyCheck.error;
  }

  if (!isPlainObject(baselineRaw) || !isPlainObject(candidateRaw)) {
    return createError(
      "invalid_compare_request",
      "baseline and candidate scenarios are required",
    );
  }

  const baselineNormalized = normalizeScenario(baselineRaw);
  if (baselineNormalized.error) {
    return {
      ...baselineNormalized.error,
      details: {
        ...(baselineNormalized.error.details ?? {}),
        scenario: "baseline",
      },
    };
  }

  const candidateNormalized = normalizeScenario(candidateRaw);
  if (candidateNormalized.error) {
    return {
      ...candidateNormalized.error,
      details: {
        ...(candidateNormalized.error.details ?? {}),
        scenario: "candidate",
      },
    };
  }

  const baseline = runTrials(numSims, baselineNormalized.value);
  const candidate = runTrials(numSims, candidateNormalized.value);

  const baselineLabel =
    isPlainObject(labels) && typeof labels.baseline === "string"
      ? labels.baseline
      : "baseline";
  const candidateLabel =
    isPlainObject(labels) && typeof labels.candidate === "string"
      ? labels.candidate
      : "candidate";

  const probabilityDelta = candidate.outcome_probability - baseline.outcome_probability;
  const meanScoreDelta =
    candidate.score_distribution.mean - baseline.score_distribution.mean;

  return {
    comparison_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      baseline_label: baselineLabel,
      candidate_label: candidateLabel,
    },
    baseline,
    candidate,
    deltas: {
      outcome_probability: round(probabilityDelta),
      mean_score: round(meanScoreDelta),
      relative_probability_change:
        baseline.outcome_probability === 0
          ? null
          : round(probabilityDelta / baseline.outcome_probability),
    },
  };
}

function runSensitivity(numSims, payload) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  if (!isPlainObject(payload)) {
    return createError("invalid_sensitivity_request", "request body must be an object");
  }

  const allowedKeys = new Set([
    "scenario",
    "parameters",
    "weights",
    "uncertainty",
    "bias",
    "threshold",
    "parameter",
    "delta",
    "mode",
  ]);
  const keyCheck = validateAllowedKeys(payload, allowedKeys, "invalid_sensitivity_request");
  if (keyCheck.error) {
    return keyCheck.error;
  }

  const scenarioPayload = toScenarioPayload(payload, {
    metaKeys: new Set(["parameter", "delta", "mode"]),
  });
  if (scenarioPayload.error) {
    return scenarioPayload.error;
  }

  const normalized = normalizeScenario(scenarioPayload.value);
  if (normalized.error) {
    return normalized.error;
  }

  if (typeof payload.parameter !== "string" || payload.parameter.trim() === "") {
    return createError(
      "invalid_sensitivity_request",
      "parameter must be a non-empty string",
    );
  }

  const parameter = payload.parameter.trim();
  if (!normalized.value.parameterKeys.includes(parameter)) {
    return createError(
      "invalid_sensitivity_request",
      `parameter "${parameter}" must exist in scenario.parameters`,
    );
  }

  const delta = payload.delta ?? 0.1;
  if (!isFiniteNumber(delta) || delta <= 0) {
    return createError(
      "invalid_sensitivity_request",
      "delta must be a finite number greater than 0",
    );
  }

  const mode = payload.mode ?? "absolute";
  if (mode !== "absolute" && mode !== "relative") {
    return createError(
      "invalid_sensitivity_request",
      'mode must be either "absolute" or "relative"',
    );
  }

  const baseScenario = normalized.value;
  const baseline = runTrials(numSims, baseScenario);
  const baseValue = baseScenario.parameters[parameter];

  const lowerValue = mode === "relative" ? baseValue * (1 - delta) : baseValue - delta;
  const upperValue = mode === "relative" ? baseValue * (1 + delta) : baseValue + delta;

  const lowerScenario = {
    ...baseScenario,
    parameters: {
      ...baseScenario.parameters,
      [parameter]: lowerValue,
    },
  };

  const upperScenario = {
    ...baseScenario,
    parameters: {
      ...baseScenario.parameters,
      [parameter]: upperValue,
    },
  };

  const lower = runTrials(numSims, lowerScenario);
  const upper = runTrials(numSims, upperScenario);

  const denominator = upperValue - lowerValue;
  const gradient =
    denominator === 0
      ? null
      : round((upper.outcome_probability - lower.outcome_probability) / denominator, 6);

  return {
    sensitivity_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      parameter,
      mode,
      delta: round(delta, 6),
      base_parameter_value: round(baseValue, 6),
    },
    baseline,
    low_variant: {
      parameter_value: round(lowerValue, 6),
      result: lower,
    },
    high_variant: {
      parameter_value: round(upperValue, 6),
      result: upper,
    },
    sensitivity: {
      probability_gradient: gradient,
      shift_low: round(lower.outcome_probability - baseline.outcome_probability),
      shift_high: round(upper.outcome_probability - baseline.outcome_probability),
    },
  };
}

function runForecast(numSims, payload) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  if (!isPlainObject(payload)) {
    return createError("invalid_forecast_request", "request body must be an object");
  }

  const allowedKeys = new Set([
    "scenario",
    "parameters",
    "weights",
    "uncertainty",
    "bias",
    "threshold",
    "periods",
    "drift",
    "uncertainty_growth",
    "growth_mode",
  ]);
  const keyCheck = validateAllowedKeys(payload, allowedKeys, "invalid_forecast_request");
  if (keyCheck.error) {
    return keyCheck.error;
  }

  const scenarioPayload = toScenarioPayload(payload, {
    metaKeys: new Set(["periods", "drift", "uncertainty_growth", "growth_mode"]),
  });
  if (scenarioPayload.error) {
    return scenarioPayload.error;
  }

  const normalized = normalizeScenario(scenarioPayload.value);
  if (normalized.error) {
    return normalized.error;
  }

  const periods = payload.periods ?? DEFAULT_FORECAST_PERIODS;
  if (!Number.isInteger(periods) || periods < 1 || periods > 120) {
    return createError(
      "invalid_forecast_request",
      "periods must be an integer between 1 and 120",
    );
  }

  const growthMode = payload.growth_mode ?? "additive";
  if (growthMode !== "additive" && growthMode !== "multiplicative") {
    return createError(
      "invalid_forecast_request",
      'growth_mode must be either "additive" or "multiplicative"',
    );
  }

  const drift = payload.drift ?? {};
  if (!isPlainObject(drift)) {
    return createError("invalid_forecast_request", "drift must be an object when provided");
  }

  const unknownDriftKeys = Object.keys(drift).filter(
    (key) => !(key in normalized.value.parameters),
  );
  if (unknownDriftKeys.length > 0) {
    return createError(
      "invalid_forecast_request",
      `drift includes unknown parameter(s): ${unknownDriftKeys.join(", ")}`,
      { unknown_parameters: unknownDriftKeys },
    );
  }

  for (const key of Object.keys(drift)) {
    if (!isFiniteNumber(drift[key])) {
      return createError(
        "invalid_forecast_request",
        `drift "${key}" must be a finite number`,
      );
    }
  }

  const uncertaintyGrowth = payload.uncertainty_growth ?? 0;
  if (!isFiniteNumber(uncertaintyGrowth) || uncertaintyGrowth < 0) {
    return createError(
      "invalid_forecast_request",
      "uncertainty_growth must be a finite number >= 0",
    );
  }

  let workingScenario = {
    ...normalized.value,
    parameters: { ...normalized.value.parameters },
    uncertainty: { ...normalized.value.uncertainty },
  };

  const timeline = [];
  for (let period = 1; period <= periods; period += 1) {
    const parameterSnapshot = {};

    for (const key of workingScenario.parameterKeys) {
      const driftValue = drift[key] ?? 0;
      const previous = workingScenario.parameters[key];
      const next =
        growthMode === "multiplicative"
          ? previous * (1 + driftValue)
          : previous + driftValue;

      workingScenario.parameters[key] = next;
      parameterSnapshot[key] = round(next, 6);
    }

    for (const key of workingScenario.parameterKeys) {
      const baseUncertainty = normalized.value.uncertainty[key];
      const scaled = baseUncertainty * (1 + uncertaintyGrowth * (period - 1));
      workingScenario.uncertainty[key] = scaled;
    }

    const result = runTrials(numSims, workingScenario);
    timeline.push({
      period,
      parameters: parameterSnapshot,
      outcome_probability: result.outcome_probability,
      confidence_interval_95: result.confidence_interval_95,
      mean_score: result.score_distribution.mean,
    });
  }

  const firstProbability = timeline[0]?.outcome_probability ?? 0;
  const lastProbability = timeline[timeline.length - 1]?.outcome_probability ?? 0;

  return {
    forecast_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      periods,
      growth_mode: growthMode,
      uncertainty_growth: round(uncertaintyGrowth, 6),
    },
    timeline,
    summary: {
      start_probability: firstProbability,
      end_probability: lastProbability,
      net_change: round(lastProbability - firstProbability),
    },
  };
}
function runComposed(numSims, payload) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  if (!isPlainObject(payload)) {
    return createError("invalid_composed_request", "request body must be an object");
  }

  const allowedKeys = new Set(["components"]);
  const keyCheck = validateAllowedKeys(payload, allowedKeys, "invalid_composed_request");
  if (keyCheck.error) {
    return keyCheck.error;
  }

  if (!Array.isArray(payload.components) || payload.components.length === 0) {
    return createError(
      "invalid_composed_request",
      "components must be a non-empty array",
    );
  }

  if (payload.components.length > 25) {
    return createError(
      "invalid_composed_request",
      "components cannot contain more than 25 entries",
    );
  }

  const normalizedComponents = [];
  for (let index = 0; index < payload.components.length; index += 1) {
    const component = payload.components[index];
    if (!isPlainObject(component)) {
      return createError(
        "invalid_composed_request",
        `components[${index}] must be an object`,
      );
    }

    const allowedComponentKeys = new Set([
      "label",
      "weight",
      "scenario",
      "parameters",
      "weights",
      "uncertainty",
      "bias",
      "threshold",
    ]);
    const componentKeyCheck = validateAllowedKeys(
      component,
      allowedComponentKeys,
      "invalid_composed_request",
    );
    if (componentKeyCheck.error) {
      return componentKeyCheck.error;
    }

    const scenarioPayload = toScenarioPayload(component, {
      metaKeys: new Set(["label", "weight"]),
    });
    if (scenarioPayload.error) {
      return {
        ...scenarioPayload.error,
        details: {
          ...(scenarioPayload.error.details ?? {}),
          component_index: index,
        },
      };
    }

    const normalizedScenario = normalizeScenario(scenarioPayload.value);
    if (normalizedScenario.error) {
      return {
        ...normalizedScenario.error,
        details: {
          ...(normalizedScenario.error.details ?? {}),
          component_index: index,
        },
      };
    }

    const weight = component.weight ?? 1;
    if (!isFiniteNumber(weight) || weight <= 0) {
      return createError(
        "invalid_composed_request",
        `components[${index}].weight must be a finite number > 0`,
      );
    }

    normalizedComponents.push({
      label:
        typeof component.label === "string" && component.label.trim() !== ""
          ? component.label.trim()
          : `component_${index + 1}`,
      weight,
      scenario: normalizedScenario.value,
    });
  }

  const totalWeight = normalizedComponents.reduce((acc, item) => acc + item.weight, 0);
  const components = normalizedComponents.map((component) => {
    const result = runTrials(numSims, component.scenario);
    return {
      label: component.label,
      weight: round(component.weight, 6),
      normalized_weight: round(component.weight / totalWeight, 6),
      result,
    };
  });

  const weightedProbability = components.reduce(
    (acc, component) =>
      acc + component.result.outcome_probability * component.normalized_weight,
    0,
  );
  const weightedMeanScore = components.reduce(
    (acc, component) =>
      acc + component.result.score_distribution.mean * component.normalized_weight,
    0,
  );
  const weightedCiLow = components.reduce(
    (acc, component) =>
      acc + component.result.confidence_interval_95.low * component.normalized_weight,
    0,
  );
  const weightedCiHigh = components.reduce(
    (acc, component) =>
      acc + component.result.confidence_interval_95.high * component.normalized_weight,
    0,
  );

  return {
    composed_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      components: components.length,
    },
    components,
    composed_outcome: {
      outcome_probability: round(weightedProbability),
      confidence_interval_95: {
        low: round(weightedCiLow),
        high: round(weightedCiHigh),
      },
      mean_score: round(weightedMeanScore),
    },
  };
}

function buildOptimizationBounds(parameters, rawBounds) {
  if (rawBounds === undefined) {
    const defaultBounds = {};
    for (const key of Object.keys(parameters)) {
      const center = parameters[key];
      const spread = Math.max(0.25, Math.abs(center) * 0.5);
      defaultBounds[key] = {
        min: center - spread,
        max: center + spread,
      };
    }
    return { value: defaultBounds };
  }

  if (!isPlainObject(rawBounds)) {
    return {
      error: createError("invalid_optimize_request", "bounds must be an object"),
    };
  }

  const unknownKeys = Object.keys(rawBounds).filter((key) => !(key in parameters));
  if (unknownKeys.length > 0) {
    return {
      error: createError(
        "invalid_optimize_request",
        `bounds include unknown parameter(s): ${unknownKeys.join(", ")}`,
        { unknown_parameters: unknownKeys },
      ),
    };
  }

  const bounds = {};
  for (const key of Object.keys(parameters)) {
    const bound = rawBounds[key];
    if (!isPlainObject(bound)) {
      const center = parameters[key];
      const spread = Math.max(0.25, Math.abs(center) * 0.5);
      bounds[key] = {
        min: center - spread,
        max: center + spread,
      };
      continue;
    }

    if (!isFiniteNumber(bound.min) || !isFiniteNumber(bound.max) || bound.min >= bound.max) {
      return {
        error: createError(
          "invalid_optimize_request",
          `bounds.${key} must include finite min < max`,
          { field: `bounds.${key}` },
        ),
      };
    }

    bounds[key] = {
      min: bound.min,
      max: bound.max,
    };
  }

  return { value: bounds };
}

function drawRandomCandidate(bounds) {
  const candidate = {};
  for (const key of Object.keys(bounds)) {
    const min = bounds[key].min;
    const max = bounds[key].max;
    candidate[key] = min + Math.random() * (max - min);
  }

  return candidate;
}

function objectiveValue(objective, result) {
  if (objective === "mean_score") {
    return result.score_distribution.mean;
  }

  return result.outcome_probability;
}

function runOptimize(numSims, payload) {
  const simCount = validateSimCount(numSims);
  if (simCount.error) {
    return simCount.error;
  }

  if (!isPlainObject(payload)) {
    return createError("invalid_optimize_request", "request body must be an object");
  }

  const allowedKeys = new Set([
    "scenario",
    "parameters",
    "weights",
    "uncertainty",
    "bias",
    "threshold",
    "bounds",
    "iterations",
    "objective",
  ]);
  const keyCheck = validateAllowedKeys(payload, allowedKeys, "invalid_optimize_request");
  if (keyCheck.error) {
    return keyCheck.error;
  }

  const scenarioPayload = toScenarioPayload(payload, {
    metaKeys: new Set(["bounds", "iterations", "objective"]),
  });
  if (scenarioPayload.error) {
    return scenarioPayload.error;
  }

  const normalized = normalizeScenario(scenarioPayload.value);
  if (normalized.error) {
    return normalized.error;
  }

  const objective = payload.objective ?? "outcome_probability";
  if (objective !== "outcome_probability" && objective !== "mean_score") {
    return createError(
      "invalid_optimize_request",
      'objective must be either "outcome_probability" or "mean_score"',
    );
  }

  const iterations = payload.iterations ?? DEFAULT_OPTIMIZATION_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 500) {
    return createError(
      "invalid_optimize_request",
      "iterations must be an integer between 1 and 500",
    );
  }

  const boundsResult = buildOptimizationBounds(
    normalized.value.parameters,
    payload.bounds,
  );
  if (boundsResult.error) {
    return boundsResult.error;
  }

  const bounds = boundsResult.value;
  const baseResult = runTrials(numSims, normalized.value);
  let bestParameters = { ...normalized.value.parameters };
  let bestResult = baseResult;
  let bestObjectiveValue = objectiveValue(objective, baseResult);

  for (let i = 0; i < iterations; i += 1) {
    const candidateParameters = drawRandomCandidate(bounds);
    const candidateScenario = {
      ...normalized.value,
      parameters: candidateParameters,
    };
    const candidateResult = runTrials(numSims, candidateScenario);
    const score = objectiveValue(objective, candidateResult);
    if (score > bestObjectiveValue) {
      bestObjectiveValue = score;
      bestParameters = candidateParameters;
      bestResult = candidateResult;
    }
  }

  const improvement =
    objective === "mean_score"
      ? bestResult.score_distribution.mean - baseResult.score_distribution.mean
      : bestResult.outcome_probability - baseResult.outcome_probability;

  return {
    optimization_meta: {
      simulations_run: numSims,
      model_version: MODEL_VERSION,
      objective,
      iterations_evaluated: iterations + 1,
    },
    baseline: {
      parameters: Object.fromEntries(
        Object.entries(normalized.value.parameters).map(([key, value]) => [key, round(value, 6)]),
      ),
      result: baseResult,
    },
    optimum: {
      parameters: Object.fromEntries(
        Object.entries(bestParameters).map(([key, value]) => [key, round(value, 6)]),
      ),
      result: bestResult,
      objective_value: round(bestObjectiveValue),
    },
    improvement: round(improvement),
    bounds: Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [
        key,
        {
          min: round(value.min, 6),
          max: round(value.max, 6),
        },
      ]),
    ),
  };
}

module.exports = {
  MODEL_VERSION,
  normalizeScenario,
  runSimulation,
  runCompare,
  runSensitivity,
  runForecast,
  runComposed,
  runOptimize,
};
