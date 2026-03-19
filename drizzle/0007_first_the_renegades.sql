CREATE TABLE `contaAzulTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastUsedAt` timestamp,
	CONSTRAINT `contaAzulTokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contaAzulTokens` ADD CONSTRAINT `contaAzulTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_conta_azul_tokens_user` ON `contaAzulTokens` (`userId`);