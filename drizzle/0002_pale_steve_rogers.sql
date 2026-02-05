CREATE TABLE `driveCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`folderId` varchar(100),
	`folderName` varchar(255),
	`lastSyncAt` timestamp,
	`syncEnabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `driveCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `driveCredentials_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `driveSyncHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`credentialId` int NOT NULL,
	`fileId` varchar(100) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileModifiedTime` timestamp NOT NULL,
	`recordsImported` int DEFAULT 0,
	`status` enum('success','failed','skipped') NOT NULL,
	`errorMessage` text,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `driveSyncHistory_id` PRIMARY KEY(`id`)
);
