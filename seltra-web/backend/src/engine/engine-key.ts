import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { prisma } from '../db'

const KEY_PREFIX = 'sk_seltra_'
const ENCRYPTION_VERSION = 'v1'

function getEncryptionKey() {
  const secret = process.env.ENGINE_KEY_ENCRYPTION_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('ENGINE_KEY_ENCRYPTION_SECRET must contain at least 32 bytes.')
  }
  return createHash('sha256')
    .update('seltra-engine-key-encryption:v1:')
    .update(secret)
    .digest()
}

export function hashEngineApiKey(key: string, salt = process.env.SELTRA_ENGINE_API_KEY_HASH_SALT ?? '') {
  if (salt.length < 32) {
    throw new Error('SELTRA_ENGINE_API_KEY_HASH_SALT must contain at least 32 characters.')
  }
  return createHash('sha256').update(salt).update(':').update(key).digest('hex')
}

export function encryptEngineApiKey(key: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptEngineApiKey(encryptedKey: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = encryptedKey.split('.')
  if (version !== ENCRYPTION_VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
    throw new Error('Stored Seltra Engine key has an unsupported encrypted format.')
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(encodedIv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    throw Object.assign(new Error('Could not decrypt the stored Seltra Engine key.'), { cause: error })
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === 'P2002'
}

async function getActiveWorkspaceKey(tenantId: string): Promise<string | null> {
  const existing = await prisma.seltraEngineApiKey.findFirst({
    where: { tenantId, revokedAt: null },
    select: { encryptedKey: true },
  })
  if (!existing) return null
  if (existing.encryptedKey) return decryptEngineApiKey(existing.encryptedKey)

  await prisma.seltraEngineApiKey.updateMany({
    where: { tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return null
}

export async function provisionEngineKey(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, ownerId: true, creditWorkspaceId: true, slug: true },
  })
  if (!tenant) throw new Error(`Cannot provision an Engine key for missing workspace "${tenantId}".`)
  if (!tenant.ownerId) throw new Error(`Cannot provision an Engine key for ownerless workspace "${tenantId}".`)

  const workspaceId = tenant.creditWorkspaceId ?? tenant.ownerId
  await prisma.workspaceCredit.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  })
  if (!tenant.creditWorkspaceId) {
    await prisma.tenant.updateMany({
      where: { id: tenant.id, creditWorkspaceId: null },
      data: { creditWorkspaceId: workspaceId },
    })
  }

  const currentKey = await getActiveWorkspaceKey(tenant.id)
  if (currentKey) return currentKey

  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  try {
    await prisma.seltraEngineApiKey.create({
      data: {
        workspaceId,
        tenantId: tenant.id,
        label: tenant.slug,
        keyHash: hashEngineApiKey(key),
        encryptedKey: encryptEngineApiKey(key),
      },
    })
    return key
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const concurrentKey = await getActiveWorkspaceKey(tenant.id)
    if (!concurrentKey) throw error
    return concurrentKey
  }
}
