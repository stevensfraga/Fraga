CREATE TABLE `dispatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`clientId` int NOT NULL,
	`channel` enum('whatsapp','email','sms') NOT NULL,
	`templateVersion` int NOT NULL DEFAULT 1,
	`messageId` varchar(255),
	`status` enum('sent','failed','blocked') NOT NULL,
	`errorMessage` text,
	`sentAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dispatches_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_unique_dispatch` UNIQUE(`receivableId`,`channel`)
);
--> statement-breakpoint
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_dispatch_client` ON `dispatches` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_channel` ON `dispatches` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_status` ON `dispatches` (`status`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_sent` ON `dispatches` (`sentAt`);