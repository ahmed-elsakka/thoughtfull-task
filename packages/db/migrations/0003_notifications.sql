CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_reminder_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"counterpart_name" text NOT NULL,
	"session_starts_at" timestamp with time zone NOT NULL,
	"offset_minutes" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_source_reminder_id_unique" UNIQUE("source_reminder_id"),
	CONSTRAINT "notification_offset_allowed" CHECK ("notifications"."offset_minutes" in (60, 1440))
);

--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at","id");
