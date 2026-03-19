CREATE TABLE `certificate_secrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`certificate_id` int NOT NULL,
	`encrypted_password` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `certificate_secrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_cert_secret_cert_id` UNIQUE(`certificate_id`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int,
	`cnpj` varchar(20) NOT NULL,
	`company_name` varchar(255),
	`file_path` varchar(512),
	`file_name` varchar(255),
	`file_hash` varchar(64),
	`serial_number` varchar(128),
	`issuer` varchar(512),
	`subject` varchar(512),
	`valid_from` timestamp,
	`valid_to` timestamp,
	`status` enum('valid','expiring_30','expiring_15','expiring_7','expired','invalid','unknown') NOT NULL DEFAULT 'unknown',
	`source` enum('scanner','upload','manual') NOT NULL DEFAULT 'scanner',
	`version` int NOT NULL DEFAULT 1,
	`is_active` boolean NOT NULL DEFAULT true,
	`last_checked_at` timestamp,
	`uploaded_by_user_id` int,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int,
	`cnpj` varchar(20) NOT NULL,
	`company_name` varchar(255),
	`sieg_status` enum('active','inactive','error','unknown') DEFAULT 'unknown',
	`sieg_certificate_id` int,
	`sieg_last_check_at` timestamp,
	`sieg_notes` text,
	`dominio_status` enum('active','inactive','error','unknown') DEFAULT 'unknown',
	`dominio_last_check_at` timestamp,
	`dominio_notes` text,
	`has_divergence` boolean DEFAULT false,
	`divergence_details` text,
	`manual_notes` text,
	`resolved_at` timestamp,
	`resolved_by_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integration_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_integration_cnpj` UNIQUE(`cnpj`)
);
--> statement-breakpoint
CREATE INDEX `idx_cert_cnpj` ON `certificates` (`cnpj`);--> statement-breakpoint
CREATE INDEX `idx_cert_status` ON `certificates` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cert_valid_to` ON `certificates` (`valid_to`);--> statement-breakpoint
CREATE INDEX `idx_cert_is_active` ON `certificates` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_integration_sieg_status` ON `integration_status` (`sieg_status`);--> statement-breakpoint
CREATE INDEX `idx_integration_dominio_status` ON `integration_status` (`dominio_status`);