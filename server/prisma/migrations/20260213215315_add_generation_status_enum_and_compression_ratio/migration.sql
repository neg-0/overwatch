/*
  Warnings:

  - The `generationStatus` column on the `scenarios` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "scenarios" ADD COLUMN     "compressionRatio" DOUBLE PRECISION NOT NULL DEFAULT 720,
DROP COLUMN "generationStatus",
ADD COLUMN     "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'PENDING';
