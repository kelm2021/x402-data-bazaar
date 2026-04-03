const { Router } = require("express");
const router = Router();

const ITERATIONS = 10000;

function runMonteCarlo({ parameters, weights, uncertainty, bias = 0, threshold = 0.5 }) {
  const keys = Object.keys(parameters);
  let successes = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    let score = bias;
    for (const k of keys) {
      const base = parameters[k];
      const u = (uncertainty && uncertainty[k]) || 0;
      const w = (weights && weights[k]) || 1;
      const sample = base + (Math.random() * 2 - 1) * u;
      score += sample * w;
    }
    if (score >= threshold) successes++;
  }
  return {
    probability: +(successes / ITERATIONS).toFixed(6),
    iterations: ITERATIONS,
    parameterCount: keys.length,
    threshold,
  };
}

router.post("/api/sim/probability", (req, res) => {
  const { parameters, weights, uncertainty, bias, threshold } = req.body || {};
  if (!parameters || typeof parameters !== "object" || Object.keys(parameters).length === 0) {
    return res.status(400).json({ error: "parameters object required with at least one key" });
  }
  const result = runMonteCarlo({ parameters, weights, uncertainty, bias, threshold });
  res.json({ type: "probability", ...result });
});

router.post("/api/sim/compare", (req, res) => {
  const { baseline, candidate, labels } = req.body || {};
  if (!baseline?.parameters || !candidate?.parameters) {
    return res.status(400).json({ error: "baseline and candidate with parameters required" });
  }
  const baseResult = runMonteCarlo(baseline);
  const candResult = runMonteCarlo(candidate);
  const delta = +(candResult.probability - baseResult.probability).toFixed(6);
  res.json({
    type: "compare",
    baseline: { label: labels?.baseline || "baseline", ...baseResult },
    candidate: { label: labels?.candidate || "candidate", ...candResult },
    uplift: { delta, relative: baseResult.probability > 0 ? +(delta / baseResult.probability).toFixed(4) : null },
  });
});

router.post("/api/sim/sensitivity", (req, res) => {
  const { scenario, parameter, delta = 0.1, mode = "absolute" } = req.body || {};
  if (!scenario?.parameters || !parameter) {
    return res.status(400).json({ error: "scenario with parameters and parameter name required" });
  }
  const base = runMonteCarlo(scenario);
  const plusParams = { ...scenario, parameters: { ...scenario.parameters } };
  const minusParams = { ...scenario, parameters: { ...scenario.parameters } };
  const val = scenario.parameters[parameter] || 0;
  const d = mode === "relative" ? val * delta : delta;
  plusParams.parameters[parameter] = val + d;
  minusParams.parameters[parameter] = val - d;
  const plus = runMonteCarlo(plusParams);
  const minus = runMonteCarlo(minusParams);
  res.json({
    type: "sensitivity",
    parameter,
    delta: d,
    mode,
    base: base.probability,
    plus: plus.probability,
    minus: minus.probability,
    swing: +(plus.probability - minus.probability).toFixed(6),
  });
});

router.post("/api/sim/forecast", (req, res) => {
  const { scenario, periods = 12, drift, uncertainty_growth = 0, growth_mode = "additive" } = req.body || {};
  if (!scenario?.parameters) {
    return res.status(400).json({ error: "scenario with parameters required" });
  }
  const path = [];
  let current = { ...scenario, parameters: { ...scenario.parameters }, uncertainty: { ...(scenario.uncertainty || {}) } };
  for (let t = 0; t < Math.min(periods, 120); t++) {
    const result = runMonteCarlo(current);
    path.push({ period: t + 1, probability: result.probability });
    if (drift) {
      for (const k of Object.keys(drift)) {
        current.parameters[k] = (current.parameters[k] || 0) + drift[k];
      }
    }
    if (uncertainty_growth > 0) {
      for (const k of Object.keys(current.uncertainty)) {
        if (growth_mode === "multiplicative") {
          current.uncertainty[k] *= (1 + uncertainty_growth);
        } else {
          current.uncertainty[k] += uncertainty_growth;
        }
      }
    }
  }
  res.json({ type: "forecast", periods: path.length, path });
});

router.post("/api/sim/composed", (req, res) => {
  const { components } = req.body || {};
  if (!Array.isArray(components) || components.length === 0) {
    return res.status(400).json({ error: "components array required" });
  }
  let totalWeight = 0;
  let blended = 0;
  const traces = [];
  for (const c of components.slice(0, 25)) {
    const scenario = c.scenario || { parameters: c.parameters, weights: c.weights, uncertainty: c.uncertainty, bias: c.bias, threshold: c.threshold };
    const result = runMonteCarlo(scenario);
    const w = c.weight || 1;
    totalWeight += w;
    blended += result.probability * w;
    traces.push({ label: c.label || "component", weight: w, probability: result.probability });
  }
  res.json({ type: "composed", blendedProbability: +(blended / totalWeight).toFixed(6), components: traces });
});

router.post("/api/sim/optimize", (req, res) => {
  const { scenario, bounds, iterations = 100, objective = "outcome_probability" } = req.body || {};
  if (!scenario?.parameters || !bounds) {
    return res.status(400).json({ error: "scenario with parameters and bounds required" });
  }
  const boundKeys = Object.keys(bounds);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(iterations, 500); i++) {
    const trial = { ...scenario, parameters: { ...scenario.parameters } };
    for (const k of boundKeys) {
      const { min, max } = bounds[k];
      trial.parameters[k] = min + Math.random() * (max - min);
    }
    const result = runMonteCarlo(trial);
    const score = objective === "mean_score" ? result.probability : result.probability;
    if (score > bestScore) {
      bestScore = score;
      best = { ...trial.parameters };
    }
  }
  res.json({ type: "optimize", objective, iterations: Math.min(iterations, 500), bestProbability: +bestScore.toFixed(6), bestParameters: best });
});

module.exports = router;
