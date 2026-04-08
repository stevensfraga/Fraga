ALTER TABLE `clients` ADD `document` varchar(20);--> statement-breakpoint
ALTER TABLE `receivables` ADD `paymentInfoPublic` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `clients_document_idx` ON `clients` (`document`);--> statement-breakpoint
CREATE INDEX `receivables_paymentInfoPublic_idx` ON `receivables` (`paymentInfoPublic`);