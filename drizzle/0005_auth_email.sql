ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_uidx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"template" text NOT NULL,
	"to_email" text NOT NULL,
	"to_user_id" text,
	"subject" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_event_key_uidx" ON "email_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_status_scheduled_idx" ON "email_outbox" USING btree ("status","scheduled_at");
