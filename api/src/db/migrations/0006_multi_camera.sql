ALTER TABLE "cameras" DROP CONSTRAINT "cameras_store_id_unique";--> statement-breakpoint
CREATE INDEX "cameras_store_idx" ON "cameras" USING btree ("store_id");