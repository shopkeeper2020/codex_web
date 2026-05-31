CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`source` text NOT NULL,
	`updated_at_iso` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_details` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`detail_json` text NOT NULL,
	`cached_at_iso` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`path` text,
	`updated_at_iso` text,
	`in_progress` integer NOT NULL,
	`owner_client_id` text,
	`owner_kind` text,
	`owner_source` text,
	`cached_at_iso` text NOT NULL
);
