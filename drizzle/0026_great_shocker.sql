CREATE TABLE `whatsappAudit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`messageId` varchar(255) NOT NULL,
	`sentAt` timestamp NOT NULL,
	`templateUsed` varchar(100),
	`status` enum('sent','failed','delivered','read','error') NOT NULL DEFAULT 'sent',
	`errorMessage` text,
	`phoneNumber` varchar(20),
	`messageContent` text,
	`pdfUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappAudit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD CONSTRAINT `whatsappAudit_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD CONSTRAINT `whatsappAudit_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audit_client` ON `whatsappAudit` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_audit_receivable` ON `whatsappAudit` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_audit_message` ON `whatsappAudit` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_audit_sent` ON `whatsappAudit` (`sentAt`);--> statement-breakpoint
CREATE INDEX `idx_audit_status` ON `whatsappAudit` (`status`);