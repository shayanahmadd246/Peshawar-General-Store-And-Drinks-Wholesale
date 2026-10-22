CREATE TABLE IF NOT EXISTS "audio_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"conversation_id" text,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"duration_ms" integer,
	"storage_path" text NOT NULL,
	"checksum" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"conversation_id" text,
	"audio_asset_id" text NOT NULL,
	"raw_transcript" text NOT NULL,
	"edited_transcript" text,
	"detected_language" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"submission_key" text,
	"gemini_used" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_transcripts" ADD CONSTRAINT "voice_transcripts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_transcripts" ADD CONSTRAINT "voice_transcripts_audio_asset_id_audio_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_assets_client_id_idx" ON "audio_assets" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_transcripts_client_id_idx" ON "voice_transcripts" USING btree ("client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_transcripts_submission_key_uidx" ON "voice_transcripts" USING btree ("submission_key");
