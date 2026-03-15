-- AlterTable
ALTER TABLE "scenario_injects" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "airspace_structures" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "structureType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coordinatesJson" JSONB NOT NULL,
    "centerLat" DOUBLE PRECISION,
    "centerLon" DOUBLE PRECISION,
    "radiusNm" DOUBLE PRECISION,
    "altitudeLow" INTEGER,
    "altitudeHigh" INTEGER,
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "sourceDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airspace_structures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airspace_structures_scenarioId_idx" ON "airspace_structures"("scenarioId");

-- AddForeignKey
ALTER TABLE "airspace_structures" ADD CONSTRAINT "airspace_structures_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
