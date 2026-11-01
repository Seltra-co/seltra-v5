import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const [command, ...args] = process.argv.slice(2)
const options = Object.fromEntries(args.flatMap((arg, i) => arg.startsWith('--') ? [[arg.slice(2), args[i + 1]]] : []))
const prisma = new PrismaClient()

try {
  const salt = process.env.SELTRA_ENGINE_API_KEY_HASH_SALT
  if (!salt || salt.length < 32) throw new Error('SELTRA_ENGINE_API_KEY_HASH_SALT (32+ chars) is required.')
  if (command === 'create') {
    const workspaceId = options.workspace
    const label = options.label
    if (!workspaceId || !label) throw new Error('Usage: npm run engine:key:create -- --workspace <id> --label <text>')
    const key = `sk_seltra_${randomBytes(32).toString('base64url')}`
    const keyHash = createHash('sha256').update(salt).update(':').update(key).digest('hex')
    await prisma.workspaceCredit.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } })
    await prisma.seltraEngineApiKey.create({ data: { workspaceId, label, keyHash } })
    process.stdout.write(`${key}\n`)
  } else if (command === 'revoke') {
    const id = options.id
    if (!id) throw new Error('Usage: npm run engine:key:revoke -- --id <key-id>')
    await prisma.seltraEngineApiKey.update({ where: { id }, data: { revokedAt: new Date() } })
    process.stdout.write(`Revoked Seltra Engine key ${id}.\n`)
  } else {
    throw new Error('Expected command: create or revoke.')
  }
} finally {
  await prisma.$disconnect()
}
