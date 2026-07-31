CREATE TABLE `institutional_backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`market_data_snapshot_id` text NOT NULL,
	`engine_version` text NOT NULL,
	`status` text NOT NULL,
	`starting_cash_minor` integer NOT NULL,
	`ending_equity_minor` integer NOT NULL,
	`total_return_bps` integer NOT NULL,
	`max_drawdown_bps` integer NOT NULL,
	`trade_count` integer NOT NULL,
	`win_rate_bps` integer NOT NULL,
	`fees_minor` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`trades_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_data_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`provider` text NOT NULL,
	`market` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`candle_count` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source_url` text NOT NULL,
	`payload_hash` text NOT NULL,
	`candles_json` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_data_snapshot_evidence_idx` ON `market_data_snapshots` (`institution_id`,`provider`,`market`,`interval_minutes`,`payload_hash`);--> statement-breakpoint
CREATE TABLE `shadow_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`market_data_snapshot_id` text NOT NULL,
	`backtest_run_id` text NOT NULL,
	`order_intent_id` text,
	`reconciliation_run_id` text NOT NULL,
	`status` text NOT NULL,
	`signal_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_cycle_request_idx` ON `shadow_cycles` (`institution_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_cycle_snapshot_idx` ON `shadow_cycles` (`deployment_id`,`market_data_snapshot_id`);--> statement-breakpoint
CREATE TABLE `shadow_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`risk_policy_id` text NOT NULL,
	`market` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`status` text NOT NULL,
	`starting_cash_minor` integer NOT NULL,
	`cash_minor` integer NOT NULL,
	`realized_pnl_minor` integer NOT NULL,
	`last_market_price_minor` integer NOT NULL,
	`last_candle_at` text,
	`last_cycle_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_deployment_strategy_idx` ON `shadow_deployments` (`institution_id`,`strategy_version_id`);--> statement-breakpoint
CREATE TABLE `shadow_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`order_id` text NOT NULL,
	`fill_key` text NOT NULL,
	`quantity` text NOT NULL,
	`price_minor` integer NOT NULL,
	`notional_minor` integer NOT NULL,
	`fee_minor` integer NOT NULL,
	`filled_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_fill_key_idx` ON `shadow_fills` (`institution_id`,`fill_key`);--> statement-breakpoint
CREATE TABLE `shadow_order_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`signal_key` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`notional_minor` integer NOT NULL,
	`quantity` text NOT NULL,
	`reference_price_minor` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_order_intent_idempotency_idx` ON `shadow_order_intents` (`institution_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `shadow_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`order_intent_id` text NOT NULL,
	`client_order_id` text NOT NULL,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`quantity` text NOT NULL,
	`price_minor` integer NOT NULL,
	`notional_minor` integer NOT NULL,
	`fee_minor` integer NOT NULL,
	`status` text NOT NULL,
	`filled_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_order_intent_idx` ON `shadow_orders` (`order_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_order_client_idx` ON `shadow_orders` (`institution_id`,`client_order_id`);--> statement-breakpoint
CREATE TABLE `shadow_positions` (
	`deployment_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`asset` text NOT NULL,
	`quantity` text NOT NULL,
	`cost_basis_minor` integer NOT NULL,
	`market_value_minor` integer NOT NULL,
	`unrealized_pnl_minor` integer NOT NULL,
	`realized_pnl_minor` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `asset`)
);
--> statement-breakpoint
CREATE TABLE `shadow_reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`status` text NOT NULL,
	`intent_count` integer NOT NULL,
	`order_count` integer NOT NULL,
	`fill_count` integer NOT NULL,
	`exception_count` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shadow_risk_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`order_intent_id` text NOT NULL,
	`risk_policy_id` text NOT NULL,
	`decision` text NOT NULL,
	`codes_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_risk_decision_intent_idx` ON `shadow_risk_decisions` (`order_intent_id`);