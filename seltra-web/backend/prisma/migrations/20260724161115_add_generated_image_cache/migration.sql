-- notionPageId was already removed in an earlier migration/environment.

-- CreateTable
CREATE TABLE "GeneratedImageCache" (
    "id" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedImageCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImageCache_promptHash_key" ON "GeneratedImageCache"("promptHash");

-- CreateIndex
CREATE INDEX "GeneratedImageCache_promptHash_idx" ON "GeneratedImageCache"("promptHash");
