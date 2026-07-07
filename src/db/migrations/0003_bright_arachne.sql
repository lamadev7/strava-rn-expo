ALTER TABLE `activities` ADD `elev_loss_m` real;
--> statement-breakpoint
UPDATE `activities` SET `type` = 'hike' WHERE `type` = 'walk';