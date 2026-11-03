CREATE TABLE "professional_availability" (
	"professional_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "professional_availability_professional_id_day_of_week_pk" PRIMARY KEY("professional_id","day_of_week"),
	CONSTRAINT "availability_day_range" CHECK ("professional_availability"."day_of_week" between 1 and 7),
	CONSTRAINT "availability_time_range" CHECK ("professional_availability"."start_minute" >= 0 and "professional_availability"."end_minute" <= 1439 and "professional_availability"."end_minute" - "professional_availability"."start_minute" >= 50)
);
--> statement-breakpoint
ALTER TABLE "professional_availability" ADD CONSTRAINT "professional_availability_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;