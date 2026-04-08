-- AlterTable
ALTER TABLE "strategy_documents" ADD COLUMN     "commanderIntent" TEXT,
ADD COLUMN     "mission" TEXT;

-- CreateTable
CREATE TABLE "oplan_phases" (
    "id" TEXT NOT NULL,
    "strategyDocId" TEXT NOT NULL,
    "phaseNumber" INTEGER NOT NULL,
    "phaseName" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "description" TEXT NOT NULL,
    "keyTasks" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oplan_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_tasks" (
    "id" TEXT NOT NULL,
    "strategyDocId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "commandRole" TEXT,
    "tasks" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pace_comms" (
    "id" TEXT NOT NULL,
    "strategyDocId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "primary" TEXT NOT NULL,
    "alternate" TEXT NOT NULL,
    "contingency" TEXT NOT NULL,
    "emergency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pace_comms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oplan_phases_strategyDocId_idx" ON "oplan_phases"("strategyDocId");

-- CreateIndex
CREATE INDEX "command_tasks_strategyDocId_idx" ON "command_tasks"("strategyDocId");

-- CreateIndex
CREATE INDEX "pace_comms_strategyDocId_idx" ON "pace_comms"("strategyDocId");

-- AddForeignKey
ALTER TABLE "oplan_phases" ADD CONSTRAINT "oplan_phases_strategyDocId_fkey" FOREIGN KEY ("strategyDocId") REFERENCES "strategy_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_tasks" ADD CONSTRAINT "command_tasks_strategyDocId_fkey" FOREIGN KEY ("strategyDocId") REFERENCES "strategy_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pace_comms" ADD CONSTRAINT "pace_comms_strategyDocId_fkey" FOREIGN KEY ("strategyDocId") REFERENCES "strategy_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
