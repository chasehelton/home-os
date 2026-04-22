ALTER TABLE `calendar_events` ADD `local_dirty` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `pending_op` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `mutation_id` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `last_push_error` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `last_push_attempt_at` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `conflict_payload` text;--> statement-breakpoint
CREATE INDEX `calendar_events_dirty_idx` ON `calendar_events` (`local_dirty`);--> statement-breakpoint
CREATE INDEX `calendar_events_mutation_idx` ON `calendar_events` (`mutation_id`);