//seltra/backend/src/conversations/conversations.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'crypto'
import { prisma } from '../db'

type ConversationRow = {
  id: string
  title: string
  user_id: string
  created_at: Date
  updated_at: Date
}

type MessageRow = {
  id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: Date
}

@Injectable()
export class ConversationsService {
  constructor(private readonly jwtService: JwtService) {}
    private readonly logger = new Logger(ConversationsService.name)

  private ready?: Promise<void>

  private ensureTables() {
    this.ready ??= (async () => {
      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Conversation" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Message" (
        "id" TEXT PRIMARY KEY,
        "conversation_id" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
        "user_id" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Conversation_user_updated_idx" ON "Conversation" ("user_id", "updated_at" DESC)`,
      )
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Message_conversation_created_idx" ON "Message" ("conversation_id", "created_at" ASC)`,
      )
    })()
    return this.ready
  }

  async list(authorization?: string, order?: string) {
    await this.ensureTables()
    const userId = await this.userId(authorization)
    const direction = order?.toLowerCase().includes(':asc') ? 'ASC' : 'DESC'
    return prisma.$queryRawUnsafe<ConversationRow[]>(
      `SELECT id, title, user_id, created_at, updated_at
       FROM "Conversation"
       WHERE user_id = $1
       ORDER BY updated_at ${direction}`,
      userId,
    )
  }

  async create(title: string, authorization?: string, fallbackUserId?: string) {
    await this.ensureTables()
    const userId = await this.userId(authorization, fallbackUserId)
    const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
      `INSERT INTO "Conversation" (id, title, user_id)
       VALUES ($1, $2, $3)
       RETURNING id, title, user_id, created_at, updated_at`,
      randomUUID(),
      title?.trim() || 'New conversation',
      userId,
    )
    return rows[0]
  }

  async messages(conversationId: string) {
    await this.ensureTables()
    return prisma.$queryRawUnsafe<MessageRow[]>(
      `SELECT id, conversation_id, user_id, role, content, created_at
       FROM "Message"
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      conversationId,
    )
  }

  async delete(conversationId: string, authorization?: string) {
    await this.ensureTables()
    const userId = await this.userId(authorization)
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `DELETE FROM "Conversation"
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      conversationId,
      userId,
    )
    return { success: rows.length > 0 }
  }

async createMessage(
  conversationId: string,
  body: { user_id?: string; role: 'user' | 'assistant'; content: string },
  authorization?: string,
) {
  await this.ensureTables()
  const userId = await this.userId(authorization, body.user_id)

  // Guard: verify the conversation exists before inserting the message
  const convExists = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "Conversation" WHERE id = $1 LIMIT 1`,
    conversationId,
  )
  if (!convExists || convExists.length === 0) {
    this.logger.warn?.(`[Conversations] Skipping message — conversation ${conversationId} not found`)
    // Return a no-op row rather than throwing, so the frontend doesn't error
    return null
  }

  const rows = await prisma.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO "Message" (id, conversation_id, user_id, role, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, user_id, role, content, created_at`,
    randomUUID(),
    conversationId,
    userId,
    body.role,
    body.content,
  )
  await prisma.$executeRawUnsafe(
    `UPDATE "Conversation" SET updated_at = now() WHERE id = $1`,
    conversationId,
  )
  return rows[0]
}

  private async userId(authorization?: string, fallbackUserId?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
          secret: process.env.JWT_SECRET || 'change-me',
        })
        return payload.sub
      } catch {
        throw new UnauthorizedException('Invalid bearer token')
      }
    }
    if (fallbackUserId) return fallbackUserId
    throw new UnauthorizedException('Missing bearer token')
  }
}
