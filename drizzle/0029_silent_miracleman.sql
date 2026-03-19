ALTER TABLE `receivables` MODIFY COLUMN `paymentInfoSource` enum('zap_storage','r2','contaazul','manual');--> statement-breakpoint
ALTER TABLE `receivables` ADD `zapStorageFilename` varchar(255);--> statement-breakpoint
ALTER TABLE `receivables` ADD `zapStorageFileSize` int;--> statement-breakpoint
ALTER TABLE `receivables` ADD `zapStorageUploadedAt` timestamp;