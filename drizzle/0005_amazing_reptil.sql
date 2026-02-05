ALTER TABLE `sales` ADD `saleType` enum('online','pos') DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `paymentGateway` varchar(100);