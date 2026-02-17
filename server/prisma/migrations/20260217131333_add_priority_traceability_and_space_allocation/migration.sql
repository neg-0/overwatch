-- CreateEnum
CREATE TYPE "MissionCriticality" AS ENUM ('CRITICAL', 'ESSENTIAL', 'ENHANCING', 'ROUTINE');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('FULFILLED', 'DEGRADED', 'CONTENTION', 'DENIED', 'PENDING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SpaceCapabilityType" ADD VALUE 'GPS_MILITARY';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SIGINT_SPACE';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SDA';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'LAUNCH_DETECT';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'CYBER_SPACE';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'DATALINK';
ALTER TYPE "SpaceCapabilityType" ADD VALUE 'SSA';

-- AlterTable
ALTER TABLE "priority_entries" ADD COLUMN     "strategyPriorityId" TEXT;

-- AlterTable
ALTER TABLE "space_needs" ADD COLUMN     "fallbackCapability" "SpaceCapabilityType",
ADD COLUMN     "missionCriticality" "MissionCriticality" NOT NULL DEFAULT 'ESSENTIAL',
ADD COLUMN     "priorityEntryId" TEXT,
ADD COLUMN     "riskIfDenied" TEXT;

-- CreateTable
CREATE TABLE "strategy_priorities" (
    "id" TEXT NOT NULL,
    "strategyDocId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effect" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_allocations" (
    "id" TEXT NOT NULL,
    "spaceNeedId" TEXT NOT NULL,
    "spaceAssetId" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "allocatedCapability" "SpaceCapabilityType",
    "rationale" TEXT,
    "riskLevel" TEXT,
    "contentionGroup" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_allocations_spaceNeedId_idx" ON "space_allocations"("spaceNeedId");

-- AddForeignKey
ALTER TABLE "strategy_priorities" ADD CONSTRAINT "strategy_priorities_strategyDocId_fkey" FOREIGN KEY ("strategyDocId") REFERENCES "strategy_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_entries" ADD CONSTRAINT "priority_entries_strategyPriorityId_fkey" FOREIGN KEY ("strategyPriorityId") REFERENCES "strategy_priorities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_needs" ADD CONSTRAINT "space_needs_priorityEntryId_fkey" FOREIGN KEY ("priorityEntryId") REFERENCES "priority_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_allocations" ADD CONSTRAINT "space_allocations_spaceNeedId_fkey" FOREIGN KEY ("spaceNeedId") REFERENCES "space_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_allocations" ADD CONSTRAINT "space_allocations_spaceAssetId_fkey" FOREIGN KEY ("spaceAssetId") REFERENCES "space_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
