ALTER TABLE `contaAzulTokens` ADD `lastRefreshAt` timestamp;--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD `lastRefreshStatus` varchar(20);--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD `lastRefreshError` text;--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD `consecutiveFailures` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD `needsReauth` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `ekontrol_companies` ADD `honorarios_fonte` varchar(50);