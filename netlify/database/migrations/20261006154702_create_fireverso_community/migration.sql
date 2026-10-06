CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"room" text NOT NULL,
	"body" text NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"region" text DEFAULT 'EU' NOT NULL,
	"instagram" text DEFAULT '' NOT NULL,
	"tiktok" text DEFAULT '' NOT NULL,
	"photo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"rank_points" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_room_date_idx" ON "messages" ("room","created_at");--> statement-breakpoint
CREATE INDEX "profiles_region_idx" ON "profiles" ("region");--> statement-breakpoint
CREATE INDEX "scores_user_date_idx" ON "scores" ("user_id","recorded_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;