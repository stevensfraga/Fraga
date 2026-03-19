CREATE TABLE `legal_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`status` enum('draft','approved','sent_to_legal','closed') NOT NULL DEFAULT 'draft',
	`approvedBy` varchar(255),
	`approvedAt` timestamp,
	`sentToLegalAt` timestamp,
	`closedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `legal_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `receivables` ADD `collectionScore` decimal(12,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_legal_client` ON `legal_cases` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_legal_status` ON `legal_cases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_legal_client_status` ON `legal_cases` (`clientId`,`status`);