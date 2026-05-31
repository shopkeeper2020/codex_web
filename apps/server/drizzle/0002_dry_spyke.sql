CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`created_at_iso` text NOT NULL,
	`thread_id` text,
	`turn_id` text,
	`official_reference_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_thread_id` ON `attachments` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_created_at_iso` ON `attachments` (`created_at_iso`);