ALTER TABLE `receivables` ADD `lastDispatchedAt` timestamp;--> statement-breakpoint
ALTER TABLE `receivables` ADD `dispatchCount` int DEFAULT 0;