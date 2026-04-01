-- CreateTable
CREATE TABLE "llm_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hitCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "llm_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_cache_cacheKey_key" ON "llm_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "llm_cache_cacheKey_idx" ON "llm_cache"("cacheKey");
