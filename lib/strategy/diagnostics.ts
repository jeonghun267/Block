import type { PriceConditionV1, StrategyV1 } from "./schema";

export interface StrategyDiagnostic {
  severity: "error" | "warning";
  code: "duplicate_condition" | "contradictory_conditions" | "unreachable_condition";
  conditionIds: string[];
  message: string;
}

function referenceKey(condition: PriceConditionV1): string {
  const reference = condition.reference;
  return [condition.metric, reference.kind, reference.interval, reference.lookbackPeriods, reference.priceField].join(":");
}

function exactKey(condition: PriceConditionV1): string {
  return JSON.stringify({
    metric: condition.metric,
    reference: condition.reference,
    trigger: condition.trigger,
    confirmation: condition.confirmation,
    missingData: condition.missingData,
    repeat: condition.repeat,
  });
}

function level(condition: PriceConditionV1) {
  return condition.trigger.kind === "level" ? condition.trigger : null;
}

export function diagnoseStrategy(strategy: StrategyV1): StrategyDiagnostic[] {
  const diagnostics: StrategyDiagnostic[] = [];
  const seen = new Map<string, string>();
  for (const condition of strategy.conditions) {
    const key = exactKey(condition);
    const first = seen.get(key);
    if (first) diagnostics.push({ severity: "warning", code: "duplicate_condition", conditionIds: [first, condition.id], message: "같은 조건이 중복되어 한 번만 평가해도 됩니다." });
    else seen.set(key, condition.id);
  }

  const groups = new Map<string, PriceConditionV1[]>();
  for (const condition of strategy.conditions) groups.set(referenceKey(condition), [...(groups.get(referenceKey(condition)) ?? []), condition]);
  for (const conditions of groups.values()) {
    const unique = conditions.filter((condition, index) => conditions.findIndex((candidate) => exactKey(candidate) === exactKey(condition)) === index);
    for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
        const left = unique[leftIndex];
        const right = unique[rightIndex];
        const leftLevel = level(left);
        const rightLevel = level(right);
        if (!leftLevel || !rightLevel) continue;
        const lower = leftLevel.operator === "gte" ? leftLevel.thresholdPct : rightLevel.operator === "gte" ? rightLevel.thresholdPct : null;
        const upper = leftLevel.operator === "lte" ? leftLevel.thresholdPct : rightLevel.operator === "lte" ? rightLevel.thresholdPct : null;
        if (strategy.match === "all" && lower !== null && upper !== null && lower > upper) {
          diagnostics.push({ severity: "error", code: "contradictory_conditions", conditionIds: [left.id, right.id], message: `${lower}% 이상과 ${upper}% 이하를 동시에 만족할 수 없습니다.` });
        }
        if (strategy.match === "any" && leftLevel.operator === rightLevel.operator) {
          const leftSubsumesRight = leftLevel.operator === "gte" ? leftLevel.thresholdPct <= rightLevel.thresholdPct : leftLevel.thresholdPct >= rightLevel.thresholdPct;
          const unreachable = leftSubsumesRight ? right : left;
          const covering = leftSubsumesRight ? left : right;
          diagnostics.push({ severity: "warning", code: "unreachable_condition", conditionIds: [covering.id, unreachable.id], message: `${unreachable.id} 조건은 더 넓은 ${covering.id} 조건에 포함되어 결과를 바꾸지 않습니다.` });
        }
      }
    }
  }
  return diagnostics;
}
