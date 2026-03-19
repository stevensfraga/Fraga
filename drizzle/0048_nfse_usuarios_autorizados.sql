-- Garante que nfse_usuarios_autorizados existe com colunas nome e configId
CREATE TABLE IF NOT EXISTS `nfse_usuarios_autorizados` (
  `id` int AUTO_INCREMENT NOT NULL,
  `configId` int,
  `nome` varchar(255) NOT NULL DEFAULT '',
  `telefone` varchar(30) NOT NULL,
  `ativo` tinyint NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `nfse_usuarios_autorizados_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Adiciona colunas se não existirem (idempotente)
ALTER TABLE `nfse_usuarios_autorizados` ADD COLUMN IF NOT EXISTS `configId` int;
--> statement-breakpoint
ALTER TABLE `nfse_usuarios_autorizados` ADD COLUMN IF NOT EXISTS `nome` varchar(255) NOT NULL DEFAULT '';
