CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text,
	`title` text NOT NULL,
	`description` text,
	`author` text,
	`site_name` text,
	`domain` text,
	`image_path` text,
	`image_source_url` text,
	`import_status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
