-- Doctrine Audit: Add target coordinates to priority entries
ALTER TABLE "priority_entries" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "priority_entries" ADD COLUMN "longitude" DOUBLE PRECISION;

-- Doctrine Audit: Add affected entities array to scenario injects
ALTER TABLE "scenario_injects" ADD COLUMN "affectedEntities" TEXT[] DEFAULT '{}';
