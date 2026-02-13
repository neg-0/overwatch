-- CreateTable
CREATE TABLE "sim_events" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effectsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sim_events_scenarioId_simTime_idx" ON "sim_events"("scenarioId", "simTime");

-- AddForeignKey
ALTER TABLE "sim_events" ADD CONSTRAINT "sim_events_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
