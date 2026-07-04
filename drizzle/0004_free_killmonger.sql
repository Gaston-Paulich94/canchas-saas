CREATE TABLE "court_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_availability_day_range" CHECK ("court_availability"."day_of_week" between 0 and 6),
	CONSTRAINT "court_availability_time_order" CHECK ("court_availability"."close_time" > "court_availability"."open_time")
);
--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN "slot_duration_min" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "court_availability" ADD CONSTRAINT "court_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_availability" ADD CONSTRAINT "court_availability_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "court_availability_court_id_idx" ON "court_availability" USING btree ("court_id");--> statement-breakpoint
CREATE INDEX "court_availability_tenant_id_idx" ON "court_availability" USING btree ("tenant_id");