-- AlterTable
ALTER TABLE "scenario_injects" ADD COLUMN     "expectedResponse" TEXT,
ADD COLUMN     "fromEntity" TEXT,
ADD COLUMN     "injectMode" TEXT,
ADD COLUMN     "mselLevel" TEXT,
ADD COLUMN     "objectiveTested" TEXT,
ADD COLUMN     "planningDocId" TEXT,
ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "toEntity" TEXT;

-- AddForeignKey
ALTER TABLE "scenario_injects" ADD CONSTRAINT "scenario_injects_planningDocId_fkey" FOREIGN KEY ("planningDocId") REFERENCES "planning_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
