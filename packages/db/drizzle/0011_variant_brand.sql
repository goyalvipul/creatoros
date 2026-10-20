ALTER TABLE "distribution_variants" ADD COLUMN IF NOT EXISTS "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distribution_variants_brand_idx" ON "distribution_variants" ("brand_id");--> statement-breakpoint
UPDATE "distribution_variants" v
SET "brand_id" = a."brand_id"
FROM "logical_assets" a
WHERE v."asset_id" = a."id" AND v."brand_id" IS NULL AND a."brand_id" IS NOT NULL;--> statement-breakpoint
UPDATE "distribution_variants" v
SET "brand_id" = p."brand_id"
FROM "creative_projects" p
WHERE v."project_id" = p."id" AND v."brand_id" IS NULL AND p."brand_id" IS NOT NULL;
