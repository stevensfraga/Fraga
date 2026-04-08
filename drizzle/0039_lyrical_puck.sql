CREATE TABLE `orphan_receivables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`clientId` int NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`dueDate` timestamp NOT NULL,
	`dbStatus` varchar(50) NOT NULL,
	`detectedAt` timestamp NOT NULL,
	`lastFoundInCA` timestamp,
	`orphanType` enum('never_synced','deleted_from_ca','renegotiated','unknown') NOT NULL DEFAULT 'unknown',
	`action` enum('pending','mark_as_cancelled','investigate','resolved') NOT NULL DEFAULT 'pending',
	`notes` text,
	`resolvedAt` timestamp,
	`resolvedBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orphan_receivables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pre_regua_validation` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`caStatus` varchar(50) NOT NULL,
	`caAmount` decimal(12,2) NOT NULL,
	`dbStatus` varchar(50) NOT NULL,
	`dbAmount` decimal(12,2) NOT NULL,
	`isValid` boolean NOT NULL,
	`validationMessage` text,
	`action` enum('proceed','skip','update_and_proceed','cancel_regua') NOT NULL DEFAULT 'proceed',
	`validatedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pre_regua_validation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receivable_mismatch_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`reconciliationRunId` varchar(64) NOT NULL,
	`caStatus` varchar(50),
	`caAmount` decimal(12,2),
	`caDueDate` timestamp,
	`dbStatus` varchar(50) NOT NULL,
	`dbAmount` decimal(12,2) NOT NULL,
	`dbDueDate` timestamp NOT NULL,
	`mismatchType` enum('status_changed','amount_changed','date_changed','multiple_changes') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`action` enum('pending','auto_sync','manual_review','ignored') NOT NULL DEFAULT 'pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receivable_mismatch_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`caTotal` decimal(12,2) NOT NULL,
	`caCount` int NOT NULL,
	`caWindow` varchar(50) NOT NULL,
	`dbTotal` decimal(12,2) NOT NULL,
	`dbCount` int NOT NULL,
	`diffValue` decimal(12,2) NOT NULL,
	`diffPercent` decimal(5,2) NOT NULL,
	`isAlerted` boolean NOT NULL DEFAULT false,
	`orphanCount` int NOT NULL DEFAULT 0,
	`statusMismatchCount` int NOT NULL DEFAULT 0,
	`valueMismatchCount` int NOT NULL DEFAULT 0,
	`renegotiationCount` int NOT NULL DEFAULT 0,
	`alertMessage` text,
	`alertSentAt` timestamp,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`durationMs` int,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconciliation_audit_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_audit_runId_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
ALTER TABLE `clients` ADD `billingPhones` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `sendConsolidatedDebt` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orphan_receivables` ADD CONSTRAINT `orphan_receivables_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orphan_receivables` ADD CONSTRAINT `orphan_receivables_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pre_regua_validation` ADD CONSTRAINT `pre_regua_validation_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pre_regua_validation` ADD CONSTRAINT `pre_regua_validation_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receivable_mismatch_history` ADD CONSTRAINT `receivable_mismatch_history_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_orphan_receivable` ON `orphan_receivables` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_client` ON `orphan_receivables` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_conta_azul` ON `orphan_receivables` (`contaAzulId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_type` ON `orphan_receivables` (`orphanType`);--> statement-breakpoint
CREATE INDEX `idx_orphan_action` ON `orphan_receivables` (`action`);--> statement-breakpoint
CREATE INDEX `idx_orphan_detected` ON `orphan_receivables` (`detectedAt`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_run` ON `pre_regua_validation` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_client` ON `pre_regua_validation` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_receivable` ON `pre_regua_validation` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_valid` ON `pre_regua_validation` (`isValid`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_validated` ON `pre_regua_validation` (`validatedAt`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_receivable` ON `receivable_mismatch_history` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_run` ON `receivable_mismatch_history` (`reconciliationRunId`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_type` ON `receivable_mismatch_history` (`mismatchType`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_severity` ON `receivable_mismatch_history` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_created` ON `receivable_mismatch_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_run` ON `reconciliation_audit` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_created` ON `reconciliation_audit` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_status` ON `reconciliation_audit` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_alerted` ON `reconciliation_audit` (`isAlerted`);