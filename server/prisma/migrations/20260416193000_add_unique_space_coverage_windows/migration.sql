-- Remove duplicate pre-seeded coverage windows before enforcing the natural key.
DELETE FROM "space_coverage_windows" a
USING "space_coverage_windows" b
WHERE a."id" > b."id"
  AND a."spaceAssetId" = b."spaceAssetId"
  AND a."capabilityType" = b."capabilityType"
  AND a."startTime" = b."startTime"
  AND a."endTime" = b."endTime"
  AND a."centerLat" = b."centerLat"
  AND a."centerLon" = b."centerLon";

-- Let createMany({ skipDuplicates: true }) suppress repeated preseed inserts.
CREATE UNIQUE INDEX "space_coverage_windows_preseed_unique"
  ON "space_coverage_windows"(
    "spaceAssetId",
    "capabilityType",
    "startTime",
    "endTime",
    "centerLat",
    "centerLon"
  );
