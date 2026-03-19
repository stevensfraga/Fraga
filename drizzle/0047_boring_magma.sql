ALTER TABLE `certificates` ADD `pfx_data` MEDIUMBLOB;--> statement-breakpoint
ALTER TABLE `certificates` ADD `sieg_status` varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `certificates` ADD `sieg_id` varchar(100);--> statement-breakpoint
ALTER TABLE `certificates` ADD `sieg_sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `certificates` ADD `sieg_error` varchar(255);