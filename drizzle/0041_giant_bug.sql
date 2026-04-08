CREATE TABLE `sync_cursor` (
	`id` int AUTO_INCREMENT NOT NULL,
	`syncType` enum('payments_lite','payments_full','receivables_lite','receivables_full') NOT NULL,
	`lastSyncAt` timestamp NOT NULL,
	`nextSyncAt` timestamp,
	`lastStatus` enum('success','partial','failed') NOT NULL DEFAULT 'success',
	`lastResult` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sync_cursor_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `regua_audit` MODIFY COLUMN `stage` enum('d_minus_3','d_0','d_plus_3','d_plus_7','d_plus_15','d_plus_30','d_plus_45','d_plus_60','d_plus_90','d_plus_180','d_plus_365','ALL') NOT NULL;--> statement-breakpoint
ALTER TABLE `regua_audit` MODIFY COLUMN `status` enum('sent','skipped','error','dry_run','overridden','override_log') NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sync_cursor_type` ON `sync_cursor` (`syncType`);--> statement-breakpoint
CREATE INDEX `idx_sync_cursor_last` ON `sync_cursor` (`lastSyncAt`);