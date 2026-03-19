CREATE TABLE `ekontrol_companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codi_emp` int NOT NULL,
	`inscricao_federal` varchar(20) NOT NULL,
	`razao_social` varchar(300) NOT NULL,
	`status_empresa` varchar(2) NOT NULL,
	`segmento` varchar(10),
	`cnae_principal` varchar(20),
	`cnae_secundario` text,
	`regime_tributario` varchar(60) NOT NULL,
	`honorarios_atual` decimal(12,2),
	`competencia_reajuste` varchar(10),
	`array_honorarios` text,
	`responsavel` varchar(200),
	`email_responsavel` varchar(320),
	`api_key_cliente` varchar(100),
	`usafolha` boolean DEFAULT false,
	`usafiscal` boolean DEFAULT false,
	`usacontabil` boolean DEFAULT false,
	`client_id` int,
	`last_sync_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ekontrol_companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ek_company_cnpj` UNIQUE(`inscricao_federal`)
);
--> statement-breakpoint
CREATE TABLE `ekontrol_metrics_monthly` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ek_company_id` int NOT NULL,
	`competencia` varchar(7) NOT NULL,
	`faturamento_total` decimal(14,2),
	`funcionarios` int,
	`admissoes` int,
	`demissoes` int,
	`notas_emitidas` int,
	`lancamentos` int,
	`fonte` enum('ekontrol_api','conta_azul','manual') NOT NULL DEFAULT 'conta_azul',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ekontrol_metrics_monthly_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ek_metrics_company_comp` UNIQUE(`ek_company_id`,`competencia`)
);
--> statement-breakpoint
CREATE TABLE `pricing_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ek_company_id` int NOT NULL,
	`action` enum('fee_calculated','defasagem_detected','reajuste_suggested','reajuste_applied','reajuste_dismissed','snooze_set','manual_override','ekontrol_synced') NOT NULL,
	`details` text,
	`performed_by` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pricing_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_current` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ek_company_id` int NOT NULL,
	`fee_atual` decimal(12,2),
	`fee_sugerido` decimal(12,2),
	`fee_base` decimal(12,2),
	`fee_funcionarios` decimal(12,2),
	`fee_faturamento` decimal(12,2),
	`fee_complexidade` decimal(12,2),
	`complexity_score` int DEFAULT 0,
	`complexity_details` text,
	`is_defasado` boolean DEFAULT false,
	`defasagem_reason` text,
	`defasagem_detected_at` timestamp,
	`snoozed_until` timestamp,
	`last_reajuste_at` timestamp,
	`is_precificacao_manual` boolean DEFAULT false,
	`last_calculated_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_current_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_pricing_ek_company` UNIQUE(`ek_company_id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ek_company_id` int NOT NULL,
	`fee_anterior` decimal(12,2),
	`fee_sugerido` decimal(12,2),
	`reason` text NOT NULL,
	`status` enum('pending','applied','dismissed','snoozed') NOT NULL DEFAULT 'pending',
	`applied_at` timestamp,
	`applied_by` varchar(100),
	`fee_aplicado` decimal(12,2),
	`snoozed_until` timestamp,
	`dismissed_reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ek_company_codi` ON `ekontrol_companies` (`codi_emp`);--> statement-breakpoint
CREATE INDEX `idx_ek_company_client` ON `ekontrol_companies` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_company` ON `pricing_audit` (`ek_company_id`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_action` ON `pricing_audit` (`action`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_created` ON `pricing_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pricing_defasado` ON `pricing_current` (`is_defasado`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_ek_company` ON `pricing_suggestions` (`ek_company_id`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_status` ON `pricing_suggestions` (`status`);