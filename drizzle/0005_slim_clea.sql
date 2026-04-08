ALTER TABLE `collectionMessages` MODIFY COLUMN `clientId` int;--> statement-breakpoint
ALTER TABLE `collectionMessages` ADD `cnpj` varchar(20) NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_cnpj` ON `collectionMessages` (`cnpj`);