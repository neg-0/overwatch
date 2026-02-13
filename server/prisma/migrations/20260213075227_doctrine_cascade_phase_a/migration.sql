-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SATCOM_PROTECTED';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SATCOM_WIDEBAND';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SATCOM_TACTICAL';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'LINK16';

-- AlterTable
ALTER TABLE "asset_types" ADD COLUMN     "commsSystems" JSONB,
ADD COLUMN     "dataLinks" TEXT[],
ADD COLUMN     "gpsType" TEXT;

-- AlterTable
ALTER TABLE "planning_documents" ADD COLUMN     "docTier" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "space_needs" ADD COLUMN     "commsBand" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN     "systemName" TEXT;

-- AlterTable
ALTER TABLE "strategy_documents" ADD COLUMN     "parentDocId" TEXT,
ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "baseId" TEXT;

-- CreateTable
CREATE TABLE "bases" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseType" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "country" TEXT NOT NULL,
    "icaoCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_injects" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "triggerDay" INTEGER NOT NULL,
    "triggerHour" INTEGER NOT NULL,
    "injectType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_injects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenario_injects_scenarioId_triggerDay_idx" ON "scenario_injects"("scenarioId", "triggerDay");

-- AddForeignKey
ALTER TABLE "strategy_documents" ADD CONSTRAINT "strategy_documents_parentDocId_fkey" FOREIGN KEY ("parentDocId") REFERENCES "strategy_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bases" ADD CONSTRAINT "bases_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_injects" ADD CONSTRAINT "scenario_injects_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
