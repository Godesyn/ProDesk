-- Trigram matching (gin_trgm_ops, and the `<%` word-similarity operator used by
-- the fuzzy board search) requires the pg_trgm extension. Idempotent + safe to
-- run inside the per-file migration transaction.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "projects_agency_updated_idx" ON "projects" USING btree ("agency_id","updated_at" DESC NULLS LAST) WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_brand_updated_idx" ON "projects" USING btree ("brand_id","updated_at" DESC NULLS LAST) WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_proposal_agency_idx" ON "projects" USING btree ("proposal_sent_by_agency_id") WHERE "projects"."proposal_sent_by_agency_id" is not null;--> statement-breakpoint
CREATE INDEX "projects_agency_service_type_idx" ON "projects" USING btree ("agency_id","service_type") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_title_trgm_idx" ON "projects" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_task_title_trgm_idx" ON "projects" USING gin ("task_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_service_name_trgm_idx" ON "projects" USING gin ("service_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_package_name_trgm_idx" ON "projects" USING gin ("package_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_brand_name_trgm_idx" ON "projects" USING gin ("brand_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_description_trgm_idx" ON "projects" USING gin ("description" gin_trgm_ops);