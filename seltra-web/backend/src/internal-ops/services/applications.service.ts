//services/applications.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { MerchantStatus, Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '../../db'
import { ResendService } from '../../resend/resend.service'
import { parseBasedIn, slugify } from '../constants'
import { ApplicationsQueryDto } from '../dto/applications-query.dto'
import { TenantEventsService } from '../events/tenant-events.service'
 import { PrismaClient } from '@prisma/client'

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly resendService: ResendService,
    private readonly tenantEvents: TenantEventsService,
  ) {}

  //List applications with optional filtering and pagination
  async list(query: ApplicationsQueryDto) {
    const where: Prisma.MerchantApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? {
        OR: [
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { businessName: { contains: query.search, mode: 'insensitive' } },
          { storeName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    const [applications, total] = await Promise.all([
      prisma.merchantApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.merchantApplication.count({ where }),
    ])
    return {
      data: applications.map((application) => ({
        id: application.id,
        ownerName: application.fullName,
        ownerEmail: application.email,
        businessName: application.businessName,
        businessType: application.businessType,
        status: application.status,
        appliedAt: application.createdAt.toISOString(),    
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    }
  }

  // async pipelineCounts() {
  //   const [pending, pendingUnreviewed, approvedNoTenant, credentialsGenerated, welcomeEmailSent] = await Promise.all([
  //     prisma.merchantApplication.count({ where: { status: 'pending' } }),
  //     prisma.merchantApplication.count({ where: { status: 'pending', reviewedAt: null } }),
  //     prisma.merchantApplication.count({ where: { status: 'approved', merchantId: null } }),
  //     prisma.merchantApplication.count({ where: { credentialsGeneratedAt: { not: null } } }),
  //     prisma.merchantApplication.count({ where: { welcomeEmailSentAt: { not: null } } }),
  //   ])
  //   return {
  //     applicationReceived: pending,
  //     reviewApprove: pendingUnreviewed,
  //     createMerchant: approvedNoTenant,
  //     generateCredentials: credentialsGenerated,
  //     sendWelcomeEmail: welcomeEmailSent,
  //   }
  // }

  //Approve an application, create a user, generate a merchant ID, and send credentials
  async approve(id: string) {
  const application = await prisma.merchantApplication.findUnique({
    where: { id },
  })

  if (!application)
    throw new NotFoundException('Application not found')

  if (application.status !== MerchantStatus.pending)
    throw new BadRequestException(
      'Only pending applications can be approved',
    )

  if (!application.email || !application.fullName)
    throw new BadRequestException(
      'Application must have an email and full name to be approved',
    )

  const tempPassword = randomBytes(9).toString('base64url')

  const passwordHash = await bcrypt.hash(
    tempPassword,
    12,
  )

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: {
        email: application.email,
      },
      update: {
        name: application.fullName,
      },
      create: {
        email: application.email,
        name: application.fullName,
        passwordHash,
      },
    })

    const merchantId = await this.generateMerchantId(tx)

    await tx.merchantApplication.update({
      where: {
        id: application.id,
      },
      data: {
        status: MerchantStatus.approved,
        merchantId,
        userId: user.id,
        reviewedAt: new Date(),
        credentialsGeneratedAt: new Date(),
      },
    })

    return {
      user,
      merchantId,
    }
  })

  let credentialsSent = false

  try {
    await this.resendService.sendMerchantApproval({
      to: application.email,
      fullName: application.fullName,
      storeName: application.storeName,
      loginUrl: 'https://www.seltra.co/auth?next=/dashboard',
      // loginUrl:
      //   process.env.MERCHANT_APP_URL ??
      //   process.env.FRONTEND_LOGIN_URL ??
      //   'https://www.seltra.co/auth?next=/dashboard',
      merchantId: result.merchantId,
      merchantEmail: application.email,
    })

    await prisma.merchantApplication.update({
      where: {
        id: application.id,
      },
      data: {
        welcomeEmailSentAt: new Date(),
      },
    })

    credentialsSent = true
  } catch (err) {
    console.error(err)
  }

  return {
    applicationId: application.id,
    merchantId: result.merchantId,
    email: application.email,
    status: 'approved',
    credentialsSent,
  }
}

//Reject an application with a reason
  async reject(id: string, reason: string) {
    const application = await prisma.merchantApplication.findUnique({ where: { id } })
    if (!application) throw new NotFoundException('Application not found')
    const updated = await prisma.merchantApplication.update({
      where: { id },
      data: {
        status: MerchantStatus.rejected,
        reviewNotes: reason,
        reviewedAt: new Date(),
      },
    })
    return { applicationId: updated.id, status: updated.status }
  }



 
//Helper function to generate a unique merchant ID
private async generateMerchantId(tx: PrismaClient | any): Promise<string> {
  while (true) {
    const left = Math.floor(1000 + Math.random() * 9000)
    const right = Math.floor(1000 + Math.random() * 9000)

    const merchantId = `SELTRA-${left}-${right}`

    const exists = await tx.merchantApplication.findUnique({
      where: { merchantId },
      select: { id: true },
    })

    if (!exists) {
      return merchantId
    }
  }
}


}
