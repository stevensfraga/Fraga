ALTER TABLE `collectionMessages` ADD `attemptCount` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `lastError` text;