CREATE TABLE `ai_assistant_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhone` varchar(20) NOT NULL,
	`clientId` int,
	`intent` varchar(50) NOT NULL,
	`dbQueryMeta` text,
	`response` text NOT NULL,
	`correlationId` varchar(100),
	`handoffToHuman` boolean NOT NULL DEFAULT false,
	`handoffReason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_assistant_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_assistant_log_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhone` varchar(20) NOT NULL,
	`text` text NOT NULL,
	`messageId` varchar(255),
	`clientId` int,
	`processed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbound_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbound_messages_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE INDEX `idx_ai_phone` ON `ai_assistant_log` (`fromPhone`);--> statement-breakpoint
CREATE INDEX `idx_ai_client` ON `ai_assistant_log` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_ai_intent` ON `ai_assistant_log` (`intent`);--> statement-breakpoint
CREATE INDEX `idx_ai_handoff` ON `ai_assistant_log` (`handoffToHuman`);--> statement-breakpoint
CREATE INDEX `idx_inbound_phone` ON `inbound_messages` (`fromPhone`);--> statement-breakpoint
CREATE INDEX `idx_inbound_client` ON `inbound_messages` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_inbound_processed` ON `inbound_messages` (`processed`);