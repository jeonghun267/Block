import type {
  ConditionEvaluationV1,
  EvaluationStateV1,
  PercentSampleV1,
  PriceConditionV1,
} from "./schema";

export function percentChange(observed: number, reference: number): number | null {
  if (!Number.isFinite(observed) || !Number.isFinite(reference) || reference === 0) return null;
  return ((observed - reference) / Math.abs(reference)) * 100;
}

function forwardFill(samples: readonly PercentSampleV1[], maxCarryBars: number): PercentSampleV1[] {
  let last: PercentSampleV1 | null = null;
  return samples.map((sample) => {
    if (sample.observed !== null && sample.reference !== null) {
      last = sample;
      return sample;
    }
    if (!last || sample.barIndex - last.barIndex > maxCarryBars) return sample;
    return { ...sample, observed: last.observed, reference: last.reference };
  });
}

function levelMatches(condition: PriceConditionV1, pct: number): boolean {
  if (condition.trigger.kind !== "level") return false;
  return condition.trigger.operator === "gte" ? pct >= condition.trigger.thresholdPct : pct <= condition.trigger.thresholdPct;
}

function crossMatches(condition: PriceConditionV1, previous: number | null, current: number): boolean {
  if (condition.trigger.kind !== "cross" || previous === null) return false;
  const threshold = condition.trigger.thresholdPct;
  return condition.trigger.direction === "above"
    ? previous < threshold && current >= threshold
    : previous > threshold && current <= threshold;
}

function repeatBlocked(condition: PriceConditionV1, state: EvaluationStateV1, currentBar: number): boolean {
  if (condition.repeat.mode === "once") return state.hasTriggered;
  if (condition.repeat.mode === "once_per_bar") return state.lastTriggeredBar === currentBar;
  if (state.lastTriggeredBar === null) return false;
  return currentBar - state.lastTriggeredBar <= condition.repeat.cooldownBars;
}

/**
 * Pure and deterministic: the function neither reads the clock nor mutates samples/state.
 * Samples must be ordered by ascending barIndex; the final sample is treated as "now".
 */
export function evaluatePercentCondition(
  condition: PriceConditionV1,
  inputSamples: readonly PercentSampleV1[],
  state: EvaluationStateV1 = { hasTriggered: false, lastTriggeredBar: null },
): ConditionEvaluationV1 {
  const window = inputSamples.slice(-condition.confirmation.windowBars);
  if (window.length === 0) return { matched: false, triggered: false, metricPct: null, hits: 0, reason: "missing_data" };
  const samples = condition.missingData.mode === "carry_forward" ? forwardFill(window, condition.missingData.maxCarryBars) : [...window];
  const current = samples.at(-1)!;
  if (condition.confirmation.closedBarsOnly && !current.closed) return { matched: false, triggered: false, metricPct: null, hits: 0, reason: "open_candle" };

  const values = samples.map((sample) => percentChange(sample.observed ?? NaN, sample.reference ?? NaN));
  const currentPct = values.at(-1) ?? null;
  if (currentPct === null) return { matched: false, triggered: false, metricPct: null, hits: 0, reason: "missing_data" };
  if (condition.missingData.mode === "fail_closed" && values.some((value) => value === null)) {
    return { matched: false, triggered: false, metricPct: currentPct, hits: 0, reason: "missing_data" };
  }

  let hits = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null) continue;
    const matched = condition.trigger.kind === "level"
      ? levelMatches(condition, value)
      : crossMatches(condition, index > 0 ? values[index - 1] : null, value);
    if (matched) hits += 1;
  }
  const matched = hits >= condition.confirmation.minimumHits;
  if (!matched) return { matched: false, triggered: false, metricPct: currentPct, hits, reason: hits > 0 ? "confirmation_pending" : "condition_not_met" };
  if (repeatBlocked(condition, state, current.barIndex)) return { matched: true, triggered: false, metricPct: currentPct, hits, reason: "repeat_blocked" };
  return { matched: true, triggered: true, metricPct: currentPct, hits, reason: "triggered" };
}
