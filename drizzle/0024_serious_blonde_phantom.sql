ALTER TABLE `receivables` ADD `pdfStorageUrl` text;--> statement-breakpoint
ALTER TABLE `receivables` ADD `paymentInfoSource` varchar(50);--> statement-breakpoint
ALTER TABLE `receivables` ADD `paymentInfoUpdatedAt` timestamp;