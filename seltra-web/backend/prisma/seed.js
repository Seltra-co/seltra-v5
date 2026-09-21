const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const { randomBytes } = require('crypto')

const prisma = new PrismaClient()

async function main() {
  const email = 'williamofosuparwar@gmail.com'
  const merchantId = 'SELTRA-2026-0001'
  const name = 'William Ofosu-Parwar'

  const existingApplication = await prisma.merchantApplication.findFirst({
    where: {
      OR: [
        { merchantId },
        { email },
      ],
    },
  })

  if (existingApplication) {
    await prisma.merchantApplication.update({
      where: { id: existingApplication.id },
      data: {
        email,
        merchantId,
        status: 'pending',
        fullName: name,
        phone: '',
        createdBy: 'ops-seed-v1',
      },
    })
  } else {
    await prisma.merchantApplication.create({
      data: {
        email,
        merchantId,
        status: 'approved',
        fullName: name,
        phone: '',
        businessName: 'Seltra Cohort Merchant',
        businessType: 'Other',
        storeName: 'William Store',
        whatYouSell: 'Placeholder - update during onboarding',
        basedIn: 'Ghana',
        monthlyRevenue: 'Placeholder - update during onboarding',
        createdBy: 'ops-seed-v1',
        createdAt: new Date(),
      },
    })
  }

  const passwordHash = await bcrypt.hash(`ops-managed:${randomBytes(24).toString('hex')}`, 12)
  await prisma.user.upsert({
    where: { email },
    update: { name },
    create: {
      email,
      name,
      passwordHash,
    },
  })

//   await prisma.merchantApplication.update({
//   where: { merchantId },
//   data: {
//     user: {
//       connect: {
//         id: user.id,
//       },
//     },
//   },
// })

}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
