CREATE TABLE `moments` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`photo` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`distance_m` real NOT NULL,
	`elapsed_s` integer NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moments_activity` ON `moments` (`activity_id`);