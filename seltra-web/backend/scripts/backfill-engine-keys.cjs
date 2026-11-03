const { prisma } = require('../dist/db')
const { provisionEngineKey } = require('../dist/engine/engine-key')

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { ownerId: { not: null } },
    select: { id: true, slug: true },
    orderBy: { createdAt: 'asc' },
  })
  let provisioned = 0
  const failures = []

  for (const tenant of tenants) {
    try {
      await provisionEngineKey(tenant.id)
      provisioned += 1
    } catch (error) {
      failures.push(tenant.slug)
      console.error(`Engine key provisioning failed for workspace "${tenant.slug}": ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  console.log(`Verified or provisioned Engine keys for ${provisioned} workspace(s).`)
  if (failures.length) {
    console.error(`Failed workspace slugs: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(`Engine key backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
