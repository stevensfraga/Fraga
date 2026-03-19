CREATE TABLE `contaAzulWebhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`webhookId` varchar(64) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`payload` text NOT NULL,
	`receivableId` int,
	`clientId` int,
	`amountPaid` decimal(12,2),
	`paymentDate` timestamp,
	`status` enum('received','processed','failed','duplicate') NOT NULL DEFAULT 'received',
	`error` text,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contaAzulWebhooks_id` PRIMARY KEY(`id`),
	CONSTRAINT `contaAzulWebhooks_webhookId_unique` UNIQUE(`webhookId`)
);
--> statement-breakpoint
CREATE TABLE `paymentHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`clientId` int NOT NULL,
	`webhookId` int,
	`amountPaid` decimal(12,2) NOT NULL,
	`paymentDate` timestamp NOT NULL,
	`paymentMethod` varchar(64),
	`collectionScheduleCancelled` boolean NOT NULL DEFAULT false,
	`cancelledSchedules` int NOT NULL DEFAULT 0,
	`notificationSent` boolean NOT NULL DEFAULT false,
	`notificationMethod` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paymentHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contaAzulWebhooks` ADD CONSTRAINT `contaAzulWebhooks_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contaAzulWebhooks` ADD CONSTRAINT `contaAzulWebhooks_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_webhookId_contaAzulWebhooks_id_fk` FOREIGN KEY (`webhookId`) REFERENCES `contaAzulWebhooks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_webhook_id` ON `contaAzulWebhooks` (`webhookId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_receivable` ON `contaAzulWebhooks` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_client` ON `contaAzulWebhooks` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_status` ON `contaAzulWebhooks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_webhook_event` ON `contaAzulWebhooks` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_payment_receivable` ON `paymentHistory` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_payment_client` ON `paymentHistory` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_payment_webhook` ON `paymentHistory` (`webhookId`);--> statement-breakpoint
CREATE INDEX `idx_payment_date` ON `paymentHistory` (`paymentDate`);