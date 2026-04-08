CREATE TABLE `responseAnalysisHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`followUpId` int,
	`responseText` text NOT NULL,
	`sentiment` enum('positive','negative','neutral','mixed') NOT NULL,
	`confidence` decimal(3,2) NOT NULL,
	`suggestedAction` enum('send_payment_link','schedule_call','offer_discount','escalate_to_manager','wait_and_retry','mark_as_paid','send_agreement') NOT NULL,
	`actionConfidence` decimal(3,2) NOT NULL,
	`aiModel` varchar(64) NOT NULL DEFAULT 'gpt-4',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `responseAnalysisHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduledFollowUps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`previousMessageId` int,
	`scheduledFor` timestamp NOT NULL,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`messageTemplate` text,
	`previousResponse` text,
	`responseAnalysis` enum('positive','negative','neutral','no_response','partial_agreement') NOT NULL,
	`status` enum('pending','sent','cancelled','completed') NOT NULL DEFAULT 'pending',
	`reason` text,
	`sentAt` timestamp,
	`cancelledAt` timestamp,
	`cancelledReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledFollowUps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD CONSTRAINT `responseAnalysisHistory_followUpId_scheduledFollowUps_id_fk` FOREIGN KEY (`followUpId`) REFERENCES `scheduledFollowUps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledFollowUps` ADD CONSTRAINT `scheduledFollowUps_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledFollowUps` ADD CONSTRAINT `scheduledFollowUps_previousMessageId_collectionMessages_id_fk` FOREIGN KEY (`previousMessageId`) REFERENCES `collectionMessages`(`id`) ON DELETE no action ON UPDATE no action;