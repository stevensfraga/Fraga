CREATE TABLE `alert_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertType` varchar(50) NOT NULL,
	`threshold` decimal(12,2) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_settings_id` PRIMARY KEY(`id`)
);
