CREATE TABLE `marketplace_strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_key` text NOT NULL,
	`creator_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`risk` text NOT NULL,
	`price_monthly` integer NOT NULL,
	`return_90d` real NOT NULL,
	`max_drawdown` real NOT NULL,
	`win_rate` real NOT NULL,
	`live_days` integer NOT NULL,
	`trade_count` integer NOT NULL,
	`trust_score` integer NOT NULL,
	`condition_summary` text NOT NULL,
	`blocks_json` text NOT NULL,
	`visibility` text NOT NULL,
	`verification` text NOT NULL,
	`status` text NOT NULL,
	`subscribers` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketplace_creator_name_idx` ON `marketplace_strategies` (`creator_key`,`name`);--> statement-breakpoint
CREATE TABLE `marketplace_subscriptions` (
	`subscriber_key` text NOT NULL,
	`strategy_id` text NOT NULL,
	`status` text NOT NULL,
	`risk_limit` real NOT NULL,
	`allocation` integer NOT NULL,
	`monthly_price` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`subscriber_key`, `strategy_id`)
);
