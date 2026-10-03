CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_user_tenant_unique";--> statement-breakpoint
DROP INDEX "profiles_user_id_idx";--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_unique" UNIQUE("user_id");