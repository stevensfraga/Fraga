CREATE TABLE `agreements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`totalAmount` decimal(12,2) NOT NULL,
	`installments` int NOT NULL,
	`installmentAmount` decimal(12,2) NOT NULL,
	`startDate` timestamp NOT NULL,
	`status` enum('active','completed','defaulted') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agreements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(20),
	`whatsappNumber` varchar(20),
	`cnae` varchar(10),
	`status` enum('active','inactive','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_contaAzulId_unique` UNIQUE(`contaAzulId`)
);
--> statement-breakpoint
CREATE TABLE `collectionMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`messageTemplate` text NOT NULL,
	`messageSent` text,
	`whatsappMessageId` varchar(255),
	`status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`responseReceived` boolean DEFAULT false,
	`responseText` text,
	`responseDate` timestamp,
	`outcome` enum('pending','agreed','paid','no_response','rejected') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receivables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`dueDate` timestamp NOT NULL,
	`paidDate` timestamp,
	`status` enum('pending','overdue','paid','cancelled') NOT NULL DEFAULT 'pending',
	`monthsOverdue` int DEFAULT 0,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receivables_id` PRIMARY KEY(`id`)
);
