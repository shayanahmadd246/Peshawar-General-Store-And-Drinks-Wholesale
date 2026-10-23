CREATE TABLE IF NOT EXISTS "wholesaler_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"applicant_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'General Wholesale' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"wholesaler_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wholesaler_applications" ADD CONSTRAINT "wholesaler_applications_wholesaler_id_wholesalers_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."wholesalers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wholesaler_applications_status_idx" ON "wholesaler_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wholesaler_applications_email_idx" ON "wholesaler_applications" USING btree ("email");
