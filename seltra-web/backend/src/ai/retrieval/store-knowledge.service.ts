//backend/src/ai/retrieval/store-knowledge.service.ts
import { prisma } from '../../db'

type KnowledgeRow = {
  id: string
  tenantId: string
  kind: string
  sourceId: string | null
  content: string
  metadata: unknown
  updatedAt: Date
}

type KnowledgeDelegate = {
  findFirst(args: unknown): Promise<KnowledgeRow | null>
  findMany(args: unknown): Promise<KnowledgeRow[]>
  create(args: unknown): Promise<KnowledgeRow>
  update(args: unknown): Promise<KnowledgeRow>
  deleteMany(args: unknown): Promise<unknown>
}

// Keep this boundary explicit while Prisma Client types refresh after migrations.
const knowledgeDb = prisma as typeof prisma & { storeKnowledgeChunk: KnowledgeDelegate }

export interface StoreKnowledgeChunk {
  id: string
  tenantId: string
  kind: 'product' | 'policy' | 'faq' | 'about' | 'section' | 'hero' | 'nav' | 'theme' | 'conversation_summary'
  sourceId?: string | null
  content: string
  metadata?: Record<string, unknown> | null
  updatedAt: Date
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function recencyDecay(updatedAt: Date): number {
  const ageHours = (Date.now() - updatedAt.getTime()) / 3_600_000
  return Math.max(0, 3 - ageHours / 24)
}

export function scoreKnowledgeChunk(chunk: { content: string; kind: string; updatedAt: Date }, query: string): number {
  const queryTokens = tokenize(query)
  const chunkTokens = new Set(tokenize(chunk.content))
  const overlap = queryTokens.filter((token) => chunkTokens.has(token)).length
  const recency = chunk.kind === 'conversation_summary' ? recencyDecay(chunk.updatedAt) : 0
  return overlap + recency
}

export async function storeKnowledgeChunk(chunk: {
  tenantId: string
  kind: string
  sourceId?: string
  content: string
  metadata?: Record<string, unknown>
  meta?: Record<string, unknown>
}): Promise<void> {
  const sourceId = chunk.sourceId ?? chunk.kind
  const metadata = chunk.metadata ?? chunk.meta
  const existing = await knowledgeDb.storeKnowledgeChunk.findFirst({
    where: { tenantId: chunk.tenantId, kind: chunk.kind, sourceId },
  })
  if (existing) {
    await knowledgeDb.storeKnowledgeChunk.update({
      where: { id: existing.id },
      data: { content: chunk.content, metadata: metadata as object | undefined },
    })
    return
  }
  await knowledgeDb.storeKnowledgeChunk.create({
    data: {
      tenantId: chunk.tenantId,
      kind: chunk.kind,
      sourceId,
      content: chunk.content,
      metadata: metadata as object | undefined,
    },
  })
}

export async function retrieveKnowledgeChunks(
  tenantId: string,
  query: string,
  limit = 6,
): Promise<StoreKnowledgeChunk[]> {
  const chunks = await knowledgeDb.storeKnowledgeChunk.findMany({ where: { tenantId } })
  // Naive keyword-overlap scoring; pgvector/embedding retrieval can replace this later.
  return chunks
    .map((chunk) => ({ chunk, score: scoreKnowledgeChunk(chunk, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => ({
      id: result.chunk.id,
      tenantId: result.chunk.tenantId,
      kind: result.chunk.kind as StoreKnowledgeChunk['kind'],
      sourceId: result.chunk.sourceId,
      content: result.chunk.content,
      metadata: result.chunk.metadata as Record<string, unknown> | null,
      updatedAt: result.chunk.updatedAt,
    }))
}

export async function deleteProductKnowledgeChunks(tenantId: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return
  await knowledgeDb.storeKnowledgeChunk.deleteMany({
    where: { tenantId, kind: 'product', sourceId: { in: productIds } },
  })
}

export async function onProductCreated(tenantId: string, product: { id: string; name: string; description?: string }): Promise<void> {
  // Hook: create knowledge chunk for new product
  await storeKnowledgeChunk({
    tenantId,
    kind: 'product',
    sourceId: product.id,
    content: `Product: ${product.name}. ${product.description || ''}`,
    metadata: { productId: product.id, type: 'product' },
  })
}

export async function onManifestPatched(tenantId: string, patch: { type?: string; fields?: Record<string, unknown> }): Promise<void> {
  // Hook: create/update section knowledge chunk when manifest changes
  if (patch.type && patch.fields) {
    const content = JSON.stringify(patch.fields)
    await storeKnowledgeChunk({
      tenantId,
      kind: 'section',
      sourceId: patch.type,
      content,
      metadata: { sectionType: patch.type },
    })
  }
}
