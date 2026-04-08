-- CreateEnum
CREATE TYPE "SSRStatus" AS ENUM ('FULFILLED', 'DEGRADED', 'DENIED');

-- AlterTable
ALTER TABLE "scenario_injects" ALTER COLUMN "affectedEntities" DROP DEFAULT;

-- CreateTable
CREATE TABLE "space_support_requests" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "atoDayNumber" INTEGER NOT NULL,
    "submitter" TEXT NOT NULL,
    "submitterType" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "callsignSupported" TEXT NOT NULL,
    "missionDescription" TEXT NOT NULL,
    "operationArea" TEXT NOT NULL,
    "coverageLat" DOUBLE PRECISION,
    "coverageLon" DOUBLE PRECISION,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "capabilityRequested" "SpaceCapabilityType" NOT NULL,
    "bandRequested" TEXT,
    "systemPreferred" TEXT,
    "controllingAuthority" TEXT NOT NULL,
    "primaryComm" TEXT NOT NULL,
    "alternateComm" TEXT,
    "contingencyComm" TEXT,
    "emergencyComm" TEXT,
    "assetAssigned" TEXT,
    "constellationAssigned" TEXT,
    "status" "SSRStatus" NOT NULL DEFAULT 'FULFILLED',
    "statusRationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_support_requests_scenarioId_atoDayNumber_idx" ON "space_support_requests"("scenarioId", "atoDayNumber");

-- AddForeignKey
ALTER TABLE "space_support_requests" ADD CONSTRAINT "space_support_requests_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
