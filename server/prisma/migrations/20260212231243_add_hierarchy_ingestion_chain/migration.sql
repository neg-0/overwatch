-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('ATO', 'MTO', 'STO', 'OPORD', 'EXORD', 'FRAGORD', 'ACO', 'SPINS');

-- CreateEnum
CREATE TYPE "Domain" AS ENUM ('AIR', 'MARITIME', 'SPACE', 'LAND');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('PLANNED', 'BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION', 'ENGAGED', 'EGRESSING', 'RTB', 'RECOVERED', 'CANCELLED', 'DIVERTED', 'DELAYED');

-- CreateEnum
CREATE TYPE "WaypointType" AS ENUM ('DEP', 'IP', 'CP', 'TGT', 'EGR', 'REC', 'ORBIT', 'REFUEL', 'CAP', 'PATROL');

-- CreateEnum
CREATE TYPE "TimeWindowType" AS ENUM ('TOT', 'ONSTA', 'OFFSTA', 'REFUEL', 'COVERAGE', 'SUPPRESS', 'TRANSIT');

-- CreateEnum
CREATE TYPE "SupportType" AS ENUM ('TANKER', 'SEAD', 'ISR', 'EW', 'ESCORT', 'CAP');

-- CreateEnum
CREATE TYPE "SpaceCapabilityType" AS ENUM ('GPS', 'SATCOM', 'OPIR', 'ISR_SPACE', 'EW_SPACE', 'WEATHER', 'PNT');

-- CreateEnum
CREATE TYPE "Affiliation" AS ENUM ('FRIENDLY', 'HOSTILE', 'NEUTRAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET');

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "theater" TEXT NOT NULL,
    "adversary" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "classification" "Classification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_documents" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorityLevel" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFormat" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewFlags" JSONB,
    "ingestedAt" TIMESTAMP(3),

    CONSTRAINT "strategy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_documents" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "strategyDocId" TEXT,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFormat" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewFlags" JSONB,
    "ingestedAt" TIMESTAMP(3),

    CONSTRAINT "planning_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_entries" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "targetId" TEXT,
    "effect" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priority_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasking_orders" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "planningDocId" TEXT,
    "orderType" "OrderType" NOT NULL,
    "orderId" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "effectiveStart" TIMESTAMP(3) NOT NULL,
    "effectiveEnd" TIMESTAMP(3) NOT NULL,
    "classification" "Classification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "atoDayNumber" INTEGER,
    "rawText" TEXT,
    "rawFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFormat" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewFlags" JSONB,
    "ingestedAt" TIMESTAMP(3),

    CONSTRAINT "tasking_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_packages" (
    "id" TEXT NOT NULL,
    "taskingOrderId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "priorityRank" INTEGER NOT NULL,
    "missionType" TEXT NOT NULL,
    "effectDesired" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "callsign" TEXT,
    "domain" "Domain" NOT NULL,
    "unitId" TEXT,
    "platformType" TEXT NOT NULL,
    "platformCount" INTEGER NOT NULL DEFAULT 1,
    "missionType" TEXT NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'PLANNED',
    "affiliation" "Affiliation" NOT NULL DEFAULT 'FRIENDLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waypoints" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "waypointType" "WaypointType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude_ft" DOUBLE PRECISION,
    "speed_kts" DOUBLE PRECISION,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waypoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_windows" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "windowType" "TimeWindowType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_targets" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beNumber" TEXT,
    "targetName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "targetCategory" TEXT,
    "priorityRank" INTEGER,
    "desiredEffect" TEXT NOT NULL,
    "collateralConcern" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_requirements" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "supportType" "SupportType" NOT NULL,
    "supportingMissionId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "unitDesignation" TEXT NOT NULL,
    "serviceBranch" TEXT NOT NULL,
    "domain" "Domain" NOT NULL,
    "baseLocation" TEXT NOT NULL,
    "baseLat" DOUBLE PRECISION NOT NULL,
    "baseLon" DOUBLE PRECISION NOT NULL,
    "affiliation" "Affiliation" NOT NULL DEFAULT 'FRIENDLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" "Domain" NOT NULL,
    "category" TEXT NOT NULL,
    "milsymbolCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "assetTypeId" TEXT NOT NULL,
    "tailNumber" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_assets" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "constellation" TEXT NOT NULL,
    "noradId" TEXT,
    "tleLine1" TEXT,
    "tleLine2" TEXT,
    "capabilities" "SpaceCapabilityType"[],
    "status" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "inclination" DOUBLE PRECISION,
    "eccentricity" DOUBLE PRECISION,
    "periodMin" DOUBLE PRECISION,
    "apogeeKm" DOUBLE PRECISION,
    "perigeeKm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_needs" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "spaceAssetId" TEXT,
    "capabilityType" "SpaceCapabilityType" NOT NULL,
    "priority" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "coverageLat" DOUBLE PRECISION,
    "coverageLon" DOUBLE PRECISION,
    "coverageRadiusKm" DOUBLE PRECISION,
    "fulfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_coverage_windows" (
    "id" TEXT NOT NULL,
    "spaceAssetId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "maxElevation" DOUBLE PRECISION NOT NULL,
    "maxElevationTime" TIMESTAMP(3) NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLon" DOUBLE PRECISION NOT NULL,
    "swathWidthKm" DOUBLE PRECISION NOT NULL,
    "capabilityType" "SpaceCapabilityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_coverage_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_states" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "simTime" TIMESTAMP(3) NOT NULL,
    "realStartTime" TIMESTAMP(3) NOT NULL,
    "compressionRatio" DOUBLE PRECISION NOT NULL DEFAULT 720,
    "currentAtoDay" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_updates" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "callsign" TEXT,
    "domain" "Domain" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude_ft" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed_kts" DOUBLE PRECISION,
    "status" "MissionStatus" NOT NULL,
    "fuelState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leadership_decisions" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedAssetIds" TEXT[],
    "affectedMissionIds" TEXT[],
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "leadership_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_logs" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "hierarchyLevel" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdRecordId" TEXT,
    "parentLinkId" TEXT,
    "extractedCounts" JSONB,
    "reviewFlagCount" INTEGER NOT NULL DEFAULT 0,
    "parseTimeMs" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_types_name_key" ON "asset_types"("name");

-- CreateIndex
CREATE INDEX "position_updates_missionId_timestamp_idx" ON "position_updates"("missionId", "timestamp");

-- CreateIndex
CREATE INDEX "ingest_logs_scenarioId_createdAt_idx" ON "ingest_logs"("scenarioId", "createdAt");

-- CreateIndex
CREATE INDEX "ingest_logs_inputHash_idx" ON "ingest_logs"("inputHash");

-- AddForeignKey
ALTER TABLE "strategy_documents" ADD CONSTRAINT "strategy_documents_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_documents" ADD CONSTRAINT "planning_documents_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_documents" ADD CONSTRAINT "planning_documents_strategyDocId_fkey" FOREIGN KEY ("strategyDocId") REFERENCES "strategy_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_entries" ADD CONSTRAINT "priority_entries_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasking_orders" ADD CONSTRAINT "tasking_orders_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasking_orders" ADD CONSTRAINT "tasking_orders_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_packages" ADD CONSTRAINT "mission_packages_taskingOrderId_fkey" FOREIGN KEY ("taskingOrderId") REFERENCES "tasking_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "mission_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_windows" ADD CONSTRAINT "time_windows_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_targets" ADD CONSTRAINT "mission_targets_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requirements" ADD CONSTRAINT "support_requirements_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "asset_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_assets" ADD CONSTRAINT "space_assets_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_needs" ADD CONSTRAINT "space_needs_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_needs" ADD CONSTRAINT "space_needs_spaceAssetId_fkey" FOREIGN KEY ("spaceAssetId") REFERENCES "space_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_coverage_windows" ADD CONSTRAINT "space_coverage_windows_spaceAssetId_fkey" FOREIGN KEY ("spaceAssetId") REFERENCES "space_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_states" ADD CONSTRAINT "simulation_states_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_updates" ADD CONSTRAINT "position_updates_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
