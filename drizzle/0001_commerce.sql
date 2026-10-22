ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sub_orders" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sub_order_items" ADD COLUMN IF NOT EXISTS "cost_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "sub_order_items" ADD COLUMN IF NOT EXISTS "pack_size" text;
--> statement-breakpoint
UPDATE "sub_order_items" SET "cost_price" = '0.00' WHERE "cost_price" IS NULL;
--> statement-breakpoint
UPDATE "sub_order_items" SET "pack_size" = '' WHERE "pack_size" IS NULL;
--> statement-breakpoint
ALTER TABLE "sub_order_items" ALTER COLUMN "cost_price" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sub_order_items" ALTER COLUMN "pack_size" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cart_items" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carts_open_client_idx" ON "carts" USING btree ("client_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_product_idx" ON "cart_items" USING btree ("cart_id","product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_orders_wholesaler_id_idx" ON "sub_orders" USING btree ("wholesaler_id");
