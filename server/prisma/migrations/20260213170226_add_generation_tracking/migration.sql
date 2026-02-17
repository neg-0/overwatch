-- AlterTable
ALTER TABLE "scenarios" ADD COLUMN     "generationError" TEXT,
ADD COLUMN     "generationProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "generationStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "generationStep" TEXT;
