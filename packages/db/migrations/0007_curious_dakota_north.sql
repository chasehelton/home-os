CREATE TABLE `github_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`github_user_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_accounts_user_idx` ON `github_accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_accounts_github_id_idx` ON `github_accounts` (`github_user_id`);