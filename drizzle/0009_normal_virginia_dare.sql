CREATE TABLE `messageQueue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int,
	`messageType` enum('whatsapp','email') NOT NULL,
	`status` enum('pending','scheduled','sent','failed','delivered') NOT NULL DEFAULT 'pending',
	`stage` varchar(20) NOT NULL,
	`phone` varchar(20),
	`email` varchar(320),
	`subject` varchar(255),
	`body` text NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`failureReason` text,
	`externalMessageId` varchar(255),
	`retryCount` int DEFAULT 0,
	`maxRetries` int DEFAULT 3,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `messageQueue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `messageQueue` ADD CONSTRAINT `messageQueue_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messageQueue` ADD CONSTRAINT `messageQueue_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_queue_client` ON `messageQueue` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_queue_receivable` ON `messageQueue` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_queue_status` ON `messageQueue` (`status`);--> statement-breakpoint
CREATE INDEX `idx_queue_scheduled` ON `messageQueue` (`scheduledFor`);--> statement-breakpoint
CREATE INDEX `idx_queue_type` ON `messageQueue` (`messageType`);