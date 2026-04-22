CREATE TABLE `ai_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`prompt` text NOT NULL,
	`tool_calls_json` text NOT NULL,
	`outcome_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_transcripts_user_created_idx` ON `ai_transcripts` (`user_id`,`created_at`);