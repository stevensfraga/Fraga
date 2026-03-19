CREATE TABLE `regua_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`stage` enum('d_minus_3','d_0','d_plus_3','d_plus_7','d_plus_15') NOT NULL,
	`dryRun` boolean NOT NULL DEFAULT false,
	`status` enum('sent','skipped','error','dry_run') NOT NULL,
	`skipReason` varchar(100),
	`phoneE164` varchar(20),
	`messageContent` text,
	`totalDebt` decimal(12,2),
	`titlesCount` int,
	`maxDaysOverdue` int,
	`providerMessageId` varchar(255),
	`providerStatus` varchar(50),
	`providerRawResult` text,
	`errorMessage` text,
	`correlationId` varchar(100),
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `regua_audit_id` PRIMARY KEY(`id`),
	CONSTRAINT `regua_audit_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE INDEX `idx_regua_run` ON `regua_audit` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_regua_client` ON `regua_audit` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_regua_receivable` ON `regua_audit` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_regua_stage` ON `regua_audit` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_regua_status` ON `regua_audit` (`status`);--> statement-breakpoint
CREATE INDEX `idx_regua_created` ON `regua_audit` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_regua_dedup` ON `regua_audit` (`clientId`,`receivableId`,`stage`);