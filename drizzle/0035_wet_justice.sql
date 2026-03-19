CREATE TABLE `webhook_raw_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(50) NOT NULL,
	`path` varchar(255) NOT NULL,
	`method` varchar(10) NOT NULL DEFAULT 'POST',
	`headersJson` text,
	`bodyJson` text,
	`ip` varchar(45),
	`userAgent` text,
	`statusCode` int,
	`responseJson` text,
	`processingTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_raw_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_provider` ON `webhook_raw_log` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_webhook_created` ON `webhook_raw_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_webhook_path` ON `webhook_raw_log` (`path`);