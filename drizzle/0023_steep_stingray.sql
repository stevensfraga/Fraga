ALTER TABLE `collectionMessages` ADD `providerMessageId` varchar(255);--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `providerStatus` enum('queued','sent','delivered','read','failed','unknown') DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `providerRawStatus` text;--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `providerError` text;