CREATE TABLE `no_response_followups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`phoneE164` varchar(20) NOT NULL,
	`bucketAtTrigger` varchar(5) NOT NULL,
	`firstSentAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextEligibleAt` timestamp,
	`lastAttemptAt` timestamp,
	`status` enum('active','stopped','completed') NOT NULL DEFAULT 'active',
	`stopReason` enum('replied','paid','optout','max_attempts','manual'),
	`metaJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `no_response_followups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_followup_client` ON `no_response_followups` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_followup_phone` ON `no_response_followups` (`phoneE164`);--> statement-breakpoint
CREATE INDEX `idx_followup_status_next` ON `no_response_followups` (`status`,`nextEligibleAt`);