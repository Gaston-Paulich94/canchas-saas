ALTER TABLE "payments" DROP CONSTRAINT "payments_reservation_id_reservations_id_fk";
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_court_id_courts_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;