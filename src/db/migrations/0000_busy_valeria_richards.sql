CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`distance_m` real DEFAULT 0 NOT NULL,
	`duration_s` integer DEFAULT 0 NOT NULL,
	`avg_pace_sec_per_km` real,
	`elev_gain_m` real
);
--> statement-breakpoint
CREATE TABLE `track_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` text NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`altitude` real,
	`timestamp` integer NOT NULL,
	`speed` real,
	`accuracy` real,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `track_points_activity_seq` ON `track_points` (`activity_id`,`seq`);