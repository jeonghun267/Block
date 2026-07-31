import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const operationSettings = sqliteTable("operation_settings", {
  ownerKey: text("owner_key").primaryKey(),
  mode: text("mode").notNull(),
  exchangeStatus: text("exchange_status").notNull(),
  emergencyStatus: text("emergency_status").notNull(),
  dailyLossLimit: real("daily_loss_limit").notNull(),
  currentLoss: real("current_loss").notNull(),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull().default(1),
});

export const operationStrategies = sqliteTable("operation_strategies", {
  id: text("id").notNull(),
  ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  status: text("status").notNull(),
  pnlToday: integer("pnl_today").notNull(),
  pnl30d: real("pnl_30d").notNull(),
  exposure: text("exposure").notNull(),
  risk: text("risk").notNull(),
  lastSignalAt: text("last_signal_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerKey, table.id] }),
  uniqueIndex("operation_strategies_owner_name_idx").on(table.ownerKey, table.name),
]);

export const operationOrders = sqliteTable("operation_orders", {
  id: text("id").notNull(),
  ownerKey: text("owner_key").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull(),
  amount: text("amount").notNull(),
  price: text("price").notNull(),
  status: text("status").notNull(),
  filledRatio: integer("filled_ratio").notNull(),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerKey, table.id] })]);

export const operationEvents = sqliteTable("operation_events", {
  id: text("id").notNull(),
  ownerKey: text("owner_key").notNull(),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  strategyId: text("strategy_id"),
  orderId: text("order_id"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerKey, table.id] }),
  uniqueIndex("operation_events_owner_request_idx").on(table.ownerKey, table.requestId),
]);

export const copilotAuditEvents = sqliteTable("copilot_audit_events", {
  id: text("id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  requestId: text("request_id").notNull(),
  promptHash: text("prompt_hash").notNull(),
  generationMode: text("generation_mode").notNull(),
  model: text("model"),
  status: text("status").notNull(),
  blockCount: integer("block_count").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("copilot_audit_owner_request_idx").on(table.ownerKey, table.requestId)]);

export const institutions = sqliteTable("institutions", {
  id: text("id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  operatingMode: text("operating_mode").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("institutions_owner_idx").on(table.ownerKey)]);

export const institutionMemberships = sqliteTable("institution_memberships", {
  institutionId: text("institution_id").notNull(),
  memberKey: text("member_key").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.institutionId, table.memberKey] })]);

export const institutionalStrategyVersions = sqliteTable("institutional_strategy_versions", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  strategyKey: text("strategy_key").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  definitionJson: text("definition_json").notNull(),
  source: text("source").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  contentHash: text("content_hash").notNull(),
}, (table) => [uniqueIndex("institutional_strategy_version_idx").on(table.institutionId, table.strategyKey, table.version)]);

export const institutionalApprovalRequests = sqliteTable("institutional_approval_requests", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  strategyVersionId: text("strategy_version_id").notNull(),
  status: text("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  requiredRole: text("required_role").notNull(),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
}, (table) => [uniqueIndex("institutional_approval_open_version_idx").on(table.institutionId, table.strategyVersionId, table.status)]);

export const institutionalRiskPolicies = sqliteTable("institutional_risk_policies", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  maxGrossExposurePct: real("max_gross_exposure_pct").notNull(),
  maxAssetConcentrationPct: real("max_asset_concentration_pct").notNull(),
  maxDailyLossPct: real("max_daily_loss_pct").notNull(),
  maxOrderKrw: integer("max_order_krw").notNull(),
  maxExchangeConcentrationPct: real("max_exchange_concentration_pct").notNull(),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("institutional_risk_policy_version_idx").on(table.institutionId, table.version)]);

export const reconciliationExceptions = sqliteTable("reconciliation_exceptions", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  assignedRole: text("assigned_role").notNull(),
  orderId: text("order_id"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const institutionalAuditLedger = sqliteTable("institutional_audit_ledger", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  sequence: integer("sequence").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  eventType: text("event_type").notNull(),
  actorKey: text("actor_key").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  requestId: text("request_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("institutional_audit_sequence_idx").on(table.institutionId, table.sequence),
  uniqueIndex("institutional_audit_request_idx").on(table.institutionId, table.requestId),
]);

export const marketplaceStrategies = sqliteTable("marketplace_strategies", {
  id: text("id").primaryKey(),
  creatorKey: text("creator_key").notNull(),
  creatorName: text("creator_name").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  risk: text("risk").notNull(),
  priceMonthly: integer("price_monthly").notNull(),
  return90d: real("return_90d").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  winRate: real("win_rate").notNull(),
  liveDays: integer("live_days").notNull(),
  tradeCount: integer("trade_count").notNull(),
  trustScore: integer("trust_score").notNull(),
  conditionSummary: text("condition_summary").notNull(),
  blocksJson: text("blocks_json").notNull(),
  visibility: text("visibility").notNull(),
  verification: text("verification").notNull(),
  status: text("status").notNull(),
  subscribers: integer("subscribers").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("marketplace_creator_name_idx").on(table.creatorKey, table.name),
]);

export const marketplaceSubscriptions = sqliteTable("marketplace_subscriptions", {
  subscriberKey: text("subscriber_key").notNull(),
  strategyId: text("strategy_id").notNull(),
  status: text("status").notNull(),
  riskLimit: real("risk_limit").notNull(),
  allocation: integer("allocation").notNull(),
  monthlyPrice: integer("monthly_price").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.subscriberKey, table.strategyId] }),
]);

export const marketDataSnapshots = sqliteTable("market_data_snapshots", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  provider: text("provider").notNull(),
  market: text("market").notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  candleCount: integer("candle_count").notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  sourceUrl: text("source_url").notNull(),
  payloadHash: text("payload_hash").notNull(),
  candlesJson: text("candles_json").notNull(),
  status: text("status").notNull(),
}, (table) => [
  uniqueIndex("market_data_snapshot_evidence_idx").on(table.institutionId, table.provider, table.market, table.intervalMinutes, table.payloadHash),
]);

export const institutionalBacktestRuns = sqliteTable("institutional_backtest_runs", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  strategyVersionId: text("strategy_version_id").notNull(),
  marketDataSnapshotId: text("market_data_snapshot_id").notNull(),
  engineVersion: text("engine_version").notNull(),
  status: text("status").notNull(),
  startingCashMinor: integer("starting_cash_minor").notNull(),
  endingEquityMinor: integer("ending_equity_minor").notNull(),
  totalReturnBps: integer("total_return_bps").notNull(),
  maxDrawdownBps: integer("max_drawdown_bps").notNull(),
  tradeCount: integer("trade_count").notNull(),
  winRateBps: integer("win_rate_bps").notNull(),
  feesMinor: integer("fees_minor").notNull(),
  metricsJson: text("metrics_json").notNull(),
  tradesJson: text("trades_json").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const shadowDeployments = sqliteTable("shadow_deployments", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  strategyVersionId: text("strategy_version_id").notNull(),
  riskPolicyId: text("risk_policy_id").notNull(),
  market: text("market").notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  status: text("status").notNull(),
  startingCashMinor: integer("starting_cash_minor").notNull(),
  cashMinor: integer("cash_minor").notNull(),
  realizedPnlMinor: integer("realized_pnl_minor").notNull(),
  lastMarketPriceMinor: integer("last_market_price_minor").notNull(),
  lastCandleAt: text("last_candle_at"),
  lastCycleAt: text("last_cycle_at"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [
  uniqueIndex("shadow_deployment_strategy_idx").on(table.institutionId, table.strategyVersionId),
]);

export const shadowPositions = sqliteTable("shadow_positions", {
  deploymentId: text("deployment_id").notNull(),
  institutionId: text("institution_id").notNull(),
  asset: text("asset").notNull(),
  quantity: text("quantity").notNull(),
  costBasisMinor: integer("cost_basis_minor").notNull(),
  marketValueMinor: integer("market_value_minor").notNull(),
  unrealizedPnlMinor: integer("unrealized_pnl_minor").notNull(),
  realizedPnlMinor: integer("realized_pnl_minor").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.deploymentId, table.asset] }),
]);

export const shadowOrderIntents = sqliteTable("shadow_order_intents", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  deploymentId: text("deployment_id").notNull(),
  strategyVersionId: text("strategy_version_id").notNull(),
  signalKey: text("signal_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  notionalMinor: integer("notional_minor").notNull(),
  quantity: text("quantity").notNull(),
  referencePriceMinor: integer("reference_price_minor").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("shadow_order_intent_idempotency_idx").on(table.institutionId, table.idempotencyKey),
]);

export const shadowRiskDecisions = sqliteTable("shadow_risk_decisions", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  orderIntentId: text("order_intent_id").notNull(),
  riskPolicyId: text("risk_policy_id").notNull(),
  decision: text("decision").notNull(),
  codesJson: text("codes_json").notNull(),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("shadow_risk_decision_intent_idx").on(table.orderIntentId),
]);

export const shadowOrders = sqliteTable("shadow_orders", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  orderIntentId: text("order_intent_id").notNull(),
  clientOrderId: text("client_order_id").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  priceMinor: integer("price_minor").notNull(),
  notionalMinor: integer("notional_minor").notNull(),
  feeMinor: integer("fee_minor").notNull(),
  status: text("status").notNull(),
  filledAt: text("filled_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("shadow_order_intent_idx").on(table.orderIntentId),
  uniqueIndex("shadow_order_client_idx").on(table.institutionId, table.clientOrderId),
]);

export const shadowFills = sqliteTable("shadow_fills", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  orderId: text("order_id").notNull(),
  fillKey: text("fill_key").notNull(),
  quantity: text("quantity").notNull(),
  priceMinor: integer("price_minor").notNull(),
  notionalMinor: integer("notional_minor").notNull(),
  feeMinor: integer("fee_minor").notNull(),
  filledAt: text("filled_at").notNull(),
}, (table) => [
  uniqueIndex("shadow_fill_key_idx").on(table.institutionId, table.fillKey),
]);

export const shadowReconciliationRuns = sqliteTable("shadow_reconciliation_runs", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  deploymentId: text("deployment_id").notNull(),
  status: text("status").notNull(),
  intentCount: integer("intent_count").notNull(),
  orderCount: integer("order_count").notNull(),
  fillCount: integer("fill_count").notNull(),
  exceptionCount: integer("exception_count").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const shadowCycles = sqliteTable("shadow_cycles", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  deploymentId: text("deployment_id").notNull(),
  marketDataSnapshotId: text("market_data_snapshot_id").notNull(),
  backtestRunId: text("backtest_run_id").notNull(),
  orderIntentId: text("order_intent_id"),
  reconciliationRunId: text("reconciliation_run_id").notNull(),
  status: text("status").notNull(),
  signalJson: text("signal_json").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  requestId: text("request_id").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
}, (table) => [
  uniqueIndex("shadow_cycle_request_idx").on(table.institutionId, table.requestId),
  uniqueIndex("shadow_cycle_snapshot_idx").on(table.deploymentId, table.marketDataSnapshotId),
]);

export const runtimeJobs = sqliteTable("runtime_jobs", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  payloadJson: text("payload_json").notNull(),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("runtime_job_dedupe_idx").on(table.institutionId, table.dedupeKey),
]);

export const runtimeJobAttempts = sqliteTable("runtime_job_attempts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  institutionId: text("institution_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  workerId: text("worker_id").notNull(),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("runtime_job_attempt_number_idx").on(table.jobId, table.attemptNumber),
]);

export const runtimeSchedulerHeartbeats = sqliteTable("runtime_scheduler_heartbeats", {
  schedulerKey: text("scheduler_key").primaryKey(),
  workerId: text("worker_id").notNull(),
  status: text("status").notNull(),
  jobsEnqueued: integer("jobs_enqueued").notNull(),
  jobsClaimed: integer("jobs_claimed").notNull(),
  jobsSucceeded: integer("jobs_succeeded").notNull(),
  jobsFailed: integer("jobs_failed").notNull(),
  recoveredLeases: integer("recovered_leases").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const exchangeConnections = sqliteTable("exchange_connections", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  provider: text("provider").notNull(),
  accountLabel: text("account_label").notNull(),
  accountFingerprint: text("account_fingerprint").notNull(),
  secretReference: text("secret_reference").notNull(),
  permissionMode: text("permission_mode").notNull(),
  status: text("status").notNull(),
  lastVerifiedAt: text("last_verified_at"),
  lastReconciledAt: text("last_reconciled_at"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("exchange_connection_fingerprint_idx").on(table.institutionId, table.provider, table.accountFingerprint),
  uniqueIndex("exchange_connection_secret_ref_idx").on(table.institutionId, table.secretReference),
]);

export const exchangeReconciliationRuns = sqliteTable("exchange_reconciliation_runs", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  connectionId: text("connection_id").notNull(),
  status: text("status").notNull(),
  comparisonScope: text("comparison_scope").notNull(),
  balanceCount: integer("balance_count").notNull(),
  openOrderCount: integer("open_order_count").notNull(),
  closedOrderCount: integer("closed_order_count").notNull(),
  exceptionCount: integer("exception_count").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
});

export const exchangeBalanceSnapshots = sqliteTable("exchange_balance_snapshots", {
  runId: text("run_id").notNull(),
  institutionId: text("institution_id").notNull(),
  currency: text("currency").notNull(),
  available: text("available").notNull(),
  locked: text("locked").notNull(),
  averageBuyPrice: text("average_buy_price").notNull(),
  payloadHash: text("payload_hash").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.currency] }),
]);

export const exchangeOrderSnapshots = sqliteTable("exchange_order_snapshots", {
  runId: text("run_id").notNull(),
  institutionId: text("institution_id").notNull(),
  exchangeOrderId: text("exchange_order_id").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  state: text("state").notNull(),
  volume: text("volume").notNull(),
  executedVolume: text("executed_volume").notNull(),
  remainingVolume: text("remaining_volume").notNull(),
  price: text("price").notNull(),
  paidFee: text("paid_fee").notNull(),
  exchangeCreatedAt: text("exchange_created_at").notNull(),
  payloadHash: text("payload_hash").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.exchangeOrderId] }),
]);
