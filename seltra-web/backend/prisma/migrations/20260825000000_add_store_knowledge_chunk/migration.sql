CREATE TABLE "StoreKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreKnowledgeChunk_tenantId_kind_idx" ON "StoreKnowledgeChunk"("tenantId", "kind");
CREATE UNIQUE INDEX "StoreKnowledgeChunk_tenantId_kind_sourceId_key" ON "StoreKnowledgeChunk"("tenantId", "kind", "sourceId");
ALTER TABLE "StoreKnowledgeChunk" ADD CONSTRAINT "StoreKnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;