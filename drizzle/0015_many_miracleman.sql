ALTER TABLE `dispatches` MODIFY COLUMN `sentAt` timestamp;--> statement-breakpoint
ALTER TABLE `dispatches` ADD `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;