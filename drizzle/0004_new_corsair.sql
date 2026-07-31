CREATE TABLE `exchange_balance_snapshots` (
	`run_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`currency` text NOT NULL,
	`available` text NOT NULL,
	`locked` text NOT NULL,
	`average_buy_price` text NOT NULL,
	`payload_hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `currency`)
);
--> statement-breakpoint
CREATE TABLE `exchange_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_label` text NOT NULL,
	`account_fingerprint` text NOT NULL,
	`secret_reference` text NOT NULL,
	`permission_mode` text NOT NULL,
	`status` text NOT NULL,
	`last_verified_at` text,
	`last_reconciled_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_connection_fingerprint_idx` ON `exchange_connections` (`institution_id`,`provider`,`account_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_connection_secret_ref_idx` ON `exchange_connections` (`institution_id`,`secret_reference`);--> statement-breakpoint
CREATE TABLE `exchange_order_snapshots` (
	`run_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`exchange_order_id` text NOT NULL,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`state` text NOT NULL,
	`volume` text NOT NULL,
	`executed_volume` text NOT NULL,
	`remaining_volume` text NOT NULL,
	`price` text NOT NULL,
	`paid_fee` text NOT NULL,
	`exchange_created_at` text NOT NULL,
	`payload_hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `exchange_order_id`)
);
--> statement-breakpoint
CREATE TABLE `exchange_reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`status` text NOT NULL,
	`comparison_scope` text NOT NULL,
	`balance_count` integer NOT NULL,
	`open_order_count` integer NOT NULL,
	`closed_order_count` integer NOT NULL,
	`exception_count` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`worker_id` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_job_attempt_number_idx` ON `runtime_job_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `runtime_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`payload_json` text NOT NULL,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_job_dedupe_idx` ON `runtime_jobs` (`institution_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `runtime_scheduler_heartbeats` (
	`scheduler_key` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`status` text NOT NULL,
	`jobs_enqueued` integer NOT NULL,
	`jobs_claimed` integer NOT NULL,
	`jobs_succeeded` integer NOT NULL,
	`jobs_failed` integer NOT NULL,
	`recovered_leases` integer NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`updated_at` text NOT NULL
);
