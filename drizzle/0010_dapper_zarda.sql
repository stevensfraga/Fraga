CREATE TABLE `collectionRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`whatsappNumber` varchar(20) NOT NULL,
	`origin` enum('contaazul','manual','api') NOT NULL DEFAULT 'contaazul',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `collectionRules` ADD CONSTRAINT `collectionRules_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_collection_rules_conta_azul_id` ON `collectionRules` (`contaAzulId`);--> statement-breakpoint
CREATE INDEX `idx_collection_rules_client_id` ON `collectionRules` (`clientId`);