ALTER TABLE `whatsappAudit` MODIFY COLUMN `messageId` varchar(255);--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `correlationId` varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `providerTrackingMode` enum('WITH_ID','ACK_ONLY','WEBHOOK') DEFAULT 'WITH_ID' NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `providerAck` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `payloadHash` varchar(64);--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `providerStatusUrl` text;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD `providerAckAt` timestamp;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD CONSTRAINT `whatsappAudit_correlationId_unique` UNIQUE(`correlationId`);--> statement-breakpoint
CREATE INDEX `idx_audit_correlation` ON `whatsappAudit` (`correlationId`);--> statement-breakpoint
CREATE INDEX `idx_audit_tracking_mode` ON `whatsappAudit` (`providerTrackingMode`);