CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"vision" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
