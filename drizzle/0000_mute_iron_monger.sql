CREATE TABLE `operation_events` (
	`id` text NOT NULL,
	`owner_key` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`strategy_id` text,
	`order_id` text,
	`request_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_events_owner_request_idx` ON `operation_events` (`owner_key`,`request_id`);--> statement-breakpoint
CREATE TABLE `operation_orders` (
	`id` text NOT NULL,
	`owner_key` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_name` text NOT NULL,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`amount` text NOT NULL,
	`price` text NOT NULL,
	`status` text NOT NULL,
	`filled_ratio` integer NOT NULL,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `id`)
);
--> statement-breakpoint
CREATE TABLE `operation_settings` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`exchange_status` text NOT NULL,
	`emergency_status` text NOT NULL,
	`daily_loss_limit` real NOT NULL,
	`current_loss` real NOT NULL,
	`last_heartbeat_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_strategies` (
	`id` text NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`status` text NOT NULL,
	`pnl_today` integer NOT NULL,
	`pnl_30d` real NOT NULL,
	`exposure` text NOT NULL,
	`risk` text NOT NULL,
	`last_signal_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_strategies_owner_name_idx` ON `operation_strategies` (`owner_key`,`name`);