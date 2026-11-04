CREATE TABLE "professional_blocked_dates" (
	"professional_id" uuid NOT NULL,
	"blocked_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_blocked_dates_professional_id_blocked_date_pk" PRIMARY KEY("professional_id","blocked_date")
);
--> statement-breakpoint
ALTER TABLE "professional_blocked_dates" ADD CONSTRAINT "professional_blocked_dates_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
