CREATE TABLE `calendar_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`refresh_token_enc` text,
	`scopes` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_accounts_google_sub_idx` ON `calendar_accounts` (`google_sub`);--> statement-breakpoint
CREATE INDEX `calendar_accounts_user_status_idx` ON `calendar_accounts` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_list_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`etag` text,
	`status` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`start_at` text,
	`end_at` text,
	`start_date` text,
	`end_date_exclusive` text,
	`start_tz` text,
	`end_tz` text,
	`title` text,
	`description` text,
	`location` text,
	`html_link` text,
	`recurring_event_id` text,
	`original_start_time` text,
	`google_updated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`calendar_list_id`) REFERENCES `calendar_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_list_event_idx` ON `calendar_events` (`calendar_list_id`,`google_event_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_list_start_idx` ON `calendar_events` (`calendar_list_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `calendar_events_list_date_idx` ON `calendar_events` (`calendar_list_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `calendar_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`google_calendar_id` text NOT NULL,
	`summary` text NOT NULL,
	`description` text,
	`color_id` text,
	`background_color` text,
	`foreground_color` text,
	`time_zone` text,
	`primary` integer DEFAULT false NOT NULL,
	`selected` integer DEFAULT true NOT NULL,
	`sync_token` text,
	`last_full_sync_at` text,
	`last_incremental_sync_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `calendar_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_lists_account_google_idx` ON `calendar_lists` (`account_id`,`google_calendar_id`);--> statement-breakpoint
CREATE INDEX `calendar_lists_account_idx` ON `calendar_lists` (`account_id`);