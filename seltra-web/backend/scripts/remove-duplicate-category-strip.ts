import { prisma } from '../src/db'
import { applyManifestPatch } from '../src/ai/agents/manifest.agent'

async function main() {
  const tenants = await prisma.tenant.findMany({ where: { manifest: { not: null } }, select: { id: true, manifest: true } })
  let patched = 0
  for (const tenant of tenants) {
    const manifest = tenant.manifest as any
    if (!manifest?.sections?.some((section: any) => section.type === 'category-strip')) continue
    const result = applyManifestPatch(manifest, { removeSection: { type: 'category-strip' } })
    if (!result.applied || !result.after) continue
    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenant.id }, data: { manifest: result.after as any, storefrontVersion: { increment: 1 }, updatedAt: new Date() } }),
      prisma.manifestPatchLog.create({ data: { tenantId: tenant.id, patch: { removeSection: { type: 'category-strip' } }, before: manifest, after: result.after as any, source: 'system' } }),
    ])
    patched++
  }
  console.log(`Removed category-strip from ${patched}/${tenants.length} tenants`)
}

main().finally(() => prisma.$disconnect())