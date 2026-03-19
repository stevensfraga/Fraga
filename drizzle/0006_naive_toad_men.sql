CREATE TABLE `collectionSchedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`stage` enum('reset','d_minus_5','d_minus_1','d_plus_3','d_plus_7','d_plus_15','d_plus_30','d_plus_45','d_plus_60') NOT NULL,
	`channels` varchar(255) NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`sentAt` timestamp,
	`status` enum('pending','sent','delivered','failed','cancelled') NOT NULL DEFAULT 'pending',
	`whatsappMessageId` varchar(255),
	`emailMessageId` varchar(255),
	`cancelledReason` text,
	`cancelledAt` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionSchedule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `collectionSchedule` ADD CONSTRAINT `collectionSchedule_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collectionSchedule` ADD CONSTRAINT `collectionSchedule_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_schedule_client` ON `collectionSchedule` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_receivable` ON `collectionSchedule` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_stage` ON `collectionSchedule` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_schedule_status` ON `collectionSchedule` (`status`);--> statement-breakpoint
CREATE INDEX `idx_schedule_scheduled` ON `collectionSchedule` (`scheduledFor`);