-- AlterTable
ALTER TABLE "airspace_structures" ADD COLUMN     "activationConditions" TEXT,
ADD COLUMN     "altitudeUnit" TEXT,
ADD COLUMN     "controllingAuthority" TEXT,
ADD COLUMN     "usageRestrictions" TEXT;

-- AlterTable
ALTER TABLE "priority_entries" ADD COLUMN     "cdeLevel" TEXT,
ADD COLUMN     "engagementAuthority" TEXT,
ADD COLUMN     "noStrike" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetStatus" TEXT,
ADD COLUMN     "targetSystemCategory" TEXT,
ADD COLUMN     "timeSensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weaponeering" TEXT;

-- CreateTable
CREATE TABLE "spins_entries" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "conditions" TEXT,
    "authority" TEXT,
    "applicableTo" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spins_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_plans" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "netName" TEXT NOT NULL,
    "frequency" TEXT,
    "band" TEXT,
    "callsign" TEXT,
    "purpose" TEXT NOT NULL,
    "paceOrder" TEXT,
    "applicableTo" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "force_apportionments" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "missionType" TEXT NOT NULL,
    "percentAllocation" DOUBLE PRECISION NOT NULL,
    "sorties" INTEGER NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "force_apportionments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weapon_target_pairs" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "targetId" TEXT,
    "weaponSystem" TEXT NOT NULL,
    "platform" TEXT,
    "quantity" INTEGER,
    "desiredEffect" TEXT NOT NULL,
    "guidanceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weapon_target_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordination_measures" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "measureType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coordinatesJson" JSONB,
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coordination_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fire_support_measures" (
    "id" TEXT NOT NULL,
    "planningDocId" TEXT NOT NULL,
    "measureType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coordinatesJson" JSONB,
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fire_support_measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spins_entries_planningDocId_idx" ON "spins_entries"("planningDocId");

-- CreateIndex
CREATE INDEX "comm_plans_planningDocId_idx" ON "comm_plans"("planningDocId");

-- CreateIndex
CREATE INDEX "force_apportionments_planningDocId_idx" ON "force_apportionments"("planningDocId");

-- CreateIndex
CREATE INDEX "weapon_target_pairs_planningDocId_idx" ON "weapon_target_pairs"("planningDocId");

-- CreateIndex
CREATE INDEX "coordination_measures_planningDocId_idx" ON "coordination_measures"("planningDocId");

-- CreateIndex
CREATE INDEX "fire_support_measures_planningDocId_idx" ON "fire_support_measures"("planningDocId");

-- AddForeignKey
ALTER TABLE "spins_entries" ADD CONSTRAINT "spins_entries_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_plans" ADD CONSTRAINT "comm_plans_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "force_apportionments" ADD CONSTRAINT "force_apportionments_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weapon_target_pairs" ADD CONSTRAINT "weapon_target_pairs_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordination_measures" ADD CONSTRAINT "coordination_measures_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fire_support_measures" ADD CONSTRAINT "fire_support_measures_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
