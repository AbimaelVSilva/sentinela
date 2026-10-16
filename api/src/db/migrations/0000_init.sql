CREATE TYPE "public"."camera_status" AS ENUM('pending', 'online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."event_severity" AS ENUM('alert', 'attention', 'info', 'error');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('removed', 'moved', 'no_change', 'analysis_failed');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('baseline', 'before', 'after', 'calibration');--> statement-breakpoint
CREATE TABLE "cameras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"serial" text,
	"qr_raw" text,
	"stream_key" text NOT NULL,
	"status" "camera_status" DEFAULT 'pending' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"roi" jsonb,
	"scene_validation" jsonb,
	"inventory" jsonb,
	"baseline_snapshot_id" uuid,
	"monitoring_enabled" boolean DEFAULT false NOT NULL,
	"events_since_inventory" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cameras_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "cameras_stream_key_unique" UNIQUE("stream_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camera_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"severity" "event_severity" NOT NULL,
	"person_entered_at" timestamp with time zone,
	"person_left_at" timestamp with time zone,
	"before_snapshot_id" uuid,
	"after_snapshot_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb,
	"scene_diff_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camera_id" uuid NOT NULL,
	"kind" "snapshot_kind" NOT NULL,
	"file_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_baseline_snapshot_id_snapshots_id_fk" FOREIGN KEY ("baseline_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_before_snapshot_id_snapshots_id_fk" FOREIGN KEY ("before_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_after_snapshot_id_snapshots_id_fk" FOREIGN KEY ("after_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_camera_created_idx" ON "events" USING btree ("camera_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "snapshots_camera_idx" ON "snapshots" USING btree ("camera_id","captured_at");