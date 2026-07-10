CREATE TYPE "public"."reservation_status" AS ENUM('confirmada', 'cancelada');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'confirmada' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_time_order" CHECK ("reservations"."ends_at" > "reservations"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_tenant_id_idx" ON "reservations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reservations_court_id_idx" ON "reservations" USING btree ("court_id");--> statement-breakpoint
CREATE INDEX "reservations_tenant_starts_at_idx" ON "reservations" USING btree ("tenant_id","starts_at");