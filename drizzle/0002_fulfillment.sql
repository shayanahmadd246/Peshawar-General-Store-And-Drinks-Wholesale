ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sub_order_id" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_ref" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "in_transit_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "failed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "failure_reason" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "stock_consumed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "reservation_released" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "status_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_assignee_id_idx" ON "shipments" USING btree ("assignee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_sub_order_id_idx" ON "shipments" USING btree ("sub_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_status_idempotency_idx" ON "shipments" USING btree ("status_idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"pack_size" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"recorded_by_role" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"notes" text,
	"status" text DEFAULT 'Posted' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_number" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sub_order_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "shipment_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_name" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "outstanding_amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_at" timestamp DEFAULT now();
--> statement-breakpoint
UPDATE "invoices" SET "invoice_number" = "id" WHERE "invoice_number" IS NULL;
--> statement-breakpoint
UPDATE "invoices" SET "client_id" = 'UNKNOWN' WHERE "client_id" IS NULL;
--> statement-breakpoint
UPDATE "invoices" SET "client_name" = 'Unknown Client' WHERE "client_name" IS NULL;
--> statement-breakpoint
UPDATE "invoices" SET "outstanding_amount" = GREATEST(("amount"::numeric - COALESCE("paid_amount", '0')::numeric), 0) WHERE "outstanding_amount" IS NULL;
--> statement-breakpoint
UPDATE "invoices" SET "issued_at" = COALESCE("created_at", now()) WHERE "issued_at" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='invoice_number') THEN
    ALTER TABLE "invoices" ALTER COLUMN "invoice_number" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='client_id') THEN
    ALTER TABLE "invoices" ALTER COLUMN "client_id" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='client_name') THEN
    ALTER TABLE "invoices" ALTER COLUMN "client_name" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='outstanding_amount') THEN
    ALTER TABLE "invoices" ALTER COLUMN "outstanding_amount" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_sub_order_id_idx" ON "invoices" USING btree ("sub_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_idempotency_key_idx" ON "invoices" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_wholesaler_id_idx" ON "invoices" USING btree ("wholesaler_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_idx" ON "payments" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_id_idx" ON "payment_allocations" USING btree ("invoice_id");
