ALTER TABLE `clients` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `messageQueue` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(255);