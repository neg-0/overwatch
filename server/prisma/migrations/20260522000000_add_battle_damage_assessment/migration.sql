-- CreateTable
CREATE TABLE "battle_damage_assessments" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "atoDayNumber" INTEGER,
    "title" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "rawText" TEXT NOT NULL,
    "structured" JSONB,
    "classification" "Classification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "effectiveDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFormat" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewFlags" JSONB,
    "ingestedAt" TIMESTAMP(3),

    CONSTRAINT "battle_damage_assessments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "battle_damage_assessments" ADD CONSTRAINT "battle_damage_assessments_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
