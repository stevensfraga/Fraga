CREATE TABLE `cron_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cronKey` varchar(64) NOT NULL,
	`lastRunAt` timestamp,
	`lastResult` text,
	`lastStatus` enum('success','partial','failed','skipped'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cron_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `cron_state_cronKey_unique` UNIQUE(`cronKey`),
	CONSTRAINT `idx_cron_state_key` UNIQUE(`cronKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_cron_state_last_run` ON `cron_state` (`lastRunAt`);