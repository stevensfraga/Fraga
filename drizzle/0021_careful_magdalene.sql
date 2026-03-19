ALTER TABLE `clients` ADD `whatsappValidatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `clients` ADD `whatsappApprovedBy` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `whatsappApprovalMethod` enum('sync-conta-azul','manual-approval','csv-import');