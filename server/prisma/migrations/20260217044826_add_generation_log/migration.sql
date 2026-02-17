-- CreateTable
CREATE TABLE "generation_logs" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "artifact" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "outputLength" INTEGER NOT NULL,
    "rawOutput" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_logs_scenarioId_idx" ON "generation_logs"("scenarioId");

-- AddForeignKey
ALTER TABLE "generation_logs" ADD CONSTRAINT "generation_logs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
