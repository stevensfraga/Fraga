CREATE TABLE `messageTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`targetSentiment` enum('positive','negative','neutral','mixed') NOT NULL,
	`template` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `messageTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `sentiment` enum('positive','negative','neutral','mixed','pending') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `sentimentScore` decimal(3,2);--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `sentimentAnalysis` text;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD `messageId` int;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD `sentimentScore` decimal(3,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD `sentimentExplanation` text;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD `suggestedNextTone` enum('friendly','administrative','formal','escalate') NOT NULL;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD CONSTRAINT `responseAnalysisHistory_messageId_collectionMessages_id_fk` FOREIGN KEY (`messageId`) REFERENCES `collectionMessages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` DROP COLUMN `confidence`;