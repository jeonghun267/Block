CREATE TABLE `copilot_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`request_id` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`generation_mode` text NOT NULL,
	`model` text,
	`status` text NOT NULL,
	`block_count` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copilot_audit_owner_request_idx` ON `copilot_audit_events` (`owner_key`,`request_id`);--> statement-breakpoint
CREATE TABLE `institution_memberships` (
	`institution_id` text NOT NULL,
	`member_key` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`institution_id`, `member_key`)
);
--> statement-breakpoint
CREATE TABLE `institutional_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`required_role` text NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutional_approval_open_version_idx` ON `institutional_approval_requests` (`institution_id`,`strategy_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `institutional_audit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`previous_hash` text NOT NULL,
	`event_hash` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_key` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutional_audit_sequence_idx` ON `institutional_audit_ledger` (`institution_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `institutional_audit_request_idx` ON `institutional_audit_ledger` (`institution_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `institutional_risk_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`max_gross_exposure_pct` real NOT NULL,
	`max_asset_concentration_pct` real NOT NULL,
	`max_daily_loss_pct` real NOT NULL,
	`max_order_krw` integer NOT NULL,
	`max_exchange_concentration_pct` real NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutional_risk_policy_version_idx` ON `institutional_risk_policies` (`institution_id`,`version`);--> statement-breakpoint
CREATE TABLE `institutional_strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`strategy_key` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`definition_json` text NOT NULL,
	`source` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutional_strategy_version_idx` ON `institutional_strategy_versions` (`institution_id`,`strategy_key`,`version`);--> statement-breakpoint
CREATE TABLE `institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`operating_mode` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutions_owner_idx` ON `institutions` (`owner_key`);--> statement-breakpoint
CREATE TABLE `reconciliation_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`assigned_role` text NOT NULL,
	`order_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
