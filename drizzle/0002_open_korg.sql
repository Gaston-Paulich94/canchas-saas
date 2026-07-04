CREATE TYPE "public"."court_sport" AS ENUM('padel', 'futbol5', 'futbol11', 'tenis');--> statement-breakpoint
CREATE TABLE "courts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sport" "court_sport" NOT NULL,
	"surface" text,
	"indoor" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"price_per_hour" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courts_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courts_tenant_id_idx" ON "courts" USING btree ("tenant_id");