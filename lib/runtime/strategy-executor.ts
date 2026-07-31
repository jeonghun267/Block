import type { ExchangeAdapter, ExchangeOrder, PlaceOrderInput } from "../exchange";
import { createOrderIdempotencyKey, evaluateExecutionGate, type ExecutionGateCode } from "../order-safety";
import type { OperationSettings } from "../operations";
import { evaluatePercentCondition } from "../strategy/evaluate";
import type {
  ConditionEvaluationV1,
  EvaluationStateV1,
  PercentSampleV1,
  PriceConditionV1,
} from "../strategy/schema";

export type StrategyExecutionBlocker =
  | ExecutionGateCode
  | "adapter_mode_mismatch"
  | "reauthentication_required";

export type StrategyExecutionResult = {
  status: "skipped" | "blocked" | "submitted";
  evaluation: ConditionEvaluationV1;
  blockers: StrategyExecutionBlocker[];
  idempotencyKey: string | null;
  order: ExchangeOrder | null;
};

export type StrategyExecutionInput = {
  ownerId: string;
  strategyId: string;
  signalId: string;
  condition: PriceConditionV1;
  samples: readonly PercentSampleV1[];
  evaluationState?: EvaluationStateV1;
  settings: OperationSettings;
  adapter: ExchangeAdapter;
  reauthenticated: boolean;
  order: Omit<PlaceOrderInput, "idempotencyKey" | "requestId">;
  requestId: string;
  now?: number;
};

/**
 * Single guarded path from deterministic signal evaluation to exchange submission.
 * The caller owns scheduling, market-data collection and persistent audit logging.
 */
export async function executeStrategySignal(input: StrategyExecutionInput): Promise<StrategyExecutionResult> {
  const evaluation = evaluatePercentCondition(input.condition, input.samples, input.evaluationState);
  if (!evaluation.triggered) {
    return { status: "skipped", evaluation, blockers: [], idempotencyKey: null, order: null };
  }

  const gate = evaluateExecutionGate(input.settings, input.now);
  const blockers: StrategyExecutionBlocker[] = [...gate.codes];
  const expectedAdapterMode = input.settings.mode === "live" ? "live" : "demo";
  if (input.adapter.capabilities.mode !== expectedAdapterMode) blockers.push("adapter_mode_mismatch");
  if (gate.requiresReauthentication && !input.reauthenticated) blockers.push("reauthentication_required");

  const idempotencyKey = createOrderIdempotencyKey(input.ownerId, input.strategyId, input.signalId);
  if (blockers.length > 0) {
    return { status: "blocked", evaluation, blockers, idempotencyKey, order: null };
  }

  const order = await input.adapter.placeLimitOrder({
    ...input.order,
    idempotencyKey,
    requestId: input.requestId,
  });
  return { status: "submitted", evaluation, blockers: [], idempotencyKey, order };
}
