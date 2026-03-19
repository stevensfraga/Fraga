CREATE TABLE `agreements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`totalAmount` decimal(12,2) NOT NULL,
	`installments` int NOT NULL,
	`installmentAmount` decimal(12,2) NOT NULL,
	`startDate` timestamp NOT NULL,
	`status` enum('active','completed','defaulted') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agreements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_assistant_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhone` varchar(20) NOT NULL,
	`clientId` int,
	`intent` varchar(50) NOT NULL,
	`dbQueryMeta` text,
	`response` text NOT NULL,
	`correlationId` varchar(100),
	`handoffToHuman` boolean NOT NULL DEFAULT false,
	`handoffReason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_assistant_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_assistant_log_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userName` varchar(255),
	`userRole` varchar(32),
	`action` varchar(128) NOT NULL,
	`resource` varchar(64),
	`resourceId` varchar(128),
	`description` text,
	`oldValue` text,
	`newValue` text,
	`ipAddress` varchar(64),
	`status` enum('success','failure') NOT NULL DEFAULT 'success',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
	`pfx_data` MEDIUMBLOB,
	`sieg_status` varchar(20) DEFAULT 'pending',
	`sieg_id` varchar(100),
	`sieg_sent_at` timestamp,
	`sieg_error` varchar(255),
	`sieg_remote_active` boolean,
	`sieg_remote_expiry` timestamp,
	`sieg_remote_status` varchar(50),
	`sieg_synced_at` timestamp,
	`sieg_source` enum('local','sieg_remote','reconciled'),
	`sieg_recon_status` varchar(20),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`contaAzulPersonId` varchar(64),
	`name` varchar(255) NOT NULL,
	`document` varchar(20),
	`email` varchar(320),
	`phone` varchar(20),
	`phoneCellular` varchar(20),
	`whatsappNumber` varchar(20),
	`whatsappSource` enum('conta-azul','manual','import','unknown') NOT NULL DEFAULT 'unknown',
	`cnae` varchar(10),
	`status` enum('active','inactive','suspended') NOT NULL DEFAULT 'active',
	`optOut` boolean NOT NULL DEFAULT false,
	`whatsappValidatedAt` timestamp,
	`whatsappApprovedBy` varchar(255),
	`whatsappApprovalMethod` enum('sync-conta-azul','manual-approval','csv-import'),
	`billingPhones` text,
	`sendConsolidatedDebt` boolean NOT NULL DEFAULT true,
	`negotiatedUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_contaAzulId_unique` UNIQUE(`contaAzulId`)
);
--> statement-breakpoint
CREATE TABLE `collectionMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int,
	`cnpj` varchar(20) NOT NULL,
	`receivableId` int,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`messageTemplate` text NOT NULL,
	`messageSent` text,
	`whatsappMessageId` varchar(255),
	`status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`responseReceived` boolean DEFAULT false,
	`responseText` text,
	`responseDate` timestamp,
	`sentiment` enum('positive','negative','neutral','mixed','pending') DEFAULT 'pending',
	`sentimentScore` decimal(3,2),
	`sentimentAnalysis` text,
	`outcome` enum('pending','agreed','paid','no_response','rejected') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 1,
	`lastError` text,
	`providerMessageId` varchar(255),
	`providerStatus` enum('queued','sent','delivered','read','failed','unknown') DEFAULT 'unknown',
	`providerRawStatus` text,
	`providerError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collectionMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`messageSent` boolean DEFAULT false,
	`messageDelivered` boolean DEFAULT false,
	`messageRead` boolean DEFAULT false,
	`responseReceived` boolean DEFAULT false,
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`readAt` timestamp,
	`respondedAt` timestamp,
	`outcome` enum('pending','agreed','paid','no_response','rejected') NOT NULL DEFAULT 'pending',
	`amountRequested` decimal(12,2),
	`amountRecovered` decimal(12,2),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collectionRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`whatsappNumber` varchar(20) NOT NULL,
	`origin` enum('contaazul','manual','api') NOT NULL DEFAULT 'contaazul',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collectionSchedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`stage` enum('reset','d_minus_5','d_minus_1','d_plus_3','d_plus_7','d_plus_15','d_plus_30','d_plus_45','d_plus_60') NOT NULL,
	`channels` varchar(255) NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`sentAt` timestamp,
	`status` enum('pending','sent','delivered','failed','cancelled') NOT NULL DEFAULT 'pending',
	`whatsappMessageId` varchar(255),
	`emailMessageId` varchar(255),
	`cancelledReason` text,
	`cancelledAt` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collectionSchedule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contaAzulTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastUsedAt` timestamp,
	`lastRefreshAt` timestamp,
	`lastRefreshStatus` varchar(20),
	`lastRefreshError` text,
	`consecutiveFailures` int DEFAULT 0,
	`needsReauth` boolean DEFAULT false,
	CONSTRAINT `contaAzulTokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contaAzulWebhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`webhookId` varchar(64) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`payload` text NOT NULL,
	`receivableId` int,
	`clientId` int,
	`amountPaid` decimal(12,2),
	`paymentDate` timestamp,
	`status` enum('received','processed','failed','duplicate') NOT NULL DEFAULT 'received',
	`error` text,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contaAzulWebhooks_id` PRIMARY KEY(`id`),
	CONSTRAINT `contaAzulWebhooks_webhookId_unique` UNIQUE(`webhookId`)
);
--> statement-breakpoint
CREATE TABLE `cron_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cronKey` varchar(64) NOT NULL,
	`lastRunAt` timestamp,
	`lastResult` text,
	`lastStatus` enum('success','partial','failed','skipped'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cron_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `cron_state_cronKey_unique` UNIQUE(`cronKey`),
	CONSTRAINT `idx_cron_state_key` UNIQUE(`cronKey`)
);
--> statement-breakpoint
CREATE TABLE `dailyPerformanceSummary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` date NOT NULL,
	`messagesSent` int NOT NULL DEFAULT 0,
	`messagesDelivered` int NOT NULL DEFAULT 0,
	`messagesRead` int NOT NULL DEFAULT 0,
	`responsesReceived` int NOT NULL DEFAULT 0,
	`responseRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`agreementsReached` int NOT NULL DEFAULT 0,
	`paymentsReceived` int NOT NULL DEFAULT 0,
	`rejections` int NOT NULL DEFAULT 0,
	`totalRequested` decimal(12,2) NOT NULL DEFAULT '0.00',
	`totalRecovered` decimal(12,2) NOT NULL DEFAULT '0.00',
	`recoveryRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`avgResponseTime` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyPerformanceSummary_id` PRIMARY KEY(`id`),
	CONSTRAINT `dailyPerformanceSummary_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `dispatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`clientId` int NOT NULL,
	`channel` enum('whatsapp','email','sms') NOT NULL,
	`templateVersion` int NOT NULL DEFAULT 1,
	`messageId` varchar(255),
	`status` enum('pending','sent','failed','blocked') NOT NULL,
	`errorMessage` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dispatches_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_unique_dispatch` UNIQUE(`receivableId`,`channel`)
);
--> statement-breakpoint
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
	`honorarios_fonte` varchar(50),
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
CREATE TABLE `inbound_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhone` varchar(20) NOT NULL,
	`text` text NOT NULL,
	`messageId` varchar(255),
	`clientId` int,
	`processed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbound_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbound_messages_messageId_unique` UNIQUE(`messageId`)
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
CREATE TABLE `legal_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`status` enum('draft','approved','sent_to_legal','closed') NOT NULL DEFAULT 'draft',
	`approvedBy` varchar(255),
	`approvedAt` timestamp,
	`sentToLegalAt` timestamp,
	`closedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `legal_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageQueue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int,
	`messageType` enum('whatsapp','email') NOT NULL,
	`status` enum('pending','scheduled','sent','failed','delivered') NOT NULL DEFAULT 'pending',
	`stage` varchar(20) NOT NULL,
	`phone` varchar(20),
	`email` varchar(320),
	`subject` varchar(255),
	`body` text NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`failureReason` text,
	`externalMessageId` varchar(255),
	`retryCount` int DEFAULT 0,
	`maxRetries` int DEFAULT 3,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `messageQueue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`targetSentiment` enum('positive','negative','neutral','mixed') NOT NULL,
	`template` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `messageTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nfse_emissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticket_id` int,
	`emitter_company_id` int NOT NULL,
	`emitter_cnpj` varchar(20) NOT NULL,
	`taker_name` varchar(255) NOT NULL,
	`taker_document` varchar(20) NOT NULL,
	`taker_email` varchar(320),
	`taker_phone` varchar(20),
	`service_description` text NOT NULL,
	`service_value` decimal(12,2) NOT NULL,
	`deduction_value` decimal(12,2) DEFAULT '0',
	`net_value` decimal(12,2),
	`issue_date` timestamp,
	`status` enum('pending','processing','emitted','error','cancelled') NOT NULL DEFAULT 'pending',
	`nfse_number` varchar(20),
	`nfse_key` varchar(50),
	`nfse_pdf_url` text,
	`nfse_xml_url` text,
	`emission_attempts` int DEFAULT 0,
	`last_attempt_at` timestamp,
	`last_error_message` text,
	`emitted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nfse_emissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `no_response_followups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`phoneE164` varchar(20) NOT NULL,
	`bucketAtTrigger` varchar(5) NOT NULL,
	`firstSentAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextEligibleAt` timestamp,
	`lastAttemptAt` timestamp,
	`status` enum('active','stopped','completed') NOT NULL DEFAULT 'active',
	`stopReason` enum('replied','paid','optout','max_attempts','manual'),
	`metaJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `no_response_followups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `paymentHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`clientId` int NOT NULL,
	`webhookId` int,
	`amountPaid` decimal(12,2) NOT NULL,
	`paymentDate` timestamp NOT NULL,
	`paymentMethod` varchar(64),
	`collectionScheduleCancelled` boolean NOT NULL DEFAULT false,
	`cancelledSchedules` int NOT NULL DEFAULT 0,
	`notificationSent` boolean NOT NULL DEFAULT false,
	`notificationMethod` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paymentHistory_id` PRIMARY KEY(`id`)
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
CREATE TABLE `receivables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contaAzulId` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`dueDate` timestamp NOT NULL,
	`paidDate` timestamp,
	`status` enum('pending','overdue','paid','cancelled') NOT NULL DEFAULT 'pending',
	`monthsOverdue` int DEFAULT 0,
	`description` text,
	`documento` varchar(255),
	`link` text,
	`linhaDigitavel` varchar(100),
	`pdfStorageUrl` text,
	`paymentLinkCanonical` varchar(512),
	`paymentInfoPublic` boolean NOT NULL DEFAULT false,
	`paymentInfoSource` enum('zap_storage','r2','contaazul','manual','manual-pdf','worker','stored','api','panel','fallback'),
	`paymentInfoUpdatedAt` timestamp,
	`zapStorageFilename` varchar(255),
	`zapStorageFileSize` int,
	`zapStorageUploadedAt` timestamp,
	`source` varchar(20) NOT NULL DEFAULT 'test',
	`lastDispatchedAt` timestamp,
	`dispatchCount` int DEFAULT 0,
	`collectionScore` decimal(12,2) NOT NULL DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receivables_id` PRIMARY KEY(`id`)
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
CREATE TABLE `regua_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`stage` enum('d_minus_3','d_0','d_plus_3','d_plus_7','d_plus_15','d_plus_30','d_plus_45','d_plus_60','d_plus_90','d_plus_180','d_plus_365','ALL') NOT NULL,
	`dryRun` boolean NOT NULL DEFAULT false,
	`status` enum('sent','skipped','error','dry_run','overridden','override_log') NOT NULL,
	`skipReason` varchar(100),
	`phoneE164` varchar(20),
	`messageContent` text,
	`totalDebt` decimal(12,2),
	`titlesCount` int,
	`maxDaysOverdue` int,
	`providerMessageId` varchar(255),
	`providerStatus` varchar(50),
	`providerRawResult` text,
	`errorMessage` text,
	`correlationId` varchar(100),
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `regua_audit_id` PRIMARY KEY(`id`),
	CONSTRAINT `regua_audit_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE TABLE `responseAnalysisHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int,
	`followUpId` int,
	`responseText` text NOT NULL,
	`sentiment` enum('positive','negative','neutral','mixed') NOT NULL,
	`sentimentScore` decimal(3,2) NOT NULL,
	`sentimentExplanation` text,
	`suggestedAction` enum('send_payment_link','schedule_call','offer_discount','escalate_to_manager','wait_and_retry','mark_as_paid','send_agreement') NOT NULL,
	`actionConfidence` decimal(3,2) NOT NULL,
	`suggestedNextTone` enum('friendly','administrative','formal','escalate') NOT NULL,
	`aiModel` varchar(64) NOT NULL DEFAULT 'gpt-4',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `responseAnalysisHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduledFollowUps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`previousMessageId` int,
	`scheduledFor` timestamp NOT NULL,
	`messageType` enum('friendly','administrative','formal') NOT NULL,
	`messageTemplate` text,
	`previousResponse` text,
	`responseAnalysis` enum('positive','negative','neutral','no_response','partial_agreement') NOT NULL,
	`status` enum('pending','sent','cancelled','completed') NOT NULL DEFAULT 'pending',
	`reason` text,
	`sentAt` timestamp,
	`cancelledAt` timestamp,
	`cancelledReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledFollowUps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin','master','operador','visualizador') NOT NULL DEFAULT 'user',
	`isActive` boolean NOT NULL DEFAULT true,
	`invitedBy` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `webhook_raw_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(50) NOT NULL,
	`path` varchar(255) NOT NULL,
	`method` varchar(10) NOT NULL DEFAULT 'POST',
	`headersJson` text,
	`bodyJson` text,
	`ip` varchar(45),
	`userAgent` text,
	`statusCode` int,
	`responseJson` text,
	`processingTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_raw_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsappAudit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`receivableId` int NOT NULL,
	`messageId` varchar(255),
	`correlationId` varchar(100),
	`providerTrackingMode` enum('WITH_ID','ACK_ONLY','NO_ID_ACK','WEBHOOK') NOT NULL DEFAULT 'WITH_ID',
	`providerAck` boolean NOT NULL DEFAULT false,
	`payloadHash` varchar(64),
	`providerStatusUrl` text,
	`sentAt` timestamp NOT NULL,
	`templateUsed` varchar(100),
	`status` enum('sent','failed','delivered','read','error') NOT NULL DEFAULT 'sent',
	`errorMessage` text,
	`phoneNumber` varchar(20),
	`messageContent` text,
	`pdfUrl` text,
	`providerAckAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappAudit_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsappAudit_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE TABLE `zapcontabil_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticket_id` varchar(64) NOT NULL,
	`client_id` int,
	`phone_e164` varchar(20) NOT NULL,
	`client_name` varchar(255),
	`client_document` varchar(20),
	`current_sector` varchar(100),
	`previous_sector` varchar(100),
	`subject` text,
	`description` text,
	`service_description` text,
	`service_value` decimal(12,2),
	`emitter_company_id` int,
	`emitter_cnpj` varchar(20),
	`status` enum('open','in_progress','pending_data','nfse_emitted','closed','error') NOT NULL DEFAULT 'open',
	`nfse_emission_id` int,
	`last_error_message` text,
	`last_webhook_at` timestamp,
	`webhook_payload` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zapcontabil_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `zapcontabil_tickets_ticket_id_unique` UNIQUE(`ticket_id`),
	CONSTRAINT `idx_zapcontabil_ticket_id` UNIQUE(`ticket_id`)
);
--> statement-breakpoint
ALTER TABLE `collectionRules` ADD CONSTRAINT `collectionRules_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collectionSchedule` ADD CONSTRAINT `collectionSchedule_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collectionSchedule` ADD CONSTRAINT `collectionSchedule_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD CONSTRAINT `contaAzulTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contaAzulWebhooks` ADD CONSTRAINT `contaAzulWebhooks_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contaAzulWebhooks` ADD CONSTRAINT `contaAzulWebhooks_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messageQueue` ADD CONSTRAINT `messageQueue_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messageQueue` ADD CONSTRAINT `messageQueue_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orphan_receivables` ADD CONSTRAINT `orphan_receivables_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orphan_receivables` ADD CONSTRAINT `orphan_receivables_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paymentHistory` ADD CONSTRAINT `paymentHistory_webhookId_contaAzulWebhooks_id_fk` FOREIGN KEY (`webhookId`) REFERENCES `contaAzulWebhooks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pre_regua_validation` ADD CONSTRAINT `pre_regua_validation_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pre_regua_validation` ADD CONSTRAINT `pre_regua_validation_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receivable_mismatch_history` ADD CONSTRAINT `receivable_mismatch_history_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD CONSTRAINT `responseAnalysisHistory_messageId_collectionMessages_id_fk` FOREIGN KEY (`messageId`) REFERENCES `collectionMessages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `responseAnalysisHistory` ADD CONSTRAINT `responseAnalysisHistory_followUpId_scheduledFollowUps_id_fk` FOREIGN KEY (`followUpId`) REFERENCES `scheduledFollowUps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledFollowUps` ADD CONSTRAINT `scheduledFollowUps_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledFollowUps` ADD CONSTRAINT `scheduledFollowUps_previousMessageId_collectionMessages_id_fk` FOREIGN KEY (`previousMessageId`) REFERENCES `collectionMessages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD CONSTRAINT `whatsappAudit_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappAudit` ADD CONSTRAINT `whatsappAudit_receivableId_receivables_id_fk` FOREIGN KEY (`receivableId`) REFERENCES `receivables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ai_phone` ON `ai_assistant_log` (`fromPhone`);--> statement-breakpoint
CREATE INDEX `idx_ai_client` ON `ai_assistant_log` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_ai_intent` ON `ai_assistant_log` (`intent`);--> statement-breakpoint
CREATE INDEX `idx_ai_handoff` ON `ai_assistant_log` (`handoffToHuman`);--> statement-breakpoint
CREATE INDEX `idx_cert_cnpj` ON `certificates` (`cnpj`);--> statement-breakpoint
CREATE INDEX `idx_cert_status` ON `certificates` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cert_valid_to` ON `certificates` (`valid_to`);--> statement-breakpoint
CREATE INDEX `idx_cert_is_active` ON `certificates` (`is_active`);--> statement-breakpoint
CREATE INDEX `clients_document_idx` ON `clients` (`document`);--> statement-breakpoint
CREATE INDEX `idx_cnpj` ON `collectionMessages` (`cnpj`);--> statement-breakpoint
CREATE INDEX `idx_collection_rules_conta_azul_id` ON `collectionRules` (`contaAzulId`);--> statement-breakpoint
CREATE INDEX `idx_collection_rules_client_id` ON `collectionRules` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_client` ON `collectionSchedule` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_receivable` ON `collectionSchedule` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_stage` ON `collectionSchedule` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_schedule_status` ON `collectionSchedule` (`status`);--> statement-breakpoint
CREATE INDEX `idx_schedule_scheduled` ON `collectionSchedule` (`scheduledFor`);--> statement-breakpoint
CREATE INDEX `idx_conta_azul_tokens_user` ON `contaAzulTokens` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_id` ON `contaAzulWebhooks` (`webhookId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_receivable` ON `contaAzulWebhooks` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_client` ON `contaAzulWebhooks` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_webhook_status` ON `contaAzulWebhooks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_webhook_event` ON `contaAzulWebhooks` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_cron_state_last_run` ON `cron_state` (`lastRunAt`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_client` ON `dispatches` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_channel` ON `dispatches` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_status` ON `dispatches` (`status`);--> statement-breakpoint
CREATE INDEX `idx_dispatch_sent` ON `dispatches` (`sentAt`);--> statement-breakpoint
CREATE INDEX `idx_ek_company_codi` ON `ekontrol_companies` (`codi_emp`);--> statement-breakpoint
CREATE INDEX `idx_ek_company_client` ON `ekontrol_companies` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_inbound_phone` ON `inbound_messages` (`fromPhone`);--> statement-breakpoint
CREATE INDEX `idx_inbound_client` ON `inbound_messages` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_inbound_processed` ON `inbound_messages` (`processed`);--> statement-breakpoint
CREATE INDEX `idx_integration_sieg_status` ON `integration_status` (`sieg_status`);--> statement-breakpoint
CREATE INDEX `idx_integration_dominio_status` ON `integration_status` (`dominio_status`);--> statement-breakpoint
CREATE INDEX `idx_legal_client` ON `legal_cases` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_legal_status` ON `legal_cases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_legal_client_status` ON `legal_cases` (`clientId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_queue_client` ON `messageQueue` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_queue_receivable` ON `messageQueue` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_queue_status` ON `messageQueue` (`status`);--> statement-breakpoint
CREATE INDEX `idx_queue_scheduled` ON `messageQueue` (`scheduledFor`);--> statement-breakpoint
CREATE INDEX `idx_queue_type` ON `messageQueue` (`messageType`);--> statement-breakpoint
CREATE INDEX `idx_nfse_ticket_id` ON `nfse_emissions` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_nfse_emitter` ON `nfse_emissions` (`emitter_cnpj`);--> statement-breakpoint
CREATE INDEX `idx_nfse_taker` ON `nfse_emissions` (`taker_document`);--> statement-breakpoint
CREATE INDEX `idx_nfse_status` ON `nfse_emissions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_nfse_number` ON `nfse_emissions` (`nfse_number`);--> statement-breakpoint
CREATE INDEX `idx_followup_client` ON `no_response_followups` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_followup_phone` ON `no_response_followups` (`phoneE164`);--> statement-breakpoint
CREATE INDEX `idx_followup_status_next` ON `no_response_followups` (`status`,`nextEligibleAt`);--> statement-breakpoint
CREATE INDEX `idx_orphan_receivable` ON `orphan_receivables` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_client` ON `orphan_receivables` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_conta_azul` ON `orphan_receivables` (`contaAzulId`);--> statement-breakpoint
CREATE INDEX `idx_orphan_type` ON `orphan_receivables` (`orphanType`);--> statement-breakpoint
CREATE INDEX `idx_orphan_action` ON `orphan_receivables` (`action`);--> statement-breakpoint
CREATE INDEX `idx_orphan_detected` ON `orphan_receivables` (`detectedAt`);--> statement-breakpoint
CREATE INDEX `idx_payment_receivable` ON `paymentHistory` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_payment_client` ON `paymentHistory` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_payment_webhook` ON `paymentHistory` (`webhookId`);--> statement-breakpoint
CREATE INDEX `idx_payment_date` ON `paymentHistory` (`paymentDate`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_run` ON `pre_regua_validation` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_client` ON `pre_regua_validation` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_receivable` ON `pre_regua_validation` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_valid` ON `pre_regua_validation` (`isValid`);--> statement-breakpoint
CREATE INDEX `idx_pre_regua_validated` ON `pre_regua_validation` (`validatedAt`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_company` ON `pricing_audit` (`ek_company_id`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_action` ON `pricing_audit` (`action`);--> statement-breakpoint
CREATE INDEX `idx_pricing_audit_created` ON `pricing_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pricing_defasado` ON `pricing_current` (`is_defasado`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_ek_company` ON `pricing_suggestions` (`ek_company_id`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_status` ON `pricing_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_receivable` ON `receivable_mismatch_history` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_run` ON `receivable_mismatch_history` (`reconciliationRunId`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_type` ON `receivable_mismatch_history` (`mismatchType`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_severity` ON `receivable_mismatch_history` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_mismatch_created` ON `receivable_mismatch_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `receivables_paymentInfoPublic_idx` ON `receivables` (`paymentInfoPublic`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_run` ON `reconciliation_audit` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_created` ON `reconciliation_audit` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_status` ON `reconciliation_audit` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_alerted` ON `reconciliation_audit` (`isAlerted`);--> statement-breakpoint
CREATE INDEX `idx_regua_run` ON `regua_audit` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_regua_client` ON `regua_audit` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_regua_receivable` ON `regua_audit` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_regua_stage` ON `regua_audit` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_regua_status` ON `regua_audit` (`status`);--> statement-breakpoint
CREATE INDEX `idx_regua_created` ON `regua_audit` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_regua_dedup` ON `regua_audit` (`clientId`,`receivableId`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_sync_cursor_type` ON `sync_cursor` (`syncType`);--> statement-breakpoint
CREATE INDEX `idx_sync_cursor_last` ON `sync_cursor` (`lastSyncAt`);--> statement-breakpoint
CREATE INDEX `idx_webhook_provider` ON `webhook_raw_log` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_webhook_created` ON `webhook_raw_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_webhook_path` ON `webhook_raw_log` (`path`);--> statement-breakpoint
CREATE INDEX `idx_audit_client` ON `whatsappAudit` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_audit_receivable` ON `whatsappAudit` (`receivableId`);--> statement-breakpoint
CREATE INDEX `idx_audit_message` ON `whatsappAudit` (`messageId`);--> statement-breakpoint
CREATE INDEX `idx_audit_correlation` ON `whatsappAudit` (`correlationId`);--> statement-breakpoint
CREATE INDEX `idx_audit_sent` ON `whatsappAudit` (`sentAt`);--> statement-breakpoint
CREATE INDEX `idx_audit_status` ON `whatsappAudit` (`status`);--> statement-breakpoint
CREATE INDEX `idx_audit_tracking_mode` ON `whatsappAudit` (`providerTrackingMode`);--> statement-breakpoint
CREATE INDEX `idx_zapcontabil_phone` ON `zapcontabil_tickets` (`phone_e164`);--> statement-breakpoint
CREATE INDEX `idx_zapcontabil_sector` ON `zapcontabil_tickets` (`current_sector`);--> statement-breakpoint
CREATE INDEX `idx_zapcontabil_status` ON `zapcontabil_tickets` (`status`);